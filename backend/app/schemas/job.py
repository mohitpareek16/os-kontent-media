import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Enum-backed columns must be validated here, not at the database. A free
# string reached Postgres and came back as a 500 — the caller's mistake
# should be a 422 with a usable message.
Weight = Literal["light", "standard", "heavy"]

# What kind of video this is — the field that replaced `weight` on every
# screen. `weight` is still on the row and still what QC routing counts in;
# nothing asks a human for it any more (migration 0018).
VideoType = str

# How a QC1 review ended when the job went forward to QC2.
#
#   approved       — watched it, nothing to raise.
#   comments_added — watched it and left notes on Frame.io, where the comments
#                    actually live (docs/03: QC comments are never mirrored
#                    into this database).
#
# Both move the job to QC2 — a send-back to the editor is the third, rare
# outcome and is an ordinary `revisions` transition, not a value here. The
# distinction exists because "passed with nothing said" and "passed having
# said plenty, elsewhere" are indistinguishable on the event log otherwise,
# and the first of those is what a skipped QC1 looks like
# (`services/qc1_review.py`).
Qc1Outcome = Literal["approved", "comments_added"]


class JobCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    pod_id: uuid.UUID
    # Which of the client's channels this one is for. Optional everywhere: a
    # job nobody has filed yet is a blank chip, not a wrong one.
    channel_id: uuid.UUID | None = None
    video_type: VideoType = "long_form"
    weight: Weight = "standard"
    # Lets QC2 routing push this past a full reviewer's budget rather than
    # holding it — and nothing else. See models/job.py.
    rush: bool = False
    # The date the pod works to — what an editor sees. See models/job.py for
    # why there are two of these.
    deadline: date | None = None
    # The date the client was promised. Lead-only on the way in as well as on
    # the way out: `routers/jobs.py::reject_hidden_client_deadline`.
    client_deadline: date | None = None
    # Where the client's material is. At creation a link can only be raw —
    # nobody has cut anything yet — so `frame_link` is accepted for callers
    # that still send it and filed as a raw link rather than as the cut.
    raw_links: list["JobLinkInput"] = Field(default_factory=list)
    frame_link: str | None = None
    assigned_editor_id: uuid.UUID | None = None


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    title: str
    pod_id: uuid.UUID
    channel_id: uuid.UUID | None = None
    stage: str
    video_type: str
    weight: str
    rush: bool = False
    assigned_editor_id: uuid.UUID | None
    qc2_reviewer_id: uuid.UUID | None
    # Which desk sent this cut back, while the editor is working on the
    # changes — it decides where the re-submit goes, so the button that makes
    # that move has to be able to name it ("Re-submit to QC2").
    sent_back_from: str | None = None
    frame_link: str | None
    round: int
    deadline: date | None
    # The promise, or None — and None means two different things depending on
    # who is asking: "no client deadline set" to a lead, and "you are not
    # shown this" to everybody else. The field is redacted on the way out
    # rather than filtered in the browser, so a VE's payload never carries it
    # at all (`routers/jobs.py::visible_client_deadline`).
    client_deadline: date | None = None
    delivered_at: datetime | None
    client_sheet_ok: bool
    ops_tracker_ok: bool
    created_at: datetime
    # Scrapped: killed before delivery, with the reason on the record. Not a
    # stage — the job keeps the stage it died at. See models/job.py.
    scrapped_at: datetime | None = None
    scrapped_by_id: uuid.UUID | None = None
    scrap_reason: str | None = None
    # Flagged by the QC2 reviewer as never having had a real QC1. Rides on
    # every row rather than being a separate lookup, because the pipeline
    # table tints the row with it.
    qc1_flagged_at: datetime | None = None
    qc1_flagged_by_id: uuid.UUID | None = None
    qc1_flag_tl_id: uuid.UUID | None = None
    qc1_flag_reason: str | None = None


class JobDetailRead(JobRead):
    """JobRead plus the names the pipeline table and job panel would
    otherwise have to resolve client-side against `GET /users` — which is
    owner/tl-only, so a VE or QC could never render them at all. Resolved
    server-side in one joined query instead of an N+1 per row."""

    pod_name: str
    # Resolved here for the same reason every other name on this model is:
    # rendering it in the browser would mean a second lookup per row against
    # an endpoint most roles cannot read.
    channel_name: str | None = None
    tl_id: uuid.UUID
    tl_name: str | None = None
    editor_name: str | None = None
    qc2_reviewer_name: str | None = None
    scrapped_by_name: str | None = None
    # Who raised the QC1 flag, and who it is about — two different people, and
    # neither is necessarily the pod's TL today. Names resolved here for the
    # same reason all the others are: `GET /users` is lead-only.
    qc1_flagged_by_name: str | None = None
    qc1_flag_tl_name: str | None = None
    # Whether this row is waiting on the caller right now — computed in SQL
    # from the same `mine_clauses` the Mine tab counts with, so a purple
    # "yours" row and the Mine count can never disagree. Recomputing the rule
    # in the browser would be two definitions of one thing, and the browser's
    # copy is the one that goes stale.
    is_mine: bool = False


