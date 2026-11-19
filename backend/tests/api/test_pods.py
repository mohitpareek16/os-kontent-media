"""/pods — who may lead a pod, and validation of the pod enums.

Item 5: a pod could be created with a VE as its `tl_id`. Because
`check_pod_lead` only compares that field, the VE then held full pod-lead
powers — members, checklist, analytics, every stage transition.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from app.models.pod import Pod
from tests.factories import add_member, auth, make_job, make_user, reload

pytestmark = pytest.mark.integration


async def _pod_count(db) -> int:
    return (await db.execute(select(func.count()).select_from(Pod))).scalar_one()


# --------------------------------------------------------------------------
# 5. A pod's TL must be a TL or Owner account
# --------------------------------------------------------------------------


async def test_a_pod_can_be_created_with_a_tl(client, db, world):
    response = await client.post(
        "/api/pods",
        json={"name": "New Client", "tl_id": str(world.tl.id)},
        headers=auth(world.owner),
    )
    assert response.status_code == 201
    assert response.json()["tl_id"] == str(world.tl.id)


async def test_a_ve_cannot_be_made_a_pods_tl(client, db, world):
    """The regression: this created the pod and handed the VE pod-lead
    powers over it."""
    response = await client.post(
        "/api/pods",
        json={"name": "Hijacked", "tl_id": str(world.ve.id)},
        headers=auth(world.owner),
    )
    assert response.status_code == 400
    assert "Team Lead role" in response.json()["detail"]
    assert await _pod_count(db) == 2  # only the two the fixture built


async def test_a_qc_cannot_be_made_a_pods_tl(client, db, world):
    response = await client.post(
        "/api/pods",
        json={"name": "Hijacked", "tl_id": str(world.qc.id)},
        headers=auth(world.owner),
    )
    assert response.status_code == 400
    assert await _pod_count(db) == 2


async def test_an_owner_may_lead_a_pod(client, db, world):
    response = await client.post(
        "/api/pods",
        json={"name": "Owner-led", "tl_id": str(world.owner.id)},
        headers=auth(world.owner),
    )
    assert response.status_code == 201


async def test_a_deactivated_tl_cannot_be_given_a_pod(client, db, world):
    world.tl.is_active = False
    await db.commit()

    response = await client.post(
        "/api/pods",
        json={"name": "Ghost pod", "tl_id": str(world.tl.id)},
        headers=auth(world.owner),
    )
    assert response.status_code == 400
    assert "deactivated" in response.json()["detail"]


async def test_an_unknown_tl_id_is_404(client, world):
    response = await client.post(
        "/api/pods",
        json={"name": "Nobody's pod", "tl_id": str(uuid.uuid4())},
        headers=auth(world.owner),
    )
    assert response.status_code == 404


async def test_the_new_pods_tl_is_added_as_a_member(client, db, world):
    response = await client.post(
        "/api/pods",
        json={"name": "Fresh", "tl_id": str(world.tl.id)},
        headers=auth(world.owner),
    )
    pod_id = response.json()["id"]

    members = await client.get(f"/api/pods/{pod_id}/members", headers=auth(world.tl))
    assert [m["user_id"] for m in members.json()] == [str(world.tl.id)]


async def test_a_ve_cannot_be_handed_a_pod_by_reassignment(client, db, world):
    """The same hole through the back door — PATCH must apply the same rule."""
    response = await client.patch(
        f"/api/pods/{world.pod.id}",
        json={"tl_id": str(world.ve.id)},
        headers=auth(world.owner),
    )
    assert response.status_code == 400
    assert (await reload(db, world.pod)).tl_id == world.tl.id


async def test_only_an_owner_may_reassign_a_pods_tl(client, db, world):
    response = await client.patch(
        f"/api/pods/{world.pod.id}",
        json={"tl_id": str(world.other_tl.id)},
        headers=auth(world.tl),
    )
    assert response.status_code == 403
    assert (await reload(db, world.pod)).tl_id == world.tl.id


async def test_a_ve_who_is_not_the_tl_gets_no_pod_lead_powers(client, db, world):
    """The consequence the rule exists to prevent, asserted directly."""
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="final", editor=world.ve)
    await db.commit()

    for request in (
        client.post(
            f"/api/pods/{world.pod.id}/members",
            json={"user_id": str(world.ve2.id), "pod_role": "ve"},
            headers=auth(world.ve),
        ),
        client.patch(
            f"/api/jobs/{job.id}/checklist",
            json={"client_sheet_ok": True},
            headers=auth(world.ve),
        ),
        client.get(
            f"/api/pods/{world.pod.id}/analytics/stage-distribution", headers=auth(world.ve)
        ),
    ):
        assert (await request).status_code == 403


# --------------------------------------------------------------------------
# 12. Enum validation — 422 from the schema, never a 500 from Postgres
# --------------------------------------------------------------------------


async def test_an_unknown_pod_status_is_422_on_create(client, world):
    response = await client.post(
        "/api/pods",
        json={"name": "Bad status", "tl_id": str(world.tl.id), "status": "dormant"},
        headers=auth(world.owner),
    )
    assert response.status_code == 422


async def test_an_unknown_pod_status_is_422_on_update(client, world):
    response = await client.patch(
        f"/api/pods/{world.pod.id}", json={"status": "dormant"}, headers=auth(world.owner)
    )
    assert response.status_code == 422


@pytest.mark.parametrize("status", ["active", "paused", "churned"])
async def test_every_documented_pod_status_is_accepted(client, db, world, status):
    response = await client.patch(
        f"/api/pods/{world.pod.id}", json={"status": status}, headers=auth(world.owner)
    )
    assert response.status_code == 200
    assert response.json()["status"] == status


async def test_an_unknown_pod_role_is_422(client, world):
    response = await client.post(
        f"/api/pods/{world.pod.id}/members",
        json={"user_id": str(world.other_ve.id), "pod_role": "boss"},
        headers=auth(world.tl),
    )
    assert response.status_code == 422


@pytest.mark.parametrize("pod_role", ["tl", "qc", "ve"])
async def test_every_documented_pod_role_is_accepted(client, db, world, pod_role):
    # Somebody who actually holds all three, since a member has to hold the
    # role they are added as — see the test below.
    newcomer = await make_user(db, role=pod_role)
    await db.commit()

    response = await client.post(
        f"/api/pods/{world.pod.id}/members",
        json={"user_id": str(newcomer.id), "pod_role": pod_role},
        headers=auth(world.tl),
    )
    assert response.status_code == 201


async def test_a_negative_retainer_volume_is_422(client, world):
    response = await client.post(
        "/api/pods",
        json={"name": "Bad retainer", "tl_id": str(world.tl.id), "retainer_volume": -5},
        headers=auth(world.owner),
    )
    assert response.status_code == 422


async def test_an_empty_pod_name_is_422(client, world):
    response = await client.post(
        "/api/pods", json={"name": "", "tl_id": str(world.tl.id)}, headers=auth(world.owner)
    )
    assert response.status_code == 422


# --------------------------------------------------------------------------
# Pod visibility
# --------------------------------------------------------------------------


async def test_pod_listing_is_scoped_to_membership(client, world):
    owner_view = await client.get("/api/pods", headers=auth(world.owner))
    assert {p["id"] for p in owner_view.json()["items"]} == {
        str(world.pod.id),
        str(world.other_pod.id),
    }
    # The status tabs count the same scoped set the rows come from.
    assert owner_view.json()["counts"]["all"] == 2

    tl_view = await client.get("/api/pods", headers=auth(world.tl))
    assert {p["id"] for p in tl_view.json()["items"]} == {str(world.pod.id)}
    assert tl_view.json()["counts"]["all"] == 1

    ve_view = await client.get("/api/pods", headers=auth(world.ve))
    assert {p["id"] for p in ve_view.json()["items"]} == {str(world.pod.id)}


async def test_a_non_member_cannot_list_a_pods_members(client, world):
    response = await client.get(
        f"/api/pods/{world.other_pod.id}/members", headers=auth(world.ve)
    )
    assert response.status_code == 403


async def test_only_the_pods_tl_may_add_members(client, db, world):
    newcomer = await make_user(db, role="ve")
    await db.commit()

    refused = await client.post(
        f"/api/pods/{world.pod.id}/members",
        json={"user_id": str(newcomer.id), "pod_role": "ve"},
        headers=auth(world.other_tl),
    )
    assert refused.status_code == 403

    allowed = await client.post(
        f"/api/pods/{world.pod.id}/members",
        json={"user_id": str(newcomer.id), "pod_role": "ve"},
        headers=auth(world.tl),
    )
    assert allowed.status_code == 201


async def test_a_member_must_hold_the_role_they_are_added_as(client, db, world):
    """`pod_role` is load-bearing — a "ve" row puts somebody in editor
    pickers, QC routing and the certification history as if they cut video.
    So the account has to actually hold the role, whether that is their own
    or one lent to them.

    This replaces a flat "HR accounts are not pod members": HR joins a pod
    like anyone else once it holds TL, and an HR who does not is refused here
    for the reason that is actually true of them."""
    hr = await make_user(db, role="hr")
    designer = await make_user(db, role="staff")
    await db.commit()

    for account in (hr, designer):
        response = await client.post(
            f"/api/pods/{world.pod.id}/members",
            json={"user_id": str(account.id), "pod_role": "ve"},
            headers=auth(world.tl),
        )
        assert response.status_code == 400
        assert "does not hold the VE role" in response.json()["detail"]


async def test_a_lent_tl_can_be_added_as_a_pods_tl(client, db, world):
    designer_who_leads = await make_user(db, role="staff", secondary_role="tl")
    await db.commit()

    response = await client.post(
        f"/api/pods/{world.pod.id}/members",
        json={"user_id": str(designer_who_leads.id), "pod_role": "tl"},
        headers=auth(world.tl),
    )
    assert response.status_code == 201
