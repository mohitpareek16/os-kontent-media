"""services/stage_machine.py — the transition table and who may drive it.

Pure functions, no HTTP and no database: this is where the pipeline rules in
docs/05-pipeline-and-routing.md and the per-move role scoping in
docs/04-permissions.md actually live.
"""
from __future__ import annotations

import uuid
from datetime import date
from types import SimpleNamespace

import pytest

from app.models.job import STAGES
from app.services.stage_machine import (
    QC_TRANSITIONS,
    SEND_BACK_ELIGIBLE,
    STAGE_OWNER_ROLE,
    VE_TRANSITIONS,
    allowed_next_stages,
    can_advance,
    is_briefed,
    is_valid_transition,
    owner_role_for,
    resubmit_stage,
    stages_owned_by,
)

pytestmark = pytest.mark.unit

LINEAR_PATH = [
    ("intake", "assigned"),
    ("assigned", "editing"),
    ("editing", "qc1"),
    ("qc1", "qc2"),
    ("qc2", "final"),
    ("final", "delivered"),
]


# --------------------------------------------------------------------------
# allowed_next_stages / is_valid_transition  (brief item 7)
# --------------------------------------------------------------------------


@pytest.mark.parametrize("current,target", LINEAR_PATH)
def test_linear_path_is_valid(current, target):
    assert target in allowed_next_stages(current)
    assert is_valid_transition(current, target)


@pytest.mark.parametrize("stage", SEND_BACK_ELIGIBLE)
def test_send_back_eligible_stages_can_drop_to_revisions(stage):
    assert "revisions" in allowed_next_stages(stage)
    assert is_valid_transition(stage, "revisions")


@pytest.mark.parametrize("stage", ["intake", "assigned", "editing", "revisions", "delivered"])
def test_only_qc1_qc2_final_can_send_back(stage):
    assert "revisions" not in allowed_next_stages(stage)
    assert not is_valid_transition(stage, "revisions")


def test_send_back_eligible_set_is_exactly_qc1_qc2_final():
    assert set(SEND_BACK_ELIGIBLE) == {"qc1", "qc2", "final"}


def test_revisions_always_go_back_through_the_edit_bay():
    """docs/05: the loop goes back through `editing` — the editor picks the
    changes up before re-submitting — never straight from `revisions` to a
    review desk. The re-entry into `editing` is what gives a revision round a
    start time on the record; without it only the first cut had one."""
    assert allowed_next_stages("revisions") == {"editing"}
    for target in STAGES:
        assert is_valid_transition("revisions", target) is (target == "editing")


@pytest.mark.parametrize("sender", SEND_BACK_ELIGIBLE)
def test_a_re_cut_returns_to_the_desk_that_sent_it_back(sender):
    """The other half of the loop: leaving the edit bay goes to whoever asked
    for the changes, not to the front of the line. A QC2 send-back that came
    back through QC1 made the pod TL re-review a change list they had never
    written, ahead of the reviewer waiting to close their own round."""
    assert resubmit_stage(sender) == sender
    assert allowed_next_stages("editing", sender) == {sender}
    assert is_valid_transition("editing", sender, sender)
    # And only there — the ordinary forward move is not still on offer.
    assert not is_valid_transition("editing", "qc1", "qc2")


def test_a_cut_that_was_never_sent_back_goes_to_qc1():
    assert resubmit_stage(None) == "qc1"
    assert allowed_next_stages("editing") == {"qc1"}
    assert allowed_next_stages("editing", None) == {"qc1"}


def test_delivered_is_terminal():
    assert allowed_next_stages("delivered") == set()
    for target in STAGES:
        assert not is_valid_transition("delivered", target)


def test_no_stage_can_skip_ahead():
    """Every stage's full legal set — a job can never jump the queue."""
    assert allowed_next_stages("intake") == {"assigned"}
    assert allowed_next_stages("assigned") == {"editing"}
    assert allowed_next_stages("editing") == {"qc1"}
    assert allowed_next_stages("qc1") == {"qc2", "revisions"}
    assert allowed_next_stages("qc2") == {"final", "revisions"}
    assert allowed_next_stages("final") == {"delivered", "revisions"}


