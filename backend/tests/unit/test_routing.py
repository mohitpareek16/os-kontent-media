"""services/routing.py — the QC2 load model from docs/12-qc2-load-model.md.

A review is priced by what kind of video it is (short 1, long 3, podcast 6),
a repeat round costs `ceil(base / 2)` **once**, and a reviewer spends against a
daily budget of 24 points full-time or 12 part-time. The spend goes to a ledger
rather than being derived from open jobs, because points are spent against a
*date*: clearing a job at noon does not hand them back before tomorrow.

    score = load / capacity
          - 0.15 if they've cleared work on this pod before
          - 0.05 x min(days_idle, 3)

Most of what is worth testing here is the edges the model is surprising at, so
that is most of what is below. `today` is passed explicitly throughout — every
interesting property is a day-boundary property, and a test cannot pin one
against a clock it can't move.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.services.routing import (
    CAPACITY,
    FAMILIARITY_BONUS,
    IDLE_CAP_DAYS,
    IDLE_TIEBREAK_FACTOR,
    PART_TIME_PODCAST_MAX,
    REREVIEW_DIVISOR,
    RUSH_OVERFLOW,
    charge,
    daily_load,
    load_breakdown,
    qc2_cost,
    release,
    route_qc2,
    sticky_reviewer,
)
from tests.factories import add_member, make_charge, make_job, make_pod, make_user

pytestmark = pytest.mark.unit

TODAY = date(2026, 8, 7)
YESTERDAY = TODAY - timedelta(days=1)


def _ago(**kwargs) -> datetime:
    return datetime.now(timezone.utc) - timedelta(**kwargs)


async def _pod_with(db, *qc_users):
    tl = await make_user(db, role="tl")
    pod = await make_pod(db, tl=tl)
    await add_member(db, pod, tl, "tl")
    for reviewer in qc_users:
        await add_member(db, pod, reviewer, "qc")
    return tl, pod


# --- the numbers themselves ------------------------------------------------


def test_documented_constants():
    """The numbers are the rule — docs/12 §4. Only these go into the build;
    the fill tables in §5 are reference for the ops team."""
    assert CAPACITY == {"full_time": 24, "part_time": 12}
    assert REREVIEW_DIVISOR == 2
    assert RUSH_OVERFLOW == 1.25
    assert PART_TIME_PODCAST_MAX == 1
    assert FAMILIARITY_BONUS == 0.15
    assert IDLE_TIEBREAK_FACTOR == 0.05
    assert IDLE_CAP_DAYS == 3


def test_a_full_day_divides_cleanly_into_every_content_type():
    """docs/12 §2: both budgets divide by 1, 3 and 6, so no mix of content
    types leaves an unusable remainder. Eight long-form reviews is the agreed
    anchor a full-time day was built from."""
    for budget in CAPACITY.values():
        for price in (1, 3, 6):
            assert budget % price == 0
    assert CAPACITY["full_time"] // 3 == 8


def test_the_halving_applies_once_and_rounds_up():
    """A repeat round is half the *base* price, never half the last round —
    so round 2 and round 6 cost the same. `ceil` keeps every figure an integer,
    which is what keeps the budgets divisible."""
    assert qc2_cost(6, repeat=False) == 6
    assert qc2_cost(6, repeat=True) == 3
    assert qc2_cost(3, repeat=True) == 2  # ceil(3/2), not 1.5
    assert qc2_cost(1, repeat=True) == 1  # ceil(1/2), never 0


# --- what "load" means -----------------------------------------------------


async def test_a_cleared_job_still_counts_against_today(db):
    """The decision the whole model rests on: points are spent against a date,
    and finishing the work does not hand them back the same day."""
    tl = await make_user(db, role="tl")
    reviewer = await make_user(db, role="qc")
    pod = await make_pod(db, tl=tl)
    job = await make_job(db, pod=pod, created_by=tl, stage="final", video_type="podcast")
    await make_charge(
        db, job=job, reviewer=reviewer, work_date=TODAY, released_at=datetime.now(timezone.utc)
    )
    await db.commit()

    assert await daily_load(db, reviewer.id, today=TODAY) == 6


async def test_a_cleared_job_stops_counting_tomorrow(db):
    """The other half of the same rule — otherwise it would never be a daily
    budget at all, just a lifetime one."""
    tl = await make_user(db, role="tl")
    reviewer = await make_user(db, role="qc")
    pod = await make_pod(db, tl=tl)
    job = await make_job(db, pod=pod, created_by=tl, stage="final", video_type="podcast")
    await make_charge(
        db, job=job, reviewer=reviewer, work_date=YESTERDAY, released_at=datetime.now(timezone.utc)
    )
    await db.commit()

    assert await daily_load(db, reviewer.id, today=TODAY) == 0


async def test_yesterdays_unfinished_round_still_counts_today(db):
    """A reviewer who sat on Monday's podcast must not start Tuesday looking
    free — the router would hand them another one."""
    tl = await make_user(db, role="tl")
    reviewer = await make_user(db, role="qc")
    pod = await make_pod(db, tl=tl)
    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="podcast")
    await make_charge(db, job=job, reviewer=reviewer, work_date=YESTERDAY)
    await db.commit()

    assert await daily_load(db, reviewer.id, today=TODAY) == 6

    breakdown = await load_breakdown(db, reviewer.id, today=TODAY)
    assert (breakdown.points_today, breakdown.points_carried) == (0, 6)
    assert breakdown.total == 6


async def test_todays_open_row_is_not_counted_twice(db):
    """A row dated today *and* still open matches both halves of the window.
    It is still one row."""
    tl = await make_user(db, role="tl")
    reviewer = await make_user(db, role="qc")
    pod = await make_pod(db, tl=tl)
    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="podcast")
    await make_charge(db, job=job, reviewer=reviewer, work_date=TODAY)
    await db.commit()

    assert await daily_load(db, reviewer.id, today=TODAY) == 6
    breakdown = await load_breakdown(db, reviewer.id, today=TODAY)
    assert (breakdown.points_today, breakdown.points_carried) == (6, 0)


# --- pricing a round -------------------------------------------------------


async def test_the_same_reviewer_pays_half_on_a_repeat_round(db):
    tl = await make_user(db, role="tl")
    reviewer = await make_user(db, role="qc")
    pod = await make_pod(db, tl=tl)
    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="podcast")

    first = await charge(db, job=job, reviewer_id=reviewer.id, today=TODAY)
    assert first.points == 6
    await release(db, job_id=job.id)

    job.round = 1
    second = await charge(db, job=job, reviewer_id=reviewer.id, today=TODAY)
    assert second.points == 3


async def test_rounds_three_four_and_five_cost_the_same_as_round_two(db):
    """Half of the base, once — not half of the previous round, which would
    reach zero by round five and make late revisions free."""
    tl = await make_user(db, role="tl")
    reviewer = await make_user(db, role="qc")
    pod = await make_pod(db, tl=tl)
    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="podcast")

    prices = []
    for round_no in range(5):
        job.round = round_no
        prices.append((await charge(db, job=job, reviewer_id=reviewer.id, today=TODAY)).points)
        await release(db, job_id=job.id)

    assert prices == [6, 3, 3, 3, 3]


async def test_a_different_reviewer_pays_full_price_on_a_repeat_round(db):
    """They have not seen the cut, so it is a first watch for them whatever the
    job's round counter says. This is why the price is stamped on the charge
    rather than recomputed from `round`."""
    tl = await make_user(db, role="tl")
    first_reviewer = await make_user(db, role="qc")
    second_reviewer = await make_user(db, role="qc")
    pod = await make_pod(db, tl=tl)
    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="podcast")

    await charge(db, job=job, reviewer_id=first_reviewer.id, today=TODAY)
    await release(db, job_id=job.id)

    job.round = 1
    handed_over = await charge(db, job=job, reviewer_id=second_reviewer.id, today=TODAY)
    assert handed_over.points == 6


async def test_charging_a_second_reviewer_moves_the_points(db):
    """A hand-reassignment must not leave the first reviewer paying for a job
    they no longer hold tomorrow."""
    tl = await make_user(db, role="tl")
    first_reviewer = await make_user(db, role="qc")
    second_reviewer = await make_user(db, role="qc")
    pod = await make_pod(db, tl=tl)
    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="long_form")

    await charge(db, job=job, reviewer_id=first_reviewer.id, today=TODAY)
    await charge(db, job=job, reviewer_id=second_reviewer.id, today=TODAY)
    await db.commit()

    # Today, both still count — no same-day refunds, for either of them.
    assert await daily_load(db, first_reviewer.id, today=TODAY) == 3
    assert await daily_load(db, second_reviewer.id, today=TODAY) == 3
    # Tomorrow, only the person actually holding it does.
    tomorrow = TODAY + timedelta(days=1)
    assert await daily_load(db, first_reviewer.id, today=tomorrow) == 0
    assert await daily_load(db, second_reviewer.id, today=tomorrow) == 3


async def test_charging_the_same_open_round_twice_is_a_no_op(db):
    """Two assignment paths can fire for one job. Neither may bill it twice."""
    tl = await make_user(db, role="tl")
    reviewer = await make_user(db, role="qc")
    pod = await make_pod(db, tl=tl)
    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="podcast")

    first = await charge(db, job=job, reviewer_id=reviewer.id, today=TODAY)
    again = await charge(db, job=job, reviewer_id=reviewer.id, today=TODAY)
    await db.commit()

    assert again.id == first.id
    assert await daily_load(db, reviewer.id, today=TODAY) == 6


async def test_a_round_released_and_reinstated_the_same_day_is_not_billed_twice(db):
    """Scrap at 11 and restore at 3 is one review, not two. The round counter
    has not moved, which is what tells this apart from a genuine second piece
    of work on the same day."""
    tl = await make_user(db, role="tl")
    reviewer = await make_user(db, role="qc")
    pod = await make_pod(db, tl=tl)
    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="podcast")

    await charge(db, job=job, reviewer_id=reviewer.id, today=TODAY)
    await release(db, job_id=job.id)
    await charge(db, job=job, reviewer_id=reviewer.id, today=TODAY)
    await db.commit()

    assert await daily_load(db, reviewer.id, today=TODAY) == 6
    # And it is open again, so it carries into tomorrow like any held round.
    assert await daily_load(db, reviewer.id, today=TODAY + timedelta(days=1)) == 6


# --- the pool filter -------------------------------------------------------


async def test_the_pool_asks_whether_this_job_fits_not_just_who_is_under_cap(db):
    """A reviewer with four points free cannot take a podcast. Letting them is
    how a budget stops meaning anything."""
    nearly_full = await make_user(db, role="qc", name="20 of 24 spent")
    roomy = await make_user(db, role="qc", name="Half a day left")
    tl, pod = await _pod_with(db, nearly_full, roomy)

    spent = await make_job(db, pod=pod, created_by=tl, stage="final", video_type="podcast")
    await make_charge(db, job=spent, reviewer=nearly_full, work_date=TODAY, points=20)
    other = await make_job(db, pod=pod, created_by=tl, stage="final", video_type="long_form")
    await make_charge(db, job=other, reviewer=roomy, work_date=TODAY, points=12)

    podcast = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="podcast")
    await db.commit()

    # nearly_full has 4 points left and the podcast costs 6, so despite being
    # the *less* loaded of the two by fraction... no: 20/24 > 12/24, but the
    # point is they are excluded outright rather than scored.
    chosen = await route_qc2(db, job=podcast, today=TODAY)
    assert chosen is not None and chosen.id == roomy.id


async def test_exactly_filling_the_budget_is_allowed(db):
    """`load + cost <= capacity`, not `<`. A reviewer with 6 points free takes
    the podcast and ends the day at exactly 24 — every fill combination in
    docs/12 §5 depends on this."""
    reviewer = await make_user(db, role="qc")
    tl, pod = await _pod_with(db, reviewer)

    spent = await make_job(db, pod=pod, created_by=tl, stage="final", video_type="long_form")
    await make_charge(db, job=spent, reviewer=reviewer, work_date=TODAY, points=18)
    podcast = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="podcast")
    await db.commit()

    chosen = await route_qc2(db, job=podcast, today=TODAY)
    assert chosen is not None and chosen.id == reviewer.id


async def test_a_spent_out_reviewer_holds_the_job_rather_than_taking_it(db):
    """docs/12 §7: an empty pool holds the job. It never assigns to the
    least-bad option and never silently overflows."""
    reviewer = await make_user(db, role="qc")
    tl, pod = await _pod_with(db, reviewer)

    spent = await make_job(db, pod=pod, created_by=tl, stage="final", video_type="long_form")
    await make_charge(db, job=spent, reviewer=reviewer, work_date=TODAY, points=24)
    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="short_form")
    await db.commit()

    assert await route_qc2(db, job=job, today=TODAY) is None


async def test_a_part_timer_holding_a_podcast_is_out_for_podcasts_only(db):
    """`PART_TIME_PODCAST_MAX` is the one constraint that is not arithmetic:
    12 points would buy two podcasts, and two podcasts is not a half day of
    anybody's attention. It says nothing about the rest of their work."""
    part_timer = await make_user(db, role="qc", employment_type="part_time")
    tl, pod = await _pod_with(db, part_timer)

    held = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="podcast")
    await make_charge(db, job=held, reviewer=part_timer, work_date=TODAY)

    second_podcast = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="podcast")
    a_short = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="short_form")
    await db.commit()

    assert await route_qc2(db, job=second_podcast, today=TODAY) is None
    still_in = await route_qc2(db, job=a_short, today=TODAY)
    assert still_in is not None and still_in.id == part_timer.id


