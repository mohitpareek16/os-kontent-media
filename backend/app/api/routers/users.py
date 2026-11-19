import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from app.core.deps import get_current_user, require_role
from app.core.security import hash_password
from app.db.session import get_db
from app.models.role_title import RoleTitle
from app.models.user import ADMIN_ROLES, ALL_PODS_ROLES, LEAD_ROLES, ROLES, User, has_role
from app.models.user_event import UserEvent
from app.models.job import Job
from app.models.pod import Pod
from app.models.pod_member import PodMember
from app.schemas.user import (
    CREATABLE_ROLES,
    AccountStatusEvent,
    AvailabilityUpdate,
    DeactivationRequest,
    EditorCapacityRead,
    CapacityJobRead,
    PasswordResetRequest,
    PodJobCount,
    QcLoadRead,
    RoleTitleRead,
    RoleCount,
    UserCapacity,
    OpenWorkSummary,
    UserCreate,
    UserDirectoryStats,
    UserListResponse,
    UserRead,
    UserUpdate,
    VELoadRead,
)
from app.services.access import not_scrapped, open_job_count
from app.services.routing import (
    PART_TIME_PODCAST_MAX,
    WEIGHT_POINTS,
    Qc2Load,
    _days_idle,
    capacity_for,
    cross_pod_capacity,
    load_breakdown,
    qc2_today,
)
from app.services.whatsapp.phone import normalise as normalise_phone
from app.services.video_types import qc_points_for

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserRead)
async def read_me(user: User = Depends(get_current_user)):
    return user


async def latest_status_changes(
    db: AsyncSession, user_ids: list[uuid.UUID]
) -> dict[uuid.UUID, AccountStatusEvent]:
    """The most recent on/off switch for each of `user_ids`, in one query.

    One query for the page, not one per row: the directory renders twenty-five
    accounts at a time and this is a subtitle under a name, not something
    worth twenty-five round trips. `DISTINCT ON` is the Postgres-native way to
    say "the newest row per person" and matches the index
    `ix_user_events_target_id_created_at` was created for.
    """
    if not user_ids:
        return {}
    actor = aliased(User)
    rows = await db.execute(
        select(UserEvent, actor.name)
        .outerjoin(actor, actor.id == UserEvent.actor_id)
        .where(UserEvent.target_id.in_(user_ids))
        .distinct(UserEvent.target_id)
        .order_by(UserEvent.target_id, UserEvent.created_at.desc())
    )
    return {
        event.target_id: AccountStatusEvent(
            action=event.action,
            actor_name=actor_name,
            reason=event.reason,
            created_at=event.created_at,
        )
        for event, actor_name in rows.all()
    }


async def with_status_change(db: AsyncSession, user: User) -> UserRead:
    """One account, plus who last switched it on or off."""
    read = UserRead.model_validate(user)
    read.last_status_change = (await latest_status_changes(db, [user.id])).get(user.id)
    return read


USER_SORT_FIELDS = {
    "name": User.name,
    "email": User.email,
    "role": User.role,
    "max_concurrent_jobs": User.max_concurrent_jobs,
    "created_at": User.created_at,
}


