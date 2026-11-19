import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job
from app.models.job_event import JobEvent
from app.models.brand_kit_event import BrandKitEvent
from app.models.notification import Notification
from app.models.pod import Pod
from app.services import dispatch


async def notify(
    db: AsyncSession, *, user_id: uuid.UUID, event: JobEvent | BrandKitEvent, channel: str = "in_app"
) -> Notification:
    """Single dispatch point for every notification — never a parallel
    notification path.

    Two further channels hang off it, and neither is a second `channel` row:
    each is a second *delivery* of this one in-app notification, to a browser
    that may have no tab open (`services/push.py`) and to a phone that is
    looking at neither (`services/whatsapp/`, docs/13-whatsapp.md).
    `services/dispatch.py` fans the one queued id out to both.

    So `channel` stays `in_app` on every row, including when a WhatsApp message
    goes out. `routers/notifications.py` does not filter on it, so a second row
    per event would show every item in the inbox twice and double the unread
    count — and a Notification has nowhere to put a `wamid`, a delivery status
    or an error code. That belongs to `whatsapp_messages`, which points back
    here.

    It is deliberately only *queued* here. This runs inside the caller's
    transaction, several statements before the commit that makes the row real,
    and a message sent for a move that then rolled back is a notification with
    nothing behind it. Both channels send after the response, by id — see the
    module docstring in `services/dispatch.py` for why that is what makes it
    correct.
    """
    notification = Notification(
        user_id=user_id,
        event_id=event.id if isinstance(event, JobEvent) else None,
        brand_event_id=event.id if isinstance(event, BrandKitEvent) else None,
        channel=channel,
    )
    db.add(notification)
    await db.flush()
    dispatch.queue(notification.id)
    return notification


# Who owns acting on a job once it enters this stage — see the stage table
# in docs/05-pipeline-and-routing.md. Stages with no new owner (intake,
# editing) are absent and don't notify.
_STAGE_RECIPIENT = {
    "assigned": lambda job, pod: job.assigned_editor_id,
    "qc1": lambda job, pod: pod.tl_id,
    "qc2": lambda job, pod: job.qc2_reviewer_id,
    "revisions": lambda job, pod: job.assigned_editor_id,
    "final": lambda job, pod: pod.tl_id,
    "delivered": lambda job, pod: job.assigned_editor_id,
}


async def notify_stage_change(db: AsyncSession, *, job: Job, pod: Pod, event: JobEvent) -> Notification | None:
    """Notifies whoever now owns the job's next action, based on the stage
    it just entered. Returns None only for stages with no new owner."""
    recipient_fn = _STAGE_RECIPIENT.get(job.stage)
    if recipient_fn is None:
        return None
    recipient_id = recipient_fn(job, pod)
    if recipient_id is None:
        # A job that reached QC2 with nobody to review it used to notify
        # no-one and then sit invisible until someone happened to look. It
        # falls back to the pod TL, who owns the output — and it also shows
        # up in the QC team's unrouted queue (docs/05).
        recipient_id = pod.tl_id if pod is not None else None
        if recipient_id is None:
            return None
    notification = await notify(db, user_id=recipient_id, event=event)
    # QC approval also tells the editor that no further changes are needed.
    # The TL's in-app final-review notification remains intact.
    if job.stage == "final" and job.assigned_editor_id and job.assigned_editor_id != recipient_id:
        await notify(db, user_id=job.assigned_editor_id, event=event)
    # A QC 2 send-back also tells the pod TL, who owns the output.
    if (
        job.stage == "revisions"
        and (event.payload or {}).get("from_stage") == "qc2"
        and pod is not None
        and pod.tl_id
        and pod.tl_id not in (recipient_id, event.actor_id)
    ):
        await notify(db, user_id=pod.tl_id, event=event)
    return notification


async def notify_job_scrapped(
    db: AsyncSession, *, job: Job, pod: Pod, event: JobEvent, actor_id: uuid.UUID
) -> list[Notification]:
    """A scrapped project tells everyone who was holding a piece of it.

    Unlike a stage change, this has no single next owner — the point is that
    there is no next owner. The editor mid-cut, the reviewer with it in their
    queue and the pod TL accountable for the output each need to stop, and
    finding out by noticing a job quietly vanish from a list is how people
    keep working on cancelled briefs. Never back to whoever scrapped it.
    """
    recipients = {job.assigned_editor_id, job.qc2_reviewer_id}
    if pod is not None:
        recipients.add(pod.tl_id)
    recipients.discard(None)
    recipients.discard(actor_id)
    return [await notify(db, user_id=user_id, event=event) for user_id in recipients]


async def notify_job_reassigned(
    db: AsyncSession,
    *,
    job: Job,
    pod: Pod,
    event: JobEvent,
    actor_id: uuid.UUID,
    previous_editor_id: uuid.UUID | None,
) -> list[Notification]:
    """A handover tells both editors and the pod TL.

    Both halves matter and neither is a stage change, so neither is covered by
    `notify_stage_change`: the new editor has work they never asked for and no
    stage moved to tell them, and the person taken off is the one who finds out
    by noticing a job quietly disappear from their list — which is how someone
    keeps cutting a video that is no longer theirs. The TL is told because they
    own the pod's output and the handover may not have been their call.
    Never back to whoever made the change.
    """
    recipients = {job.assigned_editor_id, previous_editor_id}
    if pod is not None:
        recipients.add(pod.tl_id)
    recipients.discard(None)
    recipients.discard(actor_id)
    return [await notify(db, user_id=user_id, event=event) for user_id in recipients]


async def notify_qc1_flag(
    db: AsyncSession,
    *,
    job: Job,
    pod: Pod,
    event: JobEvent,
    actor_id: uuid.UUID,
    tl_id: uuid.UUID | None,
) -> list[Notification]:
    """A QC1 flag tells the person it is about, and the pod TL.

    The first is not optional and is the whole point: a flag someone finds out
    about from a dashboard tint weeks later is an accusation made behind their
    back, and the answer to "I did review that one, over their shoulder" is
    worth having while anyone still remembers the cut. `tl_id` is whoever
    cleared QC1 — usually the pod TL, not always, which is why both are here
    and why the set is deduplicated. Never back to the reviewer who raised it.

    Cleared flags come through here too: the same two people need to know it
    was withdrawn as needed to know it was raised.
    """
    recipients = {tl_id}
    if pod is not None:
        recipients.add(pod.tl_id)
    if job.qc1_flagged_by_id is not None:
        # On a *clear*, the reviewer who raised it is the one being answered.
        recipients.add(job.qc1_flagged_by_id)
    recipients.discard(None)
    recipients.discard(actor_id)
    return [await notify(db, user_id=user_id, event=event) for user_id in recipients]


async def notify_note(
    db: AsyncSession, *, job: Job, pod: Pod, event: JobEvent, author_id
) -> Notification | None:
    """A comment left without moving the job goes to whoever currently owns
    the stage — the person expected to act on it. Never back to its own
    author."""
    recipient_fn = _STAGE_RECIPIENT.get(job.stage)
    recipient_id = recipient_fn(job, pod) if recipient_fn else None
    if recipient_id is None and pod is not None:
        recipient_id = pod.tl_id
    if recipient_id is None or recipient_id == author_id:
        return None
    return await notify(db, user_id=recipient_id, event=event)