async def test_a_full_timer_may_hold_more_than_one_podcast(db):
    """The cap is part-time only — control for the test above."""
    full_timer = await make_user(db, role="qc")
    tl, pod = await _pod_with(db, full_timer)

    held = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="podcast")
    await make_charge(db, job=held, reviewer=full_timer, work_date=TODAY)
    second = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="podcast")
    await db.commit()

    chosen = await route_qc2(db, job=second, today=TODAY)
    assert chosen is not None and chosen.id == full_timer.id


# --- the score -------------------------------------------------------------


async def test_a_part_timer_at_half_a_day_beats_a_full_timer_at_more(db):
    """Scoring uses proportion of capacity, not raw points — otherwise
    part-timers get loaded like full-timers, which is the entire reason the two
    capacities exist. 6/12 is a fuller day than 12/24 is not: it is emptier
    than 15/24, and raw points would say the opposite."""
    part_timer = await make_user(db, role="qc", name="Part-timer", employment_type="part_time")
    full_timer = await make_user(db, role="qc", name="Full-timer")
    tl, pod = await _pod_with(db, part_timer, full_timer)

    a = await make_job(db, pod=pod, created_by=tl, stage="final", video_type="long_form")
    await make_charge(db, job=a, reviewer=part_timer, work_date=TODAY, points=6)  # 50%
    b = await make_job(db, pod=pod, created_by=tl, stage="final", video_type="long_form")
    await make_charge(db, job=b, reviewer=full_timer, work_date=TODAY, points=15)  # 62.5%

    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="short_form")
    await db.commit()

    chosen = await route_qc2(db, job=job, today=TODAY)
    assert chosen is not None and chosen.id == part_timer.id
    # Raw points would have said the part-timer (6) was the emptier of the two
    # anyway, so pin the direction that actually discriminates:
    assert 6 / 12 < 15 / 24


