"""Owner-managed video categories and QC price snapshots."""

import pytest

from app.models.qc2_charge import Qc2Charge
from app.models.video_type import VideoType
from app.services.routing import charge
from tests.factories import auth, make_job

pytestmark = pytest.mark.integration


async def test_owner_can_add_and_edit_type_while_team_can_read(client, world):
    url = "/api/video-types"
    payload = {"key": "motion_graphics", "label": "Motion graphics", "qc_points": 5}
    assert (await client.post(url, json=payload, headers=auth(world.tl))).status_code == 403
    created = await client.post(url, json=payload, headers=auth(world.owner))
    assert created.status_code == 201, created.text
    assert created.json()["qc_points"] == 5
    assert any(row["key"] == "motion_graphics" for row in (await client.get(url, headers=auth(world.ve))).json())
    assert (await client.patch(f"{url}/motion_graphics", json={"qc_points": 7}, headers=auth(world.tl))).status_code == 403
    updated = await client.patch(f"{url}/motion_graphics", json={"qc_points": 7}, headers=auth(world.owner))
    assert updated.status_code == 200
    assert updated.json()["qc_points"] == 7
    assert (await client.post(url, json={**payload, "key": "motion_copy"}, headers=auth(world.owner))).status_code == 409
    assert (await client.patch(f"{url}/motion_graphics", json={"qc_points": 0}, headers=auth(world.owner))).status_code == 422
    job = await client.post("/api/jobs", json={"title": "Animated opener", "pod_id": str(world.pod.id), "video_type": "motion_graphics"}, headers=auth(world.tl))
    assert job.status_code == 201, job.text
    assert job.json()["video_type"] == "motion_graphics"


async def test_disabling_hides_type_from_new_work_but_keeps_existing_job(client, db, world):
    existing = await make_job(db, pod=world.pod, created_by=world.tl, video_type="podcast")
    await db.commit()
    result = await client.patch("/api/video-types/podcast", json={"enabled": False}, headers=auth(world.owner))
    assert result.status_code == 200
    assert (await client.post("/api/jobs", json={"title": "New show", "pod_id": str(world.pod.id), "video_type": "podcast"}, headers=auth(world.tl))).status_code == 422
    old = await client.get(f"/api/jobs/{existing.id}", headers=auth(world.tl))
    assert old.status_code == 200
    assert old.json()["video_type"] == "podcast"
    assert (await client.patch("/api/video-types/long_form", json={"enabled": False}, headers=auth(world.owner))).status_code == 200
    fallback = await client.post("/api/jobs", json={"title": "Type omitted", "pod_id": str(world.pod.id)}, headers=auth(world.tl))
    assert fallback.status_code == 201
    assert fallback.json()["video_type"] == "short_form"
    batch = await client.post("/api/jobs/batch", json={"pod_id": str(world.pod.id), "jobs": [{"title": "Batch with no type"}]}, headers=auth(world.tl))
    assert batch.status_code == 201
    assert batch.json()[0]["video_type"] == "short_form"
    assert (await client.post("/api/jobs", json={"title": "Disabled explicitly", "pod_id": str(world.pod.id), "video_type": "long_form"}, headers=auth(world.tl))).status_code == 422
    assert (await client.patch("/api/video-types/short_form", json={"enabled": False}, headers=auth(world.owner))).status_code == 400


async def test_point_edits_price_future_reviews_without_rewriting_ledger(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.tl, video_type="long_form", stage="qc2")
    first = await charge(db, job=job, reviewer_id=world.qc.id)
    await db.commit()
    assert first.points == 3
    first_id = first.id
    response = await client.patch("/api/video-types/long_form", json={"qc_points": 9}, headers=auth(world.owner))
    assert response.status_code == 200
    await db.refresh(await db.get(VideoType, "long_form"))
    second_job = await make_job(db, pod=world.pod, created_by=world.tl, video_type="long_form", stage="qc2")
    second = await charge(db, job=second_job, reviewer_id=world.qc.id)
    await db.commit()
    assert (await db.get(Qc2Charge, first_id)).points == 3
    assert second.points == 9
