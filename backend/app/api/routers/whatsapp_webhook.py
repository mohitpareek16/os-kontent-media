"""The public endpoint Meta calls. No authentication, by necessity.

This is the only unauthenticated route in the application that can change a
job's stage, so read the three rules before changing anything here.

**1. The signature is the entire security model.** Meta signs every POST with
`X-Hub-Signature-256`, an HMAC-SHA256 of the *raw request body* under the app
secret. Verified with `hmac.compare_digest`, against `await request.body()` —
never against a re-serialised copy of the parsed JSON, which produces different
bytes (key order, whitespace, unicode escaping) and fails for every legitimate
call. With no app secret configured the endpoint refuses everything rather than
trusting everything: an integration that is not set up should be closed, not
open.

**2. Answer 200 fast, and think afterwards.** Meta retries any delivery that
does not get a prompt 2xx, and after enough failures it disables the
subscription — which looks exactly like "WhatsApp stopped working" with nothing
in the log that resembles a cause. So the handler persists the raw event and
returns; the processing happens in a background task, in its own session.

**3. Nothing here is trusted because it arrived signed.** The signature proves
Meta sent it. It says nothing about whether the person holding that phone may
move that job — `services/whatsapp/inbound.py` re-checks that through the same
`stage_machine.can_advance` the HTTP route uses.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging

from fastapi import APIRouter, Request, Response, status
from fastapi.responses import PlainTextResponse
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.db.session import async_session_factory
from app.models.whatsapp import WhatsAppWebhookEvent
from app.services import dispatch
from app.services.whatsapp import inbound

logger = logging.getLogger("app.whatsapp")

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])

# Live references to in-flight processing. asyncio holds only a weak reference
# to a task, so without this one can be collected mid-run — an event that
# vanishes under load and never under test. Same reason as `_dispatch_tasks`
# in main.py.
_webhook_tasks: set[asyncio.Task] = set()


@router.get("/webhook")
async def verify_webhook(request: Request):
    """Meta's one-time handshake: echo `hub.challenge` if the token matches.

    Returns the challenge as **plain text**, not JSON. Meta compares the body
    byte for byte, and a JSON-quoted number does not match the number.
    """
    settings = get_settings()
    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge", "")

    if not settings.whatsapp_verify_token:
        logger.warning("WhatsApp webhook verification attempted with no verify token configured")
        return Response(status_code=status.HTTP_403_FORBIDDEN)
    if mode != "subscribe" or not hmac.compare_digest(
        token or "", settings.whatsapp_verify_token
    ):
        return Response(status_code=status.HTTP_403_FORBIDDEN)
    return PlainTextResponse(challenge)


@router.post("/webhook")
async def receive_webhook(request: Request):
    """Verify, persist, answer 200, process in the background."""
    settings = get_settings()
    raw = await request.body()

    if not settings.whatsapp_app_secret:
        # Closed by default. An unconfigured integration that accepted anything
        # would be an open door into the pipeline for as long as nobody noticed.
        logger.warning("WhatsApp webhook received with no app secret configured — refused")
        return Response(status_code=status.HTTP_403_FORBIDDEN)

    signature = request.headers.get("X-Hub-Signature-256", "")
    if not _signature_ok(raw, signature, settings.whatsapp_app_secret):
        logger.warning("WhatsApp webhook signature mismatch — refused")
        return Response(status_code=status.HTTP_403_FORBIDDEN)

    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        # Signed but unparseable. 200 anyway: retrying will not make it parse,
        # and a 4xx here would have Meta redeliver it until the subscription is
        # disabled.
        logger.warning("WhatsApp webhook body was not JSON")
        return {"status": "ignored"}

    stored = await _persist(body)
    if stored:
        task = asyncio.create_task(_process(stored))
        _webhook_tasks.add(task)
        task.add_done_callback(_webhook_tasks.discard)
    return {"status": "ok"}


def _signature_ok(raw: bytes, header: str, secret: str) -> bool:
    """Constant-time compare against the raw body.

    `compare_digest` rather than `==`: this compares a secret-derived value
    against attacker-supplied input, and a short-circuiting comparison leaks
    how many leading bytes were right.
    """
    if not header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header[len("sha256=") :])


async def _persist(body: dict) -> list[tuple[str, dict]]:
    """Store one row per distinct event, and return the ones that were new.

    The unique index on `dedupe_key` is the lock. Two workers handed the same
    retry both try the insert; one wins, the other catches `IntegrityError` and
    processes nothing. That is what stops a redelivered button tap advancing a
    job twice — and it works across processes, which an in-memory set would not.
    """
    fresh: list[tuple[str, dict]] = []
    try:
        async with async_session_factory() as db:
            for entry in body.get("entry", []) or []:
                for change in entry.get("changes", []) or []:
                    field = change.get("field") or ""
                    value = change.get("value") or {}
                    for key in inbound.dedupe_keys(field, value):
                        row = WhatsAppWebhookEvent(
                            dedupe_key=key[:255], field=field, payload=value
                        )
                        db.add(row)
                        try:
                            await db.flush()
                        except IntegrityError:
                            # Already seen. Roll back just this insert and move
                            # on — `flush` leaves the session unusable otherwise.
                            await db.rollback()
                            continue
                        fresh.append((key[:255], {"field": field, "value": value}))
            await db.commit()
    except Exception:
        logger.exception("WhatsApp webhook could not be persisted")
        return []
    return fresh


async def _process(stored: list[tuple[str, dict]]) -> None:
    """Apply each new event, in its own session, after the response.

    **The notification queue is opened and drained here**, because processing
    an event can create notifications and there is no request around this to do
    it. A "Can't take it" tap writes a `note_added` event for whoever owns the
    stage (`inbound._record_decline`), and `notify()` queues that id exactly as
    it would on an HTTP route — but `dispatch.begin_request()` is what the
    middleware normally calls, and no middleware runs for a background task.
    Without these two lines the row would be written and the desktop push and
    the WhatsApp message for it would silently never go out.

    Drained *after* the commit, for the same reason the middleware drains after
    the response: a notification whose transaction rolled back must announce
    nothing.

    Never raises. An exception escaping a background task can take the worker
    with it, and a webhook that was not understood is a far smaller problem
    than an API that falls over when Meta sends something new.
    """
    from sqlalchemy import select

    for key, entry in stored:
        try:
            dispatch.begin_request()
            async with async_session_factory() as db:
                await inbound.process(db, field=entry["field"], value=entry["value"])
                row = (
                    await db.execute(
                        select(WhatsAppWebhookEvent).where(
                            WhatsAppWebhookEvent.dedupe_key == key
                        )
                    )
                ).scalar_one_or_none()
                if row is not None:
                    row.processed_at = _utcnow()
                await db.commit()
            await dispatch.flush(dispatch.take_pending())
        except Exception as exc:
            # Whatever was queued for a failed event is dropped rather than
            # sent: the transaction behind it did not commit.
            dispatch.take_pending()
            logger.exception("WhatsApp webhook processing failed for %s", entry.get("field"))
            await _record_failure(key, exc)


def _utcnow():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc)


async def _record_failure(key: str, exc: Exception) -> None:
    """Put the error on the stored row, so the admin page can show that
    something arrived and could not be understood."""
    from sqlalchemy import select

    try:
        async with async_session_factory() as db:
            row = (
                await db.execute(
                    select(WhatsAppWebhookEvent).where(WhatsAppWebhookEvent.dedupe_key == key)
                )
            ).scalar_one_or_none()
            if row is not None:
                row.error = f"{exc.__class__.__name__}: {exc}"[:2000]
                row.processed_at = _utcnow()
            await db.commit()
    except Exception:
        logger.exception("WhatsApp webhook failure could not be recorded")
