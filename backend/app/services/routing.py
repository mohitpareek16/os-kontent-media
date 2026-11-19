"""Who gets the next QC2 review, and what it costs them.

The whole model is docs/12-qc2-load-model.md; the four rules that must not
change without sign-off are §7 there. In short: a review is priced by what
kind of video it is, a reviewer has a number of points to spend per working
day, and the spend is written to a ledger (`models/qc2_charge.py`) rather than
derived from open jobs — because the budget is daily, and clearing a job at
noon does not hand the points back before tomorrow.

Editor load is a separate question answered separately, further down.
"""
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone
from math import ceil
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.job import Job
from app.models.pod_member import PodMember
from app.models.qc2_charge import Qc2Charge
from app.models.user import User
from app.services.access import not_scrapped
from app.services.video_types import qc_points_for

# --- Editor load -----------------------------------------------------------
#
# How much of an *editor's* plate a job takes. Left alone by the QC2 rebuild
# and deliberately not merged with QC review points: a podcast is quick to
# cut and slow to review, so the same job is cheap here and expensive there.
# One column could not hold both numbers, which is why `video_type` was made a
# separate field from editing weight in the first place (migration 0018).
WEIGHT_POINTS = {"light": 1, "standard": 2, "heavy": 4}

# --- QC2 load (docs/12) ----------------------------------------------------

# Points a reviewer may spend in a working day. Anchored on the agreed figure
# of eight long-form reviews in a full-time day. Type prices are owner-managed.
CAPACITY = {"full_time": 24, "part_time": 12}

# A repeat round is a change-list check, not a fresh watch, so it costs
# `ceil(base / 2)`. The halving happens **once**: round 2 and round 6 cost the
# same, because it is half of the base price and never half of the last round.
REREVIEW_DIVISOR = 2

# How far past their budget the least-loaded reviewer may be pushed when a
# rush job has nowhere to go (`Job.rush`). The only escape hatch in the model,
# and a bounded one: past this the job holds and alerts the TL, because a
# reviewer at 140% of their day is not a delivery, it is a missed one later.
RUSH_OVERFLOW = 1.25

# The one constraint that is not arithmetic. 12 points would buy a part-timer
# two podcasts and nothing else; two podcasts is not a half day of anybody's
# attention.
PART_TIME_PODCAST_MAX = 1

# Score adjustments, as fractions of capacity — the same units as
# `load / capacity`, which is what makes them comparable. Scoring on raw points
# instead would load a part-timer like a full-timer, which is the entire reason
# two capacities exist.
FAMILIARITY_BONUS = 0.15
IDLE_TIEBREAK_FACTOR = 0.05
IDLE_CAP_DAYS = 3


def qc2_today() -> date:
    """The working day a charge is spent against.

    Everything else in this app stores UTC and is right to. A budget is
    different: it is a promise about a *working day*, and in UTC the day would
    roll over at 05:30 IST — before anyone starts, so it would mostly have
    worked. Configurable because "the team is in India" is a fact about today,
    not about the schema.
    """
    return datetime.now(ZoneInfo(get_settings().qc2_day_timezone)).date()


def qc2_cost(base_points: int, *, repeat: bool) -> int:
    """The price of one QC2 round — the single place a price is decided.

    `repeat` is about the *reviewer*, not the job: it means this person has
    already watched this cut. Somebody picking up a round-2 job they have never
    seen pays full price, whatever the round counter says, which is why callers
    ask `has_reviewed_before` rather than reading `job.round`.
    """
    return ceil(base_points / REREVIEW_DIVISOR) if repeat else base_points


def capacity_for(user: User) -> int:
    """A reviewer's daily budget, derived from their employment type and never
    stored per account — see `User.employment_type`."""
    return CAPACITY[user.employment_type]