async def test_raw_points_would_pick_the_wrong_person(db):
    """The discriminating case: the part-timer holds *fewer points* and is
    still the fuller day. 8/12 is 67%, 9/24 is 37.5%."""
    part_timer = await make_user(db, role="qc", name="Part-timer", employment_type="part_time")
    full_timer = await make_user(db, role="qc", name="Full-timer")
    tl, pod = await _pod_with(db, part_timer, full_timer)

    a = await make_job(db, pod=pod, created_by=tl, stage="final", video_type="long_form")
    await make_charge(db, job=a, reviewer=part_timer, work_date=TODAY, points=8)
    b = await make_job(db, pod=pod, created_by=tl, stage="final", video_type="long_form")
    await make_charge(db, job=b, reviewer=full_timer, work_date=TODAY, points=9)

    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="short_form")
    await db.commit()

    chosen = await route_qc2(db, job=job, today=TODAY)
    assert chosen is not None and chosen.id == full_timer.id


async def test_familiarity_beats_a_short_form_of_load(db):
    """-0.15 is worth 3.6 points of a full-time day, so a reviewer who has
    cleared work on this pod wins while carrying a little more."""
    familiar = await make_user(db, role="qc", name="Knows the pod")
    stranger = await make_user(db, role="qc", name="Stranger")
    tl, pod = await _pod_with(db, familiar, stranger)
    elsewhere = await make_pod(db, tl=tl, name="Elsewhere")

    held = await make_job(db, pod=pod, created_by=tl, stage="final", video_type="long_form")
    await make_charge(db, job=held, reviewer=familiar, work_date=TODAY, points=3)  # 0.125
    await make_job(db, pod=pod, created_by=tl, stage="delivered", reviewer=familiar)
    # The stranger needs recent work of their own, or the idle tiebreak decides
    # this instead: a reviewer with no history at all scores the full -0.15,
    # which is exactly the familiarity bonus and would mask it.
    await make_job(db, pod=elsewhere, created_by=tl, stage="delivered", reviewer=stranger)

    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="short_form")
    await db.commit()

    # familiar: 0.125 - 0.15 = -0.025   stranger: 0
    chosen = await route_qc2(db, job=job, today=TODAY)
    assert chosen is not None and chosen.id == familiar.id


