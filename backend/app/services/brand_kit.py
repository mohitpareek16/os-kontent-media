import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.brand_kit_event import BrandKitEvent
from app.models.pod import Pod
from app.models.pod_member import PodMember
from app.services.notify import notify


async def record_brand_change(
    db: AsyncSession, *, pod_id: uuid.UUID, actor_id: uuid.UUID, action: str,
    title: str, before: dict | None = None, after: dict | None = None, note: str | None = None,
) -> BrandKitEvent:
    event = BrandKitEvent(
        pod_id=pod_id, actor_id=actor_id, action=action, title=title,
        before=before, after=after, note=note.strip() or None if note else None,
    )
    db.add(event)
    await db.flush()
    pod = await db.get(Pod, pod_id)
    members = (await db.execute(select(PodMember.user_id).where(PodMember.pod_id == pod_id))).scalars()
    recipients = set(members)
    if pod:
        recipients.add(pod.tl_id)
    for user_id in recipients - {actor_id}:
        await notify(db, user_id=user_id, event=event)
    return event
