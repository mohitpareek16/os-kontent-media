"""Per-person performance — "how is Aditya doing on this client".

Always scoped to one pod, and gated by `check_pod_lead` on that pod. Both
halves matter:

- The pod gate is the same one on `/pods/{id}/analytics/avg-rounds-by-editor`,
  which docs/04-permissions.md calls out as *literally* the cross-editor
  comparison a VE must never see. The bot reads it through the same door.
- Requiring a pod at all keeps this from quietly becoming a company-wide
  ranking of one person against everyone, assembled a call at a time. A TL
  is accountable for output on their own pods; that is the scope of the
  question they get to ask.
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


class PersonPerformanceArgs(BaseModel):
    user_id: uuid.UUID = Field(description="From resolve_entity. Never guess this.")
    pod_id: uuid.UUID = Field(
        description="The client pod to report on. Required — this is always a per-client answer."
    )
    delivered_from: date | None = Field(
        default=None, description="Start of the delivery window, YYYY-MM-DD. Omit for all time."
    )
    delivered_to: date | None = Field(
        default=None, description="End of the delivery window, YYYY-MM-DD, inclusive."
    )


@tool(
    name="get_person_performance",
    description=(
        "How one editor or QC reviewer is doing on one client pod: deliveries, "
        "first-pass rate, average QC rounds, what they currently have open, and "
        "whether they are certified on that pod. Use for 'how is this editor doing'."
    ),
    args_model=PersonPerformanceArgs,
)
async def get_person_performance(
    db: AsyncSession, user: User, args: PersonPerformanceArgs
) -> dict:
    await check_pod_lead(db, args.pod_id, user)

    pod = await db.get(Pod, args.pod_id)
    subject = await db.get(User, args.user_id)
    if pod is None or subject is None:
        return {"error": "No such pod or person."}

    membership = await db.get(PodMember, {"pod_id": args.pod_id, "user_id": args.user_id})

    # An editor is measured on jobs assigned to them; a QC on jobs routed to
    # them. Asking which column to read is the same question as "what does
    # this person do here".
    as_editor = subject.role == "ve"
    owner_column = Job.assigned_editor_id if as_editor else Job.qc2_reviewer_id

    delivered_clauses = [Job.pod_id == pod.id, owner_column == subject.id, Job.stage == "delivered"]
    if args.delivered_from is not None:
        delivered_clauses.append(func.date(Job.delivered_at) >= args.delivered_from)
    if args.delivered_to is not None:
        delivered_clauses.append(func.date(Job.delivered_at) <= args.delivered_to)

    rounds_result = await db.execute(select(Job.round).where(*delivered_clauses))
    rounds = list(rounds_result.scalars().all())

    # Open load spans every pod they work in, not just this one — the same
    # deliberate pod-isolation break `cross_pod_capacity` makes, because "are
    # they free" is never answerable from one pod's jobs alone.
    open_result = await db.execute(
        select(func.count(Job.id)).where(
            owner_column == subject.id, Job.stage != "delivered", not_scrapped()
        )
    )
    open_all_pods = open_result.scalar_one()

    open_here_result = await db.execute(
        select(func.count(Job.id)).where(
            Job.pod_id == pod.id,
            owner_column == subject.id,
            Job.stage != "delivered",
            not_scrapped(),
        )
    )

    clean = sum(1 for r in rounds if r == 0)
    return {
        "person": {
            "user_id": str(subject.id),
            "name": subject.name,
            "role": subject.role,
            "is_active": subject.is_active,
            "available_for_new_qc_work": subject.available,
        },
        "pod": {"pod_id": str(pod.id), "name": pod.name},
        "measured_as": "editor" if as_editor else "qc_reviewer",
        "delivery_window": {
            "from": args.delivered_from.isoformat() if args.delivered_from else None,
            "to": args.delivered_to.isoformat() if args.delivered_to else None,
        },
        "delivered_in_window": len(rounds),
        "clean_first_pass_deliveries": clean,
        "first_pass_rate": (clean / len(rounds)) if rounds else None,
        "avg_qc_rounds": (sum(rounds) / len(rounds)) if rounds else None,
        "open_jobs_on_this_pod_now": open_here_result.scalar_one(),
        "open_jobs_all_pods_now": open_all_pods,
        "certified_on_this_pod": bool(membership and membership.certified_at),
        "pod_role": membership.pod_role if membership else None,
        "reading_notes": (
            "An editor's workload is a COUNT OF VIDEOS, never points — points are a "
            "QC2 reviewer's daily budget and nothing else (docs/12). "
            "Certification is computed from delivery history, never set by hand. "
            "These are one person's numbers on one client — present them as their "
            "own trend to discuss. If the question was actually a comparison, use "
            "compare_editors rather than calling this once per person."
        ),
    }
