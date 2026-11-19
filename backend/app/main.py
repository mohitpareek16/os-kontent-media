import asyncio
import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routers import api_router
from app.core.config import get_settings
from app.services import dispatch
from app.services.cleanup_expired_notes import cleanup_loop
from app.services.whatsapp.scheduler import scheduler_loop

settings = get_settings()

logger = logging.getLogger("app")

# Uvicorn configures its own loggers and leaves the root one bare, so anything
# this app logs would go nowhere at all — which is exactly the failure the
# handler below exists to prevent. Set only if nothing else has: under pytest
# and under `--log-config`, whoever configured it wins.
if not logging.getLogger().handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Two self-rescheduling asyncio loops, no external scheduler. The first
    # deletes voice notes past their retention window; the second reconciles
    # WhatsApp template status with Meta and sends the messages that fire on a
    # date rather than on a move — deadlines, stuck rounds, jobs still
    # unclaimed at QC2, the morning digest. The WhatsApp loop ticks and returns
    # immediately while the integration is unconfigured or switched off.
    tasks = [
        asyncio.create_task(cleanup_loop()),
        asyncio.create_task(scheduler_loop()),
    ]
    yield
    for task in tasks:
        task.cancel()


# Live references to in-flight deliveries. asyncio only holds a weak
# reference to a task, so without this a flush can be garbage-collected
# half-sent — a notification that vanishes under load and never under test.
_dispatch_tasks: set[asyncio.Task] = set()


class NotificationDispatchMiddleware:
    """Deliver the notifications this request created, once it is done.

    `services/notify.py::notify` only *queues* an id. It runs inside the
    caller's transaction, several statements before the commit that makes the
    notification real, and sending from there would announce work that a later
    failure rolled back. This is the other half: after the response,
    `dispatch.flush` reads those ids back out of the database in a fresh
    session and fans them out to desktop push and WhatsApp, so a notification
    that never committed is simply not there and nothing is sent for it.

    **Only on a 2xx.** A 4xx is a refusal — there is nothing to announce. A 5xx
    is worse than nothing: the caller has already been told it failed, so
    announcing "KM-1042 is yours" on top is the app contradicting itself on
    two screens — and on WhatsApp, in a message that cannot be taken back.
    `status_code` starts at 500 so a request that dies before sending a
    response head also sends nothing.

    Written as raw ASGI rather than `@app.middleware("http")`, which is
    `BaseHTTPMiddleware`: that one runs the app in a child task and wraps the
    response body, which this app cannot afford — `/api/chat` streams SSE and
    two routes return `FileResponse`. Raw ASGI also keeps the handler in *this*
    task, so the `ContextVar` the queue lives in is unambiguously the same one.

    `create_task`, so the response is not held open while three browsers are
    reached over somebody else's network.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        dispatch.begin_request()
        status_code = 500

        async def send_wrapper(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            pending = dispatch.take_pending()
            if pending and 200 <= status_code < 300:
                task = asyncio.create_task(dispatch.flush(pending))
                _dispatch_tasks.add(task)
                task.add_done_callback(_dispatch_tasks.discard)


app = FastAPI(title="Kontent OS API", lifespan=lifespan)

app.add_middleware(NotificationDispatchMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Turn a crash into something both halves of a bug report can use.

    Starlette's default for an unhandled exception is a **plain-text** body
    reading "Internal Server Error". Every deliberate rejection in this API is
    an `HTTPException` and arrives as `{"detail": "..."}`, and the frontend
    reads that `detail` to tell the user what went wrong
    (`components/ui/ErrorNote.tsx`). A plain-text body has no `detail`, so the
    UI fell back to its generic sentence — and a crash became visually
    identical to a refused move.

    That cost us a real afternoon: an editor pressing "Mark as edited — send
    for QC" in production got "Could not move the job", which reads as *the
    server considered this and said no*. It wasn't a rejection at all; it was
    an exception, and nothing on screen or in the reply distinguished the two.

    So: the traceback goes to the log with a short reference on it, and the
    same reference goes to the browser inside a `detail` the UI already knows
    how to render. The user can then quote four characters and somebody can
    `grep` for them. The message deliberately says nothing about what broke —
    the client is not the audience for a stack trace, and guessing a friendly
    cause is how people get told the wrong thing confidently.
    """
    ref = uuid.uuid4().hex[:6].upper()
    logger.exception(
        "Unhandled error %s on %s %s", ref, request.method, request.url.path, exc_info=exc
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": (
                f"Something broke on our side, not with what you did — reference {ref}. "
                "It is in the server log; send that reference on."
            )
        },
    )


app.include_router(api_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