async def test_familiarity_is_per_pod_not_global(db):
    """Clearing work on some *other* pod earns nothing here."""
    busy = await make_user(db, role="qc", name="Cleared elsewhere")
    stranger = await make_user(db, role="qc", name="Stranger")
    tl, pod = await _pod_with(db, busy, stranger)
    elsewhere = await make_pod(db, tl=tl, name="Elsewhere")

    held = await make_job(db, pod=pod, created_by=tl, stage="final", video_type="long_form")
    await make_charge(db, job=held, reviewer=busy, work_date=TODAY, points=6)
    await make_job(db, pod=elsewhere, created_by=tl, stage="delivered", reviewer=busy)

    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="short_form")
    await db.commit()

    chosen = await route_qc2(db, job=job, today=TODAY)
    assert chosen is not None and chosen.id == stranger.id


async def test_idle_tiebreak_prefers_the_person_who_has_sat_longer(db):
    """Two reviewers at zero: the one idle longer wins, so the same person
    doesn't catch three assignments in a row."""
    recent = await make_user(db, role="qc", name="Just finished")
    idle = await make_user(db, role="qc", name="Sitting idle")
    tl, pod = await _pod_with(db, recent, idle)
    elsewhere = await make_pod(db, tl=tl, name="Elsewhere")

    await make_job(
        db, pod=elsewhere, created_by=tl, stage="delivered", reviewer=recent,
        updated_at=_ago(days=1, hours=1),
    )
    await make_job(
        db, pod=elsewhere, created_by=tl, stage="delivered", reviewer=idle,
        updated_at=_ago(days=5),
    )
    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="short_form")
    await db.commit()

    # recent: -0.05 x 1 = -0.05   idle: -0.05 x min(5,3) = -0.15
    chosen = await route_qc2(db, job=job, today=TODAY)
    assert chosen is not None and chosen.id == idle.id


