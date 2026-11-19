"""services/qc1_review.py — how the latest QC1 review went, read off the log.

The whole feature rests on this derivation being right: a flag raised on the
strength of "cleared in 12 seconds, said nothing" is an accusation, and the
two numbers behind it are computed here from event rows nobody wrote for this
purpose. So the shapes that matter are the ones a real job produces — a pass
after a send-back, a note typed into the hand-off itself, and a QC1 nobody has
reached yet.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.models.job_event import JobEvent
from app.services.qc1_review import latest_qc1_pass, may_flag_qc1
from tests.factories import make_job, make_pod, make_user

pytestmark = pytest.mark.unit

START = datetime(2026, 8, 1, 9, 0, tzinfo=timezone.utc)


async def _move(db, job, actor, *, from_stage, to_stage, minutes, round_=0, outcome=None):
    payload = {"stage": to_stage, "from_stage": from_stage, "round": round_}
    if outcome is not None:
        payload["qc1_outcome"] = outcome
    event = JobEvent(
        job_id=job.id,
        event_type="stage_changed",
        actor_id=actor.id,
        payload=payload,
        created_at=START + timedelta(minutes=minutes),
    )
    db.add(event)
    await db.flush()
    return event


async def _note(db, job, actor, *, minutes, stage, from_stage=None, kind="note_added"):
    payload = {"note": "something", "stage": stage}
    if from_stage is not None:
        payload["from_stage"] = from_stage
    event = JobEvent(
        job_id=job.id,
        event_type=kind,
        actor_id=actor.id,
        payload=payload,
        created_at=START + timedelta(minutes=minutes),
    )
    db.add(event)
    await db.flush()
    return event


@pytest.fixture
async def cast(db):
    tl = await make_user(db, role="tl")
    ve = await make_user(db, role="ve")
    qc = await make_user(db, role="qc")
    pod = await make_pod(db, tl=tl)
    job = await make_job(db, pod=pod, created_by=tl, stage="qc2", editor=ve, reviewer=qc)
    await db.commit()
    return job, tl, ve, qc


async def test_a_pass_reports_who_when_and_how_long(db, cast):
    job, tl, ve, qc = cast
    await _move(db, job, ve, from_stage="editing", to_stage="qc1", minutes=0)
    await _move(db, job, tl, from_stage="qc1", to_stage="qc2", minutes=30)
    await db.commit()

    result = await latest_qc1_pass(db, job=job)
    assert result is not None
    assert result.cleared_by_id == tl.id
    assert result.seconds == 30 * 60
    assert result.comments == 0


async def test_nothing_to_report_before_qc1(db, cast):
    job, tl, ve, qc = cast
    await _move(db, job, ve, from_stage="assigned", to_stage="editing", minutes=0)
    await db.commit()

    assert await latest_qc1_pass(db, job=job) is None


async def test_a_send_back_is_not_a_pass(db, cast):
    """The opposite of the thing being measured: a TL who sent it back plainly
    did look at it."""
    job, tl, ve, qc = cast
    await _move(db, job, ve, from_stage="editing", to_stage="qc1", minutes=0)
    await _move(db, job, tl, from_stage="qc1", to_stage="revisions", minutes=20, round_=1)
    await db.commit()

    assert await latest_qc1_pass(db, job=job) is None


async def test_the_latest_pass_wins(db, cast):
    """A job on round two has been through QC1 twice, and only the pass the
    reviewer is looking at right now is the one anybody can act on."""
    job, tl, ve, qc = cast
    other_tl = await make_user(db, role="tl")
    await _move(db, job, ve, from_stage="editing", to_stage="qc1", minutes=0)
    await _move(db, job, tl, from_stage="qc1", to_stage="qc2", minutes=60)
    await _move(db, job, qc, from_stage="qc2", to_stage="revisions", minutes=90, round_=1)
    await _move(db, job, ve, from_stage="revisions", to_stage="editing", minutes=100, round_=1)
    await _move(db, job, ve, from_stage="editing", to_stage="qc1", minutes=160, round_=1)
    await _move(db, job, other_tl, from_stage="qc1", to_stage="qc2", minutes=161, round_=1)
    await db.commit()

    result = await latest_qc1_pass(db, job=job)
    assert result.cleared_by_id == other_tl.id
    assert result.seconds == 60
    assert result.round == 1


async def test_notes_left_while_it_sat_at_qc1_count(db, cast):
    job, tl, ve, qc = cast
    await _move(db, job, ve, from_stage="editing", to_stage="qc1", minutes=0)
    await _note(db, job, tl, minutes=10, stage="qc1")
    await _move(db, job, tl, from_stage="qc1", to_stage="qc2", minutes=30)
    await db.commit()

    result = await latest_qc1_pass(db, job=job)
    assert result.comments == 1


async def test_the_note_typed_into_the_hand_off_counts(db, cast):
    """It is written *after* the stage change it belongs to — same request,
    clock_timestamp() — so a naive time window misses the one comment that
    most clearly shows the TL did look."""
    job, tl, ve, qc = cast
    await _move(db, job, ve, from_stage="editing", to_stage="qc1", minutes=0)
    await _move(db, job, tl, from_stage="qc1", to_stage="qc2", minutes=30)
    await _note(db, job, tl, minutes=30, stage="qc2", from_stage="qc1")
    await db.commit()

    result = await latest_qc1_pass(db, job=job)
    assert result.comments == 1


async def test_a_note_left_at_qc2_is_not_credited_to_qc1(db, cast):
    job, tl, ve, qc = cast
    await _move(db, job, ve, from_stage="editing", to_stage="qc1", minutes=0)
    await _move(db, job, tl, from_stage="qc1", to_stage="qc2", minutes=30)
    await _note(db, job, qc, minutes=45, stage="qc2")
    await db.commit()

    result = await latest_qc1_pass(db, job=job)
    assert result.comments == 0


async def test_an_unknown_entry_is_none_seconds_not_zero(db, cast):
    """A duration nobody recorded must not render as an instant one — "it took
    no time at all" is the accusation this panel is used to make."""
    job, tl, ve, qc = cast
    await _move(db, job, tl, from_stage="qc1", to_stage="qc2", minutes=30)
    await db.commit()

    result = await latest_qc1_pass(db, job=job)
    assert result.seconds is None


