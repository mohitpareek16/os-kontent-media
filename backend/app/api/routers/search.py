from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.search import ChannelHit, JobHit, PersonHit, PodHit, SearchResults
from app.services.search import (
    DEFAULT_LIMIT,
    search_channels,
    search_jobs,
    search_people,
    search_pods,
)

router = APIRouter(prefix="/search", tags=["search"])


@router.get("", response_model=SearchResults)
async def global_search(
    q: str = Query(min_length=1, max_length=120),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """What the header's search box asks: jobs, client pods, channels and
    teammates matching one string, in one round-trip.

    "Everything about this thing" rather than "rows whose name contains this
    string" — typing a client's name answers with that client, its channels,
    the people on it and its videos, not just the one pod row whose text
    happens to match. `services/search.py` explains how a job comes back for a
    word that is nowhere in its own title.

    There is no `require_role` here on purpose, and it is not an unguarded
    route: every one of the four queries is scoped by the same clauses the
    corresponding list endpoint uses, so the answer is a strict subset of what
    this caller can already reach — the extra joins only *find* rows they
    could already list. A role gate would be the wrong tool: a VE may search,
    they just find only their own jobs.

    A whitespace-only query is an empty result, not a 422: it is what the box
    holds for one keystroke while someone clears it, and failing there would
    paint an error over a search nobody has made yet.
    """
    query = q.strip()
    if not query:
        return SearchResults(query=q, jobs=[], pods=[], channels=[], people=[])

    jobs = await search_jobs(db, user, query=query, limit=limit)
    pods = await search_pods(db, user, query=query, limit=limit)
    channels = await search_channels(db, user, query=query, limit=limit)
    people = await search_people(db, user, query=query, limit=limit)

    return SearchResults(
        query=q,
        jobs=[
            JobHit(
                id=job.id,
                code=job.code,
                title=job.title,
                stage=job.stage,
                pod_id=job.pod_id,
                pod_name=pod_name,
                channel_name=channel_name,
                editor_name=editor_name,
                matched_on=matched_on,
                scrapped_at=job.scrapped_at,
            )
            for job, pod_name, channel_name, editor_name, matched_on in jobs
        ],
        pods=[
            PodHit(
                id=pod.id,
                name=pod.name,
                status=pod.status,
                tl_name=tl_name,
                open_jobs=open_jobs,
                channels=channel_count,
            )
            for pod, tl_name, open_jobs, channel_count in pods
        ],
        channels=[
            ChannelHit(
                id=channel.id,
                name=channel.name,
                pod_id=channel.pod_id,
                pod_name=pod_name,
                open_jobs=open_jobs,
                archived=channel.archived_at is not None,
            )
            for channel, pod_name, open_jobs in channels
        ],
        people=[
            PersonHit(
                id=person.id,
                name=person.name,
                email=person.email,
                role=person.role,
                is_active=person.is_active,
                pods=pod_names,
                open_jobs=open_jobs,
            )
            for person, pod_names, open_jobs in people
        ],
    )
