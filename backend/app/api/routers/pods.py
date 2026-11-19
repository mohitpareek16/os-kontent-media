import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import (
    check_pod_lead,
    get_current_user,
    require_pod_lead,
    require_pod_member,
    require_role,
)
from app.db.session import get_db
from app.models.channel import Channel
from app.models.job import Job
from app.models.pod import Pod
from app.models.pod_member import PodMember
from app.models.user import ADMIN_ROLES, LEAD_ROLES, User, has_role
from app.schemas.channel import ChannelCreate, ChannelRead, ChannelUpdate
from app.schemas.pod import (
    PodCreate,
    PodListResponse,
    PodMemberCreate,
    PodMemberRead,
    PodRead,
    PodStatusCounts,
    PodUpdate,
)
from app.services.access import not_scrapped, pod_scope_clauses

router = APIRouter(prefix="/pods", tags=["pods"])


async def _require_lead_account(db: AsyncSession, tl_id: uuid.UUID) -> User:
    """A pod's TL must actually hold the TL role — their own, or one lent to
    them (`effective_roles`) — or be the Owner.

    Nothing checked this, so a pod could be created with a VE as its
    `tl_id` — and since `check_pod_lead` only compares that field, the VE
    then held full pod-lead powers: members, checklist, analytics, every
    stage transition. It is still the same check; it just now recognises the
    editor who was *given* the TL role for their own client pods, which is
    the entire point of a secondary role. See docs/04-permissions.md.
    """
    lead = await db.get(User, tl_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="TL account not found")
    if not has_role(lead, "tl", *ADMIN_ROLES):
        raise HTTPException(
            status_code=400,
            detail="A pod's TL must hold the Team Lead role — as their own or as a secondary",
        )
    if not lead.is_active:
        raise HTTPException(status_code=400, detail="That account is deactivated")
    return lead


@router.get("", response_model=PodListResponse)
async def list_pods(
    search: str | None = None,
    status: Literal["all", "active", "paused", "churned"] = "all",
    sort_by: Literal["name", "status", "created_at"] = "name",
    sort_dir: Literal["asc", "desc"] = "asc",
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Owner sees every pod. Everyone else sees only pods they're a member
    of — see docs/04-permissions.md. The rule itself lives in
    `services/access.py::pod_scope_clauses`, shared with the chatbot's
    entity lookup, so there is one answer to "which pods can this person
    name" rather than one per caller.

    Search, status filter and paging are applied in SQL, and the status tab
    counts come back with the page so the tabs count the same scoped set the
    cards below them are drawn from."""
    scope = pod_scope_clauses(user)

    clauses = list(scope)
    if status != "all":
        clauses.append(Pod.status == status)
    if search:
        clauses.append(Pod.name.ilike(f"%{search.strip()}%"))

    # The tabs count the searched set but ignore the status filter — a tab
    # that showed 0 for every status except the selected one would be
    # useless for deciding which tab to click next.
    count_clauses = list(scope)
    if search:
        count_clauses.append(Pod.name.ilike(f"%{search.strip()}%"))
    count_rows = await db.execute(
        select(Pod.status, func.count()).where(*count_clauses).group_by(Pod.status)
    )
    by_status = {"active": 0, "paused": 0, "churned": 0}
    for pod_status, count in count_rows.all():
        by_status[pod_status] = count

    total = (await db.execute(select(func.count()).select_from(Pod).where(*clauses))).scalar_one()

    sort_col = {"name": Pod.name, "status": Pod.status, "created_at": Pod.created_at}[sort_by]
    ordering = sort_col.desc() if sort_dir == "desc" else sort_col.asc()
    result = await db.execute(
        select(Pod).where(*clauses).order_by(ordering, Pod.id).offset((page - 1) * page_size).limit(page_size)
    )

    return PodListResponse(
        items=[PodRead.model_validate(p) for p in result.scalars().unique().all()],
        total=total,
        page=page,
        page_size=page_size,
        counts=PodStatusCounts(all=sum(by_status.values()), **by_status),
    )


@router.get("/channels", response_model=list[ChannelRead])
async def list_all_channels(
    include_archived: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Every channel this person can see, across all their clients.

    Declared above `/{pod_id}` on purpose: the two paths are the same shape,
    and FastAPI matches in declaration order — below it, `/pods/channels`
    would be read as a pod id and answer 422.

    The pipeline table is the reason this exists. With one client selected the
    per-pod list is the right question, but the table's resting state is *All
    Clients*, and there the channel filter simply vanished — the one screen
    where "show me everything for Dhan HQ" is worth asking was the one screen
    that could not ask it. Each row carries its `pod_name` so a picker holding
    two clients' "Shorts" can say which is which.

    Scoped with `pod_scope_clauses`, the same rule as `GET /pods`: the Owner
    sees every client's channels, everyone else sees the ones belonging to pods
    they are in. Ordered by client then channel, which is how the filter groups
    them.
    """
    clauses = list(pod_scope_clauses(user))
    if not include_archived:
        clauses.append(Channel.archived_at.is_(None))

    # Keyed by channel id, so counting every pod at once is one query rather
    # than one per client — the ids that come back are only read for the
    # channels this person is allowed to see.
    counts = dict(
        (
            await db.execute(
                select(Job.channel_id, func.count(Job.id))
                .where(Job.channel_id.is_not(None), not_scrapped())
                .group_by(Job.channel_id)
            )
        ).all()
    )
    rows = (
        await db.execute(
            select(Channel, Pod.name)
            .join(Pod, Pod.id == Channel.pod_id)
            .where(*clauses)
            .order_by(Pod.name, Channel.name)
        )
    ).all()
    return [
        ChannelRead(
            id=channel.id,
            pod_id=channel.pod_id,
            name=channel.name,
            pod_name=pod_name,
            archived_at=channel.archived_at,
            job_count=counts.get(channel.id, 0),
        )
        for channel, pod_name in rows
    ]


@router.post("", response_model=PodRead, status_code=201)
async def create_pod(
    payload: PodCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role(*LEAD_ROLES)),
):
    await _require_lead_account(db, payload.tl_id)
    pod = Pod(**payload.model_dump(), onboarded_by=user.id)
    db.add(pod)
    await db.flush()
    db.add(PodMember(pod_id=pod.id, user_id=pod.tl_id, pod_role="tl"))
    await db.commit()
    await db.refresh(pod)
    return pod