class JobScrap(BaseModel):
    """Scrapping a project is destructive to a client commitment, so the
    reason is mandatory and is stored on the job *and* as a `job_scrapped`
    event. `min_length` is deliberately not 1: "no" and "x" are what a
    required field collects when nobody means it."""

    reason: str = Field(min_length=10, max_length=2000)


class JobRestore(BaseModel):
    """Undoing a scrap. The reason is optional — an undo of a mistake often
    has nothing to say beyond "wrong job" — but it is recorded when given."""

    reason: str | None = Field(default=None, max_length=2000)


class JobReassign(BaseModel):
    """Handing a job that is already in flight to a different editor.

    The reason is mandatory for the same reason a scrap's is: the fact worth
    keeping is not that the editor changed — the job already shows who has it
    — but *why* it was taken off the first person. Same `min_length` as a
    scrap, and for the same reason: "no" and "x" are what a required field
    collects when nobody means it."""

    editor_id: uuid.UUID
    reason: str = Field(min_length=10, max_length=2000)


class JobQc1Flag(BaseModel):
    """The QC2 reviewer saying QC1 never really happened on this cut.

    The reason is mandatory, and for a sharper reason than on a scrap: this
    one names a colleague. "Cleared in 30 seconds with no notes and the hook
    is still the wrong aspect ratio" is something a TL can answer; a bare flag
    is an accusation nobody can. Same `min_length` as the other two — "no" and
    "x" are what a required field collects when nobody means it.
    """

    reason: str = Field(min_length=10, max_length=2000)


class JobQc1FlagClear(BaseModel):
    """Withdrawing or dismissing a QC1 flag. The reason is optional — a
    reviewer who flagged the wrong job has nothing to add beyond that — but it
    is recorded when given, because a *dismissal* by a lead usually does."""

    reason: str | None = Field(default=None, max_length=2000)


class Qc1Pass(BaseModel):
    """How the latest QC1 review went, derived from the event log.

    Facts, not a verdict: `services/qc1_review.py` reports who cleared it, how
    long it sat there and whether anything was said, and the reviewer decides
    whether that adds up to a review. `seconds` is None when the entry into
    QC1 isn't on the log — an unknown duration must not render as an instant
    one when "it took no time at all" is the accusation in question."""

    round: int
    entered_at: datetime | None
    cleared_at: datetime
    seconds: int | None
    cleared_by_id: uuid.UUID | None
    cleared_by_name: str | None
    # Notes left while the job sat at QC1, plus the hand-off note typed into
    # the move itself. Zero is the number the flag exists for — unless
    # `outcome` says the TL left their comments on Frame.io, which is where
    # this team actually writes them.
    comments: int
    # None for a pass made before this was recorded, which is not the same as
    # "approved with nothing raised" and must not be shown as it.
    outcome: Qc1Outcome | None = None


class JobStageUpdate(BaseModel):
    stage: Literal[
        "intake", "assigned", "editing", "qc1", "qc2", "revisions", "final", "delivered"
    ]
    frame_link: str | None = None
    assigned_editor_id: uuid.UUID | None = None
    # Set with the editor, on the same move, because a hand-off is both:
    # `stage_machine.is_briefed`. Assigning without one leaves the job stuck
    # on the TL's plate — legal, and the panel says so — so the field rides
    # along here rather than forcing a second PATCH to finish the job the
    # first request started.
    deadline: date | None = None
    # Settable on the same move for the same reason `deadline` is: the TL
    # knows the promise at the moment they choose the working date. Refused
    # from anyone who is not a lead on this pod.
    client_deadline: date | None = None
    # The change list that goes with a send-back. Stored on the JobEvent, not
    # on the job — QC comments themselves live wherever the editor uploaded
    # the cut (Frame.io today, pasted in manually), never mirrored here
    # (docs/03).
    note: str | None = None
    # Only read on the qc1 -> qc2 move: did the TL pass this with nothing to
    # raise, or having left comments on Frame.io? Ignored on every other
    # transition rather than rejected, so an old client is not broken by a
    # field it does not know to omit.
    qc1_outcome: Qc1Outcome | None = None


