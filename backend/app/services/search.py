"""One text search over everything people look for by name: a job, a client
pod, one of that client's channels, or a teammate.

The queries live here rather than in the router because there are two callers
with the same question — the header's global search box (`GET /search`) and
the chatbot's `resolve_entity` tool — and "which pods can this person name"
must have exactly one answer. Two hand-rolled copies of an ilike + scope
clause is how the bot ends up able to name a client the UI insists doesn't
exist.

**Jobs match on more than their own text.** Typing a client's name used to
find the pod and nothing else — none of that client's videos, unless the word
happened to be in the title too. That is not how anybody searches: "dhan"
means *everything to do with Dhan*, and an editor's name means the work on
their plate. So a job also matches on the names of the things attached to it —
its pod, its channel, its editor, its TL, its QC2 reviewer — and each hit
carries the reason it matched, because a result whose text does not contain
what you typed is otherwise indistinguishable from a bug.

Visibility is the same rule every list endpoint already applies, composed
from `services/access.py`: pods and channels via `pod_scope_clauses` (same as
`GET /pods`), jobs via `job_scope_clauses` (same as `GET /jobs`), people via
membership of the pods you can see (same as `GET /pods/{id}/members`). Nothing
here widens what a role can reach, so search cannot be used to enumerate the
company — including through the new joins, which only *find* rows the caller
could already list.
"""
from __future__ import annotations

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.channel import Channel
from app.models.job import Job
from app.models.pod import Pod
from app.models.pod_member import PodMember
from app.models.user import User
from app.services.access import job_scope_clauses, pod_scope_clauses

#: How many matches of each kind a caller gets unless it asks for fewer. This
#: is a "did you mean this one" list, not a browsable result set — anything
#: longer is what the pipeline table's own filters are for.
DEFAULT_LIMIT = 8

#: Stages that mean the job is still somebody's problem. Used for the counts
#: that ride along with a pod or a person, which are only worth reading if
#: they describe live work — "Ravi has 47 jobs" counts three years of history
#: and answers nothing.
OPEN_STAGES = ("intake", "assigned", "editing", "qc1", "qc2", "revisions", "final")


def like_term(query: str) -> str:
    r"""`%term%`, with the wildcards the *user* typed defused.

    `%` and `_` are LIKE wildcards, so an unescaped `%` matches everything and
    `_` matches any character — a search for `KM_` would quietly return jobs
    that have nothing to do with it, and a lone `%` would return the caller's
    entire visible world sorted by chance. Callers must pass `escape="\\"` to
    `ilike`, which every function in this module does.
    """
    escaped = query.strip().replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")
    return f"%{escaped}%"


async def search_jobs(
    db: AsyncSession, user: User, *, query: str, limit: int = DEFAULT_LIMIT
) -> list[tuple[Job, str, str | None, str | None, str]]:
    """Jobs matching `query`, as `(job, pod_name, channel_name, editor_name,
    matched_on)`.

    A job matches on its own code or title, and on the name of anything
    attached to it: the client pod, the channel it is filed under, the editor
    cutting it, the pod TL, the QC2 reviewer. `matched_on` says which — one of
    `job`, `pod`, `channel`, `editor`, `tl`, `reviewer` — so the row can
    explain itself. Without it, searching "dhan" and getting a video called
    "HDFC Podcast" reads as a broken search rather than as a Dhan job.

    Ordering: an exact code match first — typing a full job code is the one
    search where the user already knows the answer and only wants to be taken
    there — then a match on the job's own text ahead of one that came in
    through a relation, then newest. A title hit is what people expect at the
    top when both exist.

    Scrapped jobs are included on purpose — unlike every queue and count in
    the product, "what happened to that project we killed" is a question you
    can only ask by name. The hit carries `scrapped_at` so the UI can say so.
    """
    term = like_term(query)
    editor = aliased(User, name="editor")
    tl = aliased(User, name="tl")
    reviewer = aliased(User, name="reviewer")

    own_text = or_(Job.code.ilike(term, escape="\\"), Job.title.ilike(term, escape="\\"))

    # The order of these decides `matched_on` when more than one is true, so
    # they run most-specific first: a job whose *title* says Dhan is a job
    # match, not a pod match, even though both are true.
    reasons = (
        ("job", own_text),
        ("pod", Pod.name.ilike(term, escape="\\")),
        ("channel", Channel.name.ilike(term, escape="\\")),
        ("editor", editor.name.ilike(term, escape="\\")),
        ("tl", tl.name.ilike(term, escape="\\")),
        ("reviewer", reviewer.name.ilike(term, escape="\\")),
    )
    # A CASE rather than six queries UNIONed: one round-trip, one ordering,
    # and the reason falls out of the same evaluation that decided the row was
    # a match at all.
    matched_on = case(*[(clause, label) for label, clause in reasons], else_="job")

    result = await db.execute(
        select(Job, Pod.name, Channel.name, editor.name, matched_on)
        .join(Pod, Pod.id == Job.pod_id)
        .outerjoin(Channel, Channel.id == Job.channel_id)
        .outerjoin(editor, editor.id == Job.assigned_editor_id)
        .outerjoin(tl, tl.id == Pod.tl_id)
        .outerjoin(reviewer, reviewer.id == Job.qc2_reviewer_id)
        .where(*job_scope_clauses(user), or_(*[clause for _, clause in reasons]))
        .order_by(
            Job.code.ilike(query.strip(), escape="\\").desc(),
            own_text.desc(),
            Job.created_at.desc(),
        )
        .limit(limit)
    )
    return list(result.all())


