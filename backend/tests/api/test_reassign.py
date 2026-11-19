"""Handing a job to a different editor, through the real HTTP path.

Three things are being defended. First, who may move work off somebody — the
pod's TL and the company-wide tier, not the editor holding it and not the QC
reviewing it, enforced server-side rather than by hiding a button (docs/04).
Second, that the handover cannot happen silently: every path that could change
`assigned_editor_id` on a job that already has one now goes through the route
that takes a reason. Third, that the record left behind actually answers the
question people ask afterwards — who had it, who has it now, and why it moved.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.job_event import JobEvent
from app.models.notification import Notification
from app.models.pod_member import PodMember
from tests.factories import add_member, auth, make_job, make_user, reload

pytestmark = pytest.mark.integration

REASON = "Editor is out sick until Monday and the client deadline is Friday"


async def reassign(client, job_id, user, editor, reason=REASON):
    return await client.post(
        f"/api/jobs/{job_id}/reassign",
        json={"editor_id": str(editor.id), "reason": reason},
        headers=auth(user),
    )


@pytest.fixture
async def job(db, world):
    """Mid-cut and on Editor One's plate — the state a handover actually
    happens from."""
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="editing", editor=world.ve
    )
    await db.commit()
    return job


# --------------------------------------------------------------------------
# Who may reassign
# --------------------------------------------------------------------------


async def test_pod_tl_may_reassign(client, db, world, job):
    response = await reassign(client, job.id, world.tl, world.ve2)
    assert response.status_code == 200
    body = response.json()
    assert body["assigned_editor_id"] == str(world.ve2.id)
    assert body["editor_name"] == world.ve2.name
    # The pipeline does not move. A job handed over at editing is still at
    # editing with its rounds intact — only the name on it changed.
    assert body["stage"] == "editing"
    assert body["round"] == job.round


async def test_the_owner_may_reassign_in_any_pod(client, db, world):
    """The Owner, and nobody else company-wide. HR held this too when the role
    meant "a TL everywhere"; it now reassigns on the pods it was given, as
    itself a TL, or not at all."""
    for actor in (world.owner,):
        target = await make_job(
            db, pod=world.pod, created_by=world.tl, stage="editing", editor=world.ve
        )
        await db.commit()
        assert (await reassign(client, target.id, actor, world.ve2)).status_code == 200


async def test_a_tl_from_another_pod_may_not(client, db, world, job):
    assert (await reassign(client, job.id, world.other_tl, world.ve2)).status_code == 403
    assert (await reload(db, job)).assigned_editor_id == world.ve.id


@pytest.mark.parametrize("actor_name", ["ve", "qc"])
async def test_the_editor_holding_it_and_the_reviewer_may_not(
    client, db, world, job, actor_name
):
    """An editor cannot hand their own job on, and a QC cannot move it off the
    person they are reviewing. The UI never offers them the control; this is
    the half that matters."""
    actor = getattr(world, actor_name)
    assert (await reassign(client, job.id, actor, world.ve2)).status_code == 403
    assert (await reload(db, job)).assigned_editor_id == world.ve.id


# --------------------------------------------------------------------------
# What a reassignment requires and refuses
# --------------------------------------------------------------------------


@pytest.mark.parametrize("reason", ["", "no", "   "])
async def test_a_real_reason_is_required(client, db, world, job, reason):
    response = await reassign(client, job.id, world.tl, world.ve2, reason=reason)
    assert response.status_code == 422
    assert (await reload(db, job)).assigned_editor_id == world.ve.id


async def test_the_new_editor_must_be_an_active_ve(client, db, world, job):
    """`ensure_assignable_editor` again, reached through a second route — an
    assignment target is validated wherever it is set, not only on create."""
    deactivated = await make_user(db, role="ve", is_active=False)
    await add_member(db, world.pod, deactivated, "ve")
    await db.commit()

    # A QC account and someone who has left.
    for candidate in (world.qc, deactivated):
        assert (await reassign(client, job.id, world.tl, candidate)).status_code == 400
    assert (await reload(db, job)).assigned_editor_id == world.ve.id


async def test_a_job_can_be_handed_to_an_editor_from_another_pod(client, db, world, job):
    """The picker offers every active editor, so a rescue is not blocked by
    who happens to be on the pod — the handover puts them on it (docs/05)."""
    assert (await reassign(client, job.id, world.tl, world.other_ve)).status_code == 200
    assert (await reload(db, job)).assigned_editor_id == world.other_ve.id
    assert await db.get(PodMember, {"pod_id": world.pod.id, "user_id": world.other_ve.id})


async def test_reassigning_to_the_same_editor_is_refused(client, world, job):
    response = await reassign(client, job.id, world.tl, world.ve)
    assert response.status_code == 400
    assert "already" in response.json()["detail"].lower()


async def test_a_job_with_no_editor_yet_is_refused(client, db, world):
    """That is an assignment, not a handover, and it goes through the stage
    machine — a reason for taking nobody off nothing is noise on the record."""
    unassigned = await make_job(db, pod=world.pod, created_by=world.tl, stage="intake")
    await db.commit()
    response = await reassign(client, unassigned.id, world.tl, world.ve)
    assert response.status_code == 400
    assert (await reload(db, unassigned)).assigned_editor_id is None


async def test_a_delivered_job_cannot_be_reassigned(client, db, world):
    delivered = await make_job(
        db,
        pod=world.pod,
        created_by=world.tl,
        stage="delivered",
        editor=world.ve,
        client_sheet_ok=True,
        ops_tracker_ok=True,
    )
    await db.commit()
    assert (await reassign(client, delivered.id, world.tl, world.ve2)).status_code == 400
    assert (await reload(db, delivered)).assigned_editor_id == world.ve.id


async def test_a_scrapped_job_cannot_be_reassigned(client, db, world):
    dead = await make_job(
        db,
        pod=world.pod,
        created_by=world.tl,
        stage="editing",
        editor=world.ve,
        scrapped_by=world.tl,
    )
    await db.commit()
    assert (await reassign(client, dead.id, world.tl, world.ve2)).status_code == 400
    assert (await reload(db, dead)).assigned_editor_id == world.ve.id


# --------------------------------------------------------------------------
# The silent paths are closed
# --------------------------------------------------------------------------


async def test_patch_cannot_swap_an_editor_without_a_reason(client, db, world, job):
    response = await client.patch(
        f"/api/jobs/{job.id}",
        json={"assigned_editor_id": str(world.ve2.id)},
        headers=auth(world.tl),
    )
    assert response.status_code == 400
    assert "reassign" in response.json()["detail"].lower()
    assert (await reload(db, job)).assigned_editor_id == world.ve.id


async def test_advance_cannot_swap_an_editor_without_a_reason(client, db, world):
    """The same change as a passenger on a stage move. It used to be accepted
    here, which made the reason optional in practice."""
    intake = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="intake", editor=world.ve
    )
    await db.commit()
    response = await client.post(
        f"/api/jobs/{intake.id}/advance",
        json={"stage": "assigned", "assigned_editor_id": str(world.ve2.id)},
        headers=auth(world.tl),
    )
    assert response.status_code == 400
    assert (await reload(db, intake)).assigned_editor_id == world.ve.id


async def test_advance_still_makes_the_first_assignment(client, db, world):
    """The guard is about swapping, not about assigning — intake -> assigned
    with an editor is the normal way work starts."""
    unassigned = await make_job(db, pod=world.pod, created_by=world.tl, stage="intake")
    await db.commit()
    response = await client.post(
        f"/api/jobs/{unassigned.id}/advance",
        json={"stage": "assigned", "assigned_editor_id": str(world.ve.id)},
        headers=auth(world.tl),
    )
    assert response.status_code == 200
    assert response.json()["assigned_editor_id"] == str(world.ve.id)


# --------------------------------------------------------------------------
# What a reassignment leaves behind
# --------------------------------------------------------------------------


async def test_the_event_records_both_names_and_the_reason(client, db, world, job):
    await reassign(client, job.id, world.tl, world.ve2)

    event = (
        await db.execute(
            select(JobEvent).where(
                JobEvent.job_id == job.id, JobEvent.event_type == "job_reassigned"
            )
        )
    ).scalar_one()
    assert event.actor_id == world.tl.id
    assert event.payload["reason"] == REASON
    assert event.payload["from_editor_id"] == str(world.ve.id)
    assert event.payload["from_editor_name"] == world.ve.name
    assert event.payload["to_editor_id"] == str(world.ve2.id)
    assert event.payload["to_editor_name"] == world.ve2.name
    # Where it happened, so "handed over at QC2 on round 2" stays readable.
    assert event.payload["stage"] == "editing"


async def test_both_editors_and_the_tl_are_told_but_not_the_actor(client, db, world, job):
    await reassign(client, job.id, world.tl, world.ve2)

    recipients = set(
        (
            await db.execute(
                select(Notification.user_id)
                .join(JobEvent, JobEvent.id == Notification.event_id)
                .where(JobEvent.event_type == "job_reassigned")
            )
        )
        .scalars()
        .all()
    )
    # The TL made the call here, so they are not notified of their own action;
    # the editor who lost the job and the one who gained it both are.
    assert recipients == {world.ve.id, world.ve2.id}


async def test_the_tl_is_told_when_somebody_above_them_makes_the_call(client, db, world, job):
    await reassign(client, job.id, world.owner, world.ve2)

    recipients = set(
        (
            await db.execute(
                select(Notification.user_id)
                .join(JobEvent, JobEvent.id == Notification.event_id)
                .where(JobEvent.event_type == "job_reassigned")
            )
        )
        .scalars()
        .all()
    )
    assert recipients == {world.ve.id, world.ve2.id, world.tl.id}


async def test_the_job_moves_between_the_two_editors_mine_tabs(client, db, world, job):
    await reassign(client, job.id, world.tl, world.ve2)

    async def mine(user):
        response = await client.get("/api/jobs?status=mine", headers=auth(user))
        assert response.status_code == 200
        return [item["id"] for item in response.json()["items"]]

    assert str(job.id) not in await mine(world.ve)
    assert str(job.id) in await mine(world.ve2)


async def test_the_handover_shows_up_in_the_jobs_timeline(client, db, world, job):
    """Everyone who can read the job reads the handover on it, the editor who
    lost it included — the feed is the only place the reason ever appears."""
    await reassign(client, job.id, world.tl, world.ve2)

    response = await client.get(f"/api/jobs/{job.id}/events", headers=auth(world.ve2))
    assert response.status_code == 200
    entry = next(e for e in response.json() if e["event_type"] == "job_reassigned")
    assert entry["actor_name"] == world.tl.name
    assert entry["payload"]["reason"] == REASON