@router.get("", response_model=UserListResponse)
async def list_users(
    search: str | None = None,
    role: Literal["owner", "tl", "qc", "ve", "hr", "fo", "staff"] | None = None,
    status: Literal["all", "active", "inactive"] = "all",
    include_inactive: bool = True,
    sort_by: Literal["name", "email", "role", "max_concurrent_jobs", "created_at"] = "name",
    sort_dir: Literal["asc", "desc"] = "asc",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role(*LEAD_ROLES, "hr")),
):
    """The account directory: searched, filtered, sorted and paged in SQL.

    HR reads it too — the roster *is* their surface (who works here, in which
    role). Reading it is not the same as administering it: `PATCH /{user_id}`
    and the password reset below stay with the admin tier, so HR onboards an
    account and the Owner is still the only one who can change or switch it
    off (docs/04).

    Deactivated accounts are included by default so the directory can show
    them greyed out rather than pretending they never existed; pass
    `status=active` (or the older `include_inactive=false`) for pickers that
    should only offer people who can still be given work.

    `role_counts` comes back with every page because the role tiles above the
    directory count the whole roster, not the twenty-five rows on screen."""
    clauses: list = []
    if status == "active" or not include_inactive:
        clauses.append(User.is_active.is_(True))
    elif status == "inactive":
        clauses.append(User.is_active.is_(False))
    if role is not None:
        clauses.append(User.role == role)
    if search:
        term = f"%{search.strip()}%"
        clauses.append(or_(User.name.ilike(term), User.email.ilike(term)))

    total = (await db.execute(select(func.count()).select_from(User).where(*clauses))).scalar_one()

    sort_col = USER_SORT_FIELDS[sort_by]
    ordering = sort_col.desc() if sort_dir == "desc" else sort_col.asc()
    rows = await db.execute(
        select(User)
        .where(*clauses)
        # Names and roles tie constantly; without a stable tiebreak the same
        # account can appear on two pages and another on none.
        .order_by(ordering, User.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    page_users = list(rows.scalars().all())
    changes = await latest_status_changes(db, [u.id for u in page_users])
    items = []
    for u in page_users:
        read = UserRead.model_validate(u)
        read.last_status_change = changes.get(u.id)
        items.append(read)

    return UserListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/stats", response_model=UserDirectoryStats)
async def user_stats(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role(*LEAD_ROLES, "hr")),
):
    """Roster totals for the tiles above the directory — per role, and how
    many of each are deactivated. Whole-roster counts by definition, so they
    take no filter params: they are what the filters are being applied *to*.
    Registered before /{user_id} so "stats" isn't parsed as a uuid.

    Keyed off `ROLES` rather than a second hand-written tuple, so adding a
    role to the model can't leave a tile silently missing here."""
    rows = await db.execute(
        select(User.role, User.is_active, func.count()).group_by(User.role, User.is_active)
    )
    counts = {r: {"total": 0, "inactive": 0} for r in ROLES}
    for role_name, is_active, count in rows.all():
        counts[role_name]["total"] += count
        if not is_active:
            counts[role_name]["inactive"] += count

    return UserDirectoryStats(
        active=sum(c["total"] - c["inactive"] for c in counts.values()),
        inactive=sum(c["inactive"] for c in counts.values()),
        by_role={r: RoleCount(**c) for r, c in counts.items()},
    )


@router.patch("/me/availability", response_model=UserRead)
async def set_own_availability(
    payload: AvailabilityUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role(*LEAD_ROLES, "qc")),
):
    """The routing toggle from docs/04's role matrix — 'don't send me new
    QC work today'. There was no endpoint for it at all, so `User.available`
    (which `route_qc2` checks before assigning anyone) could only ever be
    changed with SQL. VEs don't have it: editor assignment is a TL decision,
    not self-service."""
    user.available = payload.available
    await db.commit()
    await db.refresh(user)
    return user


async def _qc_load_row(
    db: AsyncSession, reviewer: User, *, breakdown: Qc2Load, status: str
) -> QcLoadRead:
    """One reviewer's row for both QC-load endpoints.

    Written once because the two endpoints answer the same question for
    different audiences — the team table and a reviewer's own header — and two
    copies of this arithmetic is two chances for the browser to be told
    different things about the same day. Only `status` differs: the team table
    can say who is next in line, and a reviewer looking at their own row cannot
    be ranked against people they aren't allowed to see.

    The breakdown is passed in rather than fetched here: both callers already
    need it to decide the status, and re-reading it would ask the ledger the
    same question twice per reviewer.
    """
    capacity = capacity_for(reviewer)
    points_left = max(0, capacity - breakdown.total)

    cleared_count = (
        await db.execute(
            select(func.count())
            .select_from(Job)
            .where(Job.qc2_reviewer_id == reviewer.id, Job.stage == "delivered")
        )
    ).scalar() or 0

    return QcLoadRead(
        user_id=reviewer.id,
        name=reviewer.name,
        available=reviewer.available,
        employment_type=reviewer.employment_type,
        capacity=capacity,
        points_today=breakdown.points_today,
        points_carried=breakdown.points_carried,
        load=breakdown.total,
        points_left=points_left,
        open_count=breakdown.open_count,
        videos_by_type=breakdown.by_type,
        podcasts_held=breakdown.podcasts,
        # Both rules, together, which is the whole reason this is computed
        # here: a part-timer with twelve free points still cannot take a
        # second podcast.
        can_take_podcast=(
            points_left >= await qc_points_for(db, "podcast")
            and not (
                reviewer.employment_type == "part_time"
                and breakdown.podcasts >= PART_TIME_PODCAST_MAX
            )
        ),
        cleared_count=cleared_count,
        status=status,
    )


