"""Breadth reads — every client at once, every editor side by side.

The tools that came before this file all start from an id: name one pod,
name one person. That is the right shape for "how is Dhan doing" and the
wrong shape for the two questions people actually open the bot with —
"how is everything going" and "who should I give this to". Answering those
by resolving names one at a time and calling `get_pod_health` per pod costs
an iteration each and hits the loop cap before it finishes.

**On comparing people.** docs/04-permissions.md is about who may *see* a
cross-editor breakdown, and its answer is Owner and the pod's own TL — which
is precisely who `/pods/{id}/analytics/avg-rounds-by-editor` serves today,
and precisely who can reach the bot at all. So `compare_editors` is not a new
disclosure; it is the same page's numbers reachable by asking. What it must
not become is a bare ranking, because the numbers are not commensurable —
volume, weight mix and client difficulty all differ — so every row carries
the context needed to read it, and `reading_notes` tells the model to lead
with that rather than with a winner.
"""
from __future__ import annotations

import uuid
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.deps import check_pod_lead
from app.models.job import Job
from app.models.pod import Pod
from app.models.pod_member import PodMember
from app.models.user import ALL_PODS_ROLES, User, has_role
from app.models.video_type import VideoType
from app.services.access import not_scrapped, pod_lead_clauses, pod_scope_clauses
from app.services.ai.tools.base import tool
from app.services.routing import (
    capacity_for,
    daily_load,
    qc2_today,
)

STUCK_ROUNDS = 3


class ListPodsArgs(BaseModel):
    status: Literal["active", "paused", "churned", "any"] = Field(
        default="active", description="Which client pods to include."
    )
    delivered_from: date | None = Field(
        default=None,
        description="Count deliveries from this date, YYYY-MM-DD. Omit for all time.",
    )
    delivered_to: date | None = Field(
        default=None, description="Count deliveries up to this date, YYYY-MM-DD, inclusive."
    )


