"""services/access.py — "may this person see this job at all", and "is this
person a legal editor for it".

The single-row predicate (`can_read_job`) and the list-query clauses
(`job_scope_clauses`) are supposed to be the same rule; the reason the bug
existed at all is that they weren't. Both are asserted here against the same
fixture so they can never drift apart again.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.job import Job
from app.models.pod_member import PodMember
from app.services.access import (
    can_read_job,
    ensure_assignable_editor,
    ensure_assignable_reviewer,
    is_pod_member,
    job_scope_clauses,
    require_job_read,
)
from app.services.routing import daily_load, qc2_today
from app.services.video_types import qc_points_for
from tests.factories import add_member, make_job, make_pod, make_user

pytestmark = pytest.mark.unit


async def _visible_ids(db, user):
    rows = await db.execute(select(Job.id).where(*job_scope_clauses(user)))
    return set(rows.scalars().all())


@pytest.fixture
async def scene(db):
    """One pod with the full cast, plus a second pod nobody in the first
    belongs to. Jobs cover every case the scoping rule distinguishes."""
    owner = await make_user(db, role="owner")
    tl = await make_user(db, role="tl")
    ve = await make_user(db, role="ve")
    other_ve = await make_user(db, role="ve")
    qc = await make_user(db, role="qc")
    outsider_tl = await make_user(db, role="tl")

    pod = await make_pod(db, tl=tl, onboarded_by=owner)
    other_pod = await make_pod(db, tl=outsider_tl, name="Other", onboarded_by=owner)
    for user, pod_role in ((tl, "tl"), (ve, "ve"), (other_ve, "ve"), (qc, "qc")):
        await add_member(db, pod, user, pod_role)
    await add_member(db, other_pod, outsider_tl, "tl")

    jobs = {
        "ve_job": await make_job(db, pod=pod, created_by=tl, stage="editing", editor=ve),
        "other_ve_job": await make_job(db, pod=pod, created_by=tl, stage="editing", editor=other_ve),
        "routed_to_qc": await make_job(db, pod=pod, created_by=tl, stage="qc2", reviewer=qc),
        "unrouted_qc2": await make_job(db, pod=pod, created_by=tl, stage="qc2"),
        "unrouted_qc1": await make_job(db, pod=pod, created_by=tl, stage="qc1"),
        "foreign": await make_job(db, pod=other_pod, created_by=outsider_tl, stage="qc2"),
    }
    await db.commit()
    return {
        "owner": owner, "tl": tl, "ve": ve, "other_ve": other_ve, "qc": qc,
        "outsider_tl": outsider_tl, "pod": pod, "other_pod": other_pod, "jobs": jobs,
    }


async def test_owner_reads_everything(db, scene):
    for job in scene["jobs"].values():
        assert await can_read_job(db, job=job, user=scene["owner"]) is True
    assert await _visible_ids(db, scene["owner"]) == {j.id for j in scene["jobs"].values()}


async def test_ve_reads_only_their_own_assigned_jobs(db, scene):
    jobs, ve = scene["jobs"], scene["ve"]
    assert await can_read_job(db, job=jobs["ve_job"], user=ve) is True
    for key in ("other_ve_job", "routed_to_qc", "unrouted_qc2", "unrouted_qc1", "foreign"):
        assert await can_read_job(db, job=jobs[key], user=ve) is False
    assert await _visible_ids(db, ve) == {jobs["ve_job"].id}


async def test_tl_reads_every_job_in_pods_they_belong_to(db, scene):
    jobs, tl = scene["jobs"], scene["tl"]
    for key in ("ve_job", "other_ve_job", "routed_to_qc", "unrouted_qc2", "unrouted_qc1"):
        assert await can_read_job(db, job=jobs[key], user=tl) is True
    assert await _visible_ids(db, tl) == {
        jobs[k].id for k in ("ve_job", "other_ve_job", "routed_to_qc", "unrouted_qc2", "unrouted_qc1")
    }


async def test_tl_cannot_read_a_job_in_a_pod_they_are_not_in(db, scene):
    """The regression: GET /jobs/{id} only checked the VE case, so any TL
    could read any job in the company by id."""
    assert await can_read_job(db, job=scene["jobs"]["foreign"], user=scene["tl"]) is False
    assert scene["jobs"]["foreign"].id not in await _visible_ids(db, scene["tl"])


async def test_qc_reads_jobs_routed_to_them_plus_unrouted_qc2_in_their_pods(db, scene):
    jobs, qc = scene["jobs"], scene["qc"]
    assert await can_read_job(db, job=jobs["routed_to_qc"], user=qc) is True
    assert await can_read_job(db, job=jobs["unrouted_qc2"], user=qc) is True
    assert await _visible_ids(db, qc) == {jobs["routed_to_qc"].id, jobs["unrouted_qc2"].id}


async def test_qc_cannot_read_the_rest_of_their_pods_backlog(db, scene):
    """docs/04: QC sees 'in-queue only', not the whole pod."""
    jobs, qc = scene["jobs"], scene["qc"]
    for key in ("ve_job", "other_ve_job", "unrouted_qc1", "foreign"):
        assert await can_read_job(db, job=jobs[key], user=qc) is False


async def test_qc_cannot_read_an_unrouted_qc2_job_in_a_pod_they_are_not_in(db, scene):
    assert await can_read_job(db, job=scene["jobs"]["foreign"], user=scene["qc"]) is False


async def test_qc_keeps_reading_their_job_after_it_leaves_qc2(db, scene):
    """Stickiness needs it: the reviewer still owns the job while the editor
    is in revisions."""
    job = scene["jobs"]["routed_to_qc"]
    job.stage = "revisions"
    await db.commit()
    assert await can_read_job(db, job=job, user=scene["qc"]) is True


async def test_require_job_read_raises_403(db, scene):
    with pytest.raises(HTTPException) as exc:
        await require_job_read(db, job=scene["jobs"]["foreign"], user=scene["ve"])
    assert exc.value.status_code == 403


async def test_is_pod_member(db, scene):
    assert await is_pod_member(db, pod_id=scene["pod"].id, user_id=scene["ve"].id) is True
    assert await is_pod_member(db, pod_id=scene["other_pod"].id, user_id=scene["ve"].id) is False


# --------------------------------------------------------------------------
# ensure_assignable_editor  (brief item 6)
# --------------------------------------------------------------------------


async def test_assignable_editor_accepts_an_active_ve_in_the_pod(db, scene):
    await ensure_assignable_editor(db, pod_id=scene["pod"].id, editor_id=scene["ve"].id)


async def test_a_qc_account_cannot_be_a_jobs_editor(db, scene):
    with pytest.raises(HTTPException) as exc:
        await ensure_assignable_editor(db, pod_id=scene["pod"].id, editor_id=scene["qc"].id)
    assert exc.value.status_code == 400
    assert "VE account" in exc.value.detail


async def test_a_tl_account_cannot_be_a_jobs_editor(db, scene):
    with pytest.raises(HTTPException) as exc:
        await ensure_assignable_editor(db, pod_id=scene["pod"].id, editor_id=scene["tl"].id)
    assert exc.value.status_code == 400


async def test_an_editor_from_outside_the_pod_is_joined_to_it(db, scene):
    """The membership check grants instead of refusing (docs/05): the row is
    written as a consequence of the assignment, uncertified."""
    await ensure_assignable_editor(db, pod_id=scene["other_pod"].id, editor_id=scene["ve"].id)
    member = await db.get(PodMember, {"pod_id": scene["other_pod"].id, "user_id": scene["ve"].id})
    assert member is not None
    assert member.pod_role == "ve"
    assert member.certified_at is None


async def test_an_existing_membership_is_left_alone(db, scene):
    """A TL who also cuts video is in the pod as `tl` — being handed a job
    must not rewrite that to `ve`, or overwrite a certification date."""
    member = await db.get(PodMember, {"pod_id": scene["pod"].id, "user_id": scene["ve"].id})
    member.certified_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    await db.commit()

    await ensure_assignable_editor(db, pod_id=scene["pod"].id, editor_id=scene["ve"].id)
    await db.refresh(member)
    assert member.certified_at == datetime(2026, 1, 1, tzinfo=timezone.utc)


async def test_a_reviewer_from_outside_the_pod_is_joined_to_it(db, scene):
    job = await make_job(
        db, pod=scene["other_pod"], created_by=scene["tl"], stage="qc2", video_type="podcast"
    )
    await ensure_assignable_reviewer(db, job=job, reviewer_id=scene["qc"].id)
    member = await db.get(PodMember, {"pod_id": scene["other_pod"].id, "user_id": scene["qc"].id})
    assert member is not None
    assert member.pod_role == "qc"


async def test_a_hand_picked_reviewer_is_billed_for_the_round(db, scene):
    """The lead is overriding the *budget*, not hiding from it. An unbilled
    reviewer is invisible to every load query, so the router would go on
    treating them as free and stack the next three jobs on them — the override
    would spread instead of costing the one job it was meant to."""
    job = await make_job(
        db, pod=scene["pod"], created_by=scene["tl"], stage="qc2", video_type="podcast"
    )
    await ensure_assignable_reviewer(db, job=job, reviewer_id=scene["qc"].id)
    await db.commit()

    assert await daily_load(db, scene["qc"].id, today=qc2_today()) == await qc_points_for(db, "podcast")


async def test_a_reviewer_must_be_an_active_qc_account(db, scene):
    job = await make_job(db, pod=scene["pod"], created_by=scene["tl"], stage="qc2")
    for candidate in (scene["ve"], scene["tl"]):
        with pytest.raises(HTTPException) as exc:
            await ensure_assignable_reviewer(db, job=job, reviewer_id=candidate.id)
        assert exc.value.status_code == 400
        assert "QC account" in exc.value.detail

    scene["qc"].is_active = False
    await db.commit()
    with pytest.raises(HTTPException):
        await ensure_assignable_reviewer(db, job=job, reviewer_id=scene["qc"].id)


async def test_a_deactivated_editor_cannot_be_assigned(db, scene):
    scene["ve"].is_active = False
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await ensure_assignable_editor(db, pod_id=scene["pod"].id, editor_id=scene["ve"].id)
    assert exc.value.status_code == 400
    assert "deactivated" in exc.value.detail


async def test_an_unknown_editor_id_is_rejected(db, scene):
    import uuid

    with pytest.raises(HTTPException) as exc:
        await ensure_assignable_editor(db, pod_id=scene["pod"].id, editor_id=uuid.uuid4())
    assert exc.value.status_code == 400


# --------------------------------------------------------------------------
# The concurrent-work cap: how many videos one editor may hold at once
# --------------------------------------------------------------------------


async def _fill(db, scene, count: int, *, stage: str = "editing"):
    """Put `count` more open jobs on the scene's editor."""
    for _ in range(count):
        await make_job(
            db, pod=scene["pod"], created_by=scene["tl"], stage=stage, editor=scene["ve"]
        )
    await db.commit()


