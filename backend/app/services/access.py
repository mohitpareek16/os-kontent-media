"""Who may see and touch a job.

`stage_machine.can_advance()` answers "may this person make this *move*".
This module answers the question underneath it — "may this person see this
job at all", and "is this person a legal editor for it".

Both used to be answered ad hoc: the list endpoint scoped rows correctly
while `GET /jobs/{id}` only checked the VE case, so a QC or TL could read
any job in the company by id. One definition, used by every read path.
See docs/04-permissions.md.
"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import and_, false, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job
from app.models.pod import Pod
from app.models.pod_member import PodMember
from app.models.user import ALL_PODS_ROLES, User, has_role
from app.services.stage_machine import stages_owned_by


def pod_scope_clauses(user: User) -> list:
    """Row-level visibility for a *pod* list query: the Owner sees every pod,
    everyone else sees the pods they are a member of (docs/04) — which is how
    a lent TL sees theirs, since creating a pod puts its TL in it.

    Same shape and the same reasoning as `job_scope_clauses` below — one
    definition, composable onto any select, used by `GET /pods` and by the
    chatbot's entity resolution so the two cannot drift into disagreeing
    about which pods a person can name.
    """
    if has_role(user, *ALL_PODS_ROLES):
        return []
    return [
        select(PodMember.user_id)
        .where(PodMember.pod_id == Pod.id, PodMember.user_id == user.id)
        .exists()
    ]


def pod_lead_clauses(user: User) -> list:
    """The stricter pod scope: pods this person is *accountable for*, which
    is what every analytics read is gated on.

    `check_pod_lead` answers this for one known pod; this answers it across
    many, for a query that has to start from "all the pods I lead" rather
    than from a pod id the caller already named. The company-wide tier
    bypasses, same as everywhere else.
    """
    if has_role(user, *ALL_PODS_ROLES):
        return []
    return [Pod.tl_id == user.id]


def _member_of_job_pod():
    """EXISTS clause: the current row's pod contains this member. Composes
    onto any select without multiplying rows or breaking a COUNT."""
    return PodMember.pod_id == Job.pod_id


def _tl_job_clause(user: User):
    """A lead sees the jobs of every pod they are in."""
    return (
        select(PodMember.user_id)
        .where(_member_of_job_pod(), PodMember.user_id == user.id)
        .exists()
    )


def _qc_job_clause(user: User):
    """In-queue only: jobs routed to this reviewer, plus QC2 jobs in their
    pods that routing could not place. Unrouted jobs have to surface
    somewhere (docs/05) or they sit invisible forever."""
    return or_(
        Job.qc2_reviewer_id == user.id,
        (Job.stage == "qc2")
        & Job.qc2_reviewer_id.is_(None)
        & select(PodMember.user_id)
        .where(_member_of_job_pod(), PodMember.user_id == user.id)
        .exists(),
    )


def _ve_job_clause(user: User):
    return Job.assigned_editor_id == user.id


# One builder per role, so visibility can be a *union* rather than a ladder of
# elifs. It has to be a union now: a person can hold two roles (an editor who
# also leads two client pods), and asking "which branch are they" would answer
# with whichever one the author happened to test first, hiding half their work.
_JOB_SCOPE_BY_ROLE = {"tl": _tl_job_clause, "qc": _qc_job_clause, "ve": _ve_job_clause}


def job_scope_clauses(user: User) -> list:
    """Row-level visibility for a list query, per docs/04:

    - **Owner** — everything, company-wide.
    - **TL** (primary or lent) — jobs in pods they belong to.
    - **QC** — jobs routed to them, plus unrouted QC2 jobs in their pods.
    - **VE** — their own assigned jobs.
    - **Anyone else** — nothing. HR, the Founder's Office and a `staff`
      account hold no view of the work by virtue of their role; an HR who runs
      client pods holds it as their TL, on those pods, like everybody else.
    """
    if has_role(user, *ALL_PODS_ROLES):
        return []
    parts = [build(user) for role, build in _JOB_SCOPE_BY_ROLE.items() if has_role(user, role)]
    if not parts:
        return [false()]
    return [or_(*parts)] if len(parts) > 1 else [parts[0]]


def not_scrapped():
    """"This job still counts."

    A scrapped project is dead work: it must not appear in a queue, inflate an
    overdue number, consume an editor's capacity, or drag down a first-pass
    rate. Every list, count and capacity query in the product filters on it,
    which is why it is one named clause and not `Job.scrapped_at.is_(None)`
    re-typed in thirty places — the thirty-first is the one that gets
    forgotten. See docs/03-data-model.md.
    """
    return Job.scrapped_at.is_(None)


def _leads_job_pod(user: User):
    """EXISTS: the current row's pod is led by this user. An EXISTS rather
    than `Pod.tl_id == user.id` so it composes onto a select that hasn't
    joined Pod.

    `.correlate(Job)` is load-bearing. Most callers *have* already joined Pod,
    and left to itself SQLAlchemy correlates every table it recognises from
    the enclosing query — both `jobs` and `pods` — which leaves the subquery
    with no FROM at all and raises at compile time. Naming Job as the only
    correlation keeps `pods` inside the subquery where it belongs.
    """
    return (
        select(Pod.id)
        .where(Pod.id == Job.pod_id, Pod.tl_id == user.id)
        .correlate(Job)
        .exists()
    )


def _awaiting_brief():
    """SQL for `stage_machine.is_briefed` being false at an editor's stage —
    the job is nominally with an editor but the hand-off was never finished,
    so it is the TL's move and not theirs.

    Written as a clause rather than derived per row because the Mine tab is a
    COUNT as well as a list, and a Python-side check cannot be counted.
    """
    return and_(
        Job.stage.in_(stages_owned_by("ve")),
        or_(Job.assigned_editor_id.is_(None), Job.deadline.is_(None)),
    )


def mine_clauses(user: User) -> list:
    """"On my plate right now", per role — the one definition of `Mine`.

    It used to be `assigned_editor_id == me OR qc2_reviewer_id == me`, written
    out twice (once in the row query, once in the count). A TL is never either
    of those, so **every TL's Mine tab counted zero** no matter how much work
    was waiting on them, and a QC1 hand-off landed in a tab that stayed empty.

    So the question is asked of the stage, not of a name field: whose move is
    it (`STAGE_OWNER_ROLE` in stage_machine.py), and are you that person?

    - **VE** — jobs assigned to them at assigned / editing / revisions, *and
      briefed* (see below). A cut they sent to QC still has their id on it and
      is no longer their move.
    - **QC** — jobs routed to them sitting at QC2. Same reasoning: a send-back
      in revisions is the editor's move, and it returns to them after.
    - **TL, and the Owner** — jobs at intake / QC1 / final in pods they lead,
      plus the un-briefed ones sitting at an editor's stage. Every branch keys
      off `Pod.tl_id`, which is why a *lent* TL needs no special case: the
      pods they were handed are theirs here exactly as a primary TL's are. The
      Owner reaches every pod but is rarely anyone's `Pod.tl_id`, so their
      Mine is usually empty by design and the UI hides the tab rather than
      showing a permanent zero.

    A person holding two roles is the union of them: an editor who leads two
    client pods has their own cuts *and* those pods' QC1 queue waiting on
    them, and both belong in one tab, because "what do I do next" has one
    answer per person and not one per role.

    The brief is the second half of the VE rule and the reason the TL clause
    has an OR in it: a hand-off is an editor *and* a deadline, and until both
    are set the job has not left the TL's desk no matter what stage says
    (`stage_machine.is_briefed`, the same predicate the buttons read). It used
    to land in the editor's Mine the moment a name was on it, purple and
    ready, with "No deadline" where the date should be.

    Delivered and scrapped jobs are on nobody's plate and are never Mine.
    """
    parts = []
    if has_role(user, "ve"):
        parts.append(
            and_(
                Job.assigned_editor_id == user.id,
                Job.stage.in_(stages_owned_by("ve")),
                Job.deadline.is_not(None),
            )
        )
    if has_role(user, "qc"):
        parts.append(
            and_(Job.qc2_reviewer_id == user.id, Job.stage.in_(stages_owned_by("qc")))
        )
    if has_role(user, "tl", *ALL_PODS_ROLES):
        parts.append(
            and_(
                _leads_job_pod(user),
                or_(Job.stage.in_(stages_owned_by("tl")), _awaiting_brief()),
            )
        )
    if not parts:
        return [false()]
    return [or_(*parts) if len(parts) > 1 else parts[0], not_scrapped()]


async def is_pod_member(db: AsyncSession, *, pod_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    result = await db.execute(
        select(PodMember.user_id).where(PodMember.pod_id == pod_id, PodMember.user_id == user_id)
    )
    return result.scalar_one_or_none() is not None


async def can_read_job(db: AsyncSession, *, job: Job, user: User) -> bool:
    """Single-job mirror of `job_scope_clauses` — same rule, one row, and the
    same union across the roles this person holds."""
    if has_role(user, *ALL_PODS_ROLES):
        return True
    if has_role(user, "ve") and job.assigned_editor_id == user.id:
        return True
    if has_role(user, "qc"):
        if job.qc2_reviewer_id == user.id:
            return True
        if job.stage == "qc2" and job.qc2_reviewer_id is None:
            return await is_pod_member(db, pod_id=job.pod_id, user_id=user.id)
    if has_role(user, "tl"):
        return await is_pod_member(db, pod_id=job.pod_id, user_id=user.id)
    return False


async def require_job_read(db: AsyncSession, *, job: Job, user: User) -> None:
    if not await can_read_job(db, job=job, user=user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your job")


async def open_job_count(db: AsyncSession, editor_id: uuid.UUID) -> int:
    """How many videos this editor is holding right now — every job assigned
    to them that is neither delivered nor scrapped, counted as jobs and not
    as weight.

    Stages past the edit bay count too. A cut sitting in QC2 can come back as
    a revision and is still the editor's to finish, so it has not left their
    plate; delivery is the only moment that is unambiguously true, and it is
    the moment the cap is written against."""
    result = await db.execute(
        select(func.count())
        .select_from(Job)
        .where(Job.assigned_editor_id == editor_id, Job.stage != "delivered", not_scrapped())
    )
    return result.scalar() or 0


async def ensure_assignable_editor(
    db: AsyncSession, *, pod_id: uuid.UUID, editor_id: uuid.UUID, pending: int = 0
) -> None:
    """An editor must actually be an editor, must have a free slot, and ends
    up a member of the pod they were just given work in.

    The role check was not there at all once: a QC reviewer could be set as a
    job's editor, which then vanished from every capacity view (those filter
    on role='ve') and would have run the certification check against the wrong
    kind of user.

    The cap is the second, and this is deliberately the only place it lives —
    creating a job with an editor, batch-creating twenty, assigning one at
    intake, and reassigning in flight all pass through here, so there is no
    door into an editor's queue that skips the limit.

    `pending` is for a batch: the rows earlier in the same request have not
    been committed yet and so are invisible to the count, which would let one
    call hand the same editor ten jobs one row at a time. The caller passes
    how many it has already lined up for this editor.

    Membership is the third, and it is *made true* rather than demanded. This
    used to be a 400 — "That editor is not a member of this job's pod" — which
    was a rule the product contradicted from both sides: every editor picker
    is built on `/users/ve-load`, which lists active VEs company-wide because
    load is deliberately cross-pod (docs/05), so the name was offered and then
    refused on save; and a TL choosing someone *is* the decision to have them
    on the pod. The membership row now follows the assignment: `pod_role='ve'`,
    `certified_at` left None so certification is still earned per pod off that
    pod's deliveries (`services/certification.py`).

    Written last, after every check that can refuse, so a save that is turned
    down for role, deactivation or capacity does not leave a stray membership
    behind — including in a batch, where an early row's join must not outlive
    a later row's rejection.
    """
    editor = await db.get(User, editor_id)
    if editor is None or editor.role != "ve":
        raise HTTPException(status_code=400, detail="Assigned editor must be a VE account")
    if not editor.is_active:
        raise HTTPException(status_code=400, detail="That editor's account is deactivated")

    held = await open_job_count(db, editor_id) + pending
    if held >= editor.max_concurrent_jobs:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{editor.name} is already holding {held} video(s), the limit is "
                f"{editor.max_concurrent_jobs} at a time — one has to be delivered "
                "before another can be assigned"
            ),
        )

    await _join_pod(db, pod_id=pod_id, user_id=editor_id, pod_role="ve")


async def ensure_assignable_reviewer(db: AsyncSession, *, job: Job, reviewer_id: uuid.UUID) -> None:
    """The QC2 side of the same rule: an active QC account, a member of the pod
    by the time the job is theirs, and billed for the round.

    No capacity check, on purpose. Routing scores against a points budget to
    decide who *should* get a job (`services/routing.py`), and a lead naming a
    reviewer by hand is by definition overriding exactly that — refusing them
    here would make the manual override useless on precisely the day it is
    needed. Membership is added rather than demanded for the same reason it is
    on the editor side, plus one specific to QC: an unrouted job is one no
    reviewer in the pod could take, and the person the lead reaches for next is
    by definition from outside it. Without the join they would own a job in a
    pod they are not in, which is legal but leaves them missing from the pod's
    own member list.

    The charge is written even though the budget was overridden. A hand-picked
    reviewer who is not billed is invisible to every load query, so the router
    would go on treating them as free and stack the next three jobs on them —
    the override would quietly spread instead of costing the one job the lead
    meant it to cost. Overriding the budget and hiding from it are different
    decisions, and only the first one was made here.
    """
    # Imported here, not at module scope: routing.py reads `not_scrapped` from
    # this module, so a top-level import would close the loop.
    from app.services.routing import charge

    reviewer = await db.get(User, reviewer_id)
    if reviewer is None or reviewer.role != "qc" or not reviewer.is_active:
        raise HTTPException(status_code=400, detail="QC reviewer must be an active QC account")
    await _join_pod(db, pod_id=job.pod_id, user_id=reviewer_id, pod_role="qc")
    await charge(db, job=job, reviewer_id=reviewer_id)


async def _join_pod(
    db: AsyncSession, *, pod_id: uuid.UUID, user_id: uuid.UUID, pod_role: str
) -> None:
    """Membership as a consequence of being given work, not a precondition
    for it. No-op when they are already in, whatever `pod_role` they hold
    there — a TL who also cuts video keeps their `tl` row."""
    if await is_pod_member(db, pod_id=pod_id, user_id=user_id):
        return
    db.add(PodMember(pod_id=pod_id, user_id=user_id, pod_role=pod_role))
    # Flushed, not left pending: the next row of the same batch asks
    # `is_pod_member` again and must see this one rather than adding a
    # second row for the same primary key.
    await db.flush()


async def ensure_channel_in_pod(
    db: AsyncSession, *, pod_id: uuid.UUID, channel_id: uuid.UUID | None
) -> None:
    """A job's channel must belong to that job's own client.

    The foreign key only says "some channel exists with this id" — it would
    happily let a TL file a Dhan video under Upstox's "Shorts" by pasting an
    id, and that row would then render as Upstox's on every screen that reads
    the channel name. This is the rule the column actually has.

    An archived channel is refused on the way *in* while staying on the jobs
    already filed under it: retiring a channel is a statement about new work,
    not a rewrite of old work.
    """
    # Local import: models/channel imports nothing from here, but keeping the
    # import beside its one use matches how `charge` is pulled in above.
    from app.models.channel import Channel

    if channel_id is None:
        return
    channel = await db.get(Channel, channel_id)
    if channel is None or channel.pod_id != pod_id:
        raise HTTPException(status_code=400, detail="That channel belongs to a different client")
    if channel.archived_at is not None:
        raise HTTPException(
            status_code=400,
            detail="That channel is archived — new work cannot be filed under it",
        )


def leads_pod(user: User, tl_id: uuid.UUID | None) -> bool:
    """Is this person the lead of a pod whose TL is `tl_id`?

    The same test `core/deps.py::check_pod_lead` makes, without the round
    trip: the company-wide tier always, and otherwise `Pod.tl_id == user.id`.
    A lent TL passes it exactly as a primary one does, because the pods you
    were handed are yours (docs/04).

    A plain `tl_id` rather than a `Pod`, because every caller already has the
    id in hand — `_detail_select` selects it onto the row, the AI tools join
    for it — and loading the pod again to compare one column would be a query
    per row.
    """
    return has_role(user, *ALL_PODS_ROLES) or (tl_id is not None and tl_id == user.id)


def visible_client_deadline(job: Job, *, viewer: User, tl_id: uuid.UUID | None):
    """The client deadline as `viewer` is allowed to see it — the real date
    for the Owner and for this pod's own TL, `None` for everybody else.

    The one place that decision is made. It is redaction at the edge of the
    API rather than a filter in the browser on purpose: the whole point of a
    team deadline that sits earlier than the promise is that an editor works
    to the earlier one, and a payload that carries both dates to their browser
    has already given the game away to anyone who opens the network tab. The
    hardening pass in docs/00-status.md is emphatic about this shape of hole —
    the UI looked right and `curl` said otherwise.

    Every other leak path this has to be applied at is listed in
    docs/04-permissions.md: the job payloads, the activity feed, and the bot.
    """
    return job.client_deadline if leads_pod(viewer, tl_id) else None


# Keys in a `job_updated` payload that only a lead of the job's own pod may
# read. The activity feed is a read path like any other, and a change list
# that says "client deadline 20 Sep -> 22 Sep" hands an editor the date the
# job payload was careful not to send.
LEAD_ONLY_EVENT_KEYS = frozenset({"client_deadline"})


def redact_event_payload(payload: dict, *, lead: bool) -> dict:
    """An event payload as a non-lead may read it.

    A copy, never a mutation: these come straight off ORM objects that stay
    in the session, and editing one in place would write the redaction back
    to the database on the next flush.
    """
    if lead or not (payload.keys() & LEAD_ONLY_EVENT_KEYS):
        return payload
    return {k: v for k, v in payload.items() if k not in LEAD_ONLY_EVENT_KEYS}
