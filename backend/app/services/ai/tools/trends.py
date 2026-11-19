"""Deliveries over time — the shape of a number, not just its size.

Every other tool here answers "what is it now". This one answers "which way
is it going", which is the question behind most requests for a graph and the
one `find_jobs` cannot answer without the model hand-bucketing up to a
hundred rows of `delivered_at` and getting it wrong.

Bucketing happens in SQL (`date_trunc`) rather than in the model. A model
counting dates into weeks is a model doing arithmetic it is bad at, on data
it will summarise anyway.

**Scoping.** Ungrouped and pod-grouped reads use `job_scope_clauses` — the
same visibility rule as `GET /jobs`. Grouping *by editor* is the cross-editor
comparison docs/04-permissions.md gates behind pod leadership, so that branch
restricts to pods the caller actually leads (Owner bypasses, as everywhere).
"""
from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import check_pod_lead
from app.models.job import Job
from app.models.pod import Pod
from app.models.user import ALL_PODS_ROLES, User, has_role
from app.services.access import job_scope_clauses, pod_lead_clauses
from app.services.ai.tools.base import tool

# A year of weeks, or two months of days. Past this a chart is unreadable and
# the payload stops being worth its tokens.
MAX_BUCKETS = 60


class DeliveryTrendArgs(BaseModel):
    bucket: Literal["day", "week", "month"] = Field(
        default="week",
        description="Size of each point on the trend. Use week for a quarter, month for a year.",
    )
    date_from: date = Field(description="Start of the window, YYYY-MM-DD. Required.")
    date_to: date | None = Field(
        default=None, description="End of the window, YYYY-MM-DD, inclusive. Defaults to today."
    )
    group_by: Literal["none", "pod", "editor", "weight"] = Field(
        default="none",
        description=(
            "Split the trend into one series per client pod, per editor, or per job "
            "weight. 'editor' only covers pods you lead."
        ),
    )
    pod_id: uuid.UUID | None = Field(
        default=None, description="Limit to one client pod. From resolve_entity."
    )
    editor_id: uuid.UUID | None = Field(
        default=None, description="Limit to one editor's deliveries. From resolve_entity."
    )


