"""How QC1 actually went, read off the event log.

QC1 is the pod TL's first-pass review (docs/05). Nothing on the record used to
tell a real review apart from a job waved straight through: both are a
`stage_changed` event from qc1 to qc2, and the one person in a position to
notice — the QC2 reviewer, who is now reading a cut nobody checked — had
nothing to look at.

So this is the evidence, derived from the log and never stored: who cleared
QC1, when, how long the job had been sitting there, whether they said anything
while it was, and which of the two QC1 buttons they pressed. Facts and no
verdict. A forty-second pass with no note is *usually* a rubber stamp and
occasionally a TL who watched the cut over the editor's shoulder — the system
cannot tell those apart, so it reports the numbers and leaves the judgement to
the reviewer, who raises the flag by hand (`POST /jobs/{id}/qc1-flag`).

`outcome` is the closest thing here to a self-report: the TL choosing "QC1
comments added" is saying they left notes on Frame.io, which this database
never sees and so can never count. It is worth recording precisely because
the alternative — silence — is indistinguishable from not looking.

Only the **latest** pass is returned. A job on round three has been through
QC1 three times, and the one being reviewed right now is the only one anybody
is about to act on; the rest stay in the timeline.
"""
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job
from app.models.job_event import JobEvent
from app.models.user import ALL_PODS_ROLES, User, has_role
from app.schemas.job import Qc1Pass

QC1 = "qc1"
QC2 = "qc2"
# What counts as the TL having said something: a comment left while the job
# sat at QC1, and the hand-off note typed into the move itself. The second one
# matters most — "passed it forward with a line about the hook" is precisely
# the thing a bare stage change cannot show.
COMMENT_EVENTS = ("note_added", "changes_raised")
# The two ways a QC1 review ends with the job going forward, as recorded on
# the stage_changed event by `advance_stage`. Anything else on that payload —
# an older value, a typo from a hand-rolled call — is read as unknown rather
# than trusted, because this field is evidence in a disagreement between two
# colleagues.
QC1_OUTCOMES = ("approved", "comments_added")


def may_flag_qc1(*, user: User, job: Job) -> bool:
    """Who may say a QC1 never happened.

    The QC2 reviewer the job is actually routed to, and the company-wide tier
    (Owner, Founder's Office, HR) auditing after the fact. Kept next to the
    evidence for the same reason `can_advance` sits next to the transition
    table: the rule and the thing it is about are one idea.

    Deliberately **not** the pod TL. QC1 is the TL's own review, so a TL
    flagging or clearing here is marking their own homework — and the
    company-wide tier is who a genuine disagreement escalates to. Deliberately
    not the editor either: they are the party with the most to gain from
    discrediting a review of their cut, and the QC2 reviewer sees the same
    evidence anyway.
    """
    if has_role(user, *ALL_PODS_ROLES):
        return True
    return has_role(user, "qc") and job.qc2_reviewer_id == user.id


@dataclass
class _Pass:
    round: int
    entered_at: datetime | None
    cleared_at: datetime
    cleared_by_id: uuid.UUID | None
    cleared_by_name: str | None
    comments: int
    # What the TL said they were doing when they passed it on: nothing to
    # raise, or comments left on Frame.io. None on a pass recorded before the
    # two buttons existed — which is not the same as "approved", and is
    # reported as unknown rather than guessed.
    outcome: str | None


async def latest_qc1_pass(db: AsyncSession, *, job: Job) -> Qc1Pass | None:
    """The most recent time this job was cleared from QC1 to QC2.

    None when it has never been through QC1 — a job still in the edit bay, or
    one seeded straight into a later stage. `seconds` is None rather than 0
    when the entry into QC1 isn't on the log for the same reason: an unknown
    duration must not read as an instant one, which is the exact accusation
    this whole surface exists to support (docs/06: don't render numbers you
    don't have).
    """
    rows = (
        await db.execute(
            select(JobEvent, User.name)
            .outerjoin(User, User.id == JobEvent.actor_id)
            .where(
                JobEvent.job_id == job.id,
                JobEvent.event_type.in_(("stage_changed", *COMMENT_EVENTS)),
            )
            .order_by(JobEvent.created_at)
        )
    ).all()

    entered_at: datetime | None = None
    entered_round = 0
    comments = 0
    last_pass: _Pass | None = None
    # The note attached to the move out of QC1 is written *after* the
    # stage_changed row it belongs to (same request, clock_timestamp()), so it
    # cannot be caught by a time window — it is caught by being the next event
    # after the pass. Any other stage change closes the door.
    trailing_note_for: _Pass | None = None

    for event, actor_name in rows:
        payload = event.payload or {}

        if event.event_type != "stage_changed":
            if entered_at is not None:
                comments += 1
            elif trailing_note_for is not None and payload.get("from_stage") == QC1:
                trailing_note_for.comments += 1
            continue

        trailing_note_for = None
        entering = payload.get("stage")
        leaving = payload.get("from_stage")

        if entering == QC1:
            entered_at = event.created_at
            entered_round = int(payload.get("round") or 0)
            comments = 0
        elif leaving == QC1:
            if entering == QC2:
                outcome = payload.get("qc1_outcome")
                last_pass = _Pass(
                    round=int(payload.get("round") or entered_round),
                    entered_at=entered_at,
                    cleared_at=event.created_at,
                    cleared_by_id=event.actor_id,
                    cleared_by_name=actor_name,
                    comments=comments,
                    outcome=outcome if outcome in QC1_OUTCOMES else None,
                )
                trailing_note_for = last_pass
            # A send-back to revisions ends the stint too, and is the opposite
            # of the thing being measured — the TL plainly did look.
            entered_at = None
            comments = 0

    if last_pass is None:
        return None

    seconds = (
        None
        if last_pass.entered_at is None
        else max(0, int((last_pass.cleared_at - last_pass.entered_at).total_seconds()))
    )
    return Qc1Pass(
        round=last_pass.round,
        entered_at=last_pass.entered_at,
        cleared_at=last_pass.cleared_at,
        seconds=seconds,
        cleared_by_id=last_pass.cleared_by_id,
        cleared_by_name=last_pass.cleared_by_name,
        comments=last_pass.comments,
        outcome=last_pass.outcome,
    )