async def test_idle_tiebreak_never_beats_real_load(db):
    """Capped at three days: a reviewer idle for months is worth -0.15, which
    is less than a quarter of a full-time day of real work."""
    long_idle = await make_user(db, role="qc", name="Idle for months")
    free = await make_user(db, role="qc", name="Idle three days")
    tl, pod = await _pod_with(db, long_idle, free)
    elsewhere = await make_pod(db, tl=tl, name="Elsewhere")

    held = await make_job(
        db, pod=elsewhere, created_by=tl, stage="qc2", video_type="long_form",
        reviewer=long_idle, updated_at=_ago(days=100),
    )
    await make_charge(db, job=held, reviewer=long_idle, work_date=TODAY, points=6)  # 0.25
    await make_job(
        db, pod=elsewhere, created_by=tl, stage="delivered", reviewer=free,
        updated_at=_ago(days=3, hours=1),
    )
    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="short_form")
    await db.commit()

    # long_idle: 0.25 - 0.15 = 0.10   free: 0 - 0.15 = -0.15
    chosen = await route_qc2(db, job=job, today=TODAY)
    assert chosen is not None and chosen.id == free.id


# --- stickiness ------------------------------------------------------------


async def test_a_repeat_round_goes_back_to_the_same_reviewer_over_capacity(db):
    """A repeat round never re-enters load balancing. Handing it to a stranger
    would cost the team a second full watch to save one reviewer three points."""
    holder = await make_user(db, role="qc", name="Already watched it")
    free = await make_user(db, role="qc", name="Wide open")
    tl, pod = await _pod_with(db, holder, free)

    spent = await make_job(db, pod=pod, created_by=tl, stage="final", video_type="long_form")
    await make_charge(db, job=spent, reviewer=holder, work_date=TODAY, points=24)
    job = await make_job(
        db, pod=pod, created_by=tl, stage="qc2", video_type="podcast", reviewer=holder, round=1
    )
    await db.commit()

    chosen = await route_qc2(db, job=job, today=TODAY)
    assert chosen is not None and chosen.id == holder.id