class JobUpdate(BaseModel):
    """Editing a job's own attributes — distinct from advancing its stage.
    Every field optional: only what's sent gets written, and the change is
    recorded as a `job_updated` event so the log still explains the job."""

    title: str | None = Field(default=None, min_length=1, max_length=300)
    # Filing a job under a channel after the fact — the normal way it happens,
    # since every job that predates channels has none.
    channel_id: uuid.UUID | None = None
    video_type: VideoType | None = None
    weight: Weight | None = None
    rush: bool | None = None
    deadline: date | None = None
    client_deadline: date | None = None
    # Refused rather than applied: links live on `job_links` now and
    # `services/job_links.py` is the only writer of the `frame_link` pointer.
    # Kept on the schema so an old caller gets a message naming the right
    # route instead of a silent no-op.
    frame_link: str | None = None
    assigned_editor_id: uuid.UUID | None = None
    # Hand an unrouted (or wrongly routed) job to a specific reviewer.
    # Routing normally does this by itself — see docs/05.
    qc2_reviewer_id: uuid.UUID | None = None
    # Sent explicitly to clear a nullable field, since None means "not sent".
    clear_deadline: bool = False
    clear_client_deadline: bool = False
    clear_frame_link: bool = False
    clear_editor: bool = False
    clear_channel: bool = False


class JobNoteCreate(BaseModel):
    """A comment that doesn't move the job. Anyone who can see the job can
    leave one — a TL asking a question at QC1 shouldn't have to send the job
    somewhere to be heard."""

    note: str = Field(min_length=1, max_length=4000)


class JobChecklistUpdate(BaseModel):
    client_sheet_ok: bool | None = None
    ops_tracker_ok: bool | None = None


class JobBatchItem(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    channel_id: uuid.UUID | None = None
    video_type: VideoType = "long_form"
    weight: Weight = "standard"
    rush: bool = False
    raw_links: list["JobLinkInput"] = Field(default_factory=list)
    frame_link: str | None = None
    deadline: date | None = None
    client_deadline: date | None = None
    assigned_editor_id: uuid.UUID | None = None


class JobBatchCreate(BaseModel):
    pod_id: uuid.UUID
    jobs: list[JobBatchItem]


class JobBulkChannel(BaseModel):
    """File many videos under one channel in a single call.

    The backlog is the whole reason: every job that predates the channels table
    has none, and a client with three hundred of them is not going to be filed
    a dropdown at a time. `channel_id` left null means the opposite move —
    unfile the selection — so there is no separate `clear_channel` flag here;
    setting the channel is this route's only job, and "sent nothing" cannot
    mean "change nothing" when nothing else is on the payload.
    """

    job_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    channel_id: uuid.UUID | None = None


class JobBulkChannelResult(BaseModel):
    """How many rows actually moved, which is not the same as how many were
    selected: a job already filed under that channel is left alone rather than
    given a `job_updated` event saying nothing changed."""

    updated: int
    unchanged: int


class JobBulkRetryQc2(BaseModel):
    job_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class JobBulkRetryQc2Result(BaseModel):
    assigned: int
    no_capacity: int
    skipped: int


class JobEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_id: uuid.UUID
    event_type: str
    actor_id: uuid.UUID
    actor_name: str | None = None
    payload: dict
    created_at: datetime


class JobListResponse(BaseModel):
    items: list[JobDetailRead]
    total: int
    page: int
    page_size: int


class JobStatusCounts(BaseModel):
    intake: int
    active: int
    overdue: int
    mine: int
    delivered: int
    all: int
    scrapped: int
    flagged: int


class PodOverview(BaseModel):
    """One pod's card on the Overview screen."""

    pod_id: uuid.UUID
    pod_name: str
    status: str
    #: Assigned and moving — the ACTIVE tab's definition.
    in_flight: int
    #: Arrived, no editor picked yet. Counted apart from `in_flight` rather
    #: than inside it: they are two different asks of two different people.
    intake: int
    delivered: int
    in_qc: int
    overdue: int


class WorkspaceOverview(BaseModel):
    """Everything the Overview screen renders, counted in SQL.

    `first_pass_pct` is None rather than 0 when nothing has been delivered —
    there is no rate yet, and "0%" would read as a disaster (docs/06: don't
    render numbers you don't have)."""

    in_flight: int
    intake: int
    overdue: int
    delivered: int
    clean_delivered: int
    pending_qc1: int
    first_pass_pct: int | None
    # Jobs a QC2 reviewer says never got a real QC1 (docs/05). On the
    # dashboard because it is a question about the *process*, not about one
    # video — one flag is a bad day, six is a TL who has stopped reviewing.
    qc1_flagged: int
    pods: list[PodOverview]


class JobLinkInput(BaseModel):
    """One link as it arrives from a form — the shape the intake wizard sends
    a row's raw files in, and the shape the job panel posts a new one in."""

    url: str = Field(min_length=1, max_length=1000)
    title: str | None = Field(default=None, max_length=120)


class JobLinkCreate(JobLinkInput):
    # Which list it goes on, and therefore who is allowed to add it: raw
    # material is the TL's, the cut is the editor's
    # (`services/job_links.py::may_add`).
    kind: Literal["raw", "video"]


class JobLinkRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_id: uuid.UUID
    kind: str
    title: str | None
    url: str
    added_by_id: uuid.UUID
    added_by_name: str | None = None
    created_at: datetime
