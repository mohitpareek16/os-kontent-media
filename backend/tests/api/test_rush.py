"""Marking work urgent after it is already moving.

The flag existed from the day the QC2 load model landed, but only at intake:
`POST /jobs` took it and nothing could set it afterwards. That is the wrong
way round. A rush job is almost never rush when it is created — it becomes
one on a Tuesday afternoon when the client escalates something that is
already in the pipeline, which is exactly when the TL cannot say so.

Two things are defended here. That a TL can flip the flag on a live job and
it is recorded against their name; and that flipping it on a job already
sitting unrouted at QC2 actually *does* something. Routing only ever ran on
the move into QC2, so a job that had already failed to route sat there with a
rush flag nobody was going to re-read.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.job_event import JobEvent
from app.models.notification import Notification
from app.services.routing import qc2_today
from tests.factories import add_member, auth, make_charge, make_job, make_user, reload

pytestmark = pytest.mark.integration


async def set_rush(client, job, user, on=True):
    return await client.patch(
        f"/api/jobs/{job.id}", json={"rush": on}, headers=auth(user)
    )


async def test_the_pod_tl_can_mark_a_live_job_rush(db, client, world):
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="editing", editor=world.ve)
    await db.commit()

    response = await set_rush(client, job, world.tl)

    assert response.status_code == 200
    assert response.json()["rush"] is True
    assert (await reload(db, job)).rush is True


async def test_an_editor_cannot_call_their_own_job_urgent(db, client, world):
    """`check_pod_lead`, the same guard as every other edit on the job. The
    flag spends somebody else's day — a reviewer's — so it is not the
    editor's to set."""
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="editing", editor=world.ve)
    await db.commit()

    response = await set_rush(client, job, world.ve)

    assert response.status_code == 403
    assert (await reload(db, job)).rush is False


async def test_who_called_it_urgent_is_on_the_record(db, client, world):
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="editing", editor=world.ve)
    await db.commit()

    await set_rush(client, job, world.tl)

    events = (
        await db.execute(
            select(JobEvent).where(JobEvent.job_id == job.id, JobEvent.event_type == "job_updated")
        )
    ).scalars().all()
    assert len(events) == 1
    assert events[0].actor_id == world.tl.id
    assert events[0].payload["rush"] == {"from": "False", "to": "True"}


async def test_rush_reroutes_a_job_that_was_already_sitting_unrouted(db, client, world):
    """The case the flag exists for, and the one it used to miss.

    The reviewer is at 22 of 24 points, so an ordinary long form (3) does not
    fit and the job holds. Ticking rush lets routing overflow to 125% — 25 of
    a 30-point ceiling — and nothing else in the system was ever going to ask
    again.
    """
    reviewer = world.qc
    spent = await make_job(db, pod=world.pod, created_by=world.tl, stage="final")
    await make_charge(db, job=spent, reviewer=reviewer, work_date=qc2_today(), points=22)
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2", video_type="long_form"
    )
    await db.commit()
    assert job.qc2_reviewer_id is None

    response = await set_rush(client, job, world.tl)

    assert response.status_code == 200
    assert response.json()["qc2_reviewer_id"] == str(reviewer.id)
    assert (await reload(db, job)).qc2_reviewer_id == reviewer.id


async def test_the_reviewer_is_told_a_rush_job_landed_on_them(db, client, world):
    spent = await make_job(db, pod=world.pod, created_by=world.tl, stage="final")
    await make_charge(db, job=spent, reviewer=world.qc, work_date=qc2_today(), points=22)
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2", video_type="long_form"
    )
    await db.commit()

    await set_rush(client, job, world.tl)

    notifications = (
        await db.execute(select(Notification).where(Notification.user_id == world.qc.id))
    ).scalars().all()
    assert len(notifications) == 1
    event = await db.get(JobEvent, notifications[0].event_id)
    assert event.event_type == "qc2_assigned_v1"
    assert event.payload["overflow"] is True


async def test_the_overflow_charge_is_billed_not_just_assigned(db, client, world):
    """A reviewer who is handed work but not billed for it is invisible to
    every load query, and the router goes on stacking jobs on them."""
    spent = await make_job(db, pod=world.pod, created_by=world.tl, stage="final")
    await make_charge(db, job=spent, reviewer=world.qc, work_date=qc2_today(), points=22)
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2", video_type="long_form"
    )
    await db.commit()

    await set_rush(client, job, world.tl)

    from app.services.routing import daily_load

    assert await daily_load(db, world.qc.id, today=qc2_today()) == 25


async def test_rush_past_the_ceiling_leaves_the_job_where_it_was(db, client, world):
    """The wall moves, it does not disappear. The flag is still set — the TL
    said what they meant — but nobody is handed a day they cannot work."""
    spent = await make_job(db, pod=world.pod, created_by=world.tl, stage="final")
    await make_charge(db, job=spent, reviewer=world.qc, work_date=qc2_today(), points=28)
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2", video_type="long_form"
    )
    await db.commit()

    response = await set_rush(client, job, world.tl)

    assert response.status_code == 200
    assert response.json()["rush"] is True
    assert (await reload(db, job)).qc2_reviewer_id is None


async def test_a_job_that_already_has_a_reviewer_is_not_rerouted(db, client, world):
    """Rush is not a re-draw. Somebody is already watching this cut, their
    points are already spent on it, and moving it would bill it twice."""
    second = await make_user(db, role="qc", name="Second Reviewer")
    await add_member(db, world.pod, second, "qc")
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2", reviewer=world.qc
    )
    await db.commit()

    await set_rush(client, job, world.tl)

    assert (await reload(db, job)).qc2_reviewer_id == world.qc.id


async def test_turning_rush_off_does_not_route_anything(db, client, world):
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2", video_type="long_form", rush=True
    )
    await db.commit()

    response = await set_rush(client, job, world.tl, on=False)

    assert response.status_code == 200
    assert response.json()["rush"] is False
    assert (await reload(db, job)).qc2_reviewer_id is None
