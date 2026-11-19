import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job_event import JobEvent


async def record_event(
    db: AsyncSession, *, job_id: uuid.UUID, event_type: str, actor_id: uuid.UUID, payload: dict
) -> JobEvent:
    """Every job-stage change goes through here — never insert a JobEvent
    row directly from a router. See docs/07-backend-rules.md."""
    event = JobEvent(job_id=job_id, event_type=event_type, actor_id=actor_id, payload=payload)
    db.add(event)
    await db.flush()
    return event
