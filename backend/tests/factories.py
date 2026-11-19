"""Row builders. Tests construct every user/pod/job they need — nothing here
reads or depends on seeded data."""
from __future__ import annotations

import itertools
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, hash_password
from app.models.brand_asset import BrandAsset
from app.models.job import Job
from app.models.pod import Pod
from app.models.pod_member import PodMember
from app.models.qc2_charge import Qc2Charge
from app.models.user import User
from app.services.video_types import qc_points_for

# bcrypt costs ~300ms a call; every fixture user shares one password so the
# hash is computed once for the whole run.
PASSWORD = "testpass123"
_password_hash: str | None = None

_counter = itertools.count(1)

# Far enough out that no test is accidentally about an overdue job. Tests that
# care about the date pass their own; tests about a job with *no* date pass
# None explicitly, because that is now a state with its own rule
# (`stage_machine.is_briefed`) rather than just an empty column.
DEFAULT_DEADLINE = date(2099, 1, 1)


def password_hash() -> str:
    global _password_hash
    if _password_hash is None:
        _password_hash = hash_password(PASSWORD)
    return _password_hash


@dataclass
class World:
    owner: User
    tl: User
    other_tl: User
    ve: User
    ve2: User
    other_ve: User
    qc: User
    other_qc: User
    pod: Pod
    other_pod: Pod


async def make_user(
    db: AsyncSession,
    *,
    role: str,
    name: str | None = None,
    email: str | None = None,
    available: bool = True,
    is_active: bool = True,
    max_concurrent_jobs: int = 5,
    # A full working day unless a test says otherwise — the QC2 points budget
    # is derived from this (routing.CAPACITY), and most tests are not about
    # part-timers.
    employment_type: str = "full_time",
    password: str | None = None,
    # Powers lent on top of `role` — today only "tl", which makes this person
    # a real Team Lead on the pods whose `Pod.tl_id` is them.
    secondary_role: str | None = None,
) -> User:
    n = next(_counter)
    user = User(
        name=name or f"{role.upper()} {n}",
        email=email or f"{role}{n}@example.com",
        password_hash=hash_password(password) if password else password_hash(),
        role=role,
        secondary_role=secondary_role,
        available=available,
        is_active=is_active,
        max_concurrent_jobs=max_concurrent_jobs,
        employment_type=employment_type,
    )
    db.add(user)
    await db.flush()
    return user


async def make_pod(
    db: AsyncSession,
    *,
    tl: User,
    name: str | None = None,
    status: str = "active",
    onboarded_by: User | None = None,
) -> Pod:
    pod = Pod(
        name=name or f"Pod {next(_counter)}",
        tl_id=tl.id,
        status=status,
        onboarded_by=(onboarded_by or tl).id,
    )
    db.add(pod)
    await db.flush()
    return pod


async def add_member(db: AsyncSession, pod: Pod, user: User, pod_role: str) -> PodMember:
    member = PodMember(pod_id=pod.id, user_id=user.id, pod_role=pod_role)
    db.add(member)
    await db.flush()
    return member


async def make_job(
    db: AsyncSession,
    *,
    pod: Pod,
    created_by: User,
    title: str | None = None,
    stage: str = "intake",
    video_type: str = "long_form",
    weight: str = "standard",
    rush: bool = False,
    editor: User | None = None,
    reviewer: User | None = None,
    round: int = 0,
    # A briefed job by default — an editor cannot be handed a job with no date
    # on it (`stage_machine.is_briefed`), so an un-dated one is a special case
    # and every test that wants it says `deadline=None` out loud.
    deadline: date | None = DEFAULT_DEADLINE,
    delivered_at: datetime | None = None,
    client_sheet_ok: bool = False,
    ops_tracker_ok: bool = False,
    updated_at: datetime | None = None,
    code: str | None = None,
    scrapped_by: User | None = None,
    scrap_reason: str | None = None,
    scrapped_at: datetime | None = None,
) -> Job:
    n = next(_counter)
    job = Job(
        code=code or f"KM-T{n}-{uuid.uuid4().hex[:6]}",
        title=title or f"Job {n}",
        pod_id=pod.id,
        stage=stage,
        video_type=video_type,
        weight=weight,
        rush=rush,
        assigned_editor_id=editor.id if editor else None,
        qc2_reviewer_id=reviewer.id if reviewer else None,
        round=round,
        deadline=deadline,
        # A delivered job must carry a delivery date — the database enforces
        # it (migration 0009), because counting deliveries by stage and by
        # date only agree when every delivered row has one. Defaulted here so
        # a test that just wants "a delivered job" gets a valid one; pass an
        # explicit value when the date itself is what's under test.
        delivered_at=delivered_at
        or (datetime.now(timezone.utc) if stage == "delivered" else None),
        client_sheet_ok=client_sheet_ok,
        ops_tracker_ok=ops_tracker_ok,
        created_by=created_by.id,
        # The three scrap columns move together or the check constraint
        # rejects the row (migration 0012), so passing `scrapped_by` alone is
        # enough to get a valid scrapped job.
        scrapped_at=scrapped_at or (datetime.now(timezone.utc) if scrapped_by else None),
        scrapped_by_id=scrapped_by.id if scrapped_by else None,
        scrap_reason=(scrap_reason or "Client cancelled the campaign") if scrapped_by else None,
    )
    if updated_at is not None:
        # Explicit value wins over the column's server_default; the row must
        # not be UPDATEd afterwards or onupdate=now() overwrites it.
        job.updated_at = updated_at
    db.add(job)
    await db.flush()
    return job


async def make_charge(
    db: AsyncSession,
    *,
    job: Job,
    reviewer: User,
    work_date: date,
    points: int | None = None,
    released_at: datetime | None = None,
) -> Qc2Charge:
    """A row in the QC2 ledger, written directly.

    Tests about the *load model* want to say "this reviewer spent 6 points on
    Monday and closed it" without walking a job through four stage moves to
    get there. Tests about the *routing* still go through
    `services/routing.py::charge`, which is the only thing production calls.

    `points` defaults to the first-review price for the job's type, which is
    what a charge normally costs; a test about the halving passes its own.
    """
    charge = Qc2Charge(
        job_id=job.id,
        reviewer_id=reviewer.id,
        work_date=work_date,
        points=await qc_points_for(db, job.video_type) if points is None else points,
        video_type=job.video_type,
        round=job.round,
        released_at=released_at,
    )
    db.add(charge)
    await db.flush()
    return charge


async def make_brand_asset(
    db: AsyncSession,
    *,
    pod: Pod,
    uploaded_by: User,
    type: str = "do_not",
    title: str = "Do-not list",
    file_path: str = "missing/file.txt",
    version: int = 1,
) -> BrandAsset:
    asset = BrandAsset(
        pod_id=pod.id,
        type=type,
        title=title,
        file_path=file_path,
        version=version,
        uploaded_by=uploaded_by.id,
    )
    db.add(asset)
    await db.flush()
    return asset


def auth(user: User) -> dict[str, str]:
    """Authorization header for a user, minted the same way /auth/login does."""
    token = create_access_token(subject=str(user.id), role=user.role)
    return {"Authorization": f"Bearer {token}"}


async def reload(db: AsyncSession, obj):
    """Re-read a row the request just changed under us.

    A plain refresh is enough: Postgres reads READ COMMITTED, so this SELECT
    sees whatever the app's own session committed. (Rolling the fixture
    session back instead would expire *every* object it holds, and the next
    attribute access would try to lazy-load from a sync context.)
    """
    await db.refresh(obj)
    return obj