@tool(
    name="get_delivery_trend",
    description=(
        "Deliveries over time, bucketed by day, week or month, optionally split into "
        "one series per client pod, per editor or per job weight. Also returns average "
        "QC rounds and first-pass rate per bucket, so you can chart quality over time "
        "as well as volume. This is the tool for 'is X improving', 'how has this month "
        "compared to last', and for anything you are about to plot as a line."
    ),
    args_model=DeliveryTrendArgs,
)
async def get_delivery_trend(db: AsyncSession, user: User, args: DeliveryTrendArgs) -> dict:
    date_to = args.date_to or date.today()
    if date_to < args.date_from:
        return {"error": "date_to is before date_from."}

    span = (date_to - args.date_from).days + 1
    approx = {"day": span, "week": span / 7, "month": span / 30}[args.bucket]
    if approx > MAX_BUCKETS:
        return {
            "error": (
                f"That window is about {int(approx)} {args.bucket} buckets, over the "
                f"{MAX_BUCKETS} limit. Use a wider bucket or a shorter window."
            )
        }

    clauses = [
        Job.stage == "delivered",
        Job.delivered_at.is_not(None),
        func.date(Job.delivered_at) >= args.date_from,
        func.date(Job.delivered_at) <= date_to,
    ]
    if args.pod_id is not None:
        clauses.append(Job.pod_id == args.pod_id)
    if args.editor_id is not None:
        clauses.append(Job.assigned_editor_id == args.editor_id)

    scope_note = None
    if args.group_by == "editor":
        # Per-editor numbers side by side are the comparison docs/04 puts
        # behind pod leadership. A TL gets it for their own pods and nowhere
        # else, which is exactly what /pods/{id}/analytics/avg-rounds-by-editor
        # already allows them.
        if args.pod_id is not None:
            await check_pod_lead(db, args.pod_id, user)
        elif not has_role(user, *ALL_PODS_ROLES):
            clauses.append(Job.pod_id.in_(select(Pod.id).where(*pod_lead_clauses(user))))
            scope_note = "Editor numbers cover only the pods you lead."
    else:
        clauses += job_scope_clauses(user)

    bucket = func.date_trunc(args.bucket, Job.delivered_at).label("bucket")

    if args.group_by == "pod":
        group_column, join_target, join_on = Pod.name, Pod, Pod.id == Job.pod_id
    elif args.group_by == "editor":
        group_column, join_target, join_on = User.name, User, User.id == Job.assigned_editor_id
    elif args.group_by == "weight":
        group_column, join_target, join_on = Job.weight, None, None
    else:
        group_column, join_target, join_on = None, None, None

    # SUM over a CASE, not over the boolean itself: Postgres will not sum a
    # boolean, and SQLite quietly would — the difference only shows up in
    # production.
    clean_count = func.sum(case((Job.round == 0, 1), else_=0))
    columns = [bucket, func.count(Job.id), func.avg(Job.round), clean_count]
    if group_column is not None:
        columns.insert(1, group_column)

    query = select(*columns)
    if join_target is not None:
        query = query.join(join_target, join_on)
    query = query.where(*clauses).group_by(bucket)
    if group_column is not None:
        query = query.group_by(group_column)
    query = query.order_by(bucket)

    rows = (await db.execute(query)).all()

    labels: list[str] = []
    series: dict[str, dict[str, dict]] = {}
    for row in rows:
        if group_column is not None:
            bucket_at, group_name, count, avg_rounds, clean = row
        else:
            bucket_at, count, avg_rounds, clean = row
            group_name = "All"
        # Unassigned jobs join to a NULL editor name; naming it beats
        # dropping the row and quietly under-reporting the total.
        group_name = group_name or "Unassigned"
        key = bucket_at.date().isoformat()
        if key not in labels:
            labels.append(key)
        series.setdefault(group_name, {})[key] = {
            "delivered": count,
            "avg_qc_rounds": round(float(avg_rounds), 2) if avg_rounds is not None else None,
            "first_pass_rate": round((clean or 0) / count, 3) if count else None,
        }

    # Dense rows: a bucket with no deliveries for one series must come back as
    # 0, not be missing. A chart built from a ragged series silently shifts
    # every later point onto the wrong date.
    out_series = [
        {
            "name": name,
            "delivered": [buckets.get(label, {}).get("delivered", 0) for label in labels],
            "avg_qc_rounds": [buckets.get(label, {}).get("avg_qc_rounds") for label in labels],
            "first_pass_rate": [buckets.get(label, {}).get("first_pass_rate") for label in labels],
        }
        for name, buckets in sorted(series.items())
    ]

    return {
        "bucket": args.bucket,
        "window": {"from": args.date_from.isoformat(), "to": date_to.isoformat()},
        "grouped_by": args.group_by,
        # `labels` and each series' arrays are already aligned and the same
        # length — pass them straight to render_chart without re-deriving.
        "labels": labels,
        "series": out_series,
        "total_delivered": sum(sum(s["delivered"]) for s in out_series),
        "scope_note": scope_note,
        "reading_notes": (
            "Each label is the first day of that bucket. A bucket with no deliveries "
            "reports 0 delivered and null for the rates — plot the zero, but do not "
            "read a null rate as 0%. first_pass_rate is 0-1; multiply by 100 before "
            "charting it as a percent."
        ),
    }


class WorkloadHistoryArgs(BaseModel):
    days: int = Field(
        default=30, ge=2, le=180, description="How many days back to look at intake volume."
    )
    pod_id: uuid.UUID | None = Field(default=None, description="Limit to one pod.")


@tool(
    name="get_intake_trend",
    description=(
        "How many new jobs were created per day over the last N days, so you can chart "
        "incoming volume against deliveries and show whether the team is keeping up. "
        "Use alongside get_delivery_trend to answer 'are we falling behind'."
    ),
    args_model=WorkloadHistoryArgs,
)
async def get_intake_trend(db: AsyncSession, user: User, args: WorkloadHistoryArgs) -> dict:
    since = date.today() - timedelta(days=args.days - 1)
    clauses = [func.date(Job.created_at) >= since] + job_scope_clauses(user)
    if args.pod_id is not None:
        clauses.append(Job.pod_id == args.pod_id)

    bucket = func.date(Job.created_at).label("day")
    rows = (
        await db.execute(select(bucket, func.count(Job.id)).where(*clauses).group_by(bucket).order_by(bucket))
    ).all()
    counts = {day.isoformat(): count for day, count in rows}

    # Every day in the window, including the empty ones — a gap in an intake
    # chart reads as "no data recorded", not as "nothing came in".
    labels = [(since + timedelta(days=i)).isoformat() for i in range(args.days)]
    return {
        "window": {"from": since.isoformat(), "to": date.today().isoformat()},
        "labels": labels,
        "created_per_day": [counts.get(label, 0) for label in labels],
        "total_created": sum(counts.values()),
    }