def _load_window(reviewer_id: uuid.UUID, today: date):
    """The clauses that define "spent", each there for its own reason.

    - `work_date = today` — everything spent today, cleared or not. No same-day
      refunds; this is the half that makes the budget daily rather than a
      work-in-progress cap.
    - `released_at IS NULL` — a round still open from an earlier day, which
      goes on occupying the budget until it is actually reviewed. Without it a
      reviewer who sat on Monday's podcast starts Tuesday looking free and the
      router hands them another one.

    A row matching both is still one row, so nothing double-counts.

    Scrapped projects are not filtered here, unlike every other capacity query
    in the app (`services/access.py::not_scrapped`). They don't need to be:
    scrapping releases the charge, so a cancelled project stops counting
    tomorrow and keeps counting today — which is the same answer the rest of
    this model gives about work that is over.
    """
    return (
        Qc2Charge.reviewer_id == reviewer_id,
        or_(Qc2Charge.work_date == today, Qc2Charge.released_at.is_(None)),
    )


async def daily_load(db: AsyncSession, reviewer_id: uuid.UUID, *, today: date) -> int:
    """Points this reviewer has spent against `today`.

    The clock is a parameter rather than a `qc2_today()` call inside, because
    every interesting property of this model is a day-boundary property and a
    test cannot pin one against a clock it can't move.
    """
    result = await db.execute(
        select(func.coalesce(func.sum(Qc2Charge.points), 0)).where(*_load_window(reviewer_id, today))
    )
    return int(result.scalar_one())


@dataclass(frozen=True)
class Qc2Load:
    """One reviewer's day, broken into the parts a screen wants to name.

    `daily_load` answers the router's question — one number, one SUM. This
    answers a person's: how much of that was today's work, how much is carried
    over from a round they have not finished, and what is it made of. Same
    window, one pass over the rows, because at 24 points there are never many.
    """

    points_today: int
    points_carried: int
    open_count: int
    by_type: dict[str, int]
    podcasts: int

    @property
    def total(self) -> int:
        """What the router scores on — `points_today` and `points_carried`
        partition the window, so they sum to it rather than overlapping."""
        return self.points_today + self.points_carried


async def load_breakdown(db: AsyncSession, reviewer_id: uuid.UUID, *, today: date) -> Qc2Load:
    rows = (
        await db.execute(
            select(
                Qc2Charge.points,
                Qc2Charge.work_date,
                Qc2Charge.video_type,
                Qc2Charge.released_at,
            ).where(*_load_window(reviewer_id, today))
        )
    ).all()

    by_type: dict[str, int] = {}
    points_today = points_carried = open_count = podcasts = 0
    for points, work_date, video_type, released_at in rows:
        if work_date == today:
            points_today += points
        else:
            # Only reachable when released_at IS NULL — the other half of the
            # window — so this is exactly "still open from an earlier day".
            points_carried += points
        if released_at is None:
            open_count += 1
        by_type[video_type] = by_type.get(video_type, 0) + 1
        if video_type == "podcast":
            podcasts += 1

    return Qc2Load(
        points_today=points_today,
        points_carried=points_carried,
        open_count=open_count,
        by_type=by_type,
        podcasts=podcasts,
    )


async def podcasts_held(db: AsyncSession, reviewer_id: uuid.UUID, *, today: date) -> int:
    """Podcasts inside the same window as `daily_load` — what
    `PART_TIME_PODCAST_MAX` is counted against."""
    result = await db.execute(
        select(func.count())
        .select_from(Qc2Charge)
        .where(*_load_window(reviewer_id, today), Qc2Charge.video_type == "podcast")
    )
    return int(result.scalar_one())


async def has_reviewed_before(
    db: AsyncSession, *, job_id: uuid.UUID, reviewer_id: uuid.UUID
) -> bool:
    """Has this person already been charged for this job — released or not.

    The ledger is the record of who has watched what. `job.round` is not: it
    counts how many times the *cut* came back, which says nothing about whether
    the person now holding it has seen any of them.
    """
    result = await db.execute(
        select(Qc2Charge.id)
        .where(Qc2Charge.job_id == job_id, Qc2Charge.reviewer_id == reviewer_id)
        .limit(1)
    )
    return result.first() is not None


async def open_charge(db: AsyncSession, job_id: uuid.UUID) -> Qc2Charge | None:
    result = await db.execute(
        select(Qc2Charge).where(Qc2Charge.job_id == job_id, Qc2Charge.released_at.is_(None))
    )
    return result.scalars().first()