async def test_sticky_falls_through_when_the_prior_reviewer_is_deactivated(db):
    """Nothing used to re-check, so a job assigned to somebody who then left
    stayed theirs forever — invisible to every queue."""
    gone = await make_user(db, role="qc", name="Left the company", is_active=False)
    still_here = await make_user(db, role="qc", name="Still here")
    tl, pod = await _pod_with(db, still_here)

    job = await make_job(
        db, pod=pod, created_by=tl, stage="qc2", video_type="long_form", reviewer=gone, round=1
    )
    await db.commit()

    assert await sticky_reviewer(db, job) is None
    chosen = await route_qc2(db, job=job, today=TODAY)
    assert chosen is not None and chosen.id == still_here.id


async def test_sticky_survives_the_availability_toggle(db):
    """`available` means "don't send me *new* QC work today". A round-2 cut
    this person already watched and wrote the change list for is not new work,
    and scattering their open revisions the moment they take a day off would
    make a stranger pay full price for a cut nobody has seen."""
    off_today = await make_user(db, role="qc", name="Off today", available=False)
    fresh = await make_user(db, role="qc", name="Wide open")
    tl, pod = await _pod_with(db, off_today, fresh)

    job = await make_job(
        db, pod=pod, created_by=tl, stage="qc2", video_type="long_form", reviewer=off_today, round=1
    )
    await db.commit()

    chosen = await route_qc2(db, job=job, today=TODAY)
    assert chosen is not None and chosen.id == off_today.id

    # A job they have *not* seen still goes to somebody on duty — the toggle
    # does exactly what it says and nothing more.
    new_work = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="long_form")
    await db.commit()
    routed = await route_qc2(db, job=new_work, today=TODAY)
    assert routed is not None and routed.id == fresh.id