async def test_only_the_routed_reviewer_and_the_admin_tier_may_flag(db, cast):
    job, tl, ve, qc = cast
    other_qc = await make_user(db, role="qc")
    owner = await make_user(db, role="owner")
    hr = await make_user(db, role="hr")

    assert may_flag_qc1(user=qc, job=job) is True
    assert may_flag_qc1(user=owner, job=job) is True
    # HR is not the admin tier and never reviewed anything — it lost this
    # with the rest of the company-wide reach (docs/04).
    assert may_flag_qc1(user=hr, job=job) is False
    # The TL would be marking their own homework, and the editor has the most
    # to gain from discrediting a review of their own cut.
    assert may_flag_qc1(user=tl, job=job) is False
    assert may_flag_qc1(user=ve, job=job) is False
    assert may_flag_qc1(user=other_qc, job=job) is False


# --------------------------------------------------------------------------
# Which of the two QC1 buttons was pressed
# --------------------------------------------------------------------------


async def test_the_outcome_is_read_back_off_the_pass(db, cast):
    """QC1 has two endings that both go forward: nothing to raise, or comments
    left on Frame.io. The comments themselves never reach this database
    (docs/03), so this flag is their only trace — and it is what tells a real
    review apart from a cut waved through, which is the entire point of the
    surface it feeds."""
    job, tl, ve, qc = cast
    await _move(db, job, ve, from_stage="editing", to_stage="qc1", minutes=0)
    await _move(
        db, job, tl, from_stage="qc1", to_stage="qc2", minutes=4, outcome="comments_added"
    )
    await db.commit()

    result = await latest_qc1_pass(db, job=job)
    assert result.outcome == "comments_added"
    # Nothing was typed *here* — the notes are on Frame.io. Both facts are
    # reported; neither is turned into a verdict.
    assert result.comments == 0


async def test_a_pass_from_before_the_two_buttons_reports_no_outcome(db, cast):
    """None, not "approved". Every QC1 cleared before this was recorded looks
    identical on the log, and inventing a self-report for thousands of old
    rows would put words in people's mouths on a panel that gets read in
    arguments."""
    job, tl, ve, qc = cast
    await _move(db, job, ve, from_stage="editing", to_stage="qc1", minutes=0)
    await _move(db, job, tl, from_stage="qc1", to_stage="qc2", minutes=30)
    await db.commit()

    assert (await latest_qc1_pass(db, job=job)).outcome is None


async def test_a_value_that_is_not_one_of_the_two_is_read_as_unknown(db, cast):
    """The payload is JSON and nothing at the database enforces it. A typo
    from a hand-rolled call must degrade to "not recorded" rather than being
    printed back as though somebody had claimed it."""
    job, tl, ve, qc = cast
    await _move(db, job, ve, from_stage="editing", to_stage="qc1", minutes=0)
    await _move(db, job, tl, from_stage="qc1", to_stage="qc2", minutes=5, outcome="looks_fine")
    await db.commit()

    assert (await latest_qc1_pass(db, job=job)).outcome is None
