"""/voice-notes — one Frame.io asset is one video, whichever link you opened.

Frame.io serves the same asset as `/project/<project>/view/<asset>` to a
signed-in reviewer and as `/share/<share>/view/<asset>` to everyone else. Notes
were grouped by the raw URL, so the admin panel listed one cut twice and — the
part that actually mattered — two reviewers on the same video could not see
each other's notes, which is the entire point of the feature.
"""
from __future__ import annotations

import base64

import pytest

from tests.factories import auth, make_user

pytestmark = pytest.mark.integration

ASSET = "28ce7744-18ab-4d44-af72-9b0a995b0b16"
PROJECT_URL = f"https://next.frame.io/project/e146a03c-b6d1-414a-bcd1-982ec9af6cf4/view/{ASSET}"
SHARE_URL = f"https://next.frame.io/share/90029cd0-b3f8-4e34-a528-66a2dd15691a/view/{ASSET}"
OTHER_URL = "https://next.frame.io/project/e146a03c-b6d1-414a-bcd1-982ec9af6cf4/view/99999999-0000-0000-0000-000000000000"


async def _record(client, video_url, *, at=1.5, by="Milan", email="milan@kontentmedia.in"):
    """Upload one note the way the extension does — multipart, no auth."""
    return await client.post(
        "/api/voice-notes/",
        files={"audio": ("voice-note.webm", b"fake-audio-bytes", "audio/webm")},
        data={
            "video_url": video_url,
            "video_title": "file_example.mp4 - Frame.io",
            "timestamp_seconds": str(at),
            "duration_seconds": "4.25",
            "recorded_by": by,
            "recorded_by_email": email,
        },
    )


async def _notes_for(client, video_url):
    response = await client.get("/api/voice-notes/", params={"video_url": video_url})
    assert response.status_code == 200
    return response.json()


@pytest.fixture
async def owner(db):
    """Committed, because the request runs on its own session and cannot see
    a row this one has only flushed."""
    user = await make_user(db, role="owner")
    await db.commit()
    return user


@pytest.fixture
async def editor(db):
    user = await make_user(db, role="ve")
    await db.commit()
    return user


# --------------------------------------------------------------------------
# The bug: same asset, two links
# --------------------------------------------------------------------------


async def test_a_share_link_sees_the_notes_left_on_the_project_link(client):
    assert (await _record(client, PROJECT_URL, at=1.0)).status_code == 201
    assert (await _record(client, SHARE_URL, at=2.0)).status_code == 201

    # Whichever link you opened, you get both notes.
    assert len(await _notes_for(client, PROJECT_URL)) == 2
    assert len(await _notes_for(client, SHARE_URL)) == 2


async def test_a_different_asset_stays_separate(client):
    await _record(client, PROJECT_URL)
    await _record(client, OTHER_URL)

    assert len(await _notes_for(client, PROJECT_URL)) == 1
    assert len(await _notes_for(client, OTHER_URL)) == 1


async def test_query_string_on_the_link_does_not_hide_notes(client):
    """People paste links with a `?t=` on them straight out of the player."""
    await _record(client, PROJECT_URL)
    assert len(await _notes_for(client, PROJECT_URL + "?t=12.5")) == 1


async def test_notes_come_back_in_video_order(client):
    await _record(client, SHARE_URL, at=30.5)
    await _record(client, PROJECT_URL, at=2.25)

    stamps = [n["timestamp_seconds"] for n in await _notes_for(client, PROJECT_URL)]
    assert stamps == [2.25, 30.5]


async def test_millisecond_precision_survives_the_round_trip(client):
    """The extension captures `video.currentTime`, which is fractional — the
    admin panel now shows it to the millisecond, so it must not be rounded."""
    await _record(client, PROJECT_URL, at=29.933916)
    assert (await _notes_for(client, PROJECT_URL))[0]["timestamp_seconds"] == 29.933916


# --------------------------------------------------------------------------
# Identity
# --------------------------------------------------------------------------


async def test_the_recorders_name_and_email_are_stored(client):
    await _record(client, PROJECT_URL, by="Mukul", email="mukul.purohit@kontentmedia.in")

    note = (await _notes_for(client, PROJECT_URL))[0]
    assert note["recorded_by"] == "Mukul"
    assert note["recorded_by_email"] == "mukul.purohit@kontentmedia.in"


async def test_an_anonymous_note_is_still_accepted(client):
    """Older extension builds send neither field, and must keep working."""
    response = await client.post(
        "/api/voice-notes/",
        files={"audio": ("voice-note.webm", b"x", "audio/webm")},
        data={"video_url": PROJECT_URL, "timestamp_seconds": "0"},
    )
    assert response.status_code == 201
    assert response.json()["recorded_by"] is None
    assert response.json()["recorded_by_email"] is None


# --------------------------------------------------------------------------
# Admin listing
# --------------------------------------------------------------------------


async def test_admin_lists_one_video_for_both_links(client, owner):
    await _record(client, PROJECT_URL, at=1.0)
    await _record(client, SHARE_URL, at=2.0)

    response = await client.get("/api/voice-notes/admin/videos", headers=auth(owner))
    assert response.status_code == 200
    body = response.json()

    assert body["total"] == 1, "one asset must not be listed as two videos"
    assert body["total_notes"] == 2
    assert body["items"][0]["note_count"] == 2
    assert body["items"][0]["video_key"] == f"frameio:asset:{ASSET}"


async def test_admin_shows_the_link_from_the_most_recent_note(client, owner):
    """The row links somewhere real — the most recently reviewed URL, not
    whichever of the group's URLs happens to sort highest."""
    await _record(client, PROJECT_URL, at=1.0)
    await _record(client, SHARE_URL, at=2.0)

    response = await client.get("/api/voice-notes/admin/videos", headers=auth(owner))
    assert response.json()["items"][0]["video_url"] == SHARE_URL


async def test_admin_note_list_is_fetched_by_key(client, owner):
    await _record(client, PROJECT_URL, at=1.0)
    await _record(client, SHARE_URL, at=2.0)

    key = f"frameio:asset:{ASSET}"
    # Encoded the way the browser does it: url-safe, padding stripped.
    encoded = base64.urlsafe_b64encode(key.encode()).decode().rstrip("=")

    response = await client.get(
        f"/api/voice-notes/admin/videos/{encoded}/notes", headers=auth(owner)
    )
    assert response.status_code == 200
    assert len(response.json()) == 2


async def test_admin_listing_needs_an_admin(client, editor):
    response = await client.get("/api/voice-notes/admin/videos", headers=auth(editor))
    assert response.status_code == 403