async def test_a_returning_reviewer_pays_the_repeat_price_through_the_pool(db):
    """Sticky is not the only way back to a cut you have seen. Somebody who
    reviewed round 1, lost the job, and wins it back on score pays the repeat
    price — the ledger knows they watched it, not the round counter."""
    veteran = await make_user(db, role="qc", name="Saw round 1")
    tl, pod = await _pod_with(db, veteran)

    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="podcast")
    await charge(db, job=job, reviewer_id=veteran.id, today=TODAY)
    await release(db, job_id=job.id)
    job.qc2_reviewer_id = None
    job.round = 1
    await db.commit()

    chosen = await route_qc2(db, job=job, today=TODAY)
    assert chosen is not None and chosen.id == veteran.id
    billed = await charge(db, job=job, reviewer_id=veteran.id, today=TODAY)
    assert billed.points == 3


# --- rush ------------------------------------------------------------------


async def test_rush_overflows_the_least_loaded_reviewer(db):
    """docs/12 §6 step 3. Nobody has room, and this one cannot wait."""
    busier = await make_user(db, role="qc", name="Busier")
    least_loaded = await make_user(db, role="qc", name="Least loaded")
    tl, pod = await _pod_with(db, busier, least_loaded)

    a = await make_job(db, pod=pod, created_by=tl, stage="final", video_type="long_form")
    await make_charge(db, job=a, reviewer=busier, work_date=TODAY, points=24)
    b = await make_job(db, pod=pod, created_by=tl, stage="final", video_type="long_form")
    await make_charge(db, job=b, reviewer=least_loaded, work_date=TODAY, points=22)

    job = await make_job(
        db, pod=pod, created_by=tl, stage="qc2", video_type="long_form", rush=True
    )
    await db.commit()

    # 22 + 3 = 25, inside the 30-point ceiling on a 24-point day.
    chosen = await route_qc2(db, job=job, today=TODAY)
    assert chosen is not None and chosen.id == least_loaded.id


async def test_a_job_without_rush_holds_where_a_rush_job_would_overflow(db):
    """Control: the same board, the same job, one flag different."""
    reviewer = await make_user(db, role="qc")
    tl, pod = await _pod_with(db, reviewer)

    spent = await make_job(db, pod=pod, created_by=tl, stage="final", video_type="long_form")
    await make_charge(db, job=spent, reviewer=reviewer, work_date=TODAY, points=22)
    ordinary = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="long_form")
    await db.commit()

    assert await route_qc2(db, job=ordinary, today=TODAY) is None


async def test_rush_still_holds_past_the_overflow_ceiling(db):
    """The wall moves; it does not disappear. A reviewer at 140% of their day
    is not a delivery, it is a missed one later."""
    reviewer = await make_user(db, role="qc")
    tl, pod = await _pod_with(db, reviewer)

    spent = await make_job(db, pod=pod, created_by=tl, stage="final", video_type="long_form")
    await make_charge(db, job=spent, reviewer=reviewer, work_date=TODAY, points=28)
    job = await make_job(
        db, pod=pod, created_by=tl, stage="qc2", video_type="long_form", rush=True
    )
    await db.commit()

    # 28 + 3 = 31, past the 30-point ceiling.
    assert await route_qc2(db, job=job, today=TODAY) is None


async def test_rush_does_not_lift_the_part_time_podcast_cap(db):
    """The podcast cap is not a budget, so overflow has nothing to overflow.
    A part-timer's second podcast of the day is not a question of points."""
    part_timer = await make_user(db, role="qc", employment_type="part_time")
    tl, pod = await _pod_with(db, part_timer)

    held = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="podcast")
    await make_charge(db, job=held, reviewer=part_timer, work_date=TODAY)
    second = await make_job(
        db, pod=pod, created_by=tl, stage="qc2", video_type="podcast", rush=True
    )
    await db.commit()

    assert await route_qc2(db, job=second, today=TODAY) is None


