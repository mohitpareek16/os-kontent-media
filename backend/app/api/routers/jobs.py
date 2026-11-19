import uuid
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.deps import check_pod_lead, get_current_user
from app.db.session import get_db
from app.models.channel import Channel
from app.models.job import Job
from app.models.job_event import JobEvent
from app.models.job_link import JobLink
from app.models.pod import Pod
from app.models.pod_member import PodMember
from app.models.user import ALL_PODS_ROLES, LEAD_ROLES, User, effective_roles, has_role
from app.schemas.job import (
    JobBatchCreate,
    JobBulkChannel,
    JobBulkChannelResult,
    JobBulkRetryQc2,
    JobBulkRetryQc2Result,
    JobChecklistUpdate,
    JobCreate,
    JobDetailRead,
    JobEventRead,
    JobLinkCreate,
    JobLinkRead,
    JobListResponse,
    JobNoteCreate,
    JobQc1Flag,
    JobQc1FlagClear,
    JobRead,
    JobReassign,
    JobRestore,
    JobScrap,
    JobStageUpdate,
    JobStatusCounts,
    JobUpdate,
    PodOverview,
    Qc1Pass,
    WorkspaceOverview,
)
from app.services.access import (
    ensure_assignable_editor,
    ensure_assignable_reviewer,
    ensure_channel_in_pod,
    is_pod_member,
    job_scope_clauses,
    leads_pod,
    mine_clauses,
    not_scrapped,
    pod_scope_clauses,
    redact_event_payload,
    require_job_read,
    visible_client_deadline,
)
from app.services.certification import refresh_certification
from app.services.codes import next_job_code
from app.services.events import record_event
from app.services.job_links import (
    add_link,
    links_for,
    may_add,
    may_remove,
    record_editor_cut,
    remove_link,
)
from app.services.notify import (
    notify,
    notify_job_reassigned,
    notify_job_scrapped,
    notify_note,
    notify_qc1_flag,
    notify_stage_change,
)
from app.services.qc1_review import latest_qc1_pass, may_flag_qc1
from app.services.routing import assign_qc2, charge, release
from app.services.stage_machine import can_advance, is_valid_transition
from app.services.video_types import enabled_video_type, new_video_type_key

router = APIRouter(prefix="/jobs", tags=["jobs"])

Stage = Literal[
    "intake", "assigned", "editing", "qc1", "qc2", "revisions", "final", "delivered"
]
Weight = Literal["light", "standard", "heavy"]
VideoType = str

# Sorting is a whitelist, not a passthrough: `sort_by` is user input and
# reaches an ORDER BY. `pod` sorts on the joined pod name rather than its id,
# because a column that reads "Dhan" should sort as "Dhan".
SORTABLE_FIELDS = {
    "title": Job.title,
    "code": Job.code,
    "deadline": Job.deadline,
    "video_type": Job.video_type,
    "weight": Job.weight,
    # Sorted descending, urgent work is the top of the board — which is the
    # nearest thing to a priority queue the flag gets. Routing itself does not
    # read it as an order (docs/12): it only lets a full reviewer be overflowed.
    "rush": Job.rush,
    "round": Job.round,
    "pod": Pod.name,
    # Same reasoning as `pod`, on the channel the list query already outer-joins
    # for the name it shows. Unfiled jobs sort together at one end, which is the
    # order a TL working down the backlog actually wants.
    "channel": Channel.name,
    "created_at": Job.created_at,
}
SortField = Literal[
    "pipeline", "title", "code", "stage", "deadline", "video_type", "weight", "rush", "round",
    "pod", "channel", "created_at",
]

# What `status=active` is not. Intake has not been handed to anybody yet and
# delivered is finished; "active" is the span between them.
ACTIVE_EXCLUDED_STAGES = ("intake", "delivered")

# The order the pipeline is read in, and the default.
#
# Sorting by `created_at` put a video pasted in this morning with no editor on
# it above one that is due today and half cut, because the only thing the
# default knew about a row was when it arrived. This sorts by what state the
# work is in first: everything somebody is actually holding, then everything
# still waiting to be handed out, then the finished, then the abandoned.
#
# Inside a group it is deadline-first with no-deadline last — a row with no
# date cannot be urgent, and floating them to the top (which is what a plain
# ASC does on Postgres, where NULLs sort last only on DESC) buries the work
# that is actually due.
_PIPELINE_GROUPS = (
    (Job.scrapped_at.is_not(None), 3),
    (Job.stage == "delivered", 2),
    (Job.stage == "intake", 1),
)


def _pipeline_ordering(descending: bool):
    """The composite ORDER BY behind `sort_by=pipeline`, as a list."""
    group = case(*_PIPELINE_GROUPS, else_=0)
    # Reversing the whole composite, not just one key: a user who clicks the
    # header twice means "the other end of this list", and flipping the group
    # while leaving the deadline ascending would be neither order.
    if descending:
        return [group.desc(), Job.deadline.desc().nullsfirst(), Job.created_at.asc()]
    return [group.asc(), Job.deadline.asc().nullslast(), Job.created_at.desc()]


def _stage_ordering(descending: bool):
    """Board column order, with the same deadline order inside each stage."""
    stages = (
        "intake", "assigned", "editing", "qc1", "qc2", "revisions", "final", "delivered"
    )
    position = case(
        *((Job.stage == stage, index) for index, stage in enumerate(stages)),
        else_=len(stages),
    )
    if descending:
        return [position.desc(), Job.deadline.desc().nullsfirst()]
    return [position.asc(), Job.deadline.asc().nullslast()]


def _scope_and_filter_clauses(
    user: User,
    pod_id: uuid.UUID | None = None,
    status: str | None = None,
    search: str | None = None,
    *,
    stage: list[str] | None = None,
    weight: list[str] | None = None,
    video_type: list[str] | None = None,
    editor_id: uuid.UUID | None = None,
    reviewer_id: uuid.UUID | None = None,
    unassigned: bool = False,
    unrouted: bool = False,
    deadline_from: date | None = None,
    deadline_to: date | None = None,
    no_deadline: bool = False,
    scrapped: bool | None = None,
    qc1_flagged: bool | None = None,
    rush: bool | None = None,
    channel_id: uuid.UUID | None = None,
    no_channel: bool = False,
) -> list:
    """Row scoping (`services/access.py`, the single definition shared with
    every single-job read) plus the pipeline table's filters, as plain WHERE
    clauses composable onto any select or COUNT.

    Every filter the table offers is resolved here, in SQL, so a page of 20
    rows is 20 rows off the database — not a 1000-row download the browser
    then throws most of away, which is what the board and the QC panels were
    doing. Sorting and paging over a locally-filtered subset also silently
    lies: "page 1 of 1" was counting rows the server had already cut off."""
    clauses: list = job_scope_clauses(user)

    if pod_id is not None:
        clauses.append(Job.pod_id == pod_id)

    # A scrapped project is dead work and is excluded from every status that
    # means "work in progress". It is not excluded from `all`, which means
    # all: hiding rows from a tab labelled ALL is how people conclude the
    # system lost their job. The dedicated `scrapped` status is the tab that
    # shows only them.
    if status == "intake":
        # Work that has arrived and has nobody on it — the resting state for a
        # bulk paste, where the TL assigns from the list once they know who is
        # free. Disjoint from `active`, not a subset of it: see below.
        clauses += [Job.stage == "intake", not_scrapped()]
    elif status == "active":
        # Assigned to somebody and moving — editing through the final check.
        #
        # This used to mean "anything not delivered", which swallowed intake
        # whole: a board with 15 videos being worked on and 43 sitting
        # unassigned reported 58 ACTIVE, and the two kinds of row sat
        # interleaved in one list. They are different questions with different
        # owners — intake is the TL's "who takes this", active is "how is the
        # work going" — so the tabs are now disjoint and ACTIVE + INTAKE add
        # up rather than overlap.
        clauses += [Job.stage.notin_(ACTIVE_EXCLUDED_STAGES), not_scrapped()]
    elif status == "overdue":
        # Deliberately still "anything not delivered", intake included: a job
        # that is past its deadline and has not even been assigned yet is the
        # most overdue thing on the board, not an exception to the question.
        clauses += [
            Job.stage != "delivered",
            not_scrapped(),
            Job.deadline.is_not(None),
            Job.deadline < date.today(),
        ]
    elif status == "mine":
        clauses += mine_clauses(user)
    elif status == "delivered":
        # Finished work needs a tab of its own, because it is excluded from
        # every other one by construction: `active` is "not delivered", and a
        # delivered job is never overdue, never Mine and cannot be scrapped.
        # Without this the only place it appeared was ALL, mixed in with
        # everything else — and the board's Delivered column asked for
        # `active`, so it was permanently and silently empty.
        clauses.append(Job.stage == "delivered")
    elif status == "scrapped":
        clauses.append(Job.scrapped_at.is_not(None))
    elif status == "flagged":
        # Jobs a QC2 reviewer says never got a real QC1. Delivered ones are
        # included on purpose: the flag is about how the work was reviewed,
        # and that question does not stop mattering once the video ships.
        clauses.append(Job.qc1_flagged_at.is_not(None))

    # Independent of `status`, for callers that pick their own stages and so
    # cannot use one: the QC queue asks for `all` because its last group is
    # delivered work, and without this a cancelled project would sit in a
    # reviewer's queue asking to be reviewed.
    if scrapped is True:
        clauses.append(Job.scrapped_at.is_not(None))
    elif scrapped is False:
        clauses.append(not_scrapped())

    # Jobs a QC2 reviewer says never got a real QC1 (docs/05). Not a status
    # tab: it cuts across all of them — a skipped QC1 is just as worth seeing
    # on a job that has since been delivered as on one still in flight.
    if qc1_flagged is True:
        clauses.append(Job.qc1_flagged_at.is_not(None))
    elif qc1_flagged is False:
        clauses.append(Job.qc1_flagged_at.is_(None))

    # Cuts across every status for the same reason the flag above does: "what
    # did we call urgent this week" is a question about the whole board, and
    # a rush job that shipped is exactly the one worth looking back at.
    if rush is True:
        clauses.append(Job.rush.is_(True))
    elif rush is False:
        clauses.append(Job.rush.is_(False))

    # "Which of this client's channels" — and its opposite, which is the one
    # a TL actually needs: every job that predates channels has none, and
    # "what still has to be filed" is not expressible as an id.
    if no_channel:
        clauses.append(Job.channel_id.is_(None))
    elif channel_id is not None:
        clauses.append(Job.channel_id == channel_id)

    if search:
        # Code as well as title — people quote "KM-1042" to each other far
        # more often than they retype a video's full name.
        clauses.append(or_(Job.title.ilike(f"%{search}%"), Job.code.ilike(f"%{search}%")))

    # Repeatable params (?stage=qc1&stage=qc2), so the table's stage and
    # weight filters can be multi-select without n round-trips.
    if stage:
        clauses.append(Job.stage.in_(stage))
    if weight:
        clauses.append(Job.weight.in_(weight))
    if video_type:
        clauses.append(Job.video_type.in_(video_type))

    # "Unassigned" and "unrouted" are the states people actually go looking
    # for, and neither is expressible as an id — hence a flag each rather
    # than a magic id value.
    if unassigned:
        clauses.append(Job.assigned_editor_id.is_(None))
    elif editor_id is not None:
        clauses.append(Job.assigned_editor_id == editor_id)

    if unrouted:
        clauses += [Job.stage == "qc2", Job.qc2_reviewer_id.is_(None)]
    elif reviewer_id is not None:
        clauses.append(Job.qc2_reviewer_id == reviewer_id)

    if no_deadline:
        clauses.append(Job.deadline.is_(None))
    else:
        if deadline_from is not None:
            clauses += [Job.deadline.is_not(None), Job.deadline >= deadline_from]
        if deadline_to is not None:
            clauses += [Job.deadline.is_not(None), Job.deadline <= deadline_to]

    return clauses


