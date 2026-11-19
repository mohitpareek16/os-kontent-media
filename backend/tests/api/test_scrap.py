"""Scrapping a project, through the real HTTP path.

Two things are being defended. First, who may cancel a client commitment —
the pod's TL and the company-wide tier, nobody else, enforced server-side and
not by hiding a button (docs/04). Second, that a scrapped job actually leaves
the numbers: the failure mode that matters is a cancelled project still
counted as in flight, still overdue, and still filling an editor's capacity.
"""
from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models.job_event import JobEvent
from app.models.notification import Notification
from app.services.routing import charge, daily_load, qc2_today
from tests.factories import auth, make_job, make_user, reload

pytestmark = pytest.mark.integration

REASON = "Client cancelled the campaign after the brief was signed off"


async def scrap(client, job_id, user, reason=REASON):
    return await client.post(
        f"/api/jobs/{job_id}/scrap", json={"reason": reason}, headers=auth(user)
    )


async def stats(client, user):
    response = await client.get("/api/jobs/stats", headers=auth(user))
    assert response.status_code == 200
    return response.json()


@pytest.fixture
async def job(db, world):
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="editing", editor=world.ve
    )
    await db.commit()
    return job


# --------------------------------------------------------------------------
# Who may scrap
# --------------------------------------------------------------------------


async def test_pod_tl_may_scrap(client, db, world, job):
    response = await scrap(client, job.id, world.tl)
    assert response.status_code == 200
    body = response.json()
    assert body["scrapped_at"] is not None
    assert body["scrap_reason"] == REASON
    assert body["scrapped_by_name"] == world.tl.name
    # The stage it died at is kept — "we dropped this at editing" is the fact
    # worth having later, and a `scrapped` stage would have erased it.
    assert body["stage"] == "editing"


async def test_the_owner_may_scrap_in_any_pod(client, db, world):
    """Company-wide reach is the Owner's alone now — see docs/04."""
    for actor in (world.owner,):
        target = await make_job(db, pod=world.pod, created_by=world.tl, stage="qc1")
        await db.commit()
        assert (await scrap(client, target.id, actor)).status_code == 200


async def test_a_tl_from_another_pod_may_not(client, world, job):
    assert (await scrap(client, job.id, world.other_tl)).status_code == 403


@pytest.mark.parametrize("actor_name", ["ve", "qc"])
async def test_editors_and_reviewers_may_not(client, db, world, job, actor_name):
    """The UI never offers them the control; this is the half that matters."""
    actor = getattr(world, actor_name)
    assert (await scrap(client, job.id, actor)).status_code == 403
    assert (await reload(db, job)).scrapped_at is None


# --------------------------------------------------------------------------
# What a scrap requires and refuses
# --------------------------------------------------------------------------


@pytest.mark.parametrize("reason", ["", "no", "   "])
async def test_a_real_reason_is_required(client, db, world, job, reason):
    response = await scrap(client, job.id, world.tl, reason=reason)
    assert response.status_code == 422
    assert (await reload(db, job)).scrapped_at is None


async def test_a_delivered_job_cannot_be_scrapped(client, db, world):
    delivered = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="delivered", editor=world.ve
    )
    await db.commit()

    response = await scrap(client, delivered.id, world.tl)
    assert response.status_code == 400
    assert "delivered" in response.json()["detail"]


async def test_scrapping_twice_is_refused(client, world, job):
    assert (await scrap(client, job.id, world.tl)).status_code == 200
    assert (await scrap(client, job.id, world.tl)).status_code == 400


async def test_no_stage_move_is_accepted_once_scrapped(client, db, world, job):
    await scrap(client, job.id, world.tl)
    response = await client.post(
        f"/api/jobs/{job.id}/advance", json={"stage": "qc1"}, headers=auth(world.ve)
    )
    assert response.status_code == 400
    assert "Restore" in response.json()["detail"]
    assert (await reload(db, job)).stage == "editing"


async def test_the_job_may_still_be_edited_only_after_restore(client, db, world, job):
    await scrap(client, job.id, world.tl)
    blocked = await client.patch(
        f"/api/jobs/{job.id}", json={"title": "New title"}, headers=auth(world.tl)
    )
    assert blocked.status_code == 400

    restored = await client.post(
        f"/api/jobs/{job.id}/restore", json={}, headers=auth(world.tl)
    )
    assert restored.status_code == 200

    allowed = await client.patch(
        f"/api/jobs/{job.id}", json={"title": "New title"}, headers=auth(world.tl)
    )
    assert allowed.status_code == 200


# --------------------------------------------------------------------------
# What a scrap leaves behind
# --------------------------------------------------------------------------


async def test_the_reason_is_on_the_event_log_with_who_and_when(client, db, world, job):
    await scrap(client, job.id, world.tl)
    rows = await db.execute(
        select(JobEvent).where(JobEvent.job_id == job.id, JobEvent.event_type == "job_scrapped")
    )
    event = rows.scalar_one()
    assert event.actor_id == world.tl.id
    assert event.payload["reason"] == REASON
    assert event.payload["stage"] == "editing"
    assert event.created_at is not None


async def test_everyone_holding_a_piece_of_it_is_told(client, db, world):
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2", editor=world.ve, reviewer=world.qc
    )
    await db.commit()

    await scrap(client, job.id, world.tl)
    rows = await db.execute(
        select(Notification.user_id)
        .join(JobEvent, JobEvent.id == Notification.event_id)
        .where(JobEvent.job_id == job.id, JobEvent.event_type == "job_scrapped")
    )
    told = set(rows.scalars().all())
    assert told == {world.ve.id, world.qc.id}  # not the TL, who did it


