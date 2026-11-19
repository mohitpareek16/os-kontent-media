"""Turning the notifications this request created into WhatsApp messages.

The second half of the pattern `services/push.py` established, and it works
for the same reason. `notify()` only queues an id; this runs after the
response, in a fresh session, and reads those ids back out of the database. A
notification whose transaction rolled back is simply not there, so nothing is
sent for it — no outbox table, no second commit, no reconciliation. The
database already knows.

Everything here is best-effort by construction. It runs in a background task,
so an exception escaping would take the worker with it, and a message that did
not arrive is a far better outcome than that. `send_template` already refuses
to raise; this adds the outer net for everything around it.
"""
from __future__ import annotations

import logging
import uuid

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.job import Job
from app.models.job_event import JobEvent
from app.models.notification import Notification
from app.models.pod import Pod
from app.models.user import User
from app.models.video_type import VideoType
from app.services.whatsapp import events, send
from app.services.whatsapp.client import whatsapp_enabled

logger = logging.getLogger("app.whatsapp")

def deadline_label(job: Job) -> str:
    """The **team** deadline, formatted for a phone.

    Never `client_deadline`. That date is visible to the Owner and the pod TL
    alone (docs/03, docs/04) and this message goes to editors and reviewers —
    putting it in a WhatsApp bubble would leak it past every check the product
    makes, to a surface with no permissions on it at all.
    """
    if job.deadline is None:
        return "no deadline set"
    return job.deadline.strftime("%d %b")


async def flush(notification_ids: list[uuid.UUID]) -> None:
    """Send a WhatsApp message for every queued notification that warrants one."""
    if not notification_ids or not whatsapp_enabled():
        return
    try:
        async with async_session_factory() as db:
            rows = (
                await db.execute(
                    select(Notification, JobEvent, Job, Pod, User)
                    .join(JobEvent, JobEvent.id == Notification.event_id)
                    .join(Job, Job.id == JobEvent.job_id)
                    .outerjoin(Pod, Pod.id == Job.pod_id)
                    .join(User, User.id == Notification.user_id)
                    .where(Notification.id.in_(notification_ids))
                )
            ).all()
            for notification, event, job, pod, recipient in rows:
                await _send_one(db, notification, event, job, pod, recipient)
            await db.commit()
    except Exception:
        logger.exception(
            "WhatsApp fan-out failed for %s notifications", len(notification_ids)
        )


async def _send_one(db, notification, event, job, pod, recipient) -> None:
    key = events.event_key(event.event_type, event.payload)
    template_name = events.template_for(
        key=key, job=job, recipient_id=recipient.id, payload=event.payload
    )
    if template_name is None:
        # Tier 3: in-app only. Most events land here and that is the design —
        # see the module docstring in `events.py` on volume.
        return

    # Resolved separately rather than joined above: the actor may be a
    # deactivated account or, on a system-initiated routing event, not the
    # person the message is about. An outer join for a name is not worth
    # complicating the main query with.
    actor_name = None
    if event.actor_id is not None:
        actor = await db.get(User, event.actor_id)
        actor_name = actor.name if actor is not None else None

    payload = dict(event.payload or {})
    context = events.build_context(
        job=job,
        pod=pod,
        recipient=recipient,
        actor_name=actor_name,
        payload=payload,
        video_type_label=(await db.get(VideoType, job.video_type)).label,
        deadline_label=deadline_label(job),
    )
    await send.send_template(
        db,
        recipient=recipient,
        template_name=template_name,
        context=context,
        event_key=key,
        job=job,
        notification_id=notification.id,
    )