def _detail_select(user: User):
    """Job + the display names for its pod, TL, editor, QC2 reviewer and
    whoever scrapped it, plus whether it is waiting on `user` right now.

    These names can't be resolved client-side: `GET /users` is owner/tl-only
    (docs/04), so a VE or QC would see nothing but ids. One join here beats
    a per-row lookup and a permission hole.

    `is_mine` rides along for the same reason the names do — it is the rule
    from `mine_clauses`, evaluated by the database that is already counting
    the Mine tab with it, so the highlighted rows and the count are one
    answer rather than two implementations of one."""
    editor = aliased(User)
    reviewer = aliased(User)
    lead = aliased(User)
    scrapper = aliased(User)
    flagger = aliased(User)
    flagged_tl = aliased(User)
    return (
        select(
            Job,
            Pod.name,
            Pod.tl_id,
            lead.name,
            editor.name,
            reviewer.name,
            scrapper.name,
            flagger.name,
            flagged_tl.name,
            Channel.name,
            and_(*mine_clauses(user)).label("is_mine"),
        )
        .join(Pod, Pod.id == Job.pod_id)
        .outerjoin(Channel, Channel.id == Job.channel_id)
        .outerjoin(lead, lead.id == Pod.tl_id)
        .outerjoin(editor, editor.id == Job.assigned_editor_id)
        .outerjoin(reviewer, reviewer.id == Job.qc2_reviewer_id)
        .outerjoin(scrapper, scrapper.id == Job.scrapped_by_id)
        # Two more names, and they are different people: who raised the QC1
        # flag, and the TL it is about.
        .outerjoin(flagger, flagger.id == Job.qc1_flagged_by_id)
        .outerjoin(flagged_tl, flagged_tl.id == Job.qc1_flag_tl_id)
    )


def _to_detail(row, viewer: User) -> JobDetailRead:
    """The row as `viewer` is allowed to read it.

    `viewer` is here for one field. The client deadline is the Owner's and the
    pod TL's, and `tl_id` is already on the row — so the decision costs a
    comparison rather than the query it would take to ask the pod again. Every
    caller of this function has the user in hand; none of them may skip it.
    """
    (
        job,
        pod_name,
        tl_id,
        tl_name,
        editor_name,
        reviewer_name,
        scrapper_name,
        flagged_by_name,
        flagged_tl_name,
        channel_name,
        is_mine,
    ) = row
    return JobDetailRead(
        **(
            JobRead.model_validate(job).model_dump()
            | {"client_deadline": visible_client_deadline(job, viewer=viewer, tl_id=tl_id)}
        ),
        pod_name=pod_name,
        tl_id=tl_id,
        tl_name=tl_name,
        editor_name=editor_name,
        qc2_reviewer_name=reviewer_name,
        scrapped_by_name=scrapper_name,
        qc1_flagged_by_name=flagged_by_name,
        qc1_flag_tl_name=flagged_tl_name,
        channel_name=channel_name,
        is_mine=bool(is_mine),
    )


def _ensure_deadline_order(team: date | None, client: date | None) -> None:
    """The team deadline sits on or before the promise, or it is not a buffer.

    Refused rather than warned about: a team date *after* the client date has
    no reading at all — the pod would be working to a deadline later than the
    one it is judged on — so it is a typo every time, and the useful moment to
    catch a typo is before it reaches an editor's queue.
    """
    if team is not None and client is not None and team > client:
        raise HTTPException(
            status_code=400,
            detail=(
                "The team deadline has to be on or before the client deadline — "
                "the room between the two is the whole point of having both"
            ),
        )


def _require_live(job: Job) -> None:
    """A scrapped project accepts no work. Moving its stage, editing its
    deadline or ticking its delivery checklist would all quietly resurrect it
    into the counts, so those are refused with a message that says the way
    out — Restore — rather than a bare 400. Comments stay open: the reason a
    project was scrapped is exactly the thing people carry on discussing."""
    if job.scrapped_at is not None:
        raise HTTPException(
            status_code=400,
            detail="This project is scrapped. Restore it first if work should continue.",
        )


async def _add_intake_links(db: AsyncSession, *, job: Job, payload, actor: User) -> None:
    """The links a job arrives with. Raw, always — at intake nobody has cut
    anything, so a link on the way in can only be the client's material.

    `frame_link` is still accepted on the create routes and lands here rather
    than on the column: a caller sending one at intake means "here is the
    footage", and writing it to the column the editor's cut lives on is the
    exact confusion this table was built to end."""
    for link in payload.raw_links:
        await add_link(
            db, job=job, kind="raw", url=link.url, title=link.title, actor=actor
        )
    if payload.frame_link:
        await add_link(
            db, job=job, kind="raw", url=payload.frame_link, title=None, actor=actor
        )


async def _channel_name(db: AsyncSession, channel_id: uuid.UUID | None) -> str | None:
    """The name behind a channel id, for the event log. None both when there
    is no channel and when the row has vanished — an id in a feed is worse
    than a blank."""
    if channel_id is None:
        return None
    channel = await db.get(Channel, channel_id)
    return channel.name if channel is not None else None


async def _record_qc2_assignment(db: AsyncSession, *, job: Job, actor: User, assignment):
    """The log entry for "this reviewer got this job, and here is what it
    cost". Written from both places routing can happen — the move into QC2,
    and a rush flag flipped on a job already sitting unrouted — so the two
    can't drift into recording different things about the same event."""
    pick, billed = assignment
    return await record_event(
        db,
        job_id=job.id,
        event_type="qc2_assigned_v1",
        actor_id=actor.id,
        payload={
            "reviewer_id": str(pick.reviewer.id),
            "reviewer_name": pick.reviewer.name,
            "points": billed.points,
            "video_type": job.video_type,
            "round": job.round,
            "work_date": billed.work_date.isoformat(),
            # Null on a sticky return — see `routing.Qc2Pick`.
            "score": round(pick.score, 4) if pick.score is not None else None,
            "sticky": pick.sticky,
            # True when a rush job was pushed past somebody's budget, so
            # "why is she at 27 points" has an answer in the log.
            "overflow": pick.overflow,
        },
    )


