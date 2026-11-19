"""Who is free, and who is drowning.

Reads through `services/routing.py` rather than re-deriving load, so the
number the bot quotes is the number the auto-router actually scores on. Two
definitions of "load" would mean the bot could confidently say someone has
room while routing refuses to give them work.

Company-wide by design, matching `GET /users/capacity`, which is owner/tl
without pod scoping — the one deliberate pod-isolation break docs/05 calls
for, so two TLs can't double-book the same editor by accident.
"""
from __future__ import annotations

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job
from app.models.user import User
from app.models.video_type import VideoType
from app.services.access import not_scrapped
from app.services.ai.tools.base import tool
from app.services.routing import (
    CAPACITY,
    PART_TIME_PODCAST_MAX,
    capacity_for,
    cross_pod_capacity,
    load_breakdown,
    qc2_today,
)


class TeamCapacityArgs(BaseModel):
    include_editors: bool = Field(default=True, description="Editor (VE) load across all pods.")
    include_qc: bool = Field(default=True, description="QC reviewer load against the routing cap.")


@tool(
    name="get_team_capacity",
    description=(
        "Current workload for editors and QC reviewers across every pod: for editors "
        "how many videos they are holding against their concurrent-job limit, and for "
        "QC reviewers their daily points budget — spent today, carried over, left, and "
        "what they are holding. Use for 'who is free', 'who is overloaded', 'who can "
        "take a podcast', and to explain why jobs are sitting unrouted."
    ),
    args_model=TeamCapacityArgs,
)
async def get_team_capacity(db: AsyncSession, user: User, args: TeamCapacityArgs) -> dict:
    prices = dict((await db.execute(select(VideoType.key, VideoType.qc_points))).all())
    out: dict = {
        "qc2_points_per_video": prices,
        "qc2_points_per_day": CAPACITY,
        "part_time_podcast_max": PART_TIME_PODCAST_MAX,
        "reading_notes": (
            "Editors and QC reviewers are measured in two different currencies. "
            "POINTS ARE A QC2 CONCEPT ONLY — never describe an editor's or a client "
            "pod's workload in points. "
            "Editor load is a COUNT OF OPEN VIDEOS against 'max_concurrent_jobs', a "
            "hard number: how many videos one editor may hold at once, freed only on "
            "delivery, with assignment past it refused. "
            "QC2 load is a DAILY POINTS BUDGET, not a count of open jobs: a review "
            "costs the current catalog price for its video type, a repeat "
            "round costs half of that (rounded up, halved once — round 5 costs the "
            "same as round 2), and a reviewer gets 24 points a day full-time or 12 "
            "part-time. Points are spent against a DATE and are not handed back when "
            "a job is cleared: somebody who burns their 24 by lunch is done until "
            "tomorrow. 'points_carried' is work still open from an earlier day, which "
            "goes on occupying the budget until it is actually reviewed. "
            "'available' false means the person has switched off new QC work today; "
            "it does not mean they have left. A reviewer with points left may still "
            "be unable to take a particular video — check 'points_left' against what "
            "that video costs, and 'can_take_podcast' for part-timers, who may hold "
            "only one podcast a day whatever their points say."
        ),
    }

    if args.include_editors:
        rows = await cross_pod_capacity(db)
        out["editors"] = [
            {
                "user_id": str(row["user"].id),
                "name": row["user"].name,
                "open_videos": row["open_count"],
                "max_concurrent_jobs": row["user"].max_concurrent_jobs,
                "is_active": row["user"].is_active,
            }
            for row in rows
            if row["user"].is_active
        ]

    if args.include_qc:
        today = qc2_today()
        out["qc2_work_date"] = today.isoformat()
        result = await db.execute(select(User).where(User.role == "qc", User.is_active.is_(True)))
        reviewers = []
        for reviewer in result.scalars().unique().all():
            load = await load_breakdown(db, reviewer.id, today=today)
            capacity = capacity_for(reviewer)
            points_left = max(0, capacity - load.total)
            reviewers.append(
                {
                    "user_id": str(reviewer.id),
                    "name": reviewer.name,
                    "employment_type": reviewer.employment_type,
                    "points_spent_today": load.points_today,
                    "points_carried_from_earlier_days": load.points_carried,
                    "points_used": load.total,
                    "points_per_day": capacity,
                    "points_left": points_left,
                    "open_rounds": load.open_count,
                    "videos_by_type": load.by_type,
                    "podcasts_held": load.podcasts,
                    "can_take_podcast": (
                        points_left >= prices["podcast"]
                        and not (
                            reviewer.employment_type == "part_time"
                            and load.podcasts >= PART_TIME_PODCAST_MAX
                        )
                    ),
                    "available": reviewer.available,
                    "out_of_points_today": points_left == 0,
                }
            )
        out["qc_reviewers"] = reviewers

        unrouted_result = await db.execute(
            select(Job.code, Job.title).where(
                Job.stage == "qc2", Job.qc2_reviewer_id.is_(None), not_scrapped()
            )
        )
        out["unrouted_qc2_jobs"] = [
            {"code": code, "title": title} for code, title in unrouted_result.all()
        ]

    return out