@router.get("/me/qc-load", response_model=QcLoadRead)
async def get_own_qc_load(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role("qc")),
):
    """A reviewer's own day, in points.

    `/users/qc-load` is owner/TL-only because it's a cross-person comparison
    (docs/04 — nobody below Owner/TL sees a team table). But a QC not being
    able to see *their own* load against their own budget left them guessing
    about the one number that decides whether new work reaches them. Own
    trend, not a ranking — same principle as a VE's own analytics, which is
    also why `idle_next` never appears here: it is a statement about where
    somebody sits relative to colleagues they cannot see."""
    today = qc2_today()
    load = await load_breakdown(db, user.id, today=today)
    if not user.available:
        qc_status = "unavailable"
    elif load.total == 0:
        qc_status = "idle"
    elif load.total >= capacity_for(user):
        qc_status = "full"
    else:
        qc_status = "loaded"

    return await _qc_load_row(db, user, breakdown=load, status=qc_status)


@router.get("/capacity", response_model=list[UserCapacity])
async def get_cross_pod_capacity(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role(*LEAD_ROLES)),
):
    """For the assignment screen — see docs/05-pipeline-and-routing.md's
    cross-pod capacity section."""
    capacities = await cross_pod_capacity(db)
    return [
        UserCapacity(
            user_id=c["user"].id,
            name=c["user"].name,
            open_count=c["open_count"],
            weighted_load=c["weighted_load"],
            max_concurrent_jobs=c["user"].max_concurrent_jobs,
        )
        for c in capacities
    ]


@router.get("/capacity/open-jobs", response_model=list[CapacityJobRead])
async def get_capacity_open_jobs(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role(*LEAD_ROLES)),
):
    """Assigned videos stay with their editor and QC reviewer until delivery."""
    editor = aliased(User)
    reviewer = aliased(User)
    lead = aliased(User)
    pod_scope = [] if has_role(user, *ALL_PODS_ROLES) else [
        Job.pod_id.in_(select(PodMember.pod_id).where(PodMember.user_id == user.id))
    ]
    rows = await db.execute(
        select(
            Job.id, Job.code, Job.title, Job.stage, Job.video_type, Job.deadline,
            Job.rush, Pod.name.label("pod_name"),
            Job.assigned_editor_id.label("editor_id"), editor.name.label("editor_name"),
            lead.name.label("tl_name"),
            Job.qc2_reviewer_id.label("qc_id"), reviewer.name.label("qc_name"),
        )
        .join(Pod, Pod.id == Job.pod_id)
        .outerjoin(editor, editor.id == Job.assigned_editor_id)
        .outerjoin(lead, lead.id == Pod.tl_id)
        .outerjoin(reviewer, reviewer.id == Job.qc2_reviewer_id)
        .where(
            Job.stage != "delivered", not_scrapped(), *pod_scope,
            or_(Job.assigned_editor_id.is_not(None), Job.qc2_reviewer_id.is_not(None)),
        )
        .order_by(Job.deadline.asc().nulls_last(), Job.created_at.desc())
    )
    return [CapacityJobRead.model_validate(dict(row)) for row in rows.mappings()]