@router.patch("/{pod_id}", response_model=PodRead)
async def update_pod(
    pod_id: uuid.UUID,
    payload: PodUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Rename a client, pause or churn them, adjust the retainer, or hand
    the pod to a different TL.

    None of this was possible before: `Pod.status` had no way in at all, so
    the active/paused/churned enum was decorative and a churned client stayed
    'Active' forever. Handing over the TL is Owner-only — it's a
    responsibility change, not a pod setting (docs/04)."""
    pod = await db.get(Pod, pod_id)
    if pod is None:
        raise HTTPException(status_code=404, detail="Pod not found")
    await check_pod_lead(db, pod_id, user)

    if payload.tl_id is not None and payload.tl_id != pod.tl_id:
        if not has_role(user, *ADMIN_ROLES):
            raise HTTPException(status_code=403, detail="Only an Owner can reassign a pod's TL")
        await _require_lead_account(db, payload.tl_id)
        pod.tl_id = payload.tl_id
        # The new TL has to be in the pod for every membership-scoped read
        # to work for them.
        existing = await db.get(PodMember, {"pod_id": pod_id, "user_id": payload.tl_id})
        if existing is None:
            db.add(PodMember(pod_id=pod_id, user_id=payload.tl_id, pod_role="tl"))

    for field in ("name", "status", "billing_currency", "retainer_volume"):
        value = getattr(payload, field)
        if value is not None:
            setattr(pod, field, value)

    await db.commit()
    await db.refresh(pod)
    return pod


@router.get("/{pod_id}/members", response_model=list[PodMemberRead])
async def list_pod_members(
    pod_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_pod_member),
):
    result = await db.execute(
        select(PodMember, User)
        .join(User, User.id == PodMember.user_id)
        .where(PodMember.pod_id == pod_id)
    )
    return [
        PodMemberRead(
            user_id=user.id,
            name=user.name,
            email=user.email,
            role=user.role,
            pod_role=member.pod_role,
            certified_at=member.certified_at,
        )
        for member, user in result.all()
    ]


@router.post("/{pod_id}/members", status_code=201)
async def add_pod_member(
    pod_id: uuid.UUID,
    payload: PodMemberCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_pod_lead),
):
    member_user = await db.get(User, payload.user_id)
    if member_user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if not member_user.is_active:
        raise HTTPException(status_code=400, detail="That account is deactivated")
    # A member has to hold the role they are being added as. `pod_role` is
    # tl/qc/ve and it is load-bearing: a member carrying one turns up in
    # editor pickers, in QC routing and in the certification history as
    # somebody who cuts or reviews video. Adding a Graphic Designer as a "ve"
    # to get them into a pod would quietly put them in the assignment queue.
    #
    # This replaces a flat "HR accounts are not pod members" refusal. HR is
    # now a pod member like anyone else *when it holds the role* — an HR with
    # a TL secondary onboards their own clients and leads those pods — and an
    # HR without one is refused here for the same reason a designer is, which
    # is the honest reason rather than the role's name.
    if not has_role(member_user, payload.pod_role):
        raise HTTPException(
            status_code=400,
            detail=f"That account does not hold the {payload.pod_role.upper()} role",
        )
    existing = await db.get(PodMember, {"pod_id": pod_id, "user_id": payload.user_id})
    if existing is not None:
        raise HTTPException(status_code=400, detail="Already a member of this pod")

    db.add(PodMember(pod_id=pod_id, user_id=payload.user_id, pod_role=payload.pod_role))
    await db.commit()
    return {"ok": True}


@router.delete("/{pod_id}/members/{user_id}", status_code=204)
async def remove_pod_member(
    pod_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_pod_lead),
):
    pod = await db.get(Pod, pod_id)
    if pod is not None and pod.tl_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot remove the pod's TL — reassign Pod.tl_id first")
    member = await db.get(PodMember, {"pod_id": pod_id, "user_id": user_id})
    if member is None:
        raise HTTPException(status_code=404, detail="Not a member of this pod")

    # Removing someone doesn't take their work away — job visibility for an
    # editor is by assignment, not membership — so they'd keep seeing and
    # acting on jobs in a pod they're no longer part of. Reassign first.
    open_jobs = await db.execute(
        select(func.count())
        .select_from(Job)
        .where(
            Job.pod_id == pod_id,
            Job.assigned_editor_id == user_id,
            Job.stage != "delivered",
            # A scrapped job is not work they have to hand over, so it must
            # not block them leaving the pod either.
            not_scrapped(),
        )
    )
    open_count = open_jobs.scalar_one() or 0
    if open_count:
        raise HTTPException(
            status_code=400,
            detail=(
                f"They still have {open_count} open job(s) in this pod — reassign those first, "
                "otherwise the jobs stay on their plate after they leave the pod"
            ),
        )

    await db.delete(member)
    await db.commit()


@router.get("/{pod_id}/channels", response_model=list[ChannelRead])
async def list_channels(
    pod_id: uuid.UUID,
    include_archived: bool = False,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_pod_member),
):
    """The client's channels — Dhan HQ, AAD, lwdhan — with how many live jobs
    sit under each.

    `require_pod_member`, not `require_pod_lead`: an editor sees the channel
    on their own job and filters their board by it, and a list they cannot
    read would leave the filter permanently empty for them. Creating and
    renaming is the lead's, below.

    Archived channels are left out by default. They still name the jobs
    already filed under them — that is the point of archiving rather than
    deleting — but they have no business in a picker."""
    clauses = [Channel.pod_id == pod_id]
    if not include_archived:
        clauses.append(Channel.archived_at.is_(None))

    counts = dict(
        (
            await db.execute(
                select(Job.channel_id, func.count(Job.id))
                .where(Job.pod_id == pod_id, Job.channel_id.is_not(None), not_scrapped())
                .group_by(Job.channel_id)
            )
        ).all()
    )
    result = await db.execute(select(Channel).where(*clauses).order_by(Channel.name))
    return [
        ChannelRead(
            id=channel.id,
            pod_id=channel.pod_id,
            name=channel.name,
            archived_at=channel.archived_at,
            job_count=counts.get(channel.id, 0),
        )
        for channel in result.scalars().unique().all()
    ]


@router.post("/{pod_id}/channels", response_model=ChannelRead, status_code=201)
async def create_channel(
    pod_id: uuid.UUID,
    payload: ChannelCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_pod_lead),
):
    pod = await db.get(Pod, pod_id)
    if pod is None:
        raise HTTPException(status_code=404, detail="Pod not found")

    name = payload.name.strip()
    # Checked here as well as by the unique index, so the answer is a sentence
    # rather than a 500 off a constraint violation — and case-insensitively,
    # because "Dhan HQ" and "dhan hq" are one channel typed twice.
    existing = await db.execute(
        select(Channel).where(Channel.pod_id == pod_id, func.lower(Channel.name) == name.lower())
    )
    duplicate = existing.scalars().first()
    if duplicate is not None:
        if duplicate.archived_at is None:
            raise HTTPException(
                status_code=400, detail=f"This client already has a channel called {duplicate.name}"
            )
        # Re-adding a retired name is how a channel comes back, and it has to
        # be the same row: a second one would split the history of the work
        # already filed under the first.
        duplicate.archived_at = None
        duplicate.name = name
        await db.commit()
        await db.refresh(duplicate)
        return ChannelRead.model_validate(duplicate)

    channel = Channel(pod_id=pod_id, name=name, created_by=user.id)
    db.add(channel)
    await db.commit()
    await db.refresh(channel)
    return ChannelRead.model_validate(channel)


@router.patch("/{pod_id}/channels/{channel_id}", response_model=ChannelRead)
async def update_channel(
    pod_id: uuid.UUID,
    channel_id: uuid.UUID,
    payload: ChannelUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_pod_lead),
):
    """Rename a channel, or retire one.

    There is no DELETE. A channel that named real work has to go on naming it
    — dropping the row would either orphan those jobs or silently re-file them
    as "no channel", and the second is worse because it looks like data."""
    channel = await db.get(Channel, channel_id)
    if channel is None or channel.pod_id != pod_id:
        raise HTTPException(status_code=404, detail="Channel not found on this client")

    if payload.name is not None:
        name = payload.name.strip()
        clash = await db.execute(
            select(Channel).where(
                Channel.pod_id == pod_id,
                Channel.id != channel_id,
                func.lower(Channel.name) == name.lower(),
            )
        )
        if clash.scalars().first() is not None:
            raise HTTPException(
                status_code=400, detail=f"This client already has a channel called {name}"
            )
        channel.name = name

    if payload.archived is not None:
        channel.archived_at = datetime.now(timezone.utc) if payload.archived else None

    await db.commit()
    await db.refresh(channel)
    return ChannelRead.model_validate(channel)