async def search_pods(
    db: AsyncSession, user: User, *, query: str, limit: int = DEFAULT_LIMIT
) -> list[tuple[Pod, str | None, int, int]]:
    """Client pods whose name contains `query`, as `(pod, tl_name, open_jobs,
    channels)`.

    The two counts ride along because the row is otherwise just the name you
    already typed. "Dhan — Ravi Prakash Swami · 15 open · 3 channels" answers
    the question behind the search; "Dhan" restates it.
    """
    term = like_term(query)
    tl = aliased(User, name="pod_tl")

    open_jobs = (
        select(func.count())
        .select_from(Job)
        .where(
            Job.pod_id == Pod.id,
            Job.stage.in_(OPEN_STAGES),
            Job.scrapped_at.is_(None),
            *job_scope_clauses(user),
        )
        .scalar_subquery()
    )
    channel_count = (
        select(func.count())
        .select_from(Channel)
        .where(Channel.pod_id == Pod.id, Channel.archived_at.is_(None))
        .scalar_subquery()
    )

    result = await db.execute(
        select(Pod, tl.name, open_jobs, channel_count)
        .outerjoin(tl, tl.id == Pod.tl_id)
        .where(*pod_scope_clauses(user), Pod.name.ilike(term, escape="\\"))
        .order_by(Pod.name)
        .limit(limit)
    )
    return list(result.all())


async def search_channels(
    db: AsyncSession, user: User, *, query: str, limit: int = DEFAULT_LIMIT
) -> list[tuple[Channel, str, int]]:
    """Channels whose name — or whose client's name — contains `query`, as
    `(channel, pod_name, open_jobs)`.

    Matching on the pod name too is what makes "dhan" answer with Dhan's
    channels rather than only with channels that happen to have "dhan" in
    their own name. A channel is where the work actually goes, so this is
    usually the row somebody wanted.

    Archived channels are included and labelled. They still name the work that
    went to them, which is exactly what you are looking for when you search an
    old one (`models/channel.py`).
    """
    term = like_term(query)

    open_jobs = (
        select(func.count())
        .select_from(Job)
        .where(
            Job.channel_id == Channel.id,
            Job.stage.in_(OPEN_STAGES),
            Job.scrapped_at.is_(None),
            *job_scope_clauses(user),
        )
        .scalar_subquery()
    )

    result = await db.execute(
        select(Channel, Pod.name, open_jobs)
        .join(Pod, Pod.id == Channel.pod_id)
        .where(
            *pod_scope_clauses(user),
            or_(Channel.name.ilike(term, escape="\\"), Pod.name.ilike(term, escape="\\")),
        )
        # Live channels first, then by client, then by name: an archived row
        # is a footnote to a search, not the answer to one.
        .order_by(Channel.archived_at.is_not(None), Pod.name, Channel.name)
        .limit(limit)
    )
    return list(result.all())


def visible_pod_ids(user: User):
    """Subquery: the pods this caller can see. Used to scope people, who are
    visible through a shared pod rather than through a roster read — `GET
    /users` is admin-only, and search must not become a way around it."""
    return select(Pod.id).where(*pod_scope_clauses(user))


async def search_people(
    db: AsyncSession, user: User, *, query: str, limit: int = DEFAULT_LIMIT
) -> list[tuple[User, list[str], int]]:
    """Teammates matching `query`, as `(person, pod_names, open_jobs)`.

    Restricted to people who share a pod with the caller (the company-wide
    tier shares every pod, so it reaches everyone who is in one).

    The two extras are what makes the row worth landing on: which clients this
    person works on, and how much live work has their name on it right now.
    "Ravi Meena — Dhan, Upsurge · 6 open" is the answer to typing an editor's
    name; the name and email alone are not.

    `open_jobs` counts anything not finished that they are the editor or the
    QC2 reviewer of, scoped to what the *searcher* may see — so it can never
    reveal the size of a queue in a pod they have no access to.

    Deactivated accounts stay in the results. They are exactly who you search
    for when reading old work — "who edited this, and are they still here" —
    and the hit carries `is_active` so the UI can mark them rather than
    pretend they never existed.
    """
    term = like_term(query)
    pods = visible_pod_ids(user)

    open_jobs = (
        select(func.count())
        .select_from(Job)
        .where(
            or_(Job.assigned_editor_id == User.id, Job.qc2_reviewer_id == User.id),
            Job.stage.in_(OPEN_STAGES),
            Job.scrapped_at.is_(None),
            *job_scope_clauses(user),
        )
        .scalar_subquery()
    )
    # Aggregated in SQL rather than a second query per person: a dropdown of
    # eight people should not be nine round-trips.
    # NULL when the person is in none of the caller's pods, which the caller
    # normalises to an empty list — `array_agg` over no rows is NULL, not {}.
    pod_names = (
        select(func.array_agg(func.distinct(Pod.name)))
        .select_from(PodMember)
        .join(Pod, Pod.id == PodMember.pod_id)
        .where(PodMember.user_id == User.id, Pod.id.in_(pods))
        .scalar_subquery()
    )

    result = await db.execute(
        select(User, pod_names, open_jobs)
        .where(
            or_(User.name.ilike(term, escape="\\"), User.email.ilike(term, escape="\\")),
            select(PodMember.user_id)
            .where(PodMember.user_id == User.id, PodMember.pod_id.in_(pods))
            .exists(),
        )
        # Active people first — a search for a name almost always means the
        # person who is still here.
        .order_by(User.is_active.desc(), User.name)
        .limit(limit)
    )
    return [(person, list(names or []), count) for person, names, count in result.all()]


