"""Web Push: the half of a notification that arrives when nobody is looking.

`services/notify.py::notify` is the single dispatch point every notification
in this app goes through — it always was, and its docstring promised the next
channel would hang off it rather than beside it. This is that channel.

**How it hangs off it, and why it is not just a call.**

`notify()` runs inside the request's transaction, several statements before
the commit that makes the notification real. Sending from there would push for
work that a later failure rolled back — "KM-1042 is yours" for a stage change
that never happened, which is worse than silence, because there is nothing on
the board to correct it with.

So `notify()` only records the notification's **id** in a queue, and `flush()`
runs after the response has been sent, in a fresh session. It loads those ids
back out of the database, and that is what makes this correct for free: a
notification whose transaction rolled back is simply not there, so nothing is
sent. No outbox table, no second commit, no "did this really happen"
bookkeeping — the database already knows.

The queue itself lives in `services/dispatch.py` rather than here. It used to
be this module's `ContextVar`, which was right while push was the only
consumer — but it dropped everything when VAPID keys were absent, so a
deployment with WhatsApp configured and push not had an empty queue and sent
nothing. The queue belongs to the notification, not to one of its deliveries.

**Why a thread.** `pywebpush` is synchronous and talks to Google's and
Mozilla's servers. Blocking the event loop while a socket to FCM hangs would
stall every other request on the worker, so each send goes through
`anyio.to_thread.run_sync`.

**What a failure means.** A 404 or 410 from a push service is the browser
saying "this subscription is gone" — the row is deleted, because a
subscription that answers 410 answers 410 forever. Anything else is logged and
dropped: a push that did not arrive is a worse day, an exception escaping a
background task is a crashed worker.
"""
import json
import logging
import uuid

import anyio
from sqlalchemy import delete, select

from app.core.config import get_settings
from app.db.session import async_session_factory
from app.models.job import Job
from app.models.brand_kit_event import BrandKitEvent
from app.models.job_event import JobEvent
from app.models.notification import Notification
from app.models.pod import Pod
from app.models.push_subscription import PushSubscription
from app.models.user import User
from app.services.notification_text import body_for, brand_headline_for, headline_for

logger = logging.getLogger("app.push")

# How long a push service holds an undelivered message. A hand-off nobody saw
# for a day is not news any more, and a stale one waking a laptop on Monday
# morning is noise.
PUSH_TTL_SECONDS = 6 * 60 * 60


def push_enabled() -> bool:
    """Whether this deployment has VAPID keys at all.

    Empty keys are the normal state of a fresh checkout and of the test
    database, so every entry point asks rather than assuming — the same shape
    as the OpenRouter key in `core/config.py`.
    """
    settings = get_settings()
    return bool(settings.vapid_public_key and settings.vapid_private_key)


async def flush(notification_ids: list[uuid.UUID]) -> None:
    """Send every queued notification, in its own session.

    The request's session is closed by the time this runs — that is the point.
    Re-reading the rows here is what makes a rolled-back transaction send
    nothing at all.
    """
    if not notification_ids or not push_enabled():
        return
    try:
        async with async_session_factory() as db:
            rows = await db.execute(
                select(Notification, JobEvent, Job, Pod.name, User.name)
                .join(JobEvent, JobEvent.id == Notification.event_id)
                .join(Job, Job.id == JobEvent.job_id)
                .join(Pod, Pod.id == Job.pod_id)
                .outerjoin(User, User.id == JobEvent.actor_id)
                .where(Notification.id.in_(notification_ids))
            )
            for notification, event, job, pod_name, actor_name in rows.all():
                note = event.payload.get("note") or event.payload.get("reason")
                await send_to_user(
                    db,
                    user_id=notification.user_id,
                    title=headline_for(
                        event_type=event.event_type,
                        job_code=job.code,
                        actor_name=actor_name,
                        stage=event.payload.get("stage"),
                    ),
                    body=body_for(job_title=job.title, pod_name=pod_name, note=note),
                    url=f"/jobs/{job.id}",
                    # The notification's own id, so a push and the in-app poll
                    # for the same event collapse into one notification on
                    # screen rather than arriving as two.
                    tag=str(notification.id),
                )
            brand_rows = await db.execute(
                select(Notification, BrandKitEvent, Pod.name, User.name)
                .join(BrandKitEvent, BrandKitEvent.id == Notification.brand_event_id)
                .join(Pod, Pod.id == BrandKitEvent.pod_id)
                .outerjoin(User, User.id == BrandKitEvent.actor_id)
                .where(Notification.id.in_(notification_ids))
            )
            for notification, event, pod_name, actor_name in brand_rows.all():
                await send_to_user(
                    db, user_id=notification.user_id,
                    title=brand_headline_for(action=event.action, actor_name=actor_name, title=event.title, pod_name=pod_name),
                    body=body_for(job_title=event.title, pod_name=pod_name, note=event.note),
                    url=f"/pods/{event.pod_id}/brand-assets?history=1", tag=str(notification.id),
                )
            await db.commit()
    except Exception:
        # A background task that raises takes nothing useful with it and can
        # take the worker with it. A missed push is survivable.
        logger.exception("push flush failed for %s notifications", len(notification_ids))


async def send_to_user(db, *, user_id: uuid.UUID, title: str, body: str, url: str, tag: str) -> int:
    """Push one message to every browser this person has registered.

    Returns how many were delivered, which is what the test endpoint reports
    back: "sent to 0 browsers" is a far more useful answer than silence when
    somebody presses the test button and hears nothing.
    """
    if not push_enabled():
        return 0
    subs = (
        (await db.execute(select(PushSubscription).where(PushSubscription.user_id == user_id)))
        .scalars()
        .all()
    )
    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
    dead: list[uuid.UUID] = []
    sent = 0
    for sub in subs:
        result = await anyio.to_thread.run_sync(
            _send_one, sub.endpoint, sub.p256dh, sub.auth, payload
        )
        if result is None:
            dead.append(sub.id)
        elif result:
            sent += 1
    if dead:
        # Gone means gone. Left in place, these rows would be retried on every
        # notification for the rest of the deployment's life.
        await db.execute(delete(PushSubscription).where(PushSubscription.id.in_(dead)))
    return sent


def _send_one(endpoint: str, p256dh: str, auth: str, payload: str):
    """One blocking send, run in a worker thread.

    Returns True on success, False on a transient failure, and **None** when
    the push service says the subscription is gone (404/410) — three outcomes
    the caller treats differently, which a bare bool could not express.

    Imported inside the function so the app still boots without `pywebpush`
    installed, which is the state of any checkout that has not re-run
    `pip install -r requirements.txt` yet.
    """
    from pywebpush import WebPushException, webpush

    settings = get_settings()
    try:
        webpush(
            subscription_info={
                "endpoint": endpoint,
                "keys": {"p256dh": p256dh, "auth": auth},
            },
            data=payload,
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
            ttl=PUSH_TTL_SECONDS,
        )
        return True
    except WebPushException as exc:
        status = getattr(exc.response, "status_code", None)
        if status in (404, 410):
            return None
        logger.warning("push send failed (%s): %s", status, exc)
        return False
    except Exception:
        logger.exception("push send raised")
        return False