async def charge(
    db: AsyncSession, *, job: Job, reviewer_id: uuid.UUID, today: date | None = None
) -> Qc2Charge:
    """Bill a reviewer for one round of QC2. One of the two functions that
    write the ledger — nothing else may insert or update a charge row.

    Re-entrant on purpose. Every path into QC2 calls this — the auto-router, a
    lead naming a reviewer by hand, a QC claiming an unrouted job, a scrapped
    project being restored — and more than one of them can fire for the same
    job. Three cases, each with its own answer:

    - **An open charge for the same reviewer** — return it untouched. Nothing
      new happened.
    - **An open charge for a *different* reviewer** — release it first. The job
      has changed hands and the points must follow it.
    - **A released charge for the same reviewer, same day, same round** —
      reopen it rather than writing a second row. This is a round that was
      closed and reinstated without any work happening in between: a scrap and
      a restore an hour later. Billing it twice would charge somebody for one
      review because their TL changed their mind.

      The `round` half of that test is what keeps it honest. A job that is sent
      back and returns the same day does *not* match, because the round counter
      moved on the way out — so it writes a fresh row at the re-review price,
      which is right. Two pieces of work in one day both cost.

    The partial unique index on `job_id` is the backstop under all of it.
    """
    today = today or qc2_today()

    existing = await open_charge(db, job.id)
    if existing is not None:
        if existing.reviewer_id == reviewer_id:
            return existing
        await release(db, job_id=job.id)

    reinstated = (
        await db.execute(
            select(Qc2Charge).where(
                Qc2Charge.job_id == job.id,
                Qc2Charge.reviewer_id == reviewer_id,
                Qc2Charge.work_date == today,
                Qc2Charge.round == job.round,
                Qc2Charge.released_at.is_not(None),
            )
        )
    ).scalars().first()
    if reinstated is not None:
        reinstated.released_at = None
        await db.flush()
        return reinstated

    repeat = await has_reviewed_before(db, job_id=job.id, reviewer_id=reviewer_id)
    row = Qc2Charge(
        job_id=job.id,
        reviewer_id=reviewer_id,
        work_date=today,
        points=qc2_cost(await qc_points_for(db, job.video_type), repeat=repeat),
        video_type=job.video_type,
        round=job.round,
    )
    db.add(row)
    await db.flush()
    return row


async def release(db: AsyncSession, *, job_id: uuid.UUID) -> None:
    """Mark this job's open round finished. The other of the two functions that
    write the ledger.

    Called when the job leaves QC2 in *either* direction — passed to Final or
    sent back to Revisions — because the reviewer's work for that round is done
    either way. It is not a refund: the row keeps counting for the rest of the
    day it was spent on, and releasing it only stops it counting tomorrow.
    """
    await db.execute(
        update(Qc2Charge)
        .where(Qc2Charge.job_id == job_id, Qc2Charge.released_at.is_(None))
        .values(released_at=datetime.now(timezone.utc))
    )


async def _has_cleared_on_pod(db: AsyncSession, user_id: uuid.UUID, pod_id: uuid.UUID) -> bool:
    result = await db.execute(
        select(Job.id).where(Job.pod_id == pod_id, Job.qc2_reviewer_id == user_id, Job.stage == "delivered")
    )
    return result.first() is not None


async def _days_idle(db: AsyncSession, user_id: uuid.UUID) -> int:
    result = await db.execute(
        select(Job.updated_at)
        .where(Job.qc2_reviewer_id == user_id)
        .order_by(Job.updated_at.desc())
        .limit(1)
    )
    last = result.scalar_one_or_none()
    if last is None:
        return IDLE_CAP_DAYS
    return max(0, (datetime.now(timezone.utc) - last).days)


async def sticky_reviewer(db: AsyncSession, job: Job) -> User | None:
    """The reviewer this job already belongs to, if they can still take it.

    QC2 is sticky: round 2 goes back to whoever wrote the change list, at the
    re-review price, **even if it takes them over capacity** — a repeat round
    never re-enters load balancing (docs/12 §7). Handing it to a stranger would
    cost the team a second full watch to save one reviewer three points.

    The fall-through is the new part. Stickiness used to be enforced by the
    caller checking `qc2_reviewer_id is None`, which never re-asked whether
    that account still existed — so a job assigned to somebody who then left
    stayed theirs forever, invisible to every queue.

    **Deactivation breaks stickiness; `available` does not.** docs/12 §6.1
    listed both, but the reason it gave was entirely about the first: an
    account that is gone can never come back for the job. `available` is the
    "don't send me *new* QC work today" toggle, and a round-2 cut this person
    already watched and wrote the change list for is not new work. Falling
    through on it would make a stranger pay full price for a cut they have
    never seen and leave the person who raised the changes never finding out
    whether they were addressed — a day off would quietly scatter every open
    revision they had. docs/05's "stickiness is not an optimization, it's the
    point" is the older statement and the one that survives here.
    """
    if job.qc2_reviewer_id is None:
        return None
    reviewer = await db.get(User, job.qc2_reviewer_id)
    if reviewer is None or not reviewer.is_active:
        return None
    return reviewer