@tool(
    name="list_pods",
    description=(
        "Every client pod you can see, each with its TL, open job count, overdue "
        "count, jobs stuck at 3+ rounds, deliveries in the window and first-pass "
        "rate. Use this FIRST for anything company-wide — 'how are my clients "
        "doing', 'which client is worst right now', 'compare my clients' — instead "
        "of resolving and querying pods one at a time."
    ),
    args_model=ListPodsArgs,
)
async def list_pods(db: AsyncSession, user: User, args: ListPodsArgs) -> dict:
    clauses = pod_scope_clauses(user)
    if args.status != "any":
        clauses.append(Pod.status == args.status)

    tl = aliased(User)
    pods = (
        await db.execute(
            select(Pod, tl.name).join(tl, tl.id == Pod.tl_id).where(*clauses).order_by(Pod.name)
        )
    ).all()
    if not pods:
        return {"pods": [], "note": "You have no client pods matching that."}

    pod_ids = [pod.id for pod, _ in pods]
    today = date.today()

    # Four grouped queries for all pods, not four per pod. The naive version
    # is 4N round-trips and gets slower every time a client is onboarded.
    open_rows = (
        await db.execute(
            select(Job.pod_id, func.count(Job.id))
            .where(Job.pod_id.in_(pod_ids), Job.stage != "delivered", not_scrapped())
            .group_by(Job.pod_id)
        )
    ).all()
    overdue_rows = (
        await db.execute(
            select(Job.pod_id, func.count(Job.id))
            .where(
                Job.pod_id.in_(pod_ids),
                Job.stage != "delivered",
                not_scrapped(),
                Job.deadline.is_not(None),
                Job.deadline < today,
            )
            .group_by(Job.pod_id)
        )
    ).all()
    stuck_rows = (
        await db.execute(
            select(Job.pod_id, func.count(Job.id))
            .where(
                Job.pod_id.in_(pod_ids),
                Job.stage != "delivered",
                not_scrapped(),
                Job.round >= STUCK_ROUNDS,
            )
            .group_by(Job.pod_id)
        )
    ).all()

    delivered_clauses = [Job.pod_id.in_(pod_ids), Job.stage == "delivered"]
    if args.delivered_from is not None:
        delivered_clauses.append(func.date(Job.delivered_at) >= args.delivered_from)
    if args.delivered_to is not None:
        delivered_clauses.append(func.date(Job.delivered_at) <= args.delivered_to)
    delivered_rows = (
        await db.execute(
            select(
                Job.pod_id,
                func.count(Job.id),
                func.sum(case((Job.round == 0, 1), else_=0)),
                func.avg(Job.round),
            )
            .where(*delivered_clauses)
            .group_by(Job.pod_id)
        )
    ).all()

    open_counts = dict(open_rows)
    overdue = dict(overdue_rows)
    stuck = dict(stuck_rows)
    delivered = {row[0]: row[1:] for row in delivered_rows}

    out = []
    for pod, tl_name in pods:
        count, clean, avg_rounds = delivered.get(pod.id, (0, 0, None))
        out.append(
            {
                "pod_id": str(pod.id),
                "name": pod.name,
                "status": pod.status,
                "tl": tl_name,
                "you_lead_this_pod": has_role(user, *ALL_PODS_ROLES) or pod.tl_id == user.id,
                "retainer_volume_per_month": pod.retainer_volume,
                "open_jobs_now": open_counts.get(pod.id, 0),
                "overdue_now": overdue.get(pod.id, 0),
                "stuck_at_3_plus_rounds_now": stuck.get(pod.id, 0),
                "delivered_in_window": count,
                # None, not 100%: a pod that has delivered nothing has no
                # first-pass rate, and reporting one is how the Overview page
                # used to lie.
                "first_pass_rate": round(clean / count, 3) if count else None,
                "avg_qc_rounds": round(float(avg_rounds), 2) if avg_rounds is not None else None,
            }
        )

    return {
        "pods": out,
        "delivery_window": {
            "from": args.delivered_from.isoformat() if args.delivered_from else None,
            "to": args.delivered_to.isoformat() if args.delivered_to else None,
        },
        "reading_notes": (
            "Counts ending in '_now' are today's pipeline and ignore the delivery "
            "window. first_pass_rate is 0-1 and is null where nothing was delivered. "
            "'you_lead_this_pod' false means per-editor tools will refuse that pod. "
            "This list is ready to chart: one bar per pod."
        ),
    }


class CompareEditorsArgs(BaseModel):
    pod_id: uuid.UUID | None = Field(
        default=None,
        description=(
            "One client pod, from resolve_entity. Omit to cover every pod you lead — "
            "that is the right call for 'who is my strongest editor overall'."
        ),
    )
    delivered_from: date | None = Field(
        default=None, description="Start of the delivery window, YYYY-MM-DD. Omit for all time."
    )
    delivered_to: date | None = Field(
        default=None, description="End of the delivery window, YYYY-MM-DD, inclusive."
    )
    measure: Literal["editor", "qc"] = Field(
        default="editor",
        description="'editor' scores jobs by assigned editor; 'qc' by QC2 reviewer.",
    )


