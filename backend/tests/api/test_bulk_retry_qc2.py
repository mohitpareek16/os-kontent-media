"""Bulk QC2 retry only fills missing reviewers and keeps the charge ledger honest."""

import pytest
from sqlalchemy import select

from app.models.job_event import JobEvent
from app.models.notification import Notification
from app.models.qc2_charge import Qc2Charge
from app.services.routing import qc2_today
from tests.factories import auth, make_charge, make_job, reload

pytestmark = pytest.mark.integration


async def retry(client, actor, *jobs):
    return await client.post(
        "/api/jobs/bulk-retry-qc2",
        json={"job_ids": [str(job.id) for job in jobs]},
        headers=auth(actor),
    )


async def test_retry_assigns_only_missing_qc2_reviewers_and_is_idempotent(client, db, world):
    missing = await make_job(db, pod=world.pod, created_by=world.tl, stage="qc2")
    assigned = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2", reviewer=world.qc
    )
    await db.commit()

    response = await retry(client, world.tl, missing, assigned)
    assert response.status_code == 200
    assert response.json() == {"assigned": 1, "no_capacity": 0, "skipped": 1}
    assert (await reload(db, missing)).qc2_reviewer_id == world.qc.id

    second = await retry(client, world.tl, missing, assigned)
    assert second.json() == {"assigned": 0, "no_capacity": 0, "skipped": 2}
    charges = (await db.execute(select(Qc2Charge).where(Qc2Charge.job_id == missing.id))).scalars().all()
    events = (await db.execute(select(JobEvent).where(JobEvent.job_id == missing.id))).scalars().all()
    notifications = (
        await db.execute(select(Notification).where(Notification.event_id == events[0].id))
    ).scalars().all()
    assert len(charges) == len(events) == len(notifications) == 1
    assert events[0].event_type == "qc2_assigned_v1"
    assert notifications[0].user_id == world.qc.id


async def test_retry_respects_capacity_and_leaves_waiting_jobs_unassigned(client, db, world):
    world.other_qc.available = False
    for _ in range(7):
        held = await make_job(db, pod=world.pod, created_by=world.tl, stage="qc2", reviewer=world.qc)
        await make_charge(db, job=held, reviewer=world.qc, work_date=qc2_today())
    first = await make_job(db, pod=world.pod, created_by=world.tl, stage="qc2")
    second = await make_job(db, pod=world.pod, created_by=world.tl, stage="qc2")
    await db.commit()

    response = await retry(client, world.tl, first, second)
    assert response.status_code == 200
    assert response.json() == {"assigned": 1, "no_capacity": 1, "skipped": 0}
    refreshed = [await reload(db, job) for job in (first, second)]
    assert sum(job.qc2_reviewer_id is None for job in refreshed) == 1


async def test_retry_rejects_cross_pod_selection_without_changing_any_job(client, db, world):
    own = await make_job(db, pod=world.pod, created_by=world.tl, stage="qc2")
    foreign = await make_job(db, pod=world.other_pod, created_by=world.other_tl, stage="qc2")
    await db.commit()

    response = await retry(client, world.tl, own, foreign)
    assert response.status_code == 403
    assert (await reload(db, own)).qc2_reviewer_id is None
    assert (await reload(db, foreign)).qc2_reviewer_id is None


async def test_retry_skips_other_stages_and_scrapped_jobs(client, db, world):
    editing = await make_job(db, pod=world.pod, created_by=world.tl, stage="editing")
    scrapped = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2", scrapped_by=world.tl
    )
    await db.commit()

    response = await retry(client, world.tl, editing, scrapped)
    assert response.status_code == 200
    assert response.json() == {"assigned": 0, "no_capacity": 0, "skipped": 2}