@router.get("/ve-load", response_model=list[VELoadRead])
async def get_ve_load(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role(*LEAD_ROLES)),
):
    """Returns each active VE's job load stats for the assignment wizard —
    assigned (non-delivered) count, completed (delivered) count, weighted
    load, and how many of their concurrent slots are still free.

    `free_slots` is what the wizard's picker is built on: an editor with none
    left is not offered, because the save would be refused anyway
    (`services/access.py::ensure_assignable_editor`) and a name you can pick
    but not use is worse than a name that isn't there."""
    result = await db.execute(select(User).where(User.role == "ve", User.is_active.is_(True)))
    editors = result.scalars().unique().all()

    load_data: list[VELoadRead] = []
    for editor in editors:
        assigned_q = await db.execute(
            select(func.count()).select_from(Job).where(
                Job.assigned_editor_id == editor.id, Job.stage != "delivered", not_scrapped()
            )
        )
        assigned_count = assigned_q.scalar() or 0

        completed_q = await db.execute(
            select(func.count()).select_from(Job).where(
                Job.assigned_editor_id == editor.id, Job.stage == "delivered"
            )
        )
        completed_count = completed_q.scalar() or 0

        weight_q = await db.execute(
            select(Job.weight).where(
                Job.assigned_editor_id == editor.id, Job.stage != "delivered", not_scrapped()
            )
        )
        weighted_load = sum(
            WEIGHT_POINTS.get(w, 2) for w in weight_q.scalars().all()
        )

        load_data.append(
            VELoadRead(
                user_id=editor.id,
                name=editor.name,
                assigned_count=assigned_count,
                completed_count=completed_count,
                weighted_load=weighted_load,
                max_concurrent_jobs=editor.max_concurrent_jobs,
                free_slots=max(0, editor.max_concurrent_jobs - assigned_count),
            )
        )
    return load_data


@router.get("/editor-capacity", response_model=list[EditorCapacityRead])
async def get_editor_capacity(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role(*LEAD_ROLES)),
):
    """Team Capacity page's Editors tab — per-pod open-job chips plus
    delivered/clean stats, built the same way as /ve-load and
    cross_pod_capacity. 'reachable_free' is derived from real fields only
    (User.available and a spare slot under the cap), not a fabricated status.

    Active accounts only. A deactivated editor was still being listed here
    with their old open jobs, which read as leftover capacity on a page whose
    entire job is to say who can take work."""
    result = await db.execute(select(User).where(User.role == "ve", User.is_active.is_(True)))
    editors = result.scalars().unique().all()

    load_data: list[EditorCapacityRead] = []
    for editor in editors:
        open_rows = await db.execute(
            select(Pod.id, Pod.name, func.count(Job.id))
            .join(Pod, Pod.id == Job.pod_id)
            .where(Job.assigned_editor_id == editor.id, Job.stage != "delivered", not_scrapped())
            .group_by(Pod.id, Pod.name)
        )
        open_by_pod = [
            PodJobCount(pod_id=pod_id, pod_name=pod_name, count=count)
            for pod_id, pod_name, count in open_rows.all()
        ]
        open_count = sum(c.count for c in open_by_pod)

        rounds_q = await db.execute(
            select(Job.round).where(Job.assigned_editor_id == editor.id, Job.stage == "delivered")
        )
        rounds = rounds_q.scalars().all()
        delivered_count = len(rounds)
        clean_pct = (sum(1 for r in rounds if r == 0) / delivered_count * 100) if rounds else None

        weight_q = await db.execute(
            select(Job.weight).where(
                Job.assigned_editor_id == editor.id, Job.stage != "delivered", not_scrapped()
            )
        )
        weighted_load = sum(WEIGHT_POINTS.get(w, 2) for w in weight_q.scalars().all())

        load_data.append(
            EditorCapacityRead(
                user_id=editor.id,
                name=editor.name,
                open_by_pod=open_by_pod,
                open_count=open_count,
                delivered_count=delivered_count,
                clean_pct=clean_pct,
                weighted_load=weighted_load,
                max_concurrent_jobs=editor.max_concurrent_jobs,
                free_slots=max(0, editor.max_concurrent_jobs - open_count),
                reachable_free=editor.available and open_count < editor.max_concurrent_jobs,
            )
        )
    return load_data