@tool(
    name="compare_editors",
    description=(
        "Every editor (or QC reviewer) who has worked on a pod, side by side: "
        "deliveries, clean first-pass count and rate, average QC rounds, and current "
        "open load. This is the tool for 'who is my best editor', 'who has delivered "
        "the most', 'who needs support' and any per-person comparison or ranking. "
        "Covers one pod, or every pod you lead if you omit pod_id."
    ),
    args_model=CompareEditorsArgs,
)
async def compare_editors(db: AsyncSession, user: User, args: CompareEditorsArgs) -> dict:
    scope_note = None
    if args.pod_id is not None:
        await check_pod_lead(db, args.pod_id, user)
        pod_filter = [Job.pod_id == args.pod_id]
    elif has_role(user, *ALL_PODS_ROLES):
        pod_filter = []
    else:
        pod_filter = [Job.pod_id.in_(select(Pod.id).where(*pod_lead_clauses(user)))]
        scope_note = "Covers only the pods you lead, not every pod you are a member of."

    as_editor = args.measure == "editor"
    owner_column = Job.assigned_editor_id if as_editor else Job.qc2_reviewer_id

    # Only one of the two measures has a currency. A QC2 review costs what kind
    # of video it is (docs/12), so a reviewer's back catalogue can be priced.
    # An editor's cannot: `weight` is vestigial and every job carries the
    # default (migration 0018), so an "effort" total built from it was the
    # delivery count doubled, wearing a name that implied it knew better.
    # Editors are compared on volume and quality, and points stay a QC2 word.
    points_expr = VideoType.qc_points
    current_prices = dict((await db.execute(select(VideoType.key, VideoType.qc_points))).all())

    delivered_clauses = [Job.stage == "delivered", owner_column.is_not(None), *pod_filter]
    if args.delivered_from is not None:
        delivered_clauses.append(func.date(Job.delivered_at) >= args.delivered_from)
    if args.delivered_to is not None:
        delivered_clauses.append(func.date(Job.delivered_at) <= args.delivered_to)

    delivered_rows = (
        await db.execute(
            select(
                owner_column,
                User.name,
                func.count(Job.id),
                func.sum(case((Job.round == 0, 1), else_=0)),
                func.avg(Job.round),
                func.sum(points_expr),
            )
            .join(User, User.id == owner_column)
            .join(VideoType, VideoType.key == Job.video_type)
            .where(*delivered_clauses)
            .group_by(owner_column, User.name)
        )
    ).all()

    # Open load spans every pod the person works in, not just the ones in
    # scope here — "are they free" is never answerable from one client's
    # jobs, the same deliberate isolation break get_team_capacity makes.
    open_rows = (
        await db.execute(
            select(owner_column, func.count(Job.id))
            .where(owner_column.is_not(None), Job.stage != "delivered", not_scrapped())
            .group_by(owner_column)
        )
    ).all()
    open_count: dict[uuid.UUID, int] = dict(open_rows)

    # A QC reviewer's "load now" is not a sum over their open jobs at all — it
    # is what they have spent against today's budget, cleared work included
    # (docs/12 §3). Counting their open jobs would answer a question this model
    # deliberately stopped asking, and would say a reviewer who finished
    # everything by lunch is free when nothing more will route to them today.
    qc_points: dict[uuid.UUID, int] = {}
    qc_capacity: dict[uuid.UUID, int] = {}
    if not as_editor and delivered_rows:
        today = qc2_today()
        reviewer_ids = [row[0] for row in delivered_rows]
        reviewers = (
            await db.execute(select(User).where(User.id.in_(reviewer_ids)))
        ).scalars().unique().all()
        for reviewer in reviewers:
            qc_points[reviewer.id] = await daily_load(db, reviewer.id, today=today)
            qc_capacity[reviewer.id] = capacity_for(reviewer)

    people = []
    for person_id, name, count, clean, avg_rounds, points in delivered_rows:
        people.append(
            {
                "user_id": str(person_id),
                "name": name,
                "delivered_in_window": count,
                "clean_first_pass": int(clean or 0),
                "first_pass_rate": round((clean or 0) / count, 3) if count else None,
                "avg_qc_rounds": round(float(avg_rounds), 2) if avg_rounds is not None else None,
                "open_jobs_now_all_pods": open_count.get(person_id, 0),
                **(
                    {}
                    if as_editor
                    else {
                        # Two reviewers with 10 reviews each have not done the
                        # same amount of work if one carried the podcasts.
                        "qc2_points_delivered": int(points or 0),
                        "qc2_points_used_today": qc_points.get(person_id, 0),
                        "qc2_points_per_day": qc_capacity.get(person_id),
                    }
                ),
            }
        )
    people.sort(key=lambda row: row["delivered_in_window"], reverse=True)

    if not people:
        return {
            "people": [],
            "note": (
                "Nobody has delivered anything in that scope and window. Widen the "
                "dates or check the pod is right."
            ),
        }

    return {
        "measured_as": args.measure,
        "delivery_window": {
            "from": args.delivered_from.isoformat() if args.delivered_from else None,
            "to": args.delivered_to.isoformat() if args.delivered_to else None,
        },
        "people": people,
        "scope_note": scope_note,
        **({} if as_editor else {"points_scale": current_prices}),
        "reading_notes": (
            "Sorted by volume, which is not the same as sorted by best. If asked who is "
            "strongest, answer it — but say which measure you used and note the others: "
            "highest first_pass_rate is the quality read, volume is the effort read, "
            "and someone with 3 deliveries is not comparable to someone "
            "with 30. A high avg_qc_rounds on one client is often a briefing problem on "
            "that client rather than an editor problem. Never present this as a "
            "leaderboard the team is ranked on — it is a prompt for a conversation."
            + (
                " Measured as editors: an editor's work is counted in VIDEOS. There is "
                "no editor points scale — never quote one."
                if as_editor
                else " Measured as QC: delivered points use today's video-type prices, "
                "while the QC charge ledger keeps the original price for work already done. "
                "'qc2_points_used_today' is spend against today's budget rather than a "
                "count of open jobs — cleared work still counts until tomorrow."
            )
        ),
    }