# --- who is even a candidate ----------------------------------------------


async def test_unavailable_and_deactivated_reviewers_are_never_considered(db):
    off_today = await make_user(db, role="qc", name="Unavailable", available=False)
    gone = await make_user(db, role="qc", name="Left", is_active=False)
    on_duty = await make_user(db, role="qc", name="Available")
    tl, pod = await _pod_with(db, off_today, gone, on_duty)

    # The available one is carrying real work and would still lose on score.
    spent = await make_job(db, pod=pod, created_by=tl, stage="final", video_type="long_form")
    await make_charge(db, job=spent, reviewer=on_duty, work_date=TODAY, points=12)
    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="short_form")
    await db.commit()

    chosen = await route_qc2(db, job=job, today=TODAY)
    assert chosen is not None and chosen.id == on_duty.id


async def test_returns_none_when_nobody_is_available(db):
    first = await make_user(db, role="qc", available=False)
    second = await make_user(db, role="qc", available=False)
    tl, pod = await _pod_with(db, first, second)
    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="short_form")
    await db.commit()

    assert await route_qc2(db, job=job, today=TODAY) is None


async def test_returns_none_when_there_are_no_qc_accounts_at_all(db):
    tl = await make_user(db, role="tl")
    pod = await make_pod(db, tl=tl)
    await add_member(db, pod, tl, "tl")
    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="short_form")
    await db.commit()

    assert await route_qc2(db, job=job, today=TODAY) is None


async def test_the_pods_own_qc_members_win_over_the_company_wide_fallback(db):
    """The pod's reviewers are the candidate set; the wider QC team is only
    consulted when the pod has none. A free outsider must not outrank the pod's
    own reviewer."""
    in_pod = await make_user(db, role="qc", name="Pod's QC")
    await make_user(db, role="qc", name="Free outsider")
    tl, pod = await _pod_with(db, in_pod)

    spent = await make_job(db, pod=pod, created_by=tl, stage="final", video_type="long_form")
    await make_charge(db, job=spent, reviewer=in_pod, work_date=TODAY, points=12)
    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="short_form")
    await db.commit()

    chosen = await route_qc2(db, job=job, today=TODAY)
    assert chosen is not None and chosen.id == in_pod.id


async def test_falls_back_to_the_company_qc_team_when_the_pod_has_no_reviewer(db):
    """QC2 is a company-wide team, not a pod role: a pod with no QC member yet
    still gets routed instead of sending every job to the unrouted pile."""
    company_qc = await make_user(db, role="qc", name="Company QC")
    tl = await make_user(db, role="tl")
    pod = await make_pod(db, tl=tl)
    await add_member(db, pod, tl, "tl")
    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="short_form")
    await db.commit()

    chosen = await route_qc2(db, job=job, today=TODAY)
    assert chosen is not None and chosen.id == company_qc.id


async def test_a_pod_member_seated_as_a_ve_is_not_the_pods_reviewer(db):
    """Membership with pod_role 've' doesn't make someone the pod's QC. If it
    did, the loaded seat-holder would short-circuit the fallback and win;
    correctly, the free company reviewer does."""
    ve_seat = await make_user(db, role="qc", name="QC sitting in as VE")
    company_qc = await make_user(db, role="qc", name="Company QC")
    tl = await make_user(db, role="tl")
    pod = await make_pod(db, tl=tl)
    await add_member(db, pod, tl, "tl")
    await add_member(db, pod, ve_seat, "ve")

    spent = await make_job(db, pod=pod, created_by=tl, stage="final", video_type="long_form")
    await make_charge(db, job=spent, reviewer=ve_seat, work_date=TODAY, points=12)
    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", video_type="short_form")
    await db.commit()

    chosen = await route_qc2(db, job=job, today=TODAY)
    assert chosen is not None and chosen.id == company_qc.id