async def _pool(db: AsyncSession, pod_id: uuid.UUID) -> list[User]:
    """Everyone who could take a review on this pod, before load is considered."""
    result = await db.execute(
        select(User)
        .join(PodMember, PodMember.user_id == User.id)
        .where(
            PodMember.pod_id == pod_id,
            PodMember.pod_role == "qc",
            User.available.is_(True),
            User.is_active.is_(True),
        )
    )
    candidates = list(result.scalars().unique().all())
    if candidates:
        return candidates

    # QC2 is a company-wide team, not a pod role (docs/05) — pod membership is
    # where the familiarity bonus comes from, not a gate. Without this fallback
    # a pod with no QC member yet sent every job into the unrouted pile
    # forever, which reads as "the pipeline is broken" rather than "nobody is
    # free".
    wider = await db.execute(
        select(User).where(User.role == "qc", User.available.is_(True), User.is_active.is_(True))
    )
    return list(wider.scalars().unique().all())


@dataclass(frozen=True)
class Qc2Pick:
    """Who the router chose and why — enough to put in the event log.

    `score` is None on a sticky return, because no scoring happened: a repeat
    round never re-enters load balancing, and recording a score for it would
    invite somebody to compare it against one that was actually competed for.

    `overflow` says the budget was knowingly exceeded — a rush job pushed onto
    somebody who had no room. It goes in the event payload so "why is she at
    27 points" has an answer in the log rather than in somebody's memory.
    """

    reviewer: User
    score: float | None
    sticky: bool
    overflow: bool = False


async def pick_qc2(db: AsyncSession, *, job: Job, today: date | None = None) -> Qc2Pick | None:
    """Pick the reviewer for this job, in the order docs/12 §6 sets out.

    Sticky first, then a pool filtered on whether this *particular* job fits
    what they have left, then lowest score wins. Returns None when nobody can
    take it, and the caller must leave the job unrouted rather than piling it
    on the least-bad option — an unrouted job surfaces on the QC page and
    alerts the TL, which is a state somebody can act on. A silently overloaded
    reviewer is not.

    This does not write the charge. `assign_qc2` does, and is what routers
    call; this stays free of side effects so a screen can ask "who would get
    this" without billing anybody.
    """
    today = today or qc2_today()

    sticky = await sticky_reviewer(db, job)
    if sticky is not None:
        return Qc2Pick(reviewer=sticky, score=None, sticky=True)

    base_points = await qc_points_for(db, job.video_type)

    eligible: list[tuple[float, User]] = []
    considered: list[tuple[float, User, int, int]] = []
    for candidate in await _pool(db, job.pod_id):
        # A first assignment is a first watch for whoever gets it, but the
        # candidate may have seen this cut on an earlier round and been
        # released since — in which case it is a re-review for them.
        candidate_cost = qc2_cost(
            base_points,
            repeat=await has_reviewed_before(db, job_id=job.id, reviewer_id=candidate.id),
        )
        load = await daily_load(db, candidate.id, today=today)
        capacity = capacity_for(candidate)

        # The podcast cap is not a budget and rush does not lift it: a
        # part-timer's second podcast of the day is not a question of points.
        # Checked before the overflow branch can see them, on purpose.
        if (
            job.video_type == "podcast"
            and candidate.employment_type == "part_time"
            and await podcasts_held(db, candidate.id, today=today) >= PART_TIME_PODCAST_MAX
        ):
            continue

        # A fraction, not a 0-100 percentage: at that scale the 0.15
        # familiarity bonus would be rounding noise.
        score = load / capacity
        if await _has_cleared_on_pod(db, candidate.id, job.pod_id):
            score -= FAMILIARITY_BONUS
        score -= IDLE_TIEBREAK_FACTOR * min(await _days_idle(db, candidate.id), IDLE_CAP_DAYS)
        considered.append((score, candidate, load, capacity))

        # Not "are they under the cap" but "does *this* job fit": a reviewer
        # with four points free cannot take a podcast, and letting them have it
        # is how a budget stops meaning anything.
        if load + candidate_cost <= capacity:
            eligible.append((score, candidate))

    if eligible:
        score, winner = min(eligible, key=lambda pair: pair[0])
        return Qc2Pick(reviewer=winner, score=score, sticky=False)

    if job.rush and considered:
        # Nobody has room and this one cannot wait. The least-loaded reviewer —
        # by proportion of their own day, so a part-timer isn't picked just for
        # having a smaller number — may be pushed to `RUSH_OVERFLOW` of their
        # budget.
        #
        # `floor`, not `round`: 125% of a part-timer's 12 is 15, and of a
        # full-timer's 24 is 30, so nothing here depends on rounding luck. The
        # wall still exists, rush only moves it; past 125% the job holds and
        # alerts the TL exactly as it does without the flag, because a reviewer
        # at 140% of their day is not a delivery, it is a missed one later.
        score, winner, load, capacity = min(considered, key=lambda row: row[0])
        cost = qc2_cost(
            base_points,
            repeat=await has_reviewed_before(db, job_id=job.id, reviewer_id=winner.id),
        )
        if load + cost <= int(capacity * RUSH_OVERFLOW):
            return Qc2Pick(reviewer=winner, score=score, sticky=False, overflow=True)

    return None


