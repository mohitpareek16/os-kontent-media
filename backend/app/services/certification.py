import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job
from app.models.pod_member import PodMember

# Threshold rationale: docs/05-pipeline-and-routing.md
CERT_THRESHOLD_DELIVERIES = 3
CERT_MAX_ROUNDS = 1


async def is_certified(db: AsyncSession, *, user_id: uuid.UUID, pod_id: uuid.UUID) -> bool:
    result = await db.execute(
        select(Job.round).where(
            Job.pod_id == pod_id,
            Job.assigned_editor_id == user_id,
            Job.stage == "delivered",
        )
    )
    rounds = result.scalars().all()
    clean_deliveries = sum(1 for r in rounds if r <= CERT_MAX_ROUNDS)
    return clean_deliveries >= CERT_THRESHOLD_DELIVERIES


async def refresh_certification(db: AsyncSession, *, user_id: uuid.UUID, pod_id: uuid.UUID) -> None:
    """Call after a delivery. Computed, not manually maintained — nobody
    should ever set PodMember.certified_at directly. See docs/05."""
    member = await db.get(PodMember, {"pod_id": pod_id, "user_id": user_id})
    if member is None or member.certified_at is not None:
        return
    if await is_certified(db, user_id=user_id, pod_id=pod_id):
        member.certified_at = datetime.now(timezone.utc)