async def test_an_editor_at_their_cap_takes_no_more_work(db, scene):
    scene["ve"].max_concurrent_jobs = 3
    await _fill(db, scene, 2)  # plus the one the fixture already gave them
    with pytest.raises(HTTPException) as exc:
        await ensure_assignable_editor(db, pod_id=scene["pod"].id, editor_id=scene["ve"].id)
    assert exc.value.status_code == 400
    assert "limit is 3" in exc.value.detail


async def test_the_cap_counts_jobs_the_editor_is_no_longer_touching(db, scene):
    """A cut sitting at QC2 can come back as a revision, so it has not left
    the editor's plate — delivery is the only moment that has."""
    scene["ve"].max_concurrent_jobs = 3
    await _fill(db, scene, 2, stage="qc2")
    with pytest.raises(HTTPException):
        await ensure_assignable_editor(db, pod_id=scene["pod"].id, editor_id=scene["ve"].id)


async def test_delivered_and_scrapped_jobs_free_a_slot(db, scene):
    """Delivery is what frees a slot; a cancelled project is nobody's load at
    all, the same rule every capacity view already counts by."""
    scene["ve"].max_concurrent_jobs = 2
    now = datetime.now(timezone.utc)
    for _ in range(3):
        await make_job(
            db,
            pod=scene["pod"],
            created_by=scene["tl"],
            stage="delivered",
            editor=scene["ve"],
            delivered_at=now,
        )
    for _ in range(3):
        await make_job(
            db,
            pod=scene["pod"],
            created_by=scene["tl"],
            stage="editing",
            editor=scene["ve"],
            scrapped_by=scene["tl"],
            scrapped_at=now,
            scrap_reason="client cancelled the series",
        )
    await db.commit()
    # Only the fixture's one open job counts, so a slot is still free.
    await ensure_assignable_editor(db, pod_id=scene["pod"].id, editor_id=scene["ve"].id)


async def test_rows_already_lined_up_in_the_same_batch_count(db, scene):
    """Twenty pasted jobs pointed at one editor are twenty against the cap,
    not twenty separate 'they have room' answers to an uncommitted question."""
    scene["ve"].max_concurrent_jobs = 3
    await db.commit()
    # One open job from the fixture, so two slots are left.
    await ensure_assignable_editor(
        db, pod_id=scene["pod"].id, editor_id=scene["ve"].id, pending=1
    )
    with pytest.raises(HTTPException) as exc:
        await ensure_assignable_editor(
            db, pod_id=scene["pod"].id, editor_id=scene["ve"].id, pending=2
        )
    assert exc.value.status_code == 400


async def test_a_cap_of_zero_takes_nothing(db, scene):
    """Not the same as deactivating someone — they keep what they hold and
    are simply given nothing new."""
    scene["ve"].max_concurrent_jobs = 0
    await db.commit()
    with pytest.raises(HTTPException):
        await ensure_assignable_editor(db, pod_id=scene["pod"].id, editor_id=scene["ve"].id)