async def route_qc2(db: AsyncSession, *, job: Job, today: date | None = None) -> User | None:
    """`pick_qc2` when all you want is the name."""
    pick = await pick_qc2(db, job=job, today=today)
    return pick.reviewer if pick else None


async def assign_qc2(
    db: AsyncSession, *, job: Job, today: date | None = None
) -> tuple[Qc2Pick, Qc2Charge] | None:
    """Route the job and bill the winner — the one call a router makes.

    Routing and charging are inseparable in practice: a reviewer chosen but not
    charged is invisible to every load query, so the next job lands on them
    too, and the one after that. Keeping both in one function means no route
    handler can do half of it and no future one can forget the half that has no
    visible symptom.
    """
    pick = await pick_qc2(db, job=job, today=today)
    job.qc2_reviewer_id = pick.reviewer.id if pick else None
    if pick is None:
        return None
    return pick, await charge(db, job=job, reviewer_id=pick.reviewer.id, today=today)


async def cross_pod_capacity(db: AsyncSession) -> list[dict]:
    """Weighted open load per VE across ALL their pods, not just one TL's —
    the one deliberate pod-isolation break docs/05 calls for, so the
    assignment screen doesn't let two TLs double-book the same editor by
    accident. 'Open' means any non-delivered job currently on their plate —
    scrapped projects are nobody's load, and counting them would keep an
    editor artificially "full" against work that was cancelled.

    Deactivated accounts are left out: nothing can be assigned to them
    (`services/access.py::ensure_assignable_editor`), so listing them offered
    the assignment screen names every save path then refused."""
    result = await db.execute(select(User).where(User.role == "ve", User.is_active.is_(True)))
    editors = result.scalars().unique().all()

    capacities = []
    for editor in editors:
        load_result = await db.execute(
            select(Job.weight).where(
                Job.assigned_editor_id == editor.id, Job.stage != "delivered", not_scrapped()
            )
        )
        weights = list(load_result.scalars().all())
        # Both numbers, because they answer different questions and only one of
        # them is real. `open_count` is what an editor's cap is actually in —
        # videos held at once — and it is what every screen and the bot now
        # quote. `weighted_load` is kept for the callers still shaped around it,
        # but every job carries the default weight (migration 0018), so it is
        # `2 * open_count` in disguise and must not be shown as "points": points
        # are a QC2 concept (docs/12).
        capacities.append(
            {
                "user": editor,
                "open_count": len(weights),
                "weighted_load": sum(WEIGHT_POINTS[weight] for weight in weights),
            }
        )
    return capacities