class PodTeamArgs(BaseModel):
    pod_id: uuid.UUID = Field(description="From resolve_entity.")


@tool(
    name="get_pod_team",
    description=(
        "Who is on a client pod: every member with their role, whether they are "
        "certified on that pod, whether their account is active, and their current "
        "open load. Use for 'who works on this client' and 'who is certified here'."
    ),
    args_model=PodTeamArgs,
)
async def get_pod_team(db: AsyncSession, user: User, args: PodTeamArgs) -> dict:
    pod = await db.get(Pod, args.pod_id)
    if pod is None:
        return {"error": "No such pod."}
    # Membership, not leadership: seeing who else is on a pod you belong to
    # is what GET /pods/{id}/members already allows any member.
    if not has_role(user, *ALL_PODS_ROLES):
        mine = (
            await db.execute(
                select(PodMember.user_id).where(
                    PodMember.pod_id == pod.id, PodMember.user_id == user.id
                )
            )
        ).scalar_one_or_none()
        if mine is None:
            return {"error": "You are not a member of that pod."}

    rows = (
        await db.execute(
            select(User, PodMember.pod_role, PodMember.certified_at)
            .join(PodMember, PodMember.user_id == User.id)
            .where(PodMember.pod_id == pod.id)
            .order_by(PodMember.pod_role, User.name)
        )
    ).all()

    member_ids = [member.id for member, _, _ in rows]
    load_rows = (
        await db.execute(
            select(Job.assigned_editor_id, func.count(Job.id))
            .where(
                Job.assigned_editor_id.in_(member_ids),
                Job.stage != "delivered",
                not_scrapped(),
            )
            .group_by(Job.assigned_editor_id)
        )
    ).all()
    load: dict[uuid.UUID, int] = dict(load_rows)

    return {
        "pod": {"pod_id": str(pod.id), "name": pod.name, "status": pod.status},
        "members": [
            {
                "user_id": str(member.id),
                "name": member.name,
                "account_role": member.role,
                "pod_role": pod_role,
                "certified_on_this_pod": certified_at is not None,
                "certified_at": certified_at.isoformat() if certified_at else None,
                "is_active": member.is_active,
                "available_for_new_qc_work": member.available,
                "max_concurrent_jobs": member.max_concurrent_jobs,
                "open_videos_all_pods": load.get(member.id, 0),
            }
            for member, pod_role, certified_at in rows
        ],
        "reading_notes": (
            "Certification is computed from delivery history, never granted by hand. "
            "Open load counts every pod the person works in, not just this one, and "
            "it is a COUNT OF VIDEOS against 'max_concurrent_jobs' — an editor's work "
            "is never expressed in points."
        ),
    }
