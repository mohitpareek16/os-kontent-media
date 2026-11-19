"""The pipeline end to end, through the real HTTP path.

Covers the delivery-checklist gate, the round counter, QC2 sticky routing and
the full happy path with the JobEvent rows it must leave behind.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.job_event import JobEvent
from app.models.notification import Notification
from app.models.pod_member import PodMember
from tests.factories import DEFAULT_DEADLINE, add_member, auth, make_job, make_user, reload

pytestmark = pytest.mark.integration


async def advance(client, job_id, user, stage, **extra):
    return await client.post(
        f"/api/jobs/{job_id}/advance", json={"stage": stage, **extra}, headers=auth(user)
    )


async def events_for(db, job_id):
    rows = await db.execute(
        select(JobEvent).where(JobEvent.job_id == job_id).order_by(JobEvent.created_at)
    )
    return list(rows.scalars().all())


# --------------------------------------------------------------------------
# 14. Delivery requires both checklist flags
# --------------------------------------------------------------------------


@pytest.fixture
async def ready_to_deliver(db, world):
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="final", editor=world.ve, reviewer=world.qc
    )
    await db.commit()
    return job


async def test_delivery_is_blocked_with_neither_flag(client, db, world, ready_to_deliver):
    response = await advance(client, ready_to_deliver.id, world.tl, "delivered")
    assert response.status_code == 400
    assert "client_sheet_ok" in response.json()["detail"]
    job = await reload(db, ready_to_deliver)
    assert job.stage == "final" and job.delivered_at is None


@pytest.mark.parametrize("flag", ["client_sheet_ok", "ops_tracker_ok"])
async def test_delivery_is_blocked_with_only_one_flag(
    client, db, world, ready_to_deliver, flag
):
    patched = await client.patch(
        f"/api/jobs/{ready_to_deliver.id}/checklist", json={flag: True}, headers=auth(world.tl)
    )
    assert patched.status_code == 200

    response = await advance(client, ready_to_deliver.id, world.tl, "delivered")
    assert response.status_code == 400
    assert (await reload(db, ready_to_deliver)).stage == "final"


async def test_delivery_succeeds_once_both_flags_are_set(client, db, world, ready_to_deliver):
    await client.patch(
        f"/api/jobs/{ready_to_deliver.id}/checklist",
        json={"client_sheet_ok": True, "ops_tracker_ok": True},
        headers=auth(world.tl),
    )
    response = await advance(client, ready_to_deliver.id, world.tl, "delivered")

    assert response.status_code == 200
    job = await reload(db, ready_to_deliver)
    assert job.stage == "delivered" and job.delivered_at is not None


async def test_a_blocked_delivery_leaves_no_event_behind(client, db, world, ready_to_deliver):
    await advance(client, ready_to_deliver.id, world.tl, "delivered")
    assert await events_for(db, ready_to_deliver.id) == []


@pytest.mark.parametrize("actor", ["ve", "qc"])
async def test_only_owner_or_pod_tl_may_tick_the_checklist(client, db, world, ready_to_deliver, actor):
    response = await client.patch(
        f"/api/jobs/{ready_to_deliver.id}/checklist",
        json={"client_sheet_ok": True},
        headers=auth(getattr(world, actor)),
    )
    assert response.status_code == 403
    assert (await reload(db, ready_to_deliver)).client_sheet_ok is False


# --------------------------------------------------------------------------
# 15. Job.round increments on every send-back
# --------------------------------------------------------------------------


async def test_round_increments_on_every_send_back(client, db, world):
    """docs/05: a send-back from QC1, QC2 *or* Final check bumps the counter."""
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc1", editor=world.ve, reviewer=world.qc
    )
    await db.commit()
    assert job.round == 0

    # QC1 -> revisions. A QC1 send-back comes back to QC1, so this round is a
    # straight there-and-back through the edit bay.
    assert (await advance(client, job.id, world.tl, "revisions", note="round one")).status_code == 200
    assert (await reload(db, job)).round == 1

    # back round the loop, QC2 -> revisions
    await advance(client, job.id, world.ve, "editing")
    await advance(client, job.id, world.ve, "qc1")
    await advance(client, job.id, world.tl, "qc2")
    assert (await advance(client, job.id, world.qc, "revisions", note="round two")).status_code == 200
    assert (await reload(db, job)).round == 2

    # and once more, Final check -> revisions. The re-cut goes back to QC2 —
    # the desk that raised round two — and on to Final from there.
    await advance(client, job.id, world.ve, "editing")
    await advance(client, job.id, world.ve, "qc2")
    await advance(client, job.id, world.qc, "final")
    assert (await advance(client, job.id, world.tl, "revisions", note="round three")).status_code == 200
    assert (await reload(db, job)).round == 3


async def test_forward_moves_never_touch_the_round_counter(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="assigned", editor=world.ve)
    await db.commit()

    for actor, stage in (("ve", "editing"), ("ve", "qc1"), ("tl", "qc2"), ("tl", "final")):
        assert (await advance(client, job.id, getattr(world, actor), stage)).status_code == 200
    assert (await reload(db, job)).round == 0


async def test_a_send_back_note_is_recorded_as_changes_raised(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="qc1", editor=world.ve)
    await db.commit()

    await advance(client, job.id, world.tl, "revisions", note="Trim the intro; fix the LUT")
    changes = [e for e in await events_for(db, job.id) if e.event_type == "changes_raised"]

    assert len(changes) == 1
    assert changes[0].payload["note"] == "Trim the intro; fix the LUT"
    assert changes[0].payload["from_stage"] == "qc1"
    assert changes[0].payload["round"] == 1


async def test_a_note_on_a_forward_move_is_recorded_as_note_added(client, db, world):
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2", editor=world.ve, reviewer=world.qc
    )
    await db.commit()

    await advance(client, job.id, world.qc, "final", note="Clean, shipping it")
    types = [e.event_type for e in await events_for(db, job.id)]

    assert "note_added" in types
    assert "changes_raised" not in types


# --------------------------------------------------------------------------
# QC2 routing through the API, including stickiness on later rounds
# --------------------------------------------------------------------------


async def test_reaching_qc2_auto_routes_to_an_available_reviewer(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="qc1", editor=world.ve)
    await db.commit()

    response = await advance(client, job.id, world.tl, "qc2")

    assert response.status_code == 200
    assert response.json()["qc2_reviewer_id"] == str(world.qc.id)
    assert response.json()["qc2_reviewer_name"] == world.qc.name


async def test_a_job_with_no_available_reviewer_stays_unrouted(client, db, world):
    """docs/05: it doesn't vanish and it doesn't get piled onto someone —
    it surfaces on the QC team page as unrouted."""
    world.qc.available = False
    world.other_qc.available = False
    await db.commit()

    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="qc1", editor=world.ve)
    await db.commit()

    response = await advance(client, job.id, world.tl, "qc2")
    assert response.status_code == 200
    assert response.json()["qc2_reviewer_id"] is None

    # ...and it's visible to the pod's QC as an unrouted QC2 job.
    listed = await client.get("/api/jobs?status=all", headers=auth(world.qc))
    assert [item["id"] for item in listed.json()["items"]] == [str(job.id)]


async def test_the_reviewer_is_sticky_across_rounds(client, db, world):
    """docs/05: 'Stickiness is not an optimization, it's the point.' A second
    reviewer joins the pod with zero load and the original one goes
    unavailable — the job must still come back to whoever holds it."""
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="qc1", editor=world.ve)
    await db.commit()

    first = await advance(client, job.id, world.tl, "qc2")
    reviewer_id = first.json()["qc2_reviewer_id"]
    assert reviewer_id == str(world.qc.id)

    fresh_reviewer = await make_user(db, role="qc", name="Fresh eyes")
    await add_member(db, world.pod, fresh_reviewer, "qc")
    world.qc.available = False
    await db.commit()

    await advance(client, job.id, world.qc, "revisions", note="fix these")
    await advance(client, job.id, world.ve, "editing")
    second = await advance(client, job.id, world.ve, "qc2")

    assert second.json()["qc2_reviewer_id"] == reviewer_id


# --------------------------------------------------------------------------
# 17. The full happy path
# --------------------------------------------------------------------------


async def test_full_pipeline_from_intake_to_delivered(client, db, world):
    """create -> assign -> editing -> qc1 -> qc2 (auto-routed) -> send back
    with a change list -> re-submit -> qc1 -> qc2 (same reviewer) -> final ->
    checklist -> delivered, with the event log asserted along the way."""
    created = await client.post(
        "/api/jobs",
        json={"title": "Launch film", "pod_id": str(world.pod.id), "weight": "heavy"},
        headers=auth(world.tl),
    )
    assert created.status_code == 201
    job_id = created.json()["id"]
    assert created.json()["stage"] == "intake"
    assert created.json()["code"].startswith("KM-")

    # The hand-off is both halves at once — a name and a date. Assigning
    # without the date is legal but leaves the job on the TL's plate, and the
    # editor's moves are refused until it has one (`is_briefed`).
    assigned = await advance(
        client,
        job_id,
        world.tl,
        "assigned",
        assigned_editor_id=str(world.ve.id),
        deadline=str(DEFAULT_DEADLINE),
    )
    assert assigned.status_code == 200
    assert assigned.json()["deadline"] == str(DEFAULT_DEADLINE)
    assert (await advance(client, job_id, world.ve, "editing")).status_code == 200
    assert (await advance(client, job_id, world.ve, "qc1", frame_link="https://frame.io/x")).status_code == 200

    to_qc2 = await advance(client, job_id, world.tl, "qc2")
    assert to_qc2.status_code == 200
    reviewer_id = to_qc2.json()["qc2_reviewer_id"]
    assert reviewer_id == str(world.qc.id)

    sent_back = await advance(
        client, job_id, world.qc, "revisions", note="Cut the first 4s, wrong logo at 0:12"
    )
    assert sent_back.status_code == 200
    assert sent_back.json()["round"] == 1

    # Back through the edit bay before QC sees it again — the editor picking
    # the changes up is a move on the record, which is what gives round 1 a
    # start time on the record to measure from. And then straight
    # back to QC2, the desk that wrote the change list: QC1 is the TL's first
    # pass, and re-running it on changes the TL never asked for put them in
    # front of the reviewer who is waiting to close their own round.
    assert (await advance(client, job_id, world.ve, "editing")).status_code == 200
    assert (await advance(client, job_id, world.ve, "qc1")).status_code == 400
    round_two = await advance(client, job_id, world.ve, "qc2")
    assert round_two.status_code == 200
    assert round_two.json()["qc2_reviewer_id"] == reviewer_id, "reviewer must be sticky"

    assert (await advance(client, job_id, world.qc, "final")).status_code == 200

    await client.patch(
        f"/api/jobs/{job_id}/checklist",
        json={"client_sheet_ok": True, "ops_tracker_ok": True},
        headers=auth(world.tl),
    )
    delivered = await advance(client, job_id, world.tl, "delivered")
    assert delivered.status_code == 200

    final = delivered.json()
    assert final["stage"] == "delivered"
    assert final["round"] == 1
    assert final["delivered_at"] is not None
    assert final["frame_link"] == "https://frame.io/x"
    assert final["editor_name"] == world.ve.name
    assert final["pod_name"] == world.pod.name

    # --- the append-only log the whole thing is judged by ------------------
    events = await events_for(db, job_id)
    assert [e.event_type for e in events] == [
        "intake",
        "job_updated",     # the deadline that came with the hand-off
        "stage_changed",   # -> assigned
        "stage_changed",   # -> editing
        "stage_changed",   # -> qc1
        "stage_changed",   # -> qc2
        "qc2_assigned_v1", # routed, and billed for the round (docs/12)
        "stage_changed",   # -> revisions
        "changes_raised",  # the change list that came with it
        "stage_changed",   # -> editing (editor picks the changes up)
        "stage_changed",   # -> qc2 (back to the reviewer who sent it back)
        "qc2_assigned_v1", # same reviewer, half price — see below
        "stage_changed",   # -> final
        "stage_changed",   # -> delivered
    ]

    # The two assignments, side by side, are the load model in one place: the
    # first watch costs full price and is competed for on score; the second is
    # the same reviewer at `ceil(base / 2)` with no scoring at all, because a
    # repeat round never re-enters load balancing (docs/12 §6-7).
    first_pass, second_pass = [e for e in events if e.event_type == "qc2_assigned_v1"]
    assert first_pass.payload["reviewer_id"] == str(world.qc.id)
    assert first_pass.payload["points"] == 3      # long_form, first watch
    assert first_pass.payload["sticky"] is False
    assert first_pass.payload["score"] is not None

    assert second_pass.payload["reviewer_id"] == str(world.qc.id)
    assert second_pass.payload["points"] == 2     # ceil(3 / 2)
    assert second_pass.payload["sticky"] is True
    assert second_pass.payload["score"] is None

    stages = [e.payload["stage"] for e in events if e.event_type == "stage_changed"]
    assert stages == [
        "assigned", "editing", "qc1", "qc2", "revisions",
        "editing", "qc2", "final", "delivered",
    ]

    change_list = next(e for e in events if e.event_type == "changes_raised")
    assert change_list.payload["note"] == "Cut the first 4s, wrong logo at 0:12"
    assert change_list.payload["from_stage"] == "qc2"
    assert change_list.payload["round"] == 1
    assert change_list.actor_id == world.qc.id

    # every event carries its actor, and the feed reads back in order
    feed = await client.get(f"/api/jobs/{job_id}/events", headers=auth(world.tl))
    assert [e["event_type"] for e in feed.json()] == [e.event_type for e in events]
    assert all(e["actor_name"] for e in feed.json())


async def test_the_editor_is_notified_when_changes_are_raised(client, db, world):
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2", editor=world.ve, reviewer=world.qc
    )
    await db.commit()

    await advance(client, job.id, world.qc, "revisions", note="see notes")

    rows = await db.execute(select(Notification).where(Notification.user_id == world.ve.id))
    assert len(rows.scalars().all()) == 1

    inbox = await client.get("/api/notifications", headers=auth(world.ve))
    assert inbox.status_code == 200
    assert inbox.json()["items"][0]["job_code"] == job.code
    assert inbox.json()["items"][0]["stage"] == "revisions"
    # The unread count is the whole inbox's, not this page's.
    assert inbox.json()["unread"] == 1


async def test_a_third_clean_delivery_certifies_the_editor_on_that_pod(client, db, world):
    """The certification service, reached the way it actually gets reached."""
    for _ in range(2):
        await make_job(
            db, pod=world.pod, created_by=world.tl, stage="delivered", editor=world.ve, round=1
        )
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="final", editor=world.ve,
        client_sheet_ok=True, ops_tracker_ok=True,
    )
    await db.commit()

    membership = await db.get(PodMember, {"pod_id": world.pod.id, "user_id": world.ve.id})
    assert membership.certified_at is None

    assert (await advance(client, job.id, world.tl, "delivered")).status_code == 200

    await db.refresh(membership)
    assert membership.certified_at is not None


# --------------------------------------------------------------------------
# How QC1 was passed
# --------------------------------------------------------------------------


async def test_qc1_records_which_of_the_two_buttons_was_pressed(client, db, world):
    """QC1 forward is two moves, not one: nothing to raise, or comments left
    on Frame.io. Both land the job on QC2 — roughly 98 cuts in 100 go forward
    — and the difference is recorded because it is the only thing telling the
    QC2 reviewer a reviewed cut from a waved-through one."""
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc1", editor=world.ve, reviewer=world.qc
    )
    await db.commit()

    response = await advance(client, job.id, world.tl, "qc2", qc1_outcome="comments_added")
    assert response.status_code == 200
    assert response.json()["stage"] == "qc2"

    pass_row = await client.get(f"/api/jobs/{job.id}/qc1-pass", headers=auth(world.qc))
    assert pass_row.json()["outcome"] == "comments_added"


async def test_a_move_that_names_no_outcome_is_recorded_as_approved(client, db, world):
    """The seed script, the chatbot's tool layer and any client older than the
    two buttons all make this move without knowing about the field. Refusing
    them would break the pipeline to record a nuance, and "approved" is the
    honest reading of a pass with nothing attached — it is exactly what the
    single button that used to be here meant."""
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc1", editor=world.ve, reviewer=world.qc
    )
    await db.commit()

    assert (await advance(client, job.id, world.tl, "qc2")).status_code == 200

    pass_row = await client.get(f"/api/jobs/{job.id}/qc1-pass", headers=auth(world.qc))
    assert pass_row.json()["outcome"] == "approved"


async def test_the_outcome_is_ignored_on_every_other_move(client, db, world):
    """It describes a QC1 review and nothing else. Sent on an unrelated
    transition it is dropped rather than rejected — a client that always
    includes the field must not be refused for it."""
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="assigned", editor=world.ve
    )
    await db.commit()

    response = await advance(client, job.id, world.ve, "editing", qc1_outcome="approved")
    assert response.status_code == 200

    moves = [e for e in await events_for(db, job.id) if e.event_type == "stage_changed"]
    assert "qc1_outcome" not in moves[-1].payload
