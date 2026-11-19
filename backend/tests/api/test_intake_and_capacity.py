"""Intake-first assignment and the per-editor concurrent cap.

Two rules that arrived together, because they are the same workflow: a bulk
paste lands as unassigned work in `intake` and the TL hands it out when they
know who is free — and "free" is now a number the server enforces
(`User.max_concurrent_jobs`) rather than a figure on an admin screen nothing
ever read.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.models.job import Job
from app.services.routing import charge
from tests.factories import auth, make_job, make_user

pytestmark = pytest.mark.integration


async def job_count(db) -> int:
    return (await db.execute(select(func.count()).select_from(Job))).scalar_one()


async def stats(client, user, query: str = ""):
    response = await client.get(f"/api/jobs/stats{query}", headers=auth(user))
    assert response.status_code == 200
    return response.json()


# --------------------------------------------------------------------------
# Intake: work that has arrived with nobody on it
# --------------------------------------------------------------------------


async def test_a_batch_with_no_editor_lands_in_intake(client, db, world):
    response = await client.post(
        "/api/jobs/batch",
        json={
            "pod_id": str(world.pod.id),
            "jobs": [{"title": "Gold pattern"}, {"title": "US ETFs"}],
        },
        headers=auth(world.tl),
    )
    assert response.status_code == 201
    assert [job["stage"] for job in response.json()] == ["intake", "intake"]
    assert all(job["assigned_editor_id"] is None for job in response.json())
    assert all(job["deadline"] is None for job in response.json())


async def test_the_intake_tab_lists_exactly_the_unassigned_arrivals(client, db, world):
    waiting = await make_job(db, pod=world.pod, created_by=world.tl, stage="intake")
    await make_job(db, pod=world.pod, created_by=world.tl, stage="editing", editor=world.ve)
    await db.commit()

    response = await client.get("/api/jobs?status=intake", headers=auth(world.tl))
    assert response.status_code == 200
    body = response.json()
    assert [row["id"] for row in body["items"]] == [str(waiting.id)]
    assert body["total"] == 1
    assert (await stats(client, world.tl))["intake"] == 1


async def test_a_scrapped_arrival_is_not_waiting_for_anyone(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="intake")
    job.scrapped_at = datetime.now(timezone.utc)
    job.scrapped_by_id = world.tl.id
    job.scrap_reason = "client pulled the series before it started"
    await db.commit()

    assert (await stats(client, world.tl))["intake"] == 0


# --------------------------------------------------------------------------
# The cap: how many videos one editor may hold at once
# --------------------------------------------------------------------------


async def fill_editor(db, world, count: int):
    for _ in range(count):
        await make_job(
            db, pod=world.pod, created_by=world.tl, stage="editing", editor=world.ve
        )
    await db.commit()


async def test_assignment_stops_at_the_cap(client, db, world):
    world.ve.max_concurrent_jobs = 2
    await fill_editor(db, world, 2)
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="intake")
    await db.commit()

    response = await client.post(
        f"/api/jobs/{job.id}/advance",
        json={"stage": "assigned", "assigned_editor_id": str(world.ve.id)},
        headers=auth(world.tl),
    )
    assert response.status_code == 400
    assert "limit is 2" in response.json()["detail"]


async def test_a_batch_cannot_slip_past_the_cap_one_row_at_a_time(client, db, world):
    """The rows of one batch are uncommitted while it is being checked, so
    without counting them the same editor could be handed the lot."""
    world.ve.max_concurrent_jobs = 2
    await db.commit()
    response = await client.post(
        "/api/jobs/batch",
        json={
            "pod_id": str(world.pod.id),
            "jobs": [
                {"title": f"Clip {i}", "assigned_editor_id": str(world.ve.id)}
                for i in range(3)
            ],
        },
        headers=auth(world.tl),
    )
    assert response.status_code == 400
    # One transaction: the two rows that would have fit must not survive either.
    assert await job_count(db) == 0


async def test_a_batch_within_the_cap_goes_through(client, db, world):
    world.ve.max_concurrent_jobs = 2
    await db.commit()
    response = await client.post(
        "/api/jobs/batch",
        json={
            "pod_id": str(world.pod.id),
            "jobs": [
                {"title": "Clip 1", "assigned_editor_id": str(world.ve.id)},
                {"title": "Clip 2", "assigned_editor_id": str(world.ve.id)},
            ],
        },
        headers=auth(world.tl),
    )
    assert response.status_code == 201
    assert [job["stage"] for job in response.json()] == ["assigned", "assigned"]


async def test_a_reassignment_cannot_overfill_the_receiving_editor(client, db, world):
    world.ve2.max_concurrent_jobs = 1
    await make_job(db, pod=world.pod, created_by=world.tl, stage="editing", editor=world.ve2)
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="editing", editor=world.ve)
    await db.commit()

    response = await client.post(
        f"/api/jobs/{job.id}/reassign",
        json={"editor_id": str(world.ve2.id), "reason": "first editor is off sick this week"},
        headers=auth(world.tl),
    )
    assert response.status_code == 400
    assert "limit is 1" in response.json()["detail"]


async def test_delivering_a_job_frees_the_slot(client, db, world):
    world.ve.max_concurrent_jobs = 1
    held = await make_job(
        db,
        pod=world.pod,
        created_by=world.tl,
        stage="final",
        editor=world.ve,
        reviewer=world.qc,
        client_sheet_ok=True,
        ops_tracker_ok=True,
    )
    waiting = await make_job(db, pod=world.pod, created_by=world.tl, stage="intake")
    await db.commit()

    async def assign():
        return await client.post(
            f"/api/jobs/{waiting.id}/advance",
            json={"stage": "assigned", "assigned_editor_id": str(world.ve.id)},
            headers=auth(world.tl),
        )

    assert (await assign()).status_code == 400
    delivered = await client.post(
        f"/api/jobs/{held.id}/advance", json={"stage": "delivered"}, headers=auth(world.tl)
    )
    assert delivered.status_code == 200
    assert (await assign()).status_code == 200


# --------------------------------------------------------------------------
# The capacity views the pickers are built on
# --------------------------------------------------------------------------


async def test_ve_load_reports_the_slots_left(client, db, world):
    world.ve.max_concurrent_jobs = 4
    await fill_editor(db, world, 3)

    response = await client.get("/api/users/ve-load", headers=auth(world.tl))
    assert response.status_code == 200
    row = next(r for r in response.json() if r["user_id"] == str(world.ve.id))
    assert row["max_concurrent_jobs"] == 4
    assert row["assigned_count"] == 3
    assert row["free_slots"] == 1


async def test_capacity_video_roster_stays_assigned_until_delivery(client, db, world):
    active = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="revisions",
        editor=world.ve, reviewer=world.qc,
    )
    delivered = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="delivered",
        editor=world.ve, reviewer=world.qc,
    )
    scrapped = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="assigned",
        editor=world.ve, scrapped_by=world.tl,
    )
    other_pod_job = await make_job(
        db, pod=world.other_pod, created_by=world.other_tl,
        stage="assigned", editor=world.ve2,
    )
    await db.commit()

    response = await client.get("/api/users/capacity/open-jobs", headers=auth(world.tl))
    assert response.status_code == 200
    rows = {row["id"]: row for row in response.json()}
    assert str(active.id) in rows
    assert rows[str(active.id)]["editor_name"] == world.ve.name
    assert rows[str(active.id)]["qc_name"] == world.qc.name
    assert rows[str(active.id)]["tl_name"] == world.tl.name
    assert str(delivered.id) not in rows
    assert str(scrapped.id) not in rows
    assert str(other_pod_job.id) not in rows
    owner_rows = (await client.get("/api/users/capacity/open-jobs", headers=auth(world.owner))).json()
    assert str(other_pod_job.id) in {row["id"] for row in owner_rows}
    assert (await client.get("/api/users/capacity/open-jobs", headers=auth(world.ve))).status_code == 403


async def test_a_full_editor_has_no_slots_rather_than_a_negative_number(client, db, world):
    world.ve.max_concurrent_jobs = 1
    await fill_editor(db, world, 3)

    response = await client.get("/api/users/editor-capacity", headers=auth(world.tl))
    row = next(r for r in response.json() if r["user_id"] == str(world.ve.id))
    assert row["free_slots"] == 0
    assert row["reachable_free"] is False


@pytest.mark.parametrize("path", ["/api/users/ve-load", "/api/users/editor-capacity"])
async def test_deactivated_editors_are_not_offered_work(client, db, world, path):
    """They cannot be assigned to (`ensure_assignable_editor`), so listing
    them handed the assignment screen names every save then refused."""
    world.ve.is_active = False
    await db.commit()

    response = await client.get(path, headers=auth(world.tl))
    assert response.status_code == 200
    assert str(world.ve.id) not in {row["user_id"] for row in response.json()}
    assert str(world.ve2.id) in {row["user_id"] for row in response.json()}


async def test_deactivated_reviewers_leave_the_qc_capacity_view(client, db, world):
    world.qc.is_active = False
    await db.commit()

    response = await client.get("/api/users/qc-load", headers=auth(world.tl))
    assert response.status_code == 200
    assert str(world.qc.id) not in {row["user_id"] for row in response.json()}


async def test_qc_load_reports_the_day_in_points_not_a_job_count(client, db, world):
    """docs/12: the QC tab reports a *daily points budget*. A reviewer holding
    one podcast and one short form is at 7 points of 24 — not "2 jobs", which
    is the answer the old weighted-load column gave and the reason this model
    exists."""
    podcast = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2",
        video_type="podcast", reviewer=world.qc,
    )
    short = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2",
        video_type="short_form", reviewer=world.qc,
    )
    await charge(db, job=podcast, reviewer_id=world.qc.id)
    await charge(db, job=short, reviewer_id=world.qc.id)
    await db.commit()

    response = await client.get("/api/users/qc-load", headers=auth(world.tl))
    assert response.status_code == 200
    row = next(r for r in response.json() if r["user_id"] == str(world.qc.id))

    assert row["employment_type"] == "full_time"
    assert row["capacity"] == 24
    assert row["load"] == 7
    assert row["points_today"] == 7 and row["points_carried"] == 0
    assert row["points_left"] == 17
    assert row["open_count"] == 2
    assert row["videos_by_type"] == {"podcast": 1, "short_form": 1}
    assert row["podcasts_held"] == 1
    assert row["can_take_podcast"] is True
    assert row["status"] == "loaded"


async def test_a_part_timers_row_is_measured_against_a_half_day(client, db, world):
    """The same two videos, a different day. 7 of 12 is most of a part-time
    day, and the second podcast is refused on the podcast cap rather than on
    points — which is exactly why `can_take_podcast` is sent rather than
    derived from `points_left` in the browser."""
    world.qc.employment_type = "part_time"
    podcast = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2",
        video_type="podcast", reviewer=world.qc,
    )
    await charge(db, job=podcast, reviewer_id=world.qc.id)
    await db.commit()

    response = await client.get("/api/users/me/qc-load", headers=auth(world.qc))
    assert response.status_code == 200
    row = response.json()

    assert row["employment_type"] == "part_time"
    assert row["capacity"] == 12
    assert row["load"] == 6
    # Six points left is exactly a podcast, and they still cannot have one.
    assert row["points_left"] == 6
    assert row["podcasts_held"] == 1
    assert row["can_take_podcast"] is False


async def test_a_spent_out_reviewer_is_reported_as_full_not_merely_loaded(client, db, world):
    """"Full" and "busy" are different states: nothing more routes to them
    until tomorrow, and the tab should say so rather than leaving a TL to read
    it off two numbers."""
    for _ in range(8):
        job = await make_job(
            db, pod=world.pod, created_by=world.tl, stage="qc2",
            video_type="long_form", reviewer=world.qc,
        )
        await charge(db, job=job, reviewer_id=world.qc.id)
    await db.commit()

    response = await client.get("/api/users/qc-load", headers=auth(world.tl))
    row = next(r for r in response.json() if r["user_id"] == str(world.qc.id))
    assert row["load"] == 24 and row["points_left"] == 0
    assert row["status"] == "full"
    assert row["can_take_podcast"] is False


async def test_the_owner_sets_an_editors_cap(client, world):
    response = await client.patch(
        f"/api/users/{world.ve.id}",
        json={"max_concurrent_jobs": 3},
        headers=auth(world.owner),
    )
    assert response.status_code == 200
    assert response.json()["max_concurrent_jobs"] == 3


async def test_a_new_account_starts_at_five(db):
    editor = await make_user(db, role="ve")
    await db.commit()
    assert editor.max_concurrent_jobs == 5
