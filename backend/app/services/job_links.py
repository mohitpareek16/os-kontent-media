"""Links on a job — the raw material in, the cuts out.

`jobs.frame_link` used to be both, one column, 500 characters. It could hold
the client's Drive folder or the editor's Frame.io review link but never both,
so whichever was written last was the one everyone saw, and the editor's
"paste your link" box opened pre-filled with the client's folder.

`frame_link` survives as a **pointer to the latest video link**, maintained
here. It is what the row icon, the job panel and the bot's
`has_working_file_link` all read, and rewriting every one of those to run a
subquery per row would be a lot of churn to say the same thing. Nothing
outside this module writes it.
"""
from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job
from app.models.job_link import JobLink
from app.models.user import LEAD_ROLES, User, has_role

MAX_LINKS_PER_KIND = 25


async def links_for(db: AsyncSession, *, job_id: uuid.UUID, kind: str | None = None):
    """Oldest first: the order they were added is the order they make sense
    in — first cut, then round two — and it is stable, which a URL sort is
    not."""
    clauses = [JobLink.job_id == job_id]
    if kind is not None:
        clauses.append(JobLink.kind == kind)
    result = await db.execute(
        select(JobLink).where(*clauses).order_by(JobLink.created_at, JobLink.id)
    )
    return list(result.scalars().unique().all())


async def may_add(db: AsyncSession, *, job: Job, user: User, kind: str) -> bool:
    """Who may put which kind of link on a job.

    Raw material is the TL's: they are the one the client sends it to, and a
    raw folder appearing from anywhere else is how a job ends up pointing at
    the wrong shoot. The cut is the editor's, for the same reason in reverse —
    it is theirs to hand over, and nobody else knows which export is the one.

    The Owner tier passes both, as it does everywhere.
    """
    if has_role(user, *LEAD_ROLES) and await _leads(db, job=job, user=user):
        return kind == "raw"
    if kind == "video" and job.assigned_editor_id == user.id:
        return True
    return False


async def _leads(db: AsyncSession, *, job: Job, user: User) -> bool:
    from app.models.user import ALL_PODS_ROLES
    from app.models.pod import Pod

    if has_role(user, *ALL_PODS_ROLES):
        return True
    pod = await db.get(Pod, job.pod_id)
    return pod is not None and pod.tl_id == user.id


async def may_remove(db: AsyncSession, *, job: Job, user: User, link: JobLink) -> bool:
    """Whoever put it there, or the pod's lead. A wrong link is usually
    spotted by the person who pasted it, and always fixable by the TL."""
    if link.added_by_id == user.id:
        return True
    return has_role(user, *LEAD_ROLES) and await _leads(db, job=job, user=user)


async def add_link(
    db: AsyncSession, *, job: Job, kind: str, url: str, title: str | None, actor: User
) -> JobLink:
    """Add one link, and keep `frame_link` pointing at the newest cut.

    Re-adding a URL that is already on the job of the same kind returns the
    row that is already there rather than a second one: an editor re-submitting
    the same Frame.io link on round 3 is not three links, and the list is read
    by people, not deduped by them.
    """
    url = url.strip()
    if not url:
        raise HTTPException(status_code=422, detail="A link needs a URL")

    existing = await links_for(db, job_id=job.id, kind=kind)
    for link in existing:
        if link.url == url:
            if title and not link.title:
                link.title = title
            await _point_frame_link_at_latest(db, job=job)
            return link

    if len(existing) >= MAX_LINKS_PER_KIND:
        raise HTTPException(
            status_code=400,
            detail=f"This job already has {MAX_LINKS_PER_KIND} {kind} links — remove one first",
        )

    link = JobLink(
        job_id=job.id,
        kind=kind,
        url=url,
        title=(title or "").strip() or None,
        added_by_id=actor.id,
    )
    db.add(link)
    await db.flush()
    await _point_frame_link_at_latest(db, job=job)
    return link


async def remove_link(db: AsyncSession, *, job: Job, link: JobLink) -> None:
    await db.delete(link)
    await db.flush()
    await _point_frame_link_at_latest(db, job=job)


async def _point_frame_link_at_latest(db: AsyncSession, *, job: Job) -> None:
    """`frame_link` is the newest cut, or nothing when there isn't one.

    Not the newest link of *any* kind: a TL adding a B-roll folder would
    otherwise silently replace what QC opens to review.
    """
    videos = await links_for(db, job_id=job.id, kind="video")
    job.frame_link = videos[-1].url if videos else None


async def record_editor_cut(db: AsyncSession, *, job: Job, url: str, actor: User) -> JobLink:
    """The link an editor types into "Mark as edited — send for QC".

    Goes through the same list as everything else rather than straight onto
    the column, so the round-two cut does not overwrite the round-one one and
    QC can still see what they reviewed last time. Titled by round, because
    that is the only thing distinguishing two exports of the same video.
    """
    title = "First cut" if job.round == 0 else f"Round {job.round} cut"
    return await add_link(db, job=job, kind="video", url=url, title=title, actor=actor)

