"""The client deadline is the Owner's and the pod TL's, and nobody else's.

A team deadline that sits earlier than the promise only works if the earlier
one is the only date the team is shown. So this is not a UI question — it is
the same shape of hole the hardening pass in docs/00-status.md was about:
every one of those was reachable with a valid login and `curl` while the
screen looked correct.

So these tests drive the API as a VE and as a QC and try to read the date
through every route that touches a job: the list, the detail, the activity
feed, and the bot's own job tools. There is no UI in any of them on purpose.
"""
from __future__ import annotations

from datetime import date

import pytest

from app.models.job_event import JobEvent
from app.services.ai.tools import run_tool
from tests.factories import add_member, auth, make_job, reload

pytestmark = pytest.mark.integration

TEAM = date(2026, 9, 17)
CLIENT = date(2026, 9, 20)


async def _job_with_both_dates(db, world):
    job = await make_job(
        db,
        pod=world.pod,
        created_by=world.tl,
        stage="editing",
        editor=world.ve,
        reviewer=world.qc,
        deadline=TEAM,
    )
    job.client_deadline = CLIENT
    await db.flush()
    await db.commit()
    return job


# --------------------------------------------------------------------------
# Who is shown the promise
# --------------------------------------------------------------------------


async def test_pod_tl_sees_the_client_deadline(client, db, world):
    job = await _job_with_both_dates(db, world)
    response = await client.get(f"/api/jobs/{job.id}", headers=auth(world.tl))
    assert response.status_code == 200
    body = response.json()
    assert body["deadline"] == TEAM.isoformat()
    assert body["client_deadline"] == CLIENT.isoformat()


async def test_owner_sees_the_client_deadline(client, db, world):
    job = await _job_with_both_dates(db, world)
    response = await client.get(f"/api/jobs/{job.id}", headers=auth(world.owner))
    assert response.json()["client_deadline"] == CLIENT.isoformat()


async def test_editor_is_shown_the_team_deadline_and_nothing_else(client, db, world):
    job = await _job_with_both_dates(db, world)
    response = await client.get(f"/api/jobs/{job.id}", headers=auth(world.ve))
    body = response.json()
    assert body["deadline"] == TEAM.isoformat()
    assert body["client_deadline"] is None


async def test_qc_reviewer_is_shown_the_team_deadline_and_nothing_else(client, db, world):
    job = await _job_with_both_dates(db, world)
    response = await client.get(f"/api/jobs/{job.id}", headers=auth(world.qc))
    assert response.json()["client_deadline"] is None


async def test_it_is_redacted_in_the_list_too(client, db, world):
    """The list is a separate serialisation path from the detail, and the one
    a VE actually lives in."""
    await _job_with_both_dates(db, world)
    response = await client.get("/api/jobs", headers=auth(world.ve))
    rows = response.json()["items"]
    assert rows, "the editor should be able to see their own job"
    assert all(row["client_deadline"] is None for row in rows)


async def test_a_tl_of_another_pod_does_not_see_it(client, db, world):
    """A TL's reach is their own pods. `leads_pod` compares `Pod.tl_id`, not
    the role name — this is the test that keeps it that way."""
    job = await _job_with_both_dates(db, world)
    # `other_tl` is given a seat in the pod so the job is readable at all;
    # readable is not the same as shown the promise.
    await add_member(db, world.pod, world.other_tl, "tl")
    await db.commit()
    response = await client.get(f"/api/jobs/{job.id}", headers=auth(world.other_tl))
    assert response.status_code == 200
    assert response.json()["client_deadline"] is None


# --------------------------------------------------------------------------
# The activity feed, which is the sneaky one
# --------------------------------------------------------------------------


async def test_the_change_is_hidden_from_the_feed(client, db, world):
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="editing", editor=world.ve, deadline=TEAM
    )
    await db.commit()

    patched = await client.patch(
        f"/api/jobs/{job.id}",
        json={"client_deadline": CLIENT.isoformat()},
        headers=auth(world.tl),
    )
    assert patched.status_code == 200

    lead_feed = await client.get(f"/api/jobs/{job.id}/events", headers=auth(world.tl))
    assert any("client_deadline" in event["payload"] for event in lead_feed.json())

    editor_feed = await client.get(f"/api/jobs/{job.id}/events", headers=auth(world.ve))
    assert editor_feed.status_code == 200
    assert not any("client_deadline" in event["payload"] for event in editor_feed.json())


async def test_redacting_the_feed_does_not_write_the_redaction_back(client, db, world):
    """The payload comes off an ORM object that stays in the session. Editing
    one in place would persist the redaction on the next flush — losing the
    record for the lead as well."""
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="editing", editor=world.ve, deadline=TEAM
    )
    await db.commit()
    await client.patch(
        f"/api/jobs/{job.id}",
        json={"client_deadline": CLIENT.isoformat()},
        headers=auth(world.tl),
    )
    await client.get(f"/api/jobs/{job.id}/events", headers=auth(world.ve))

    stored = (
        await db.execute(
            JobEvent.__table__.select().where(JobEvent.job_id == job.id)
        )
    ).fetchall()
    assert any("client_deadline" in (row.payload or {}) for row in stored)