@pytest.mark.parametrize(
    "current,target",
    [
        ("intake", "delivered"),
        ("intake", "editing"),
        ("assigned", "qc1"),
        ("editing", "qc2"),
        ("qc1", "final"),
        ("qc2", "delivered"),
        ("qc2", "qc1"),
        ("final", "qc2"),
        ("editing", "editing"),
    ],
)
def test_representative_illegal_transitions(current, target):
    assert not is_valid_transition(current, target)


def test_transition_table_is_a_closed_graph():
    """Nothing points at a stage that doesn't exist."""
    for stage in STAGES:
        assert allowed_next_stages(stage) <= set(STAGES)


# --------------------------------------------------------------------------
# can_advance  (brief item 8)
# --------------------------------------------------------------------------

TL_ID = uuid.uuid4()
VE_ID = uuid.uuid4()
QC_ID = uuid.uuid4()
STRANGER_ID = uuid.uuid4()
DEADLINE = date(2030, 1, 1)


def _job(stage: str, *, editor=VE_ID, reviewer=QC_ID, sent_back_from=None, deadline=DEADLINE):
    return SimpleNamespace(
        stage=stage,
        assigned_editor_id=editor,
        qc2_reviewer_id=reviewer,
        sent_back_from=sent_back_from,
        # Briefed by default: a job with a date on it is the ordinary case,
        # and the hand-off gate (`is_briefed`) gets its own tests below.
        deadline=deadline,
    )


def _pod(tl_id=TL_ID):
    return SimpleNamespace(tl_id=tl_id)


ALL_MOVES = [
    (stage, target) for stage in STAGES for target in sorted(allowed_next_stages(stage))
]


@pytest.mark.parametrize("stage,target", ALL_MOVES)
def test_owner_may_make_every_move(stage, target):
    assert can_advance(
        role="owner", user_id=STRANGER_ID, job=_job(stage), pod=_pod(), target=target
    )


@pytest.mark.parametrize("stage,target", ALL_MOVES)
def test_pod_tl_may_make_every_move_on_their_own_pod(stage, target):
    assert can_advance(role="tl", user_id=TL_ID, job=_job(stage), pod=_pod(), target=target)


@pytest.mark.parametrize("stage,target", ALL_MOVES)
def test_tl_of_another_pod_may_make_no_move(stage, target):
    """docs/04: 'A TL who merely sits in another pod as a member does not get
    that pod's job controls.'"""
    assert not can_advance(
        role="tl", user_id=STRANGER_ID, job=_job(stage), pod=_pod(), target=target
    )


def test_tl_with_no_pod_row_is_refused():
    assert not can_advance(role="tl", user_id=TL_ID, job=_job("qc1"), pod=None, target="qc2")


@pytest.mark.parametrize("stage,target", ALL_MOVES)
def test_ve_may_make_only_the_editor_loop_on_their_own_job(stage, target):
    # The way out of the edit bay is not a fixed pair — it is wherever the
    # job was sent back from — so it is checked against the same rule the
    # transition table uses rather than against the entry moves.
    expected = (stage, target) in VE_TRANSITIONS or (
        stage == "editing" and target == resubmit_stage(None)
    )
    assert can_advance(
        role="ve", user_id=VE_ID, job=_job(stage), pod=_pod(), target=target
    ) is expected


def test_ve_transition_set_is_exactly_the_two_ways_into_the_edit_bay():
    """Two ways in, and the one way out is `resubmit_stage()` rather than a
    pair in here: an editor cannot send a cut for review without first
    starting it, on the first round or the fifth."""
    assert set(VE_TRANSITIONS) == {
        ("assigned", "editing"),
        ("revisions", "editing"),
    }


@pytest.mark.parametrize("sender", SEND_BACK_ELIGIBLE)
def test_ve_re_submits_to_whoever_sent_the_job_back(sender):
    job = _job("editing", sent_back_from=sender)
    assert can_advance(role="ve", user_id=VE_ID, job=job, pod=_pod(), target=sender)
    # Not anywhere else, including the route a first cut would take.
    for target in STAGES:
        if target != sender:
            assert not can_advance(
                role="ve", user_id=VE_ID, job=job, pod=_pod(), target=target
            )


@pytest.mark.parametrize("stage,target", sorted(VE_TRANSITIONS) + [("editing", "qc1")])
def test_ve_cannot_move_someone_elses_job(stage, target):
    assert not can_advance(
        role="ve", user_id=STRANGER_ID, job=_job(stage), pod=_pod(), target=target
    )