@router.get("/qc-load", response_model=list[QcLoadRead])
async def get_qc_load(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role(*LEAD_ROLES)),
):
    """Team Capacity page's QC tab — every reviewer's day in points, against
    their own budget (docs/12-qc2-load-model.md).

    Status is derived only from fields that actually exist (User.available,
    the points ledger, idle days) — there is no per-user WhatsApp-reachability
    state yet (see docs/09), so no 'window open' style badge is produced here.

    Active accounts only, same as the Editors tab and for the same reason:
    routing skips deactivated reviewers (`services/routing.py::route_qc2`), so
    showing them here described a queue nobody can be sent to."""
    today = qc2_today()
    result = await db.execute(select(User).where(User.role == "qc", User.is_active.is_(True)))
    reviewers = result.scalars().unique().all()

    loads = {r.id: await load_breakdown(db, r.id, today=today) for r in reviewers}
    idle_days = {
        r.id: await _days_idle(db, r.id) if r.available else 0 for r in reviewers
    }

    # Who the idle tiebreak would reach for next, shown so the tab explains its
    # own ordering rather than looking arbitrary. Only meaningful between
    # people at zero — past that, real load decides and the tiebreak is noise.
    idle_candidates = [r for r in reviewers if r.available and loads[r.id].total == 0]
    next_in_line_id = (
        max(idle_candidates, key=lambda r: idle_days[r.id]).id if idle_candidates else None
    )

    load_data: list[QcLoadRead] = []
    for reviewer in reviewers:
        load = loads[reviewer.id]
        if not reviewer.available:
            qc_status = "unavailable"
        elif load.total == 0:
            qc_status = "idle_next" if reviewer.id == next_in_line_id else "idle"
        elif load.total >= capacity_for(reviewer):
            # Spent out for the day, which is not the same as unavailable and
            # not the same as merely busy: nothing more will route to them
            # until tomorrow, and the tab should say so out loud.
            qc_status = "full"
        else:
            qc_status = "loaded"

        load_data.append(await _qc_load_row(db, reviewer, breakdown=load, status=qc_status))
    return load_data


async def resolve_role_title(db: AsyncSession, payload, *, actor: User, role: str | None):
    """Turn "what shall we call them" into a `RoleTitle` row, creating it the
    first time somebody types it.

    A title and a role are a matched pair and the endpoint refuses them apart:
    a `staff` account must have a title (`staff` alone is not a name for
    anybody), and a built-in role must not (a VE called "Graphic Designer"
    would sit in the editor pickers under a name that says they don't cut).
    Custom role *is* the role — that is what the feature means.

    Matched case-insensitively, so the tenth designer joins "Graphic Designer"
    rather than founding "graphic designer" next to it.
    """
    named = (payload.role_title or "").strip()
    if role is not None and role != "staff":
        if named or payload.role_title_id:
            raise HTTPException(
                status_code=400,
                detail="A job title belongs to a custom role — pick one or the other",
            )
        return None
    if payload.role_title_id:
        title = await db.get(RoleTitle, payload.role_title_id)
        if title is None:
            raise HTTPException(status_code=404, detail="That job title no longer exists")
        return title
    if not named:
        if role == "staff":
            raise HTTPException(
                status_code=400, detail="A custom role needs a title — what is this person called?"
            )
        return None

    found = await db.execute(select(RoleTitle).where(func.lower(RoleTitle.name) == named.lower()))
    title = found.scalar_one_or_none()
    if title is None:
        title = RoleTitle(name=named, created_by_id=actor.id)
        db.add(title)
        await db.flush()
    elif not title.is_active:
        # Somebody is hiring for it again. Re-using the row keeps every
        # account that ever held the title pointing at one thing.
        title.is_active = True
    return title


@router.get("/role-titles", response_model=list[RoleTitleRead])
async def list_role_titles(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role(*CREATABLE_ROLES.keys())),
):
    """The titles the onboarding form offers. Whoever may create an account
    may read this; there is nothing in it but names people chose.

    Registered before `/{user_id}` so "role-titles" is not parsed as a uuid —
    same reason as `/stats` above."""
    rows = await db.execute(
        select(RoleTitle).where(RoleTitle.is_active.is_(True)).order_by(RoleTitle.name)
    )
    return list(rows.scalars().all())


