"""Client-pod health — "how is Dhan doing".

One call rather than four, because the four analytics endpoints
(`stage-distribution`, `first-pass-rate`, `avg-rounds-by-editor`,
`stuck-jobs`) are always read together to answer this question, and four
round-trips through the model is four times the latency and cost for the
same answer.

Gated by `check_pod_lead` — the identical guard on
`/pods/{id}/analytics/*`. A TL who merely sits in another TL's pod as a
member gets the same 403 here that they get there.
"""
from __future__ import annotations

import uuid
from datetime import date

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import check_pod_lead
from app.models.job import Job
from app.models.pod import Pod
from app.models.pod_member import PodMember
from app.models.user import User
from app.services.access import not_scrapped
from app.services.ai.tools.base import tool

STUCK_ROUNDS = 3


class PodHealthArgs(BaseModel):
    pod_id: uuid.UUID = Field(description="From resolve_entity. Never guess this.")
    delivered_from: date | None = Field(
        default=None,
        description="Start of the delivery window, YYYY-MM-DD. Omit for all time.",
    )
    delivered_to: date | None = Field(
        default=None, description="End of the delivery window, YYYY-MM-DD, inclusive."
    )


@tool(
    name="get_pod_health",
    description=(
        "Delivery and quality summary for one client pod: how many jobs are at each "
        "stage right now, deliveries in a date window, first-pass rate, average QC "
        "rounds, overdue jobs and jobs stuck at 3+ rounds. This is the tool for "
        "'how is this client doing'."
    ),
    args_model=PodHealthArgs,
)
async def get_pod_health(db: AsyncSession, user: User, args: PodHealthArgs) -> dict:
    await check_pod_lead(db, args.pod_id, user)

    pod = await db.get(Pod, args.pod_id)
    if pod is None:
        return {"error": "No such pod."}

    stage_rows = await db.execute(
        select(Job.stage, func.count(Job.id))
        .where(Job.pod_id == pod.id, not_scrapped())
        .group_by(Job.stage)
    )
    stage_distribution = {stage: count for stage, count in stage_rows.all()}

    delivered_clauses = [Job.pod_id == pod.id, Job.stage == "delivered"]
    if args.delivered_from is not None:
        delivered_clauses.append(func.date(Job.delivered_at) >= args.delivered_from)
    if args.delivered_to is not None:
        delivered_clauses.append(func.date(Job.delivered_at) <= args.delivered_to)

    rounds_result = await db.execute(select(Job.round).where(*delivered_clauses))
    rounds = list(rounds_result.scalars().all())

    overdue_result = await db.execute(
        select(func.count(Job.id)).where(
            Job.pod_id == pod.id,
            Job.stage != "delivered",
            not_scrapped(),
            Job.deadline.is_not(None),
            Job.deadline < date.today(),
        )
    )
    stuck_result = await db.execute(
        select(Job.code, Job.title, Job.stage, Job.round).where(
            Job.pod_id == pod.id,
            Job.round >= STUCK_ROUNDS,
            Job.stage != "delivered",
            not_scrapped(),
        )
    )
    members_result = await db.execute(
        select(PodMember.pod_role, func.count(PodMember.user_id))
        .where(PodMember.pod_id == pod.id)
        .group_by(PodMember.pod_role)
    )

    clean = sum(1 for r in rounds if r == 0)
    return {
        "pod": {
            "pod_id": str(pod.id),
            "name": pod.name,
            "status": pod.status,
            "retainer_volume_per_month": pod.retainer_volume,
        },
        "delivery_window": {
            "from": args.delivered_from.isoformat() if args.delivered_from else None,
            "to": args.delivered_to.isoformat() if args.delivered_to else None,
        },
        "delivered_in_window": len(rounds),
        # None rather than a made-up 100%: a pod with no deliveries yet has no
        # first-pass rate, and saying "100%" about it is a lie the Overview
        # page used to tell.
        "first_pass_rate": (clean / len(rounds)) if rounds else None,
        "avg_qc_rounds": (sum(rounds) / len(rounds)) if rounds else None,
        # Current state, NOT filtered by the delivery window above.
        "stage_distribution_now": stage_distribution,
        "open_jobs_now": sum(v for k, v in stage_distribution.items() if k != "delivered"),
        "overdue_now": overdue_result.scalar_one(),
        "stuck_jobs_now": [
            {"code": code, "title": title, "stage": stage, "rounds": rounds_count}
            for code, title, stage, rounds_count in stuck_result.all()
        ],
        "team": {pod_role: count for pod_role, count in members_result.all()},
        "reading_notes": (
            "stage_distribution_now, open_jobs_now, overdue_now and stuck_jobs_now "
            "describe the pipeline as it stands today and ignore the delivery window. "
            "A job at 3+ rounds is usually a briefing problem, not an editor problem. "
            "A pod's workload is a COUNT OF VIDEOS — it has no points. Points are a "
            "QC2 reviewer's daily budget and nothing else (docs/12)."
        ),
    }
