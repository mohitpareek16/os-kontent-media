"""Kontent Bot — `/api/chat`.

Owner and TL only, at the door. Every tool underneath re-checks anyway
(services/ai/tools/base.py), but the bot as a whole is an Owner/TL surface
exactly like analytics, so a QC or VE never gets as far as the model — see
docs/04-permissions.md.

Thin, per docs/07: the loop is `services/ai/agent.py`, the storage rules are
`services/ai/history.py`, and this file decides what becomes an HTTP status
and what becomes an SSE frame.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import require_role
from app.db.session import async_session_factory, get_db
from app.models.chat import ChatConversation, ChatMessage
from app.models.user import LEAD_ROLES, User
from app.schemas.chat import (
    ChatAsk,
    ChatConversationDetail,
    ChatConversationListResponse,
    ChatConversationRead,
    ChatMessageRead,
    ChatStatusRead,
)
from app.services.ai.agent import run_agent
from app.services.ai.history import (
    enforce_daily_cap,
    get_owned_conversation,
    load_history,
    messages_used_today,
    record_exchange,
    start_conversation,
)
from app.services.ai.openrouter import AiRequestError, AiUnavailable, ChatClient, build_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

NOT_CONFIGURED = (
    "Kontent Bot isn't connected yet — no OpenRouter API key is configured on the "
    "server. Everything else about it is built and waiting for that one setting."
)


def get_ai_client() -> ChatClient:
    """A dependency purely so the tests can substitute a scripted client and
    exercise the whole request path without a key or a network call."""
    return build_client()


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@router.get("/status", response_model=ChatStatusRead)
async def chat_status(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role(*LEAD_ROLES)),
):
    settings = get_settings()
    enabled = bool(settings.openrouter_api_key)
    return ChatStatusRead(
        enabled=enabled,
        model=settings.openrouter_model,
        daily_cap=settings.ai_daily_message_cap,
        used_today=await messages_used_today(db, user=user),
        reason=None if enabled else NOT_CONFIGURED,
    )


@router.post("")
async def ask(
    payload: ChatAsk,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role(*LEAD_ROLES)),
    client: ChatClient = Depends(get_ai_client),
):
    """Answer one question, streaming progress as Server-Sent Events.

    Everything that can be decided before the model is involved is decided
    here and answered with a real status code — a 429 buried inside a 200
    stream is a 429 nobody handles. Only failures that happen mid-answer
    travel as an `error` frame.
    """
    settings = get_settings()
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=NOT_CONFIGURED)

    await enforce_daily_cap(db, user=user, cap=settings.ai_daily_message_cap)

    if payload.conversation_id is not None:
        conversation = await get_owned_conversation(
            db, conversation_id=payload.conversation_id, user=user
        )
        history = await load_history(db, conversation_id=conversation.id)
        conversation_id = conversation.id
    else:
        conversation = await start_conversation(db, user=user, first_message=payload.message)
        await db.commit()
        history = []
        conversation_id = conversation.id

    question = payload.message
    user_id = user.id

    async def stream() -> AsyncIterator[str]:
        # The agent runs as its own task and posts frames to a queue the
        # generator drains. Collecting the frames and flushing them at the
        # end would be simpler and would defeat the point: "checking Dhan's
        # delivery stats…" is only useful while the lookup is still running.
        queue: asyncio.Queue[tuple[str, dict] | None] = asyncio.Queue()

        async def emit(event: str, data: dict) -> None:
            await queue.put((event, data))

        async def run() -> None:
            # A session of its own, not the request's. This runs while the
            # response is being sent, which is after FastAPI has already
            # closed the dependency-injected one — using `db` here would
            # work right up until it didn't.
            try:
                async with async_session_factory() as session:
                    stream_user = await session.get(User, user_id)
                    stream_conversation = await session.get(ChatConversation, conversation_id)
                    if stream_user is None or stream_conversation is None:  # pragma: no cover
                        await queue.put(("error", {"detail": "Session went away mid-answer."}))
                        return

                    result = await run_agent(
                        session,
                        stream_user,
                        client=client,
                        question=question,
                        history=history,
                        emit=emit,
                    )
                    tool_calls = [call.as_dict() for call in result.tool_calls]
                    assistant = await record_exchange(
                        session,
                        conversation=stream_conversation,
                        question=question,
                        answer=result.answer,
                        tool_calls=tool_calls,
                        charts=result.charts,
                        model=result.model,
                        usage=result.usage,
                    )
                    await session.commit()
                    await queue.put(
                        (
                            "message",
                            {
                                "message_id": str(assistant.id),
                                "conversation_id": str(conversation_id),
                                "content": result.answer,
                                "tool_calls": tool_calls,
                                "charts": result.charts,
                                "model": result.model,
                                "hit_iteration_cap": result.hit_iteration_cap,
                            },
                        )
                    )
            except AiUnavailable:
                await queue.put(("error", {"detail": NOT_CONFIGURED}))
            except AiRequestError as exc:
                # `code` is only set for the failures someone can fix (an
                # empty balance, a dead key). The UI turns those into
                # instructions; everything else stays a plain message.
                await queue.put(("error", {"detail": str(exc), "code": exc.code}))
            except asyncio.CancelledError:  # pragma: no cover - client hung up
                raise
            except Exception:  # noqa: BLE001 - the stream must always terminate
                logger.exception("chat agent failed for user %s", user_id)
                await queue.put(
                    ("error", {"detail": "Something went wrong answering that. Try again."})
                )
            finally:
                await queue.put(None)

        yield _sse("meta", {"conversation_id": str(conversation_id)})

        task = asyncio.create_task(run())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield _sse(*item)
            yield _sse("done", {})
        finally:
            # The browser navigating away closes the generator; without this
            # the agent would keep spending tokens on an answer nobody will
            # ever read.
            if not task.done():
                task.cancel()

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/conversations", response_model=ChatConversationListResponse)
async def list_conversations(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role(*LEAD_ROLES)),
):
    total = await db.scalar(
        select(func.count(ChatConversation.id)).where(ChatConversation.user_id == user.id)
    )
    result = await db.execute(
        select(ChatConversation)
        .where(ChatConversation.user_id == user.id)
        .order_by(ChatConversation.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return ChatConversationListResponse(
        items=[ChatConversationRead.model_validate(row) for row in result.scalars().all()],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


@router.get("/conversations/{conversation_id}", response_model=ChatConversationDetail)
async def read_conversation(
    conversation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role(*LEAD_ROLES)),
):
    conversation = await get_owned_conversation(db, conversation_id=conversation_id, user=user)
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.conversation_id == conversation.id)
        .order_by(ChatMessage.created_at.asc())
    )
    return ChatConversationDetail(
        id=conversation.id,
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        messages=[ChatMessageRead.model_validate(row) for row in result.scalars().all()],
    )


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role(*LEAD_ROLES)),
):
    conversation = await get_owned_conversation(db, conversation_id=conversation_id, user=user)
    await db.delete(conversation)
    await db.commit()
