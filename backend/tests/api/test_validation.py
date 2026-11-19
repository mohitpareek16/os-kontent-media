"""Item 12: the enum-backed columns are validated by the Pydantic schema, so
a bad value is a 422 with a usable message — not a free string reaching
Postgres' enum and coming back as a 500.

The pod/user enums live in tests/api/test_pods.py and test_auth_and_users.py
next to the rest of those routes; this file covers the job schemas and the
generic 'nothing gets through as a 500' assertion.
"""
from __future__ import annotations

import pytest

from app.models.job import STAGES, WEIGHTS
from tests.factories import auth, make_job

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("weight", ["huge", "", "STANDARD", "1"])
async def test_an_unknown_job_weight_is_422_on_create(client, world, weight):
    response = await client.post(
        "/api/jobs",
        json={"title": "Bad weight", "pod_id": str(world.pod.id), "weight": weight},
        headers=auth(world.tl),
    )
    assert response.status_code == 422


@pytest.mark.parametrize("weight", WEIGHTS)
async def test_every_documented_weight_is_accepted(client, world, weight):
    response = await client.post(
        "/api/jobs",
        json={"title": f"A {weight} job", "pod_id": str(world.pod.id), "weight": weight},
        headers=auth(world.tl),
    )
    assert response.status_code == 201
    assert response.json()["weight"] == weight


async def test_an_unknown_weight_is_422_in_a_batch(client, world):
    response = await client.post(
        "/api/jobs/batch",
        json={"pod_id": str(world.pod.id), "jobs": [{"title": "x", "weight": "gigantic"}]},
        headers=auth(world.tl),
    )
    assert response.status_code == 422


async def test_an_unknown_weight_is_422_on_update(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.tl)
    await db.commit()

    response = await client.patch(
        f"/api/jobs/{job.id}", json={"weight": "gigantic"}, headers=auth(world.tl)
    )
    assert response.status_code == 422


async def test_an_unknown_stage_is_422(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.tl)
    await db.commit()

    response = await client.post(
        f"/api/jobs/{job.id}/advance", json={"stage": "shipped"}, headers=auth(world.tl)
    )
    assert response.status_code == 422


@pytest.mark.parametrize("stage", STAGES)
async def test_every_documented_stage_is_understood_by_the_schema(client, db, world, stage):
    """A legal stage name never 422s — it either advances or is refused by the
    state machine with a 400/403, which is a different failure entirely."""
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="qc1", editor=world.ve)
    await db.commit()

    response = await client.post(
        f"/api/jobs/{job.id}/advance", json={"stage": stage}, headers=auth(world.tl)
    )
    assert response.status_code != 422


async def test_an_empty_job_title_is_422(client, world):
    response = await client.post(
        "/api/jobs",
        json={"title": "", "pod_id": str(world.pod.id)},
        headers=auth(world.tl),
    )
    assert response.status_code == 422


async def test_a_malformed_uuid_is_422(client, world):
    response = await client.post(
        "/api/jobs",
        json={"title": "Bad pod", "pod_id": "not-a-uuid"},
        headers=auth(world.tl),
    )
    assert response.status_code == 422


async def test_a_malformed_deadline_is_422(client, world):
    response = await client.post(
        "/api/jobs",
        json={"title": "Bad date", "pod_id": str(world.pod.id), "deadline": "31/12/2026"},
        headers=auth(world.tl),
    )
    assert response.status_code == 422


async def test_no_bad_enum_value_ever_reaches_the_database(client, world):
    """One sweep across every enum-backed field the API accepts. The point is
    the absence of 5xx, not the individual status codes."""
    attempts = [
        client.post(
            "/api/jobs",
            json={"title": "x", "pod_id": str(world.pod.id), "weight": "enormous"},
            headers=auth(world.tl),
        ),
        client.post(
            "/api/pods",
            json={"name": "x", "tl_id": str(world.tl.id), "status": "asleep"},
            headers=auth(world.owner),
        ),
        client.post(
            f"/api/pods/{world.pod.id}/members",
            json={"user_id": str(world.other_ve.id), "pod_role": "supervisor"},
            headers=auth(world.tl),
        ),
        client.post(
            "/api/users",
            json={
                "name": "x", "email": "x@example.com", "password": "longenough",
                "role": "superuser",
            },
            headers=auth(world.owner),
        ),
        client.post(
            f"/api/pods/{world.pod.id}/brand-assets",
            params={"type": "contract", "title": "t"},
            files={"file": ("a.txt", b"x", "text/plain")},
            headers=auth(world.tl),
        ),
    ]
    for attempt in attempts:
        response = await attempt
        assert response.status_code == 422, response.text