# --------------------------------------------------------------------------
# The bot sees exactly what the caller sees (docs/11)
#
# Phrased as the exploit, per docs/07: the bot is offered to Owners and TLs,
# so the person to try it as is a TL who can *see* the job — a member of the
# pod — but does not lead it. Asking the bot is the obvious way round a
# redacted field, and it has to give the same answer the API did.
# --------------------------------------------------------------------------


async def test_the_bot_does_not_leak_it_to_a_tl_who_does_not_lead_the_pod(db, world):
    job = await _job_with_both_dates(db, world)
    await add_member(db, world.pod, world.other_tl, "tl")
    await db.commit()

    timeline = await run_tool(
        db, world.other_tl, name="get_job_timeline", arguments={"job_code": job.code}
    )
    assert "client_deadline" not in timeline["job"]

    listing = await run_tool(db, world.other_tl, name="find_jobs", arguments={})
    rows = [row for row in listing["jobs"] if row["code"] == job.code]
    assert rows, "the job should be listed for a member of its pod"
    assert all("client_deadline" not in row for row in rows)


async def test_the_bot_tells_the_pod_tl(db, world):
    job = await _job_with_both_dates(db, world)
    timeline = await run_tool(
        db, world.tl, name="get_job_timeline", arguments={"job_code": job.code}
    )
    assert timeline["job"]["client_deadline"] == CLIENT.isoformat()

    listing = await run_tool(db, world.tl, name="find_jobs", arguments={})
    row = next(row for row in listing["jobs"] if row["code"] == job.code)
    assert row["client_deadline"] == CLIENT.isoformat()


# --------------------------------------------------------------------------
# Writing it
# --------------------------------------------------------------------------


async def test_a_team_deadline_after_the_promise_is_refused(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.tl, deadline=None)
    await db.commit()
    response = await client.patch(
        f"/api/jobs/{job.id}",
        json={"deadline": "2026-09-25", "client_deadline": CLIENT.isoformat()},
        headers=auth(world.tl),
    )
    assert response.status_code == 400
    assert "on or before" in response.json()["detail"]


async def test_the_two_dates_may_be_equal(client, db, world):
    """No buffer is a legitimate choice — it is what every job looked like
    before this existed."""
    job = await make_job(db, pod=world.pod, created_by=world.tl, deadline=None)
    await db.commit()
    response = await client.patch(
        f"/api/jobs/{job.id}",
        json={"deadline": CLIENT.isoformat(), "client_deadline": CLIENT.isoformat()},
        headers=auth(world.tl),
    )
    assert response.status_code == 200


async def test_an_editor_cannot_set_it_on_a_stage_move(client, db, world):
    """`advance` is the one write path an editor reaches, so it carries its
    own check rather than relying on the route's role gate."""
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="assigned", editor=world.ve, deadline=TEAM
    )
    await db.commit()
    response = await client.post(
        f"/api/jobs/{job.id}/advance",
        json={"stage": "editing", "client_deadline": "2026-12-31"},
        headers=auth(world.ve),
    )
    assert response.status_code == 403
    assert (await reload(db, job)).client_deadline is None


async def test_a_tl_sets_both_on_the_hand_off(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="intake", deadline=None)
    await db.commit()
    response = await client.post(
        f"/api/jobs/{job.id}/advance",
        json={
            "stage": "assigned",
            "assigned_editor_id": str(world.ve.id),
            "deadline": TEAM.isoformat(),
            "client_deadline": CLIENT.isoformat(),
        },
        headers=auth(world.tl),
    )
    assert response.status_code == 200
    refreshed = await reload(db, job)
    assert refreshed.deadline == TEAM
    assert refreshed.client_deadline == CLIENT


async def test_created_with_both_at_intake(client, db, world):
    response = await client.post(
        "/api/jobs",
        json={
            "title": "Ep 42",
            "pod_id": str(world.pod.id),
            "deadline": TEAM.isoformat(),
            "client_deadline": CLIENT.isoformat(),
        },
        headers=auth(world.tl),
    )
    assert response.status_code == 201
    assert response.json()["client_deadline"] == CLIENT.isoformat()


async def test_a_batch_is_refused_whole_when_one_row_is_backwards(client, db, world):
    """The batch is one transaction — a rejected row must take the paste with
    it rather than leaving half of it created."""
    response = await client.post(
        "/api/jobs/batch",
        json={
            "pod_id": str(world.pod.id),
            "jobs": [
                {"title": "Fine", "deadline": TEAM.isoformat(), "client_deadline": CLIENT.isoformat()},
                {"title": "Backwards", "deadline": "2026-10-01", "client_deadline": CLIENT.isoformat()},
            ],
        },
        headers=auth(world.tl),
    )
    assert response.status_code == 400
    listed = await client.get("/api/jobs", headers=auth(world.tl))
    assert not any(row["title"] == "Fine" for row in listed.json()["items"])


async def test_clearing_it(client, db, world):
    job = await _job_with_both_dates(db, world)
    response = await client.patch(
        f"/api/jobs/{job.id}",
        json={"clear_client_deadline": True},
        headers=auth(world.tl),
    )
    assert response.status_code == 200
    assert response.json()["client_deadline"] is None
    assert response.json()["deadline"] == TEAM.isoformat(), "the team date is untouched"