@router.get("", response_model=JobListResponse)
async def list_jobs(
    pod_id: uuid.UUID | None = None,
    status: Literal[
        "intake", "active", "overdue", "mine", "delivered", "all", "scrapped", "flagged"
    ] = "active",
    search: str | None = None,
    stage: list[Stage] | None = Query(None),
    weight: list[Weight] | None = Query(None),
    video_type: list[VideoType] | None = Query(None),
    editor_id: uuid.UUID | None = None,
    reviewer_id: uuid.UUID | None = None,
    unassigned: bool = False,
    unrouted: bool = False,
    deadline_from: date | None = None,
    deadline_to: date | None = None,
    no_deadline: bool = False,
    scrapped: bool | None = None,
    qc1_flagged: bool | None = None,
    rush: bool | None = None,
    channel_id: uuid.UUID | None = None,
    no_channel: bool = False,
    sort_by: SortField = "pipeline",
    sort_dir: Literal["asc", "desc"] = "asc",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Owner sees all jobs; TL sees the pods they belong to; QC sees their
    own queue plus unrouted QC2 jobs in their pods; VE sees only their own
    assigned jobs. The rule lives in `services/access.py` and is shared with
    every single-job read — see docs/04-permissions.md.

    Every filter, the sort and the page are applied in SQL. Rows carry the
    pod/editor/reviewer names so the table renders real values for every
    role."""
    clauses = _scope_and_filter_clauses(
        user,
        pod_id,
        status,
        search,
        stage=list(stage) if stage else None,
        weight=list(weight) if weight else None,
        video_type=list(video_type) if video_type else None,
        editor_id=editor_id,
        reviewer_id=reviewer_id,
        unassigned=unassigned,
        unrouted=unrouted,
        deadline_from=deadline_from,
        deadline_to=deadline_to,
        no_deadline=no_deadline,
        scrapped=scrapped,
        qc1_flagged=qc1_flagged,
        rush=rush,
        channel_id=channel_id,
        no_channel=no_channel,
    )

    total = (
        await db.execute(
            select(func.count()).select_from(Job).join(Pod, Pod.id == Job.pod_id).where(*clauses)
        )
    ).scalar_one()

    if sort_by == "pipeline":
        ordering = _pipeline_ordering(sort_dir == "desc")
    elif sort_by == "stage":
        ordering = _stage_ordering(sort_dir == "desc")
    else:
        sort_col = SORTABLE_FIELDS[sort_by]
        ordering = [sort_col.desc() if sort_dir == "desc" else sort_col.asc()]
    query = (
        _detail_select(user)
        .where(*clauses)
        # `deadline` and `round` are full of ties, and a tied ORDER BY gives
        # the database licence to return rows in a different order per page —
        # which shows the same job twice and hides another. The id breaks
        # every tie, so paging is stable.
        .order_by(*ordering, Job.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    rows = (await db.execute(query)).all()
    return JobListResponse(
        items=[_to_detail(row, user) for row in rows], total=total, page=page, page_size=page_size
    )


@router.get("/stats", response_model=JobStatusCounts)
async def job_stats(
    pod_id: uuid.UUID | None = None,
    search: str | None = None,
    stage: list[Stage] | None = Query(None),
    weight: list[Weight] | None = Query(None),
    video_type: list[VideoType] | None = Query(None),
    editor_id: uuid.UUID | None = None,
    reviewer_id: uuid.UUID | None = None,
    unassigned: bool = False,
    unrouted: bool = False,
    deadline_from: date | None = None,
    deadline_to: date | None = None,
    no_deadline: bool = False,
    scrapped: bool | None = None,
    qc1_flagged: bool | None = None,
    rush: bool | None = None,
    channel_id: uuid.UUID | None = None,
    no_channel: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Counts for each pipeline status tab
    (intake/active/overdue/mine/delivered/all/scrapped/flagged), scoped and
    filtered exactly like list_jobs.

    It takes the same filter params for a reason: the cards sit directly on
    top of the table, and a card that counts a wider set than the rows
    beneath it is just wrong. Registered before /{job_id} so "stats" doesn't
    get swallowed by that route's uuid.UUID path param."""
    scope = _scope_and_filter_clauses(
        user,
        pod_id,
        search=search,
        stage=list(stage) if stage else None,
        weight=list(weight) if weight else None,
        video_type=list(video_type) if video_type else None,
        editor_id=editor_id,
        reviewer_id=reviewer_id,
        unassigned=unassigned,
        unrouted=unrouted,
        deadline_from=deadline_from,
        deadline_to=deadline_to,
        no_deadline=no_deadline,
        scrapped=scrapped,
        qc1_flagged=qc1_flagged,
        rush=rush,
        channel_id=channel_id,
        no_channel=no_channel,
    )

    async def count(*extra_where):
        q = (
            select(func.count())
            .select_from(Job)
            .join(Pod, Pod.id == Job.pod_id)
            .where(*scope, *extra_where)
        )
        return (await db.execute(q)).scalar_one()

    # Each card counts exactly what its tab lists — same clauses, same
    # module. `mine` in particular is `mine_clauses` and not a second copy of
    # the rule: the copy is what left every TL looking at a zero.
    intake = await count(Job.stage == "intake", not_scrapped())
    # Disjoint from `intake` — same rule as the tab it sits on, and the reason
    # the two cards now add up instead of one containing the other.
    active = await count(Job.stage.notin_(ACTIVE_EXCLUDED_STAGES), not_scrapped())
    overdue = await count(
        Job.stage != "delivered",
        not_scrapped(),
        Job.deadline.is_not(None),
        Job.deadline < date.today(),
    )
    mine = await count(*mine_clauses(user))
    delivered = await count(Job.stage == "delivered")
    all_count = await count()
    scrapped_count = await count(Job.scrapped_at.is_not(None))
    flagged = await count(Job.qc1_flagged_at.is_not(None))

    return JobStatusCounts(
        intake=intake,
        active=active,
        overdue=overdue,
        mine=mine,
        delivered=delivered,
        all=all_count,
        scrapped=scrapped_count,
        flagged=flagged,
    )


@router.get("/overview", response_model=WorkspaceOverview)
async def workspace_overview(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The Overview screen's KPI tiles and per-pod cards, counted in SQL.

    This page used to fetch every job the caller could see and reduce them in
    the browser, which meant the numbers were only right up to whatever row
    limit happened to be in force — and silently wrong past it. Pod cards are
    built from the pod list, not from the jobs, so a client with no work yet
    still appears instead of vanishing.

    "Overdue" is the same definition the pipeline's OVERDUE filter uses: past
    its deadline and not yet delivered — intake included, because a job nobody
    has been given yet is the most overdue kind there is. `in_flight` is the
    narrower ACTIVE definition (assigned and moving), with everything still
    waiting for an editor counted separately as `intake`; the two tiles link
    to the two tabs, and a tile has to count what its tab lists."""
    job_scope = job_scope_clauses(user)
    today = date.today()
    # Every in-flight number here excludes scrapped work. A killed project
    # left in "in flight" is a client commitment the dashboard still believes
    # in, and left in "overdue" it is an alarm nobody can ever clear.
    # `delivered` needs no such guard: a delivered job cannot be scrapped.
    open_clause = and_(Job.stage != "delivered", not_scrapped())
    # What the ACTIVE tab lists, so the tile and the tab it opens agree.
    # `open_clause` is the wider "anything not finished" and is what overdue
    # still counts.
    active_clause = and_(Job.stage.notin_(ACTIVE_EXCLUDED_STAGES), not_scrapped())
    intake_clause = and_(Job.stage == "intake", not_scrapped())
    overdue_clause = and_(open_clause, Job.deadline.is_not(None), Job.deadline < today)

    totals = (
        await db.execute(
            select(
                func.count().filter(active_clause),
                # Arrived and unassigned. Its own tile because a pile of 43 of
                # these is the single most actionable number a lead has, and
                # it used to be invisible — folded into "in flight", where it
                # read as work already underway.
                func.count().filter(intake_clause),
                func.count().filter(overdue_clause),
                func.count().filter(Job.stage == "delivered"),
                func.count().filter(and_(Job.stage == "delivered", Job.round == 0)),
                func.count().filter(and_(Job.stage == "qc1", not_scrapped())),
                # Counted across every stage, delivered included: a QC1 that
                # never happened is not undone by the video shipping — that is
                # the case that should worry a lead most.
                func.count().filter(and_(Job.qc1_flagged_at.is_not(None), not_scrapped())),
            )
            .select_from(Job)
            .where(*job_scope)
        )
    ).one()
    in_flight, intake, overdue, delivered, clean_delivered, pending_qc1, qc1_flagged = totals

    per_pod = (
        await db.execute(
            select(
                Pod.id,
                Pod.name,
                Pod.status,
                func.count(Job.id).filter(active_clause),
                func.count(Job.id).filter(intake_clause),
                func.count(Job.id).filter(Job.stage == "delivered"),
                func.count(Job.id).filter(and_(Job.stage.in_(("qc1", "qc2")), not_scrapped())),
                func.count(Job.id).filter(overdue_clause),
            )
            # Outer join, so a pod with no jobs still gets a card with zeroes.
            .outerjoin(Job, and_(Job.pod_id == Pod.id, *job_scope))
            .where(*pod_scope_clauses(user))
            .group_by(Pod.id, Pod.name, Pod.status)
            .order_by(Pod.name)
        )
    ).all()

    return WorkspaceOverview(
        in_flight=in_flight,
        intake=intake,
        overdue=overdue,
        delivered=delivered,
        clean_delivered=clean_delivered,
        pending_qc1=pending_qc1,
        # None, not 0: nothing has been delivered, so there is no rate to
        # report — and "0%" would read as a catastrophe (docs/06: don't
        # render numbers you don't have).
        first_pass_pct=round(clean_delivered / delivered * 100) if delivered else None,
        qc1_flagged=qc1_flagged,
        pods=[
            PodOverview(
                pod_id=pod_id,
                pod_name=pod_name,
                status=pod_status,
                in_flight=pod_in_flight,
                intake=pod_intake,
                delivered=pod_delivered,
                in_qc=pod_in_qc,
                overdue=pod_overdue,
            )
            for (
                pod_id,
                pod_name,
                pod_status,
                pod_in_flight,
                pod_intake,
                pod_delivered,
                pod_in_qc,
                pod_overdue,
            ) in per_pod
        ],
    )


@router.post("/bulk-retry-qc2", response_model=JobBulkRetryQc2Result)
async def bulk_retry_qc2_assignment(
    payload: JobBulkRetryQc2,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Retry routing only for selected, active QC2 jobs without a reviewer.

    Lock job rows so two retries of the same selection cannot both bill it.
    Every assignment is charged and announced through the normal QC2 path.
    """
    if len(set(payload.job_ids)) != len(payload.job_ids):
        raise HTTPException(status_code=400, detail="Select each video only once")

    rows = (
        await db.execute(
            select(Job).where(Job.id.in_(payload.job_ids)).order_by(Job.id).with_for_update()
        )
    ).scalars().all()
    if len(rows) != len(payload.job_ids):
        raise HTTPException(status_code=404, detail="One or more selected videos no longer exist")

    for pod_id in {job.pod_id for job in rows}:
        await check_pod_lead(db, pod_id, user)

    assigned = no_capacity = skipped = 0
    for job in sorted(rows, key=lambda item: (item.deadline is None, item.deadline or date.max, item.code)):
        if job.stage != "qc2" or job.qc2_reviewer_id is not None or job.scrapped_at is not None:
            skipped += 1
            continue
        assignment = await assign_qc2(db, job=job)
        if assignment is None:
            no_capacity += 1
            continue
        event = await _record_qc2_assignment(db, job=job, actor=user, assignment=assignment)
        await notify(db, user_id=assignment[0].reviewer.id, event=event)
        assigned += 1

    await db.commit()
    return JobBulkRetryQc2Result(assigned=assigned, no_capacity=no_capacity, skipped=skipped)


@router.get("/{job_id}", response_model=JobDetailRead)
async def get_job(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Single-job lookup for the job detail panel/page. Same scoping as
    list_jobs — a VE only sees their own assigned job. Carries the pod /
    TL / editor / reviewer names so the panel can say who owns the job
    without a second, permission-gated call to /users."""
    row = (await db.execute(_detail_select(user).where(Job.id == job_id))).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")
    await require_job_read(db, job=row[0], user=user)
    return _to_detail(row, user)


@router.post("", response_model=JobRead, status_code=201)
async def create_job(
    payload: JobCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Intake. Owner or the pod's own TL only — this route had no permission
    check at all, so any authenticated user (a VE included) could create work
    in any pod in the company. See docs/04-permissions.md."""
    pod = await db.get(Pod, payload.pod_id)
    if pod is None:
        raise HTTPException(status_code=404, detail="Pod not found")
    await check_pod_lead(db, payload.pod_id, user)
    video_type = await new_video_type_key(db, payload.video_type, explicit="video_type" in payload.model_fields_set)

    if payload.assigned_editor_id is not None:
        await ensure_assignable_editor(
            db, pod_id=payload.pod_id, editor_id=payload.assigned_editor_id
        )
    await ensure_channel_in_pod(db, pod_id=payload.pod_id, channel_id=payload.channel_id)
    _ensure_deadline_order(payload.deadline, payload.client_deadline)

    job = Job(
        **payload.model_dump(exclude={"raw_links", "frame_link", "video_type"}),
        video_type=video_type,
        stage="assigned" if payload.assigned_editor_id else "intake",
        code=await next_job_code(db),
        created_by=user.id,
    )
    db.add(job)
    await db.flush()
    # At intake every link is raw by definition — nobody has cut anything yet.
    # `frame_link`, if a caller still sends one, is the client's folder and is
    # filed as such rather than onto the column the editor's cut lives on.
    await _add_intake_links(db, job=job, payload=payload, actor=user)
    await record_event(db, job_id=job.id, event_type="intake", actor_id=user.id, payload={})
    if payload.assigned_editor_id:
        event = await record_event(
            db,
            job_id=job.id,
            event_type="stage_changed",
            actor_id=user.id,
            payload={"stage": "assigned", "from_stage": "intake", "round": 0},
        )
        await notify_stage_change(db, job=job, pod=pod, event=event)
    await db.commit()
    await db.refresh(job)
    return job


@router.post("/batch", response_model=list[JobRead], status_code=201)
async def create_jobs_batch(
    payload: JobBatchCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create multiple jobs in a single transaction. If assigned_editor_id is
    provided for a job, it starts at 'assigned' rather than 'intake'.
    Same Owner-or-pod-TL guard as the single create."""
    pod = await db.get(Pod, payload.pod_id)
    if pod is None:
        raise HTTPException(status_code=404, detail="Pod not found")
    await check_pod_lead(db, payload.pod_id, user)

    # Checked up front, before a single row is written, and counting the rows
    # of this same batch as they are lined up (`pending`): twenty pasted jobs
    # all pointing at one editor are twenty against their cap, not twenty
    # separate "they have room" answers to the same uncommitted question.
    # Nothing is created if any row fails — the whole paste comes back with
    # the reason, still editable, rather than half of it landing.
    lined_up: dict[uuid.UUID, int] = {}
    video_types: list[str] = []
    for item in payload.jobs:
        video_types.append(await new_video_type_key(db, item.video_type, explicit="video_type" in item.model_fields_set))
        await ensure_channel_in_pod(db, pod_id=payload.pod_id, channel_id=item.channel_id)
        _ensure_deadline_order(item.deadline, item.client_deadline)
        if item.assigned_editor_id is not None:
            await ensure_assignable_editor(
                db,
                pod_id=payload.pod_id,
                editor_id=item.assigned_editor_id,
                pending=lined_up.get(item.assigned_editor_id, 0),
            )
            lined_up[item.assigned_editor_id] = lined_up.get(item.assigned_editor_id, 0) + 1

    created: list[Job] = []

    for item, video_type in zip(payload.jobs, video_types):
        job = Job(
            title=item.title,
            pod_id=payload.pod_id,
            channel_id=item.channel_id,
            video_type=video_type,
            weight=item.weight,
            rush=item.rush,
            deadline=item.deadline,
            client_deadline=item.client_deadline,
            assigned_editor_id=item.assigned_editor_id,
            stage="assigned" if item.assigned_editor_id else "intake",
            code=await next_job_code(db),
            created_by=user.id,
        )
        db.add(job)
        await db.flush()
        await _add_intake_links(db, job=job, payload=item, actor=user)
        await record_event(
            db, job_id=job.id, event_type="intake", actor_id=user.id, payload={}
        )
        if item.assigned_editor_id:
            event = await record_event(
                db,
                job_id=job.id,
                event_type="stage_changed",
                actor_id=user.id,
                payload={"stage": "assigned", "from_stage": "intake", "round": 0},
            )
            await notify_stage_change(db, job=job, pod=pod, event=event)
        created.append(job)

    await db.commit()
    for job in created:
        await db.refresh(job)
    return created


@router.post("/bulk-channel", response_model=JobBulkChannelResult)
async def bulk_file_under_channel(
    payload: JobBulkChannel,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """File a selection of videos under one channel — or unfile them.

    `PATCH /jobs/{id}` already does this one job at a time, and that is the
    right shape for a video somebody is looking at. It is the wrong shape for
    the backlog: every job created before the channels table has no channel,
    and a client with a few hundred of them cannot be filed one dialog at a
    time, which in practice means it never gets filed at all and every channel
    report reads as mostly-unknown forever.

    All or nothing, like `POST /batch`: the guards run over the whole selection
    before a single row is written, so a selection that reaches into a pod the
    caller does not lead — or picks up a scrapped job — comes back with the
    reason instead of half-applying. The alternative is a partial write nobody
    can see the shape of, from a screen whose whole point is doing this in one
    move.

    A channel belongs to exactly one client (`ensure_channel_in_pod`), so a
    selection spanning two pods can only be *unfiled* in one call. Filing it
    would mean guessing which of the two clients' channels was meant.
    """
    rows = (await db.execute(select(Job).where(Job.id.in_(payload.job_ids)))).scalars().all()
    found = {job.id for job in rows}
    missing = [str(job_id) for job_id in payload.job_ids if job_id not in found]
    if missing:
        raise HTTPException(status_code=404, detail=f"{len(missing)} of those jobs no longer exist")

    # Named rather than counted: "3 of these are scrapped" leaves the user
    # hunting for which three in a selection of forty.
    scrapped = [job.code for job in rows if job.scrapped_at is not None]
    if scrapped:
        raise HTTPException(
            status_code=400,
            detail=(
                "These are scrapped and take no changes: "
                + ", ".join(sorted(scrapped)[:5])
                + (" …" if len(scrapped) > 5 else "")
            ),
        )

    pod_ids = {job.pod_id for job in rows}
    for pod_id in pod_ids:
        await check_pod_lead(db, pod_id, user)

    if payload.channel_id is not None:
        if len(pod_ids) > 1:
            raise HTTPException(
                status_code=400,
                detail=(
                    "A channel belongs to one client — select videos from a single client to "
                    "file them, or switch the client filter first"
                ),
            )
        await ensure_channel_in_pod(
            db, pod_id=next(iter(pod_ids)), channel_id=payload.channel_id
        )

    # Read once for the event log rather than per row: every job in the call is
    # moving to the same channel, and the feed wants its name, not its id.
    to_name = await _channel_name(db, payload.channel_id)
    updated = 0
    for job in rows:
        if job.channel_id == payload.channel_id:
            continue
        from_name = await _channel_name(db, job.channel_id)
        job.channel_id = payload.channel_id
        await record_event(
            db,
            job_id=job.id,
            event_type="job_updated",
            actor_id=user.id,
            payload={"channel": {"from": from_name, "to": to_name}},
        )
        updated += 1

    await db.commit()
    return JobBulkChannelResult(updated=updated, unchanged=len(rows) - updated)


@router.post("/{job_id}/advance", response_model=JobDetailRead)
async def advance_stage(
    job_id: uuid.UUID,
    payload: JobStageUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Enforces the pipeline state machine (docs/05-pipeline-and-routing.md,
    app/services/stage_machine.py), applies the QC2 sticky-routing rule and
    the round counter, notifies the new stage's owner, and refreshes
    certification on delivery."""
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _require_live(job)
    if not is_valid_transition(job.stage, payload.stage, job.sent_back_from):
        raise HTTPException(
            status_code=400, detail=f"Cannot move a job from '{job.stage}' to '{payload.stage}'"
        )

    pod = await db.get(Pod, job.pod_id)
    # Who may make this move, not just which moves exist. Without this a VE
    # could advance any job in the system straight to delivery — the UI hid
    # the buttons but the route never checked (docs/04: "enforcement is
    # server-side, not just hidden UI").
    if not can_advance(
        role=effective_roles(user), user_id=user.id, job=job, pod=pod, target=payload.stage
    ):
        raise HTTPException(
            status_code=403, detail=f"Your role cannot move this job to '{payload.stage}'"
        )

    from_stage = job.stage

    if payload.stage == "revisions":
        job.round += 1
        # Remember which desk raised the changes so the re-cut comes back to
        # them and not to the front of the line — read by
        # `stage_machine.resubmit_stage()` while the editor works.
        job.sent_back_from = from_stage
    elif from_stage == "editing":
        # The round is closed: the cut has gone back to whoever asked for it,
        # and from here the job is on the ordinary forward path again.
        job.sent_back_from = None

    if from_stage == "qc2":
        # The round is over the moment the job leaves this desk, in *either*
        # direction: passed to Final, or sent back to Revisions with a change
        # list. The reviewer's work is done either way, and the points stay
        # spent for the rest of today regardless — releasing only stops them
        # counting tomorrow (docs/12 §3).
        await release(db, job_id=job.id)

    assignment = None
    if payload.stage == "qc2":
        # Every entry into QC2 comes through here, first round or fifth.
        # `assign_qc2` does the sticky check itself rather than the caller
        # guarding on `qc2_reviewer_id is None`, which is how a job assigned to
        # somebody who later left stayed theirs forever — nothing ever
        # re-asked whether that account could still take it.
        #
        # The routing runs here because the reviewer has to be on the job
        # before the stage change notifies them; the *event* is written further
        # down, after `stage_changed`, so the log reads in the order things
        # happened rather than announcing an assignment to a desk the job has
        # not reached yet.
        assignment = await assign_qc2(db, job=job)

    if payload.stage == "delivered":
        if not (job.client_sheet_ok and job.ops_tracker_ok):
            raise HTTPException(
                status_code=400,
                detail="Both client_sheet_ok and ops_tracker_ok must be true before delivery",
            )
        job.delivered_at = datetime.now(timezone.utc)

    if payload.frame_link:
        # Onto the video list, so round two does not overwrite the cut QC
        # reviewed in round one. `frame_link` still ends up pointing at the
        # newest of them (`services/job_links.py`).
        await record_editor_cut(db, job=job, url=payload.frame_link, actor=user)

    if payload.assigned_editor_id:
        # `can_advance` gates the *move*; this field is a separate authority.
        # Without this check a VE making one of their three legal moves could
        # also hand the job to a different editor — docs/04 scopes assignment
        # to the TL. Found by the regression suite, not by review.
        if not has_role(user, *LEAD_ROLES):
            raise HTTPException(
                status_code=403, detail="Only an Owner or the pod's TL can assign the editor"
            )
        # First assignment only. Swapping an editor who is already on the job
        # is a handover and goes through `POST /jobs/{id}/reassign`, which
        # takes the reason — otherwise the reason is optional in practice,
        # since the same change lands here as a passenger on a stage move.
        if (
            job.assigned_editor_id is not None
            and job.assigned_editor_id != payload.assigned_editor_id
        ):
            raise HTTPException(
                status_code=400,
                detail="This job already has an editor — use Reassign, which records why it moved",
            )
        await ensure_assignable_editor(
            db, pod_id=job.pod_id, editor_id=payload.assigned_editor_id
        )
        job.assigned_editor_id = payload.assigned_editor_id

    if payload.deadline is not None:
        # The other half of the hand-off, and the same authority as the half
        # above: a date is a lead's decision. Recorded as a `job_updated`
        # event so the log reads the same whether the deadline arrived here or
        # through PATCH /jobs/{id}.
        if not has_role(user, *LEAD_ROLES):
            raise HTTPException(
                status_code=403, detail="Only an Owner or the pod's TL can set the deadline"
            )
        if job.deadline != payload.deadline:
            await record_event(
                db,
                job_id=job.id,
                event_type="job_updated",
                actor_id=user.id,
                payload={"deadline": {"from": str(job.deadline), "to": str(payload.deadline)}},
            )
            job.deadline = payload.deadline

    if payload.client_deadline is not None:
        # The promise, set on the same move for the same reason the team date
        # is: the TL knows both at the moment they choose the working one.
        # Same authority, and a separate payload key so the activity feed can
        # hide this change from the people the date itself is hidden from
        # (`LEAD_ONLY_EVENT_KEYS`).
        if not has_role(user, *LEAD_ROLES):
            raise HTTPException(
                status_code=403, detail="Only an Owner or the pod's TL can set the client deadline"
            )
        if job.client_deadline != payload.client_deadline:
            await record_event(
                db,
                job_id=job.id,
                event_type="job_updated",
                actor_id=user.id,
                payload={
                    "client_deadline": {
                        "from": str(job.client_deadline),
                        "to": str(payload.client_deadline),
                    }
                },
            )
            job.client_deadline = payload.client_deadline

    _ensure_deadline_order(job.deadline, job.client_deadline)

    job.stage = payload.stage
    stage_payload: dict = {
        "stage": payload.stage,
        "from_stage": from_stage,
        "round": job.round,
    }
    # How the QC1 review ended, on the one move where the question exists.
    # It rides on the stage_changed event rather than on a column because it
    # describes *this* pass through QC1, and a job on round three has been
    # through three of them — a column would only ever remember the last.
    # `services/qc1_review.py` reads it back off the log.
    #
    # Defaulted rather than required: an older client, the seed script and the
    # chatbot's tool layer all make this move without knowing about it, and
    # refusing them would break the pipeline to record a nuance. "Approved" is
    # the honest reading of a pass with nothing attached — it is what the
    # single button that used to be here meant.
    if from_stage == "qc1" and payload.stage == "qc2":
        stage_payload["qc1_outcome"] = payload.qc1_outcome or "approved"

    event = await record_event(
        db,
        job_id=job.id,
        event_type="stage_changed",
        actor_id=user.id,
        payload=stage_payload,
    )

    if assignment is not None:
        await _record_qc2_assignment(db, job=job, actor=user, assignment=assignment)

    # A send-back's change list is the one thing the editor actually needs to
    # read on the way back round the loop, so it gets its own event type
    # rather than hiding inside a stage_changed payload. Same append-only
    # log, no Comment table — see docs/03-data-model.md.
    if payload.note:
        await record_event(
            db,
            job_id=job.id,
            event_type="changes_raised" if payload.stage == "revisions" else "note_added",
            actor_id=user.id,
            payload={
                "note": payload.note,
                "from_stage": from_stage,
                "stage": payload.stage,
                "round": job.round,
            },
        )

    await notify_stage_change(db, job=job, pod=pod, event=event)

    if payload.stage == "delivered" and job.assigned_editor_id is not None:
        await refresh_certification(db, user_id=job.assigned_editor_id, pod_id=job.pod_id)

    await db.commit()

    row = (await db.execute(_detail_select(user).where(Job.id == job.id))).first()
    return _to_detail(row, user)


@router.patch("/{job_id}", response_model=JobDetailRead)
async def update_job(
    job_id: uuid.UUID,
    payload: JobUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Edit the job itself — title, video type, deadline, working-file link,
    assigned editor. Owner or the pod's TL.

    Nothing could be corrected after creation before this existed: a job
    created without a deadline could never get one, which quietly made the
    whole 'overdue' view meaningless, and a typo in a title was permanent.
    Every change is recorded as a `job_updated` event, so the log still
    explains how the job got to where it is."""
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    await check_pod_lead(db, job.pod_id, user)
    _require_live(job)

    changes: dict = {}

    def apply(field: str, value):
        if getattr(job, field) != value:
            changes[field] = {"from": str(getattr(job, field)), "to": str(value)}
            setattr(job, field, value)

    if payload.title is not None:
        apply("title", payload.title)
    if payload.channel_id is not None or payload.clear_channel:
        target = payload.channel_id if payload.channel_id is not None else None
        await ensure_channel_in_pod(db, pod_id=job.pod_id, channel_id=target)
        if job.channel_id != target:
            # Recorded by name rather than through `apply`, which stringifies
            # whatever it is given: "channel 3f2a…→91bc…" in the activity feed
            # is a change nobody reading it can identify.
            changes["channel"] = {
                "from": await _channel_name(db, job.channel_id),
                "to": await _channel_name(db, target),
            }
            job.channel_id = target
    if payload.video_type is not None:
        if payload.video_type != job.video_type:
            await enabled_video_type(db, payload.video_type)
        apply("video_type", payload.video_type)
    if payload.weight is not None:
        apply("weight", payload.weight)
    if payload.rush is not None:
        # Turning rush on after the job is already sitting unrouted is the
        # normal way this gets used: the TL finds out it is urgent, ticks the
        # box, and the next attempt to route it can overflow. Recorded as a
        # `job_updated` event like everything else here, because "who called
        # this urgent" is the first question asked when somebody ends the day
        # at 30 points.
        apply("rush", payload.rush)
    if payload.deadline is not None:
        apply("deadline", payload.deadline)
    elif payload.clear_deadline:
        apply("deadline", None)
    # No extra role check: this whole route is `check_pod_lead`, so anybody
    # who got this far is the Owner or this pod's own TL — which is exactly
    # who may see the field, let alone write it.
    if payload.client_deadline is not None:
        apply("client_deadline", payload.client_deadline)
    elif payload.clear_client_deadline:
        apply("client_deadline", None)
    _ensure_deadline_order(job.deadline, job.client_deadline)
    if payload.frame_link is not None or payload.clear_frame_link:
        # `frame_link` is a pointer to the newest video link now, and
        # `services/job_links.py` is the only thing that writes it. Setting it
        # here would hold until the next link was added and then silently
        # revert, which is worse than refusing — so this says where the link
        # actually goes.
        raise HTTPException(
            status_code=400,
            detail=(
                "Links live on the job's own lists now — POST /jobs/{id}/links "
                "with kind 'raw' (the client's files) or 'video' (a cut)"
            ),
        )

    if payload.assigned_editor_id is not None:
        # Same rule as on `advance`: this route sets the *first* editor, it
        # does not swap one. A handover carries a reason and goes through
        # `POST /jobs/{id}/reassign` — a silent swap here left the feed saying
        # "editor someone else → someone else" and nobody able to say why.
        if (
            job.assigned_editor_id is not None
            and job.assigned_editor_id != payload.assigned_editor_id
        ):
            raise HTTPException(
                status_code=400,
                detail="This job already has an editor — use Reassign, which records why it moved",
            )
        await ensure_assignable_editor(
            db, pod_id=job.pod_id, editor_id=payload.assigned_editor_id
        )
        apply("assigned_editor_id", payload.assigned_editor_id)
    elif payload.clear_editor:
        # Taking the job off the board entirely is not a handover — there is
        # no next editor to explain to — so it stays here.
        apply("assigned_editor_id", None)

    if payload.qc2_reviewer_id is not None:
        # Writes the charge as well as the membership: a hand-picked reviewer
        # who isn't billed is invisible to every load query, and the router
        # would go on stacking work on them (`services/access.py`).
        await ensure_assignable_reviewer(db, job=job, reviewer_id=payload.qc2_reviewer_id)
        apply("qc2_reviewer_id", payload.qc2_reviewer_id)

    if changes:
        await record_event(
            db, job_id=job.id, event_type="job_updated", actor_id=user.id, payload=changes
        )

    # A job that is already sitting unrouted at QC2 is the case the rush flag
    # was built for, and until now ticking the box did nothing for it: routing
    # only ever runs on the *move* into QC2 (`advance_stage`) or on a reviewer
    # claiming the job by hand, so the flag sat there waiting for an attempt
    # that was never going to come. Re-ask now, with the overflow branch newly
    # available. Still allowed to fail — past 125% of somebody's day the job
    # holds and the TL is told, exactly as before.
    if "rush" in changes and job.rush and job.stage == "qc2" and job.qc2_reviewer_id is None:
        assignment = await assign_qc2(db, job=job)
        if assignment is not None:
            event = await _record_qc2_assignment(db, job=job, actor=user, assignment=assignment)
            # Against the assignment event itself, not a made-up stage change:
            # the job did not move, it acquired a reviewer, and that reviewer
            # is the one person who needs to know a video landed on their day.
            await notify(db, user_id=assignment[0].reviewer.id, event=event)

    await db.commit()
    row = (await db.execute(_detail_select(user).where(Job.id == job.id))).first()
    return _to_detail(row, user)


@router.post("/{job_id}/reassign", response_model=JobDetailRead)
async def reassign_job(
    job_id: uuid.UUID,
    payload: JobReassign,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Hand a job in flight to a different editor, with the reason on the
    record.

    Work stalls on the person, not on the job: the editor is off sick, the
    week filled up, the cut is beyond them. Until now the only way to move it
    was `PATCH /jobs/{id}` with a new `assigned_editor_id`, which swapped the
    name silently — the feed said "edited the job · editor someone else →
    someone else" and nobody could later answer why the video changed hands,
    which is the one question anyone actually asks about a handover.

    Who: the pod's TL, and the company-wide tier (`check_pod_lead`) — the same
    authority that assigns the work in the first place. An editor cannot hand
    their own job to someone else, and a QC cannot move it off the person
    they are reviewing.

    The stage does not move. A job reassigned at QC2 is still at QC2 with its
    rounds intact; only the name on it changes, because that is the whole
    truth of what happened.
    """
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    await check_pod_lead(db, job.pod_id, user)
    _require_live(job)

    if job.stage == "delivered":
        raise HTTPException(
            status_code=400,
            detail="This job is delivered — reassigning it would rewrite who did the work",
        )
    if job.assigned_editor_id is None:
        raise HTTPException(
            status_code=400,
            detail="This job has no editor yet — assign one from 'Your next step' instead",
        )
    if job.assigned_editor_id == payload.editor_id:
        raise HTTPException(status_code=400, detail="That editor already has this job")

    await ensure_assignable_editor(db, pod_id=job.pod_id, editor_id=payload.editor_id)

    previous_editor = await db.get(User, job.assigned_editor_id)
    new_editor = await db.get(User, payload.editor_id)
    job.assigned_editor_id = new_editor.id

    # Names as well as ids in the payload: the feed reads "Abhishek → Ram"
    # months later, when resolving two ids means a join the timeline endpoint
    # doesn't do — and when one of those accounts may since have been
    # deactivated and dropped out of every picker.
    event = await record_event(
        db,
        job_id=job.id,
        event_type="job_reassigned",
        actor_id=user.id,
        payload={
            "reason": payload.reason.strip(),
            "from_editor_id": str(previous_editor.id),
            "from_editor_name": previous_editor.name,
            "to_editor_id": str(new_editor.id),
            "to_editor_name": new_editor.name,
            "stage": job.stage,
            "round": job.round,
        },
    )
    pod = await db.get(Pod, job.pod_id)
    await notify_job_reassigned(
        db,
        job=job,
        pod=pod,
        event=event,
        actor_id=user.id,
        previous_editor_id=previous_editor.id,
    )

    await db.commit()
    row = (await db.execute(_detail_select(user).where(Job.id == job.id))).first()
    return _to_detail(row, user)


@router.post("/{job_id}/claim-qc2", response_model=JobDetailRead)
async def claim_qc2(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """A QC picks up a job that routing could not place.

    docs/05 says an unrouted job "surfaces on the QC team page" so somebody
    can take it — but there was no way to actually take one: `qc2_reviewer_id`
    was only ever written by the auto-router on the way into QC2, and a QC
    can't advance a job that isn't already theirs. An unrouted job was
    therefore permanently stuck, and freeing capacity later did not re-route
    it. This is that missing verb.
    """
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if not has_role(user, "qc"):
        raise HTTPException(status_code=403, detail="Only a QC reviewer can claim QC2 work")
    _require_live(job)
    # Pod membership rather than the general read check: the moment someone
    # else claims the job it leaves this QC's scope, and `require_job_read`
    # would answer a lost race with "Not your job" — technically true and
    # useless to the person who just clicked Claim on a row that was in their
    # list a second ago. Membership is what they'd already know either way.
    if not await is_pod_member(db, pod_id=job.pod_id, user_id=user.id):
        raise HTTPException(status_code=403, detail="Not a member of this pod")
    if job.stage != "qc2":
        raise HTTPException(status_code=400, detail="Only a job sitting at QC2 can be claimed")
    if job.qc2_reviewer_id is not None:
        reviewer = await db.get(User, job.qc2_reviewer_id)
        taken_by = reviewer.name if reviewer else "someone else"
        raise HTTPException(
            status_code=400,
            detail=f"{taken_by} picked this up first — QC2 stays with one reviewer (docs/05)",
        )

    job.qc2_reviewer_id = user.id
    # Claiming is an assignment like any other and costs the same points. The
    # unrouted pile exists precisely because nobody had room, so a claim that
    # didn't bill would let a full reviewer empty it and stay "free".
    billed = await charge(db, job=job, reviewer_id=user.id)
    await record_event(
        db,
        job_id=job.id,
        event_type="qc2_claimed",
        actor_id=user.id,
        payload={
            "stage": job.stage,
            "round": job.round,
            "points": billed.points,
            "video_type": job.video_type,
        },
    )
    await db.commit()

    row = (await db.execute(_detail_select(user).where(Job.id == job.id))).first()
    return _to_detail(row, user)


@router.get("/{job_id}/qc1-pass", response_model=Qc1Pass | None)
async def get_qc1_pass(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """How the latest QC1 review went — see `services/qc1_review.py`.

    Derived from the event log, never stored: who cleared it, when, how long
    it had been sitting at QC1, and whether they said anything. Facts, not a
    verdict — a fast pass with no note is usually a rubber stamp and
    occasionally a TL who watched the cut being made, and nothing here can
    tell those apart.

    Null when the job has never been through QC1. Same scoping as the
    timeline it sits beside: anyone who can see the
    job can see it. That includes the editor, on purpose — it is the same
    stance the change list and the edit-bay clock already take (docs/05), and
    a review record readable only by the people being reviewed is not a
    record.
    """
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    await require_job_read(db, job=job, user=user)
    return await latest_qc1_pass(db, job=job)


@router.post("/{job_id}/qc1-flag", response_model=JobDetailRead)
async def flag_qc1(
    job_id: uuid.UUID,
    payload: JobQc1Flag,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The QC2 reviewer says this cut never actually had a QC1.

    QC1 is the pod TL's first-pass review, and a job waved straight through it
    is indistinguishable on the record from one that was properly reviewed —
    both are a stage change from qc1 to qc2. The person who finds out is the
    QC2 reviewer, who is now doing two reviews' work on a cut nobody checked,
    and until now the only thing they could do about it was mention it in
    chat. This is that, on the job.

    Who: the QC2 reviewer the job is routed to, plus Owner / Founder's Office
    / HR auditing afterwards — `services/qc1_review.py::may_flag_qc1`, which
    also explains why the pod TL is not on that list.

    What it requires: a QC1 pass actually on the record (there is nothing to
    flag otherwise), a reason, and that the flagger is not the person who
    cleared it. The stage does not move and the round does not change — the
    flag is a statement about something that already happened, not a
    send-back. The QC2 review carries on as normal.

    Who is told: whoever cleared QC1 and the pod TL, never the reviewer who
    raised it. Somebody learning they were flagged from a dashboard tint weeks
    later is an accusation made behind their back.
    """
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    await require_job_read(db, job=job, user=user)
    if not may_flag_qc1(user=user, job=job):
        raise HTTPException(
            status_code=403,
            detail="Only this job's QC2 reviewer (or an admin) can flag its QC1",
        )
    _require_live(job)

    if job.qc1_flagged_at is not None:
        raise HTTPException(status_code=400, detail="This job's QC1 is already flagged")

    qc1_pass = await latest_qc1_pass(db, job=job)
    if qc1_pass is None:
        raise HTTPException(
            status_code=400,
            detail="This job has not been through QC1 yet — there is no review to flag",
        )
    if qc1_pass.cleared_by_id == user.id:
        raise HTTPException(
            status_code=400, detail="You cleared QC1 on this job yourself"
        )

    job.qc1_flagged_at = datetime.now(timezone.utc)
    job.qc1_flagged_by_id = user.id
    job.qc1_flag_tl_id = qc1_pass.cleared_by_id
    job.qc1_flag_reason = payload.reason.strip()

    # The evidence goes into the payload rather than being re-derived later:
    # the log is append-only and this is what was on screen when the call was
    # made. A stage correction afterwards must not quietly change what the
    # reviewer is on record as having seen.
    event = await record_event(
        db,
        job_id=job.id,
        event_type="qc1_flag_raised",
        actor_id=user.id,
        payload={
            "reason": job.qc1_flag_reason,
            "tl_id": str(qc1_pass.cleared_by_id) if qc1_pass.cleared_by_id else None,
            "tl_name": qc1_pass.cleared_by_name,
            "cleared_at": qc1_pass.cleared_at.isoformat(),
            "seconds_at_qc1": qc1_pass.seconds,
            "comments_at_qc1": qc1_pass.comments,
            "stage": job.stage,
            "round": job.round,
        },
    )
    pod = await db.get(Pod, job.pod_id)
    await notify_qc1_flag(
        db, job=job, pod=pod, event=event, actor_id=user.id, tl_id=qc1_pass.cleared_by_id
    )

    await db.commit()
    row = (await db.execute(_detail_select(user).where(Job.id == job.id))).first()
    return _to_detail(row, user)


@router.post("/{job_id}/qc1-flag/clear", response_model=JobDetailRead)
async def clear_qc1_flag(
    job_id: uuid.UUID,
    payload: JobQc1FlagClear,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Withdraw a QC1 flag, or dismiss one.

    Two different acts through one door: the reviewer who raised it taking it
    back (wrong job, or the TL explained), and the company-wide tier ruling on
    it after hearing both sides. Not the pod TL and not whoever cleared QC1 —
    a flag anyone can delete about themselves is not a flag, and clearing it
    would leave the dashboard tint as the only thing that ever noticed.

    The columns clear; the log does not. `qc1_flag_raised` and
    `qc1_flag_cleared` both stay, so "this was raised and withdrawn an hour
    later" remains readable, which is exactly the pattern worth being able to
    see over a few months.
    """
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    await require_job_read(db, job=job, user=user)

    if job.qc1_flagged_at is None:
        raise HTTPException(status_code=400, detail="This job's QC1 is not flagged")
    if not (has_role(user, *ALL_PODS_ROLES) or job.qc1_flagged_by_id == user.id):
        raise HTTPException(
            status_code=403,
            detail="Only the reviewer who raised this flag, or an admin, can clear it",
        )

    flagged_tl_id = job.qc1_flag_tl_id
    event = await record_event(
        db,
        job_id=job.id,
        event_type="qc1_flag_cleared",
        actor_id=user.id,
        payload={
            "reason": (payload.reason or "").strip() or None,
            "tl_id": str(flagged_tl_id) if flagged_tl_id else None,
            "raised_at": job.qc1_flagged_at.isoformat(),
            "raised_reason": job.qc1_flag_reason,
            "stage": job.stage,
            "round": job.round,
        },
    )
    pod = await db.get(Pod, job.pod_id)
    # Before the columns are cleared: the reviewer who raised it is read off
    # the job, and they are one of the two people this answers.
    await notify_qc1_flag(
        db, job=job, pod=pod, event=event, actor_id=user.id, tl_id=flagged_tl_id
    )

    job.qc1_flagged_at = None
    job.qc1_flagged_by_id = None
    job.qc1_flag_tl_id = None
    job.qc1_flag_reason = None

    await db.commit()
    row = (await db.execute(_detail_select(user).where(Job.id == job.id))).first()
    return _to_detail(row, user)


@router.post("/{job_id}/scrap", response_model=JobDetailRead)
async def scrap_job(
    job_id: uuid.UUID,
    payload: JobScrap,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Kill a project before delivery, with a reason on the record.

    Work gets cancelled — the client pulls the campaign, the brief dies, the
    footage never arrives — and until now the only ways to express that were
    to leave the job rotting in someone's queue forever or to march it to
    "delivered", which is a lie that lands in the first-pass rate and the
    client's delivered count. Both were happening.

    Who: the pod's TL, and the company-wide tier — Owner, Founder's Office and
    HR (`check_pod_lead`, the same gate as editing the job or delivering it).
    An editor or a QC cannot cancel a client commitment; that is the pod TL's
    call per docs/04. A *delivered* job cannot be scrapped: it has already
    gone to the client, and pretending otherwise would silently rewrite
    history the client can see.

    The reason is stored twice on purpose — on the job, where every list can
    show it without a join, and as a `job_scrapped` event, which is the
    append-only record of who did it and when. The job keeps its stage, so
    "we dropped this at QC2 on round 3" stays legible afterwards.
    """
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    await check_pod_lead(db, job.pod_id, user)

    if job.scrapped_at is not None:
        raise HTTPException(status_code=400, detail="This project is already scrapped")
    if job.stage == "delivered":
        raise HTTPException(
            status_code=400,
            detail="This job was delivered to the client — a delivered job cannot be scrapped",
        )

    job.scrapped_at = datetime.now(timezone.utc)
    job.scrapped_by_id = user.id
    job.scrap_reason = payload.reason.strip()

    # The QC2 round is over — nobody is going to review a cancelled project.
    # Without this the charge stays open, and an open charge carries forward
    # into every following day for good: no stage move will ever come along to
    # release it. The points stay spent for the rest of today, which is the
    # same answer this model gives about any finished round (docs/12 §3).
    await release(db, job_id=job.id)

    event = await record_event(
        db,
        job_id=job.id,
        event_type="job_scrapped",
        actor_id=user.id,
        payload={"reason": job.scrap_reason, "stage": job.stage, "round": job.round},
    )
    pod = await db.get(Pod, job.pod_id)
    await notify_job_scrapped(db, job=job, pod=pod, event=event, actor_id=user.id)

    await db.commit()
    row = (await db.execute(_detail_select(user).where(Job.id == job.id))).first()
    return _to_detail(row, user)


@router.post("/{job_id}/restore", response_model=JobDetailRead)
async def restore_job(
    job_id: uuid.UUID,
    payload: JobRestore,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Undo a scrap. Same authority as making one.

    The job comes back at the stage it died at, with its round count intact,
    because that is where the work actually stands — restoring to intake would
    throw away three rounds of QC history to make the state machine tidier.
    The scrap and the restore both stay in the event log; the job's own
    columns are cleared, since they answer "is this dead right now".
    """
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    await check_pod_lead(db, job.pod_id, user)

    if job.scrapped_at is None:
        raise HTTPException(status_code=400, detail="This project is not scrapped")

    scrapped_at = job.scrapped_at
    job.scrapped_at = None
    job.scrapped_by_id = None
    job.scrap_reason = None

    # The job comes back at the stage it died at, so a reviewer is holding real
    # work again and the ledger has to say so — otherwise a restored job is
    # invisible to load and the router treats them as free. Restored the same
    # day it was scrapped, `charge` reopens the row the scrap released instead
    # of billing the round twice (`services/routing.py`).
    if job.stage in ("qc2", "revisions") and job.qc2_reviewer_id is not None:
        await charge(db, job=job, reviewer_id=job.qc2_reviewer_id)

    await record_event(
        db,
        job_id=job.id,
        event_type="job_restored",
        actor_id=user.id,
        payload={
            "reason": (payload.reason or "").strip() or None,
            "stage": job.stage,
            "round": job.round,
            "scrapped_at": scrapped_at.isoformat(),
        },
    )

    await db.commit()
    row = (await db.execute(_detail_select(user).where(Job.id == job.id))).first()
    return _to_detail(row, user)


@router.post("/{job_id}/notes", response_model=JobEventRead, status_code=201)
async def add_job_note(
    job_id: uuid.UUID,
    payload: JobNoteCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Leave a comment without moving the job.

    Notes used to be possible only as a passenger on a stage change, so a TL
    with a question at QC1 had to send the job somewhere to be heard. Anyone
    who can read the job can comment on it; whoever currently owns the stage
    gets notified."""
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    await require_job_read(db, job=job, user=user)

    event = await record_event(
        db,
        job_id=job.id,
        event_type="note_added",
        actor_id=user.id,
        payload={"note": payload.note, "stage": job.stage, "round": job.round},
    )
    pod = await db.get(Pod, job.pod_id)
    await notify_note(db, job=job, pod=pod, event=event, author_id=user.id)

    await db.commit()
    result = JobEventRead.model_validate(event)
    result.actor_name = user.name
    return result


@router.patch("/{job_id}/checklist", response_model=JobRead)
async def update_checklist(
    job_id: uuid.UUID,
    payload: JobChecklistUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Sets the client_sheet_ok / ops_tracker_ok delivery checklist flags —
    a TL/Owner action, gating the qc/final -> delivered transition in
    advance_stage. See docs/03-data-model.md: temporary migration bridge
    from the dual-spreadsheet habit, not a pattern to extend."""
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    await check_pod_lead(db, job.pod_id, user)
    _require_live(job)

    if payload.client_sheet_ok is not None:
        job.client_sheet_ok = payload.client_sheet_ok
    if payload.ops_tracker_ok is not None:
        job.ops_tracker_ok = payload.ops_tracker_ok

    await db.commit()
    await db.refresh(job)
    return job


@router.get("/{job_id}/events", response_model=list[JobEventRead])
async def list_job_events(
    job_id: uuid.UUID,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Activity feed for one job — the timeline and the QC change list in the
    job panel both read from here. Same scoping as list_jobs: a VE only sees
    events for their own assigned job. Joined with the actor's name so the
    feed can say *who* raised a change, not just when."""
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    await require_job_read(db, job=job, user=user)

    # One lookup for the whole feed, not one per row: the only thing it
    # decides is whether the client-deadline changes in this log are readable,
    # and that answer is the same for every row in it.
    pod = await db.get(Pod, job.pod_id)
    lead = leads_pod(user, pod.tl_id if pod else None)

    result = await db.execute(
        select(JobEvent, User.name)
        .outerjoin(User, User.id == JobEvent.actor_id)
        .where(JobEvent.job_id == job_id)
        .order_by(JobEvent.created_at)
        .offset(offset)
        .limit(limit)
    )
    feed = []
    for event, actor_name in result.all():
        item = JobEventRead.model_validate(event)
        item.actor_name = actor_name
        item.payload = redact_event_payload(item.payload, lead=lead)
        feed.append(item)
    return feed


@router.get("/{job_id}/links", response_model=list[JobLinkRead])
async def list_job_links(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Every link on the job, raw and video, oldest first.

    Same read rule as the job itself — if you can see the job you can see
    what it points at, and the two answers cannot be allowed to differ."""
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    await require_job_read(db, job=job, user=user)

    links = await links_for(db, job_id=job.id)
    names = dict(
        (
            await db.execute(
                select(User.id, User.name).where(
                    User.id.in_({link.added_by_id for link in links} or {uuid.uuid4()})
                )
            )
        ).all()
    )
    return [
        JobLinkRead(
            **{
                field: getattr(link, field)
                for field in ("id", "job_id", "kind", "title", "url", "added_by_id", "created_at")
            },
            added_by_name=names.get(link.added_by_id),
        )
        for link in links
    ]


@router.post("/{job_id}/links", response_model=JobLinkRead, status_code=201)
async def add_job_link(
    job_id: uuid.UUID,
    payload: JobLinkCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Raw material is the TL's to add; the cut is the editor's. The split is
    in `services/job_links.py::may_add` — a raw folder arriving from anywhere
    but the person the client sends it to is how a job ends up pointing at
    the wrong shoot, and nobody but the editor knows which export is the one
    to review."""
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _require_live(job)
    if not await may_add(db, job=job, user=user, kind=payload.kind):
        raise HTTPException(
            status_code=403,
            detail=(
                "Only the pod's TL can add raw files"
                if payload.kind == "raw"
                else "Only the editor on this job can add a cut"
            ),
        )

    link = await add_link(
        db, job=job, kind=payload.kind, url=payload.url, title=payload.title, actor=user
    )
    # On the record like every other change to a job: a link nobody can trace
    # is the one that turns out to point at the wrong client's footage.
    await record_event(
        db,
        job_id=job.id,
        event_type="link_added",
        actor_id=user.id,
        payload={"kind": link.kind, "title": link.title, "url": link.url},
    )
    await db.commit()
    await db.refresh(link)
    return JobLinkRead(
        **{
            field: getattr(link, field)
            for field in ("id", "job_id", "kind", "title", "url", "added_by_id", "created_at")
        },
        added_by_name=user.name,
    )


@router.delete("/{job_id}/links/{link_id}", status_code=204)
async def delete_job_link(
    job_id: uuid.UUID,
    link_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Whoever added it, or the pod's lead."""
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _require_live(job)
    link = await db.get(JobLink, link_id)
    if link is None or link.job_id != job.id:
        raise HTTPException(status_code=404, detail="Link not found on this job")
    if not await may_remove(db, job=job, user=user, link=link):
        raise HTTPException(
            status_code=403, detail="Only whoever added this link, or the pod's TL, can remove it"
        )

    await record_event(
        db,
        job_id=job.id,
        event_type="link_removed",
        actor_id=user.id,
        payload={"kind": link.kind, "title": link.title, "url": link.url},
    )
    await remove_link(db, job=job, link=link)
    await db.commit()
