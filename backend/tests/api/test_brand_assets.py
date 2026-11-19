"""/pods/{id}/brand-assets — upload is Owner or the pod's own TL; read is
pod membership.

Item 4: upload accepted any pod member, so an editor could rewrite the brief
and the do-not list they are judged against. docs/04 gives VEs read access to
brand context and edit rights to nobody below TL.
"""
from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.models.brand_asset import BrandAsset
from tests.factories import auth

pytestmark = pytest.mark.integration


def _file(content: bytes = b"never use the old logo"):
    return {"file": ("do-not.txt", content, "text/plain")}


async def _upload(client, pod, user, *, type="do_not", title="Do-not list", content=b"x"):
    return await client.post(
        f"/api/pods/{pod.id}/brand-assets",
        params={"type": type, "title": title},
        files=_file(content),
        headers=auth(user),
    )


async def _asset_count(db) -> int:
    return (await db.execute(select(func.count()).select_from(BrandAsset))).scalar_one()


# --------------------------------------------------------------------------
# Upload — Owner / pod TL only
# --------------------------------------------------------------------------


async def test_the_pods_tl_can_upload(client, db, world):
    response = await _upload(client, world.pod, world.tl)
    assert response.status_code == 201
    assert response.json()["version"] == 1
    assert await _asset_count(db) == 1


async def test_the_owner_can_upload(client, db, world):
    assert (await _upload(client, world.pod, world.owner)).status_code == 201


async def test_a_ve_cannot_rewrite_the_do_not_list(client, db, world):
    """The regression, in the exact shape it mattered."""
    response = await _upload(client, world.pod, world.ve)
    assert response.status_code == 403
    assert await _asset_count(db) == 0


async def test_a_qc_member_cannot_upload(client, db, world):
    assert (await _upload(client, world.pod, world.qc)).status_code == 403
    assert await _asset_count(db) == 0


async def test_a_tl_of_another_pod_cannot_upload(client, db, world):
    assert (await _upload(client, world.pod, world.other_tl)).status_code == 403
    assert await _asset_count(db) == 0


async def test_an_unknown_asset_type_is_422(client, world):
    response = await _upload(client, world.pod, world.tl, type="contract")
    assert response.status_code == 422


async def test_reuploading_the_same_title_bumps_the_version(client, world):
    first = await _upload(client, world.pod, world.tl, content=b"v1")
    second = await _upload(client, world.pod, world.tl, content=b"v2")

    assert first.json()["version"] == 1
    assert second.json()["version"] == 2


# --------------------------------------------------------------------------
# Read / download — pod membership
# --------------------------------------------------------------------------


async def test_a_ve_can_read_the_brand_context_for_their_pod(client, world):
    """docs/04: 'Withholding brand context from the person executing the
    brand is how QC rounds happen.'"""
    await _upload(client, world.pod, world.tl)

    listing = await client.get(f"/api/pods/{world.pod.id}/brand-assets", headers=auth(world.ve))
    assert listing.status_code == 200
    assert len(listing.json()) == 1


async def test_a_non_member_cannot_list_brand_assets(client, world):
    await _upload(client, world.pod, world.tl)

    response = await client.get(
        f"/api/pods/{world.pod.id}/brand-assets", headers=auth(world.other_ve)
    )
    assert response.status_code == 403


async def test_a_pod_member_can_download_the_file(client, world):
    uploaded = await _upload(client, world.pod, world.tl, content=b"the actual bytes")
    asset_id = uploaded.json()["id"]

    response = await client.get(
        f"/api/pods/{world.pod.id}/brand-assets/{asset_id}/download", headers=auth(world.ve)
    )
    assert response.status_code == 200
    assert response.content == b"the actual bytes"


async def test_download_requires_pod_membership(client, world):
    uploaded = await _upload(client, world.pod, world.tl)
    asset_id = uploaded.json()["id"]

    response = await client.get(
        f"/api/pods/{world.pod.id}/brand-assets/{asset_id}/download",
        headers=auth(world.other_ve),
    )
    assert response.status_code == 403


async def test_the_owner_can_download_without_being_a_member(client, world):
    uploaded = await _upload(client, world.pod, world.tl)
    asset_id = uploaded.json()["id"]

    response = await client.get(
        f"/api/pods/{world.pod.id}/brand-assets/{asset_id}/download", headers=auth(world.owner)
    )
    assert response.status_code == 200


async def test_an_asset_cannot_be_fetched_through_another_pods_url(client, world):
    uploaded = await _upload(client, world.pod, world.tl)
    asset_id = uploaded.json()["id"]

    response = await client.get(
        f"/api/pods/{world.other_pod.id}/brand-assets/{asset_id}/download",
        headers=auth(world.owner),
    )
    assert response.status_code == 404
