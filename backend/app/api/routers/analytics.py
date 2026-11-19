import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_pod_lead
from app.db.session import get_db
from app.models.job import Job
from app.models.user import User
from app.schemas.job import JobRead
from app.services.access import not_scrapped

router = APIRouter(prefix="/pods/{pod_id}/analytics", tags=["analytics"])


@router.get("/stage-distribution")
async def stage_distribution(
    pod_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_pod_lead),
):
    result = await db.execute(
        select(Job.stage, func.count(Job.id))
        .where(Job.pod_id == pod_id, not_scrapped())
        .group_by(Job.stage)
    )
    return {stage: count for stage, count in result.all()}


@router.get("/first-pass-rate")
async def first_pass_rate(
    pod_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_pod_lead),
):
    result = await db.execute(select(Job.round).where(Job.pod_id == pod_id, Job.stage == "delivered"))
    rounds = result.scalars().all()
    if not rounds:
        return {"first_pass_rate": None, "avg_rounds": None}
    clean = sum(1 for r in rounds if r == 0)
    return {"first_pass_rate": clean / len(rounds), "avg_rounds": sum(rounds) / len(rounds)}


@router.get("/avg-rounds-by-editor")
async def avg_rounds_by_editor(
    pod_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_pod_lead),
):
    """Team-level analytics (Owner/pod-TL only, see docs/04-permissions.md)
    — a per-editor breakdown is exactly the cross-editor leaderboard VEs
    must never see, so this is gated same as the rest of this router, not
    exposed as anyone's 'own trend' view."""
    result = await db.execute(
        select(Job.assigned_editor_id, Job.round).where(
            Job.pod_id == pod_id, Job.stage == "delivered", Job.assigned_editor_id.is_not(None)
        )
    )
    by_editor: dict[uuid.UUID, list[int]] = {}
    for editor_id, round_count in result.all():
        by_editor.setdefault(editor_id, []).append(round_count)
    return {
        str(editor_id): sum(rounds) / len(rounds) for editor_id, rounds in by_editor.items()
    }


@router.get("/stuck-jobs", response_model=list[JobRead])
async def stuck_jobs(
    pod_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_pod_lead),
):
    """The 3+ round flag — see docs/05-pipeline-and-routing.md: a job stuck
    at round 4 is almost always a briefing problem, not an editor problem."""
    result = await db.execute(
        select(Job).where(
            Job.pod_id == pod_id, Job.round >= 3, Job.stage != "delivered", not_scrapped()
        )
    )
    return result.scalars().all()
