"""Pipeline stage transition rules — see docs/05-pipeline-and-routing.md.
Single source of truth for what stage changes are legal; the router calls
into this rather than re-deriving the state machine inline."""
from app.models.user import ALL_PODS_ROLES

FORWARD = {
    "intake": "assigned",
    "assigned": "editing",
    "editing": "qc1",
    "qc1": "qc2",
    "qc2": "final",
    "final": "delivered",
}
# A send-back from QC1, QC2, or Final always drops the job into Revisions,
# never straight to whichever stage sent it back.
SEND_BACK_ELIGIBLE = ("qc1", "qc2", "final")

# Whose plate the job is on at each open stage — the stage table in docs/05,
# as a partition. Every stage before delivery belongs to exactly one role, and
# `delivered` is absent because a delivered job is on nobody's plate.
#
# This is what "Mine" means (`services/access.py::mine_clauses`): not "a job
# with my name somewhere on it" but "a job waiting on me right now". The two
# are different questions — an editor's cut sitting in QC2 still carries their
# id, and counting it as theirs tells them to act on something they cannot
# touch. `assigned` belongs to the VE, not the TL who assigned it: the next
# move from there is the editor starting the cut.
STAGE_OWNER_ROLE: dict[str, str] = {
    "intake": "tl",
    "assigned": "ve",
    "editing": "ve",
    "qc1": "tl",
    "qc2": "qc",
    "revisions": "ve",
    "final": "tl",
}


def stages_owned_by(role: str) -> tuple[str, ...]:
    return tuple(stage for stage, owner in STAGE_OWNER_ROLE.items() if owner == role)


def is_briefed(job) -> bool:
    """Has this job actually been handed over — an editor *and* a date?

    A hand-off is two decisions, not one, and until the TL has made both there
    is nothing an editor can act on. A job that lands on their plate with "no
    deadline" tells them to start cutting against no date at all: they cannot
    tell it from the job that is due tomorrow, and the pipeline's own overdue
    number quietly skips it forever.

    So the brief is the gate. Missing either half and the job is still the
    TL's move (`STAGE_OWNER_ROLE` is overridden by `owner_role_for` below),
    it stays out of the editor's Mine, and `can_advance` refuses their moves.
    The TL fixes it by setting a deadline, not by pushing the job on.
    """
    return job.assigned_editor_id is not None and job.deadline is not None


def owner_role_for(job) -> str | None:
    """Whose move it is on *this* job, which is the stage table plus the one
    exception above: an un-briefed job at an editor's stage is the TL's.

    `STAGE_OWNER_ROLE` answers the question for a stage in the abstract; this
    answers it for a row, and is the one `mine_clauses` and the UI both mean.
    """
    owner = STAGE_OWNER_ROLE.get(job.stage)
    if owner == "ve" and not is_briefed(job):
        return "tl"
    return owner


def resubmit_stage(sent_back_from: str | None) -> str:
    """Where a re-cut goes when it leaves the edit bay.

    Back to the desk that asked for the changes — QC2's send-back returns to
    QC2, the final check's returns to the final check — and to QC1 when the
    job has never been sent back at all. Walking the whole line again put the
    pod TL in front of a change list they had not written, ahead of the
    reviewer who had; the round is that reviewer's to close.
    """
    return sent_back_from if sent_back_from in SEND_BACK_ELIGIBLE else FORWARD["editing"]


def allowed_next_stages(stage: str, sent_back_from: str | None = None) -> set[str]:
    if stage == "revisions":
        # Back through the edit bay, not straight to QC. A revision round used
        # to go `revisions -> qc1` in one move, which meant the round had a
        # finish line and no starting gun: there was no moment on the record
        # when the editor picked the changes up, so the only round anyone
        # could time was the first one. Re-entering `editing` costs the editor
        # one click and puts a start on the record for every round — and it is
        # what they are doing anyway.
        return {"editing"}
    if stage == "delivered":
        return set()
    if stage == "editing":
        return {resubmit_stage(sent_back_from)}
    next_stages = {FORWARD[stage]}
    if stage in SEND_BACK_ELIGIBLE:
        next_stages.add("revisions")
    return next_stages


def is_valid_transition(current: str, target: str, sent_back_from: str | None = None) -> bool:
    return target in allowed_next_stages(current, sent_back_from)


# Which moves a VE may make on their *own* job — the three steps of the
# editor's loop in docs/05: pick the job up, hand the cut on for review, and
# pick a sent-back job up again. Note that both ways into the edit bay are
# here and only one way out: an editor cannot send a cut for QC without first
# starting it, on the first round or on the fifth, which is what makes the
# time spent per round a real number. Everything else (assigning, clearing QC,
# delivery) belongs to a TL/QC — see the role matrix in docs/04-permissions.md.
#
# The way out is written as a stage set rather than a pair because it depends
# on the job: `resubmit_stage()` decides which desk it is, and the editor may
# make whichever move that is — never a choice between them.
VE_TRANSITIONS = frozenset({("assigned", "editing"), ("revisions", "editing")})
VE_RESUBMIT_FROM = "editing"
# QC owns the QC2 stage only (docs/05 stage table): they either clear the job
# to Final check or send it back with a change list.
QC_TRANSITIONS = frozenset({("qc2", "final"), ("qc2", "revisions")})


def can_advance(*, role, user_id, job, pod, target: str) -> bool:
    """Server-side answer to 'is this person allowed to make this move'.

    Kept next to the transition table because the two are one rule together:
    which moves exist, and who may make them. The router raises the 403; this
    stays a pure predicate so the same check can back a future scheduled job
    or the Phase 3 chatbot's tool layer without going through HTTP.

    `role` is a role name **or the set of roles this person holds** — pass
    `effective_roles(user)` and a lent TL is a TL here too. Every branch is
    an independent `if`, not an `elif`: someone can be the editor on this job
    *and* the lead of the pod it is in, and refusing them the lead's move
    because the editor branch matched first would be a bug that only shows up
    on the accounts most likely to be unsticking something.
    """
    roles = {role} if isinstance(role, str) else set(role)

    # The Owner makes any legal move on any pod; a TL makes any legal move on
    # the pods they lead. Same powers, different reach — ALL_PODS_ROLES in
    # models/user.py.
    if roles & set(ALL_PODS_ROLES):
        return True
    if "tl" in roles and pod is not None and pod.tl_id == user_id:
        return True
    if "qc" in roles:
        if job.qc2_reviewer_id == user_id and (job.stage, target) in QC_TRANSITIONS:
            return True
    if "ve" in roles and job.assigned_editor_id == user_id:
        # Nothing to start against no date. An un-briefed job is still the
        # TL's move (`is_briefed`), so the editor's three moves are refused
        # here as well as hidden in the UI — the button was the visible half
        # of a rule that has to hold on the route too (docs/04).
        if is_briefed(job):
            if job.stage == VE_RESUBMIT_FROM:
                return target == resubmit_stage(getattr(job, "sent_back_from", None))
            return (job.stage, target) in VE_TRANSITIONS
    return False
