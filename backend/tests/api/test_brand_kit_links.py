import pytest
from sqlalchemy import select

from app.models.brand_kit_event import BrandKitEvent
from app.models.notification import Notification
from tests.factories import auth

pytestmark = pytest.mark.integration


async def test_tl_link_change_has_history_and_notifies_pod_members(client, db, world):
    base = f"/api/pods/{world.pod.id}/brand-assets"
    created = await client.post(
        f"{base}/links", headers=auth(world.tl),
        json={"title": "Logo folder", "url": "https://example.com/logo", "category": "assets", "note": "Use the new marks"},
    )
    assert created.status_code == 201
    link_id = created.json()["id"]
    assert (await client.get(f"{base}/links", headers=auth(world.ve))).json()[0]["title"] == "Logo folder"

    changed = await client.put(
        f"{base}/links/{link_id}", headers=auth(world.tl),
        json={"title": "Final logo folder", "url": "https://example.com/final", "category": "assets", "note": "Old folder retired"},
    )
    assert changed.status_code == 200
    history = (await client.get(f"{base}/history", headers=auth(world.ve))).json()
    assert [item["action"] for item in history] == ["link_updated", "link_added"]
    assert history[0]["before"]["url"] == "https://example.com/logo"
    assert history[0]["after"]["url"] == "https://example.com/final"
    assert history[0]["note"] == "Old folder retired"
    assert (await db.execute(select(Notification).where(Notification.user_id == world.ve.id, Notification.brand_event_id.is_not(None)))).scalars().first()
    inbox = (await client.get("/api/notifications", headers=auth(world.ve))).json()["items"]
    assert inbox[0]["pod_id"] == str(world.pod.id)
    assert inbox[0]["event_type"] == "brand_kit_updated"
    assert inbox[0]["note"] == "Old folder retired"


async def test_non_members_cannot_see_links_or_history_and_editors_cannot_change_them(client, world):
    base = f"/api/pods/{world.pod.id}/brand-assets"
    payload = {"title": "Brand site", "url": "https://example.com", "category": "website"}
    assert (await client.get(f"{base}/links", headers=auth(world.other_ve))).status_code == 403
    assert (await client.get(f"{base}/history", headers=auth(world.other_ve))).status_code == 403
    assert (await client.post(f"{base}/links", headers=auth(world.ve), json=payload)).status_code == 403
    assert (await client.post(f"{base}/links", headers=auth(world.tl), json={**payload, "url": "javascript:alert(1)"})).status_code == 422


async def test_upload_note_is_recorded_and_notified(client, db, world):
    base = f"/api/pods/{world.pod.id}/brand-assets"
    response = await client.post(
        base, headers=auth(world.tl),
        params={"type": "kit", "title": "Fonts", "note": "Use these fonts on all new edits"},
        files={"file": ("brand.woff2", b"font", "font/woff2")},
    )
    assert response.status_code == 201
    event = (await db.execute(select(BrandKitEvent).where(BrandKitEvent.pod_id == world.pod.id))).scalar_one()
    assert event.note == "Use these fonts on all new edits"
    assert event.after["filename"] == "brand.woff2"