@router.post("", response_model=UserRead, status_code=201)
async def create_user(
    payload: UserCreate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_role(*CREATABLE_ROLES.keys())),
):
    """Onboards an account. This was the sharpest gap in the app — previously
    the only way to create a non-Owner user was a direct DB script. A TL does
    not onboard their own editors — see docs/04-permissions.md. Add the new
    user to a pod separately via POST /pods/{id}/members. Role and password
    length are validated by the schema (docs/07: one password rule, not a
    browser attribute).

    *Which* roles the caller may hand out is `CREATABLE_ROLES` — an Owner
    anything, the Founder's Office everything below the admin tier, HR the
    roles that do the work. Checked here rather than only in the UI, because
    creating an account whose password you set is the same power as logging
    in as it: without this, "create user" is a promotion path around every
    restriction on the caller's own role."""
    allowed = CREATABLE_ROLES.get(actor.role, ())
    if payload.role not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Your role may onboard {', '.join(r.upper() for r in allowed)} accounts — "
                "only an Owner creates accounts with owner-level access"
            ),
        )

    email = str(payload.email).strip().lower()
    existing = await db.execute(select(User.id).where(func.lower(func.trim(User.email)) == email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="Email already registered")

    title = await resolve_role_title(db, payload, actor=actor, role=payload.role)

    new_user = User(
        name=payload.name,
        email=email,
        password_hash=hash_password(payload.password),
        role=payload.role,
        phone=payload.phone,
        # Derived here rather than by a nightly job, so a number is dialable
        # from the moment the account exists. `normalise` returns None for
        # anything it will not guess at, and the WhatsApp Numbers tab lists
        # those as needing a human — see services/whatsapp/phone.py.
        phone_e164=normalise_phone(payload.phone),
        role_title_id=title.id if title else None,
        secondary_role=payload.secondary_role,
        employment_type=payload.employment_type,
    )
    db.add(new_user)
    await commit_user(db)
    await db.refresh(new_user)
    return new_user


async def commit_user(db: AsyncSession) -> None:
    """Handle concurrent writes rejected by the email uniqueness constraint."""
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if "uq_users_email_case_insensitive" in str(exc) or "ix_users_email" in str(exc):
            raise HTTPException(status_code=400, detail="Email already registered") from exc
        raise


def require_can_administer(actor: User, target: User) -> None:
    """Whether `actor` may change `target`'s account at all.

    The Owner may administer anyone. The Founder's Office may administer
    everyone outside the admin tier and nobody inside it — it cannot
    deactivate, demote, rename or reset the password of an Owner, which is
    what "the Founder's Office cannot remove the admin" has to mean if it is
    to mean anything. A peer Founder's Office is covered by the same rule:
    the tier is the Owner's to hand out and the Owner's to take back.

    Note what a password reset is, in a system with no email recovery: the
    ability to log in as that account. Leaving reset-password out of this
    check would have left the whole restriction decorative.
    """
    if actor.role == "owner":
        return
    if target.role in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an Owner can administer an Owner or Founder's Office account",
        )


@router.get("/{user_id}/open-work", response_model=OpenWorkSummary)
async def get_open_work(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role(*ADMIN_ROLES, "hr")),
):
    """How much is still hanging on this account — videos they are cutting,
    reviews they are holding, pods they lead.

    Exists for the confirm dialog, and it is the honest version of that
    dialog: switching somebody off does not move their work, so the number
    that matters at the moment of offboarding is how much will be left with
    nobody. Three integers and no job data — HR reads the roster, not the
    board (docs/04)."""
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    reviewing = await db.execute(
        select(func.count())
        .select_from(Job)
        .where(
            Job.qc2_reviewer_id == user_id,
            Job.stage.in_(("qc2", "revisions")),
            not_scrapped(),
        )
    )
    leading = await db.execute(
        select(func.count()).select_from(Pod).where(Pod.tl_id == user_id)
    )
    return OpenWorkSummary(
        editing=await open_job_count(db, user_id),
        reviewing=reviewing.scalar_one() or 0,
        leading_pods=leading.scalar_one() or 0,
    )