# --------------------------------------------------------------------------
# What a scrap stops counting towards
# --------------------------------------------------------------------------


async def test_it_leaves_active_and_stays_in_all(client, world, job):
    before = await stats(client, world.tl)
    await scrap(client, job.id, world.tl)
    after = await stats(client, world.tl)

    assert after["active"] == before["active"] - 1
    assert after["scrapped"] == before["scrapped"] + 1
    # ALL means all — a row that vanishes from every tab is a row people
    # conclude the system lost.
    assert after["all"] == before["all"]


async def test_it_leaves_overdue(client, db, world):
    from datetime import date, timedelta

    late = await make_job(
        db,
        pod=world.pod,
        created_by=world.tl,
        stage="editing",
        editor=world.ve,
        deadline=date.today() - timedelta(days=3),
    )
    await db.commit()

    assert (await stats(client, world.tl))["overdue"] >= 1
    before = (await stats(client, world.tl))["overdue"]
    await scrap(client, late.id, world.tl)
    assert (await stats(client, world.tl))["overdue"] == before - 1


async def test_it_leaves_the_editor_s_capacity(client, db, world, job):
    async def open_count():
        response = await client.get("/api/users/ve-load", headers=auth(world.tl))
        assert response.status_code == 200
        row = next(r for r in response.json() if r["user_id"] == str(world.ve.id))
        return row["assigned_count"]

    before = await open_count()
    await scrap(client, job.id, world.tl)
    assert await open_count() == before - 1


async def test_the_scrapped_tab_lists_it_and_the_active_one_does_not(client, world, job):
    await scrap(client, job.id, world.tl)

    scrapped = await client.get("/api/jobs?status=scrapped", headers=auth(world.tl))
    assert str(job.id) in {row["id"] for row in scrapped.json()["items"]}

    active = await client.get("/api/jobs?status=active", headers=auth(world.tl))
    assert str(job.id) not in {row["id"] for row in active.json()["items"]}


# --------------------------------------------------------------------------
# Restore
# --------------------------------------------------------------------------


async def test_restore_brings_it_back_where_it_died(client, db, world):
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2", editor=world.ve, round=2
    )
    await db.commit()

    await scrap(client, job.id, world.tl)
    response = await client.post(f"/api/jobs/{job.id}/restore", json={}, headers=auth(world.tl))
    assert response.status_code == 200

    body = response.json()
    assert body["scrapped_at"] is None and body["scrap_reason"] is None
    # Rounds and stage intact: restoring to intake would throw away the
    # history that explains where the work actually stands.
    assert body["stage"] == "qc2" and body["round"] == 2

    rows = await db.execute(
        select(JobEvent.event_type).where(JobEvent.job_id == job.id).order_by(JobEvent.created_at)
    )
    assert ["job_scrapped", "job_restored"] == [
        t for t in rows.scalars().all() if t.startswith("job_")
    ]


async def test_restoring_a_live_job_is_refused(client, world, job):
    response = await client.post(f"/api/jobs/{job.id}/restore", json={}, headers=auth(world.tl))
    assert response.status_code == 400


@pytest.mark.parametrize("actor_name", ["ve", "qc", "other_tl"])
async def test_only_a_lead_may_restore(client, world, job, actor_name):
    await scrap(client, job.id, world.tl)
    actor = getattr(world, actor_name)
    response = await client.post(f"/api/jobs/{job.id}/restore", json={}, headers=auth(actor))
    assert response.status_code == 403


# --------------------------------------------------------------------------
# The QC2 points ledger (docs/12-qc2-load-model.md)
# --------------------------------------------------------------------------


async def test_scrapping_releases_the_reviewers_open_round(client, db, world):
    """Nobody is going to review a cancelled project. Left open, the charge
    carries forward into every following day for good — no stage move will ever
    come along to release it — and the reviewer is quietly short six points a
    day for the rest of their career.

    Today it still counts: the no-refund rule is about the day the work was
    spent on, and scrapping does not un-spend somebody's morning."""
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2",
        video_type="podcast", reviewer=world.qc,
    )
    await charge(db, job=job, reviewer_id=world.qc.id)
    await db.commit()

    today = qc2_today()
    tomorrow = today + timedelta(days=1)
    assert await daily_load(db, world.qc.id, today=tomorrow) == 6

    assert (await scrap(client, job.id, world.tl)).status_code == 200

    assert await daily_load(db, world.qc.id, today=today) == 6
    assert await daily_load(db, world.qc.id, today=tomorrow) == 0


async def test_restoring_the_same_day_does_not_bill_the_round_twice(client, db, world):
    """A scrap at 11 and a restore at 3 is one review, and a TL changing their
    mind must not cost the reviewer a second podcast's worth of their day."""
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2",
        video_type="podcast", reviewer=world.qc,
    )
    await charge(db, job=job, reviewer_id=world.qc.id)
    await db.commit()

    await scrap(client, job.id, world.tl)
    restored = await client.post(
        f"/api/jobs/{job.id}/restore", json={}, headers=auth(world.tl)
    )
    assert restored.status_code == 200

    today = qc2_today()
    assert await daily_load(db, world.qc.id, today=today) == 6
    # Open again, so it carries into tomorrow like any round still on a plate.
    assert await daily_load(db, world.qc.id, today=today + timedelta(days=1)) == 6