@pytest.mark.parametrize("target", ["final", "revisions"])
def test_ve_never_clears_or_sends_back_their_own_qc(target):
    """An editor never clears their own QC and never sends their own job back."""
    assert not can_advance(
        role="ve", user_id=VE_ID, job=_job("qc2"), pod=_pod(), target=target
    )
    assert not can_advance(
        role="ve", user_id=VE_ID, job=_job("qc1"), pod=_pod(), target="revisions"
    )


def test_ve_cannot_deliver():
    assert not can_advance(
        role="ve", user_id=VE_ID, job=_job("final"), pod=_pod(), target="delivered"
    )


@pytest.mark.parametrize("stage,target", ALL_MOVES)
def test_qc_may_only_leave_qc2_on_a_job_routed_to_them(stage, target):
    expected = (stage, target) in QC_TRANSITIONS
    assert can_advance(
        role="qc", user_id=QC_ID, job=_job(stage), pod=_pod(), target=target
    ) is expected


def test_qc_transition_set_is_exactly_out_of_qc2():
    assert set(QC_TRANSITIONS) == {("qc2", "final"), ("qc2", "revisions")}


@pytest.mark.parametrize("target", ["final", "revisions"])
def test_qc_cannot_touch_a_job_routed_to_a_different_reviewer(target):
    job = _job("qc2", reviewer=STRANGER_ID)
    assert not can_advance(role="qc", user_id=QC_ID, job=job, pod=_pod(), target=target)


@pytest.mark.parametrize("target", ["final", "revisions"])
def test_qc_cannot_touch_an_unrouted_job(target):
    """A QC can *see* an unrouted qc2 job in their pod (access.py) but seeing
    it is not owning it."""
    job = _job("qc2", reviewer=None)
    assert not can_advance(role="qc", user_id=QC_ID, job=job, pod=_pod(), target=target)


def test_qc_cannot_deliver():
    """docs/04: 'They own the QC2 stage ... delivery is not.'"""
    assert not can_advance(
        role="qc", user_id=QC_ID, job=_job("final"), pod=_pod(), target="delivered"
    )


def test_unknown_role_is_refused():
    assert not can_advance(
        role="intern", user_id=STRANGER_ID, job=_job("qc1"), pod=_pod(), target="qc2"
    )


# --------------------------------------------------------------------------
# is_briefed / owner_role_for — the hand-off gate
# --------------------------------------------------------------------------


@pytest.mark.parametrize("stage,target", sorted(VE_TRANSITIONS) + [("editing", "qc1")])
def test_editor_cannot_move_a_job_that_has_no_deadline(stage, target):
    """Half a hand-off is not a hand-off. A name on the job and no date gives
    the editor nothing to work against, so none of their three moves are
    theirs to make until the TL finishes it."""
    job = _job(stage, deadline=None)
    assert not can_advance(role="ve", user_id=VE_ID, job=job, pod=_pod(), target=target)


def test_a_lead_can_still_move_an_un_briefed_job():
    """The gate is on the editor, not on the job: an admin unsticking one
    (and the TL who owns it) is exactly who should be able to move it."""
    job = _job("assigned", deadline=None)
    assert can_advance(role="tl", user_id=TL_ID, job=job, pod=_pod(), target="editing")
    assert can_advance(role="owner", user_id=STRANGER_ID, job=job, pod=_pod(), target="editing")


@pytest.mark.parametrize("stage", stages_owned_by("ve"))
def test_an_un_briefed_editor_stage_is_still_the_tls_move(stage):
    assert owner_role_for(_job(stage, deadline=None)) == "tl"
    assert owner_role_for(_job(stage, editor=None)) == "tl"
    assert owner_role_for(_job(stage)) == "ve"


@pytest.mark.parametrize("stage", [s for s in STAGES if STAGE_OWNER_ROLE.get(s) != "ve"])
def test_the_brief_does_not_move_any_other_stage(stage):
    """Only the editor's stages have this exception — a QC2 job with no
    deadline is still the reviewer's, and delivered is still nobody's."""
    assert owner_role_for(_job(stage, deadline=None)) == STAGE_OWNER_ROLE.get(stage)


def test_is_briefed_needs_both_halves():
    assert is_briefed(_job("assigned"))
    assert not is_briefed(_job("assigned", editor=None))
    assert not is_briefed(_job("assigned", deadline=None))
