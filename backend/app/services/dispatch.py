"""One queue of notifications per request, delivered after the response.

`services/notify.py::notify` is the single dispatch point every notification
goes through, and it promised its second channel would hang off it rather than
beside it. There are now two — desktop push and WhatsApp — and this is the
thing they hang off.

**Why the queue is here and not in `push.py`.** It used to live there, which
was right while push was the only consumer: an id was recorded in a ContextVar
and flushed after the response. But `push.queue()` dropped everything when
VAPID keys were absent, so on a deployment with WhatsApp configured and push
not, the queue was empty and nothing was ever sent. The queue belongs to the
notification, not to one of its deliveries.

**Why the flush is after the response, and not simply a call.** `notify()`
runs inside the caller's transaction, several statements before the commit
that makes the notification real. Sending from there announces work that a
later failure rolled back — "KM-1042 is yours" for a stage change that never
happened, which is worse than silence because there is nothing on the board to
correct it with. Each channel's flush re-reads the ids in a fresh session, so
a rolled-back notification is simply absent and nothing is sent. That is what
makes this correct without an outbox table.

**Channels are isolated from each other.** One failing must not stop the
other: a WhatsApp outage that also killed desktop notifications would turn a
degraded channel into a total one. Each is awaited inside its own try.

Both flushes run their own query rather than sharing one. That is a deliberate
duplication: it keeps each channel's flush independently testable and
monkeypatchable — `tests/api/test_push_notifications.py` patches `push.flush`
by attribute — and two indexed reads of a handful of ids is not a cost worth
coupling two delivery paths to avoid.
"""
from __future__ import annotations

import logging
import uuid
from contextvars import ContextVar

from app.services import push
from app.services.whatsapp import fanout
from app.services.whatsapp.client import whatsapp_enabled

logger = logging.getLogger("app.dispatch")

# Ids recorded during this request, flushed after the response. A ContextVar
# rather than a module-level list: requests run concurrently on one event loop
# and a shared list would deliver one person's notifications on another
# person's response.
_pending: ContextVar[list[uuid.UUID] | None] = ContextVar("pending_dispatch", default=None)


def any_channel_enabled() -> bool:
    return push.push_enabled() or whatsapp_enabled()


def begin_request() -> None:
    """Start a fresh list for this request. Called by the middleware."""
    _pending.set([])


def queue(notification_id: uuid.UUID) -> None:
    """Remember to deliver this once the transaction has actually committed.

    Does nothing outside a request (seed scripts, test factories) and nothing
    when every channel is off. `notify()` must not have to know which of those
    it is in.
    """
    pending = _pending.get()
    if pending is None or not any_channel_enabled():
        return
    pending.append(notification_id)


def take_pending() -> list[uuid.UUID]:
    """Hand over what was queued and clear it, so a flush cannot run twice."""
    pending = _pending.get()
    _pending.set([])
    return pending or []


async def flush(notification_ids: list[uuid.UUID]) -> None:
    """Deliver every queued notification on every enabled channel."""
    if not notification_ids:
        return
    # Looked up through the module rather than imported by name so that a test
    # monkeypatching `push.flush` still intercepts it here.
    try:
        await push.flush(notification_ids)
    except Exception:
        logger.exception("push flush failed for %s notifications", len(notification_ids))
    try:
        await fanout.flush(notification_ids)
    except Exception:
        logger.exception("whatsapp flush failed for %s notifications", len(notification_ids))