def require_can_switch_off(actor: User, target: User) -> None:
    """Whether `actor` may deactivate or reactivate `target`.

    **You may switch off only the kinds of account you may create.** That is
    `CREATABLE_ROLES` — already the rule for who may onboard an account and
    for who may change its role — and it is the same rule for the same
    reason: deciding who can be in the building is one power, and it has one
    boundary. HR onboards TL/QC/VE/staff, so HR can offboard exactly those,
    and cannot touch an Owner, the Founder's Office, another HR, or itself.

    Reusing the table rather than writing a third list is the point. A fourth
    place to keep this in sync is a fourth place to get it wrong, and the one
    that gets missed is always the one that grants too much.
    """
    allowed = CREATABLE_ROLES.get(actor.role, ())
    if target.role not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Your role may switch off {', '.join(r.upper() for r in allowed) or 'no'} "
                "accounts — only an Owner can deactivate an Owner, the Founder's Office "
                "or another HR"
            ),
        )


async def set_account_active(
    db: AsyncSession, *, target: User, active: bool, actor: User, reason: str | None = None
) -> User:
    """Switch an account on or off, and write down who did it.

    The one implementation. Two routes reach it — the Owner's `PATCH
    /users/{id}` and the `deactivate`/`reactivate` pair HR also holds — and
    they must not be able to drift into meaning different things, because the
    audit row is only worth having if *every* path writes one.

    Deactivation is a flag, never a delete: their id is on every job, event
    and notification they ever touched. It does not unassign their open work
    either, which is deliberate — reassigning a leaver's four in-flight cuts
    is a pipeline decision a TL makes one at a time, not a side effect of an
    HR action. The confirm dialog says so, and says how many.
    """
    if not active and target.id == actor.id:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
    if not active and target.role == "owner":
        # Demoting or switching off the last Owner locks everyone out of user
        # admin, impersonation and cross-pod visibility. Same guard as the
        # role change in `update_user`, for the same reason.
        remaining = await db.execute(
            select(func.count())
            .select_from(User)
            .where(User.role == "owner", User.is_active.is_(True), User.id != target.id)
        )
        if (remaining.scalar_one() or 0) == 0:
            raise HTTPException(
                status_code=400, detail="Cannot deactivate the last active Owner"
            )

    # A no-op writes no row: pressing deactivate twice is one departure, and
    # a log that says otherwise is a log nobody trusts.
    if target.is_active != active:
        target.is_active = active
        db.add(
            UserEvent(
                target_id=target.id,
                actor_id=actor.id,
                action="reactivated" if active else "deactivated",
                reason=(reason or None),
            )
        )
    return target


@router.post("/{user_id}/deactivate", response_model=UserRead)
async def deactivate_user(
    user_id: uuid.UUID,
    payload: DeactivationRequest,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_role(*ADMIN_ROLES, "hr")),
):
    """Offboard somebody: they can no longer log in, QC routing skips them,
    and they drop out of every picker — while every job, event and QC charge
    they ever touched still names them.

    Its own route rather than opening `PATCH /users/{user_id}` to HR. That
    route also changes roles, lends the TL secondary and resets capacity, and
    a role change is account creation by another name (see its docstring). A
    dedicated endpoint hands over one power, and cannot quietly grow into the
    others the next time a field is added to `UserUpdate`."""
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    require_can_switch_off(actor, target)
    await set_account_active(db, target=target, active=False, actor=actor, reason=payload.reason)
    await db.commit()
    await db.refresh(target)
    return await with_status_change(db, target)


@router.post("/{user_id}/reactivate", response_model=UserRead)
async def reactivate_user(
    user_id: uuid.UUID,
    payload: DeactivationRequest,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_role(*ADMIN_ROLES, "hr")),
):
    """Somebody came back, or the wrong row was clicked. Same authority as
    switching the account off: whoever may close a door may open it again,
    and splitting the two would mean an HR mistake needed an Owner to undo."""
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    require_can_switch_off(actor, target)
    await set_account_active(db, target=target, active=True, actor=actor, reason=payload.reason)
    await db.commit()
    await db.refresh(target)
    return await with_status_change(db, target)


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_role(*ADMIN_ROLES, "hr")),
):
    """Account admin: rename, change role, set weekly capacity, or deactivate
    someone who has left. There was no update route of any kind before — a
    wrong role or a departed teammate could only be fixed with SQL.

    Deactivation is a flag, never a delete: their id is referenced by every
    job, event and notification they ever touched."""
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if actor.role == "hr":
        if payload.model_fields_set - {"name", "email", "phone"}:
            raise HTTPException(status_code=403, detail="HR may only edit name, email and phone here")
    else:
        require_can_administer(actor, target)

    if payload.name is not None:
        payload.name = payload.name.strip()
        if not payload.name:
            raise HTTPException(status_code=422, detail="Name cannot be blank")
    if payload.email is not None:
        email = str(payload.email).strip().lower()
        existing = await db.execute(
            select(User.id).where(func.lower(func.trim(User.email)) == email, User.id != target.id)
        )
        if existing.scalar_one_or_none() is not None:
            raise HTTPException(status_code=400, detail="Email already registered")
        target.email = email


    if payload.role is not None and payload.role != target.role:
        # A role change is account creation by another name — it hands out
        # exactly the access the new role carries — so it is bounded by the
        # same table, and a Founder's Office cannot promote anyone into the
        # admin tier it isn't allowed to create.
        if payload.role not in CREATABLE_ROLES.get(actor.role, ()):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only an Owner can grant owner-level access",
            )
        # An Owner demoting the last Owner would lock everyone out of user
        # admin, impersonation and cross-pod visibility.
        if target.role == "owner":
            remaining = await db.execute(
                select(func.count())
                .select_from(User)
                .where(User.role == "owner", User.is_active.is_(True), User.id != target.id)
            )
            if (remaining.scalar_one() or 0) == 0:
                raise HTTPException(status_code=400, detail="Cannot demote the last active Owner")
        target.role = payload.role

    # A title follows the role it belongs to: switching somebody onto a
    # built-in role drops the custom name with it, and onto `staff` requires
    # one. Resolved against the role the account will *have* after this
    # request, not the one it had when it arrived.
    if payload.role_title or payload.role_title_id or payload.role is not None:
        title = await resolve_role_title(db, payload, actor=actor, role=target.role)
        if title is not None or target.role != "staff":
            target.role_title_id = title.id if title else None
    elif payload.clear_role_title:
        target.role_title_id = None

    # Lending and taking back the TL role. Explicitly separate from `role`:
    # this is the one that hands somebody pods they did not have, and it
    # should read that way in the audit trail and on the form.
    if payload.secondary_role is not None:
        target.secondary_role = payload.secondary_role
    elif payload.clear_secondary_role:
        target.secondary_role = None

    for field in (
        "name",
        "phone",
        "max_concurrent_jobs",
        "employment_type",
        "available",
    ):
        value = getattr(payload, field)
        if value is not None:
            setattr(target, field, value)

    # The dialable form follows the typed one. Kept next to the assignment
    # rather than in a service hook because there are exactly two places a
    # phone number is written, and both are in this file: a column that can
    # drift from its own source is a message sent to an old number.
    if payload.phone is not None:
        target.phone_e164 = normalise_phone(payload.phone)

    # Not set inline with the rest: switching an account off is the one change
    # here that gets asked about later, so it goes through the same helper the
    # HR route uses and leaves the same `user_events` row behind. Two routes,
    # one meaning.
    if payload.is_active is not None:
        await set_account_active(db, target=target, active=payload.is_active, actor=actor)

    await commit_user(db)
    await db.refresh(target)
    return await with_status_change(db, target)


@router.post("/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    user_id: uuid.UUID,
    payload: PasswordResetRequest,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_role(*ADMIN_ROLES, "hr")),
):
    """For a user who's locked out and has no session to call
    POST /auth/change-password with. The admin sets a new password and relays
    it out-of-band, same trust model as account creation itself. (Users who
    can receive email can also self-serve via POST /auth/forgot-password.)

    The Owner may reset anyone. HR may reset only the kinds of account it may
    create (`CREATABLE_ROLES`: TL/QC/VE/staff) — the same boundary as
    switching an account off, for the same reason: a reset is a session as
    that account, so HR must not be able to reach an Owner, the Founder's
    Office or another HR through it."""
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if actor.role != "owner":
        allowed = CREATABLE_ROLES.get(actor.role, ())
        if target.role not in allowed or target.id == actor.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Your role may reset passwords for {', '.join(r.upper() for r in allowed)} "
                    "accounts only — ask an Owner for anyone else"
                ),
            )
    target.password_hash = hash_password(payload.new_password)
    await db.commit()
