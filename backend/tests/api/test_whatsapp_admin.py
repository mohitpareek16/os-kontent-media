"""The admin page's API: who may reach it, and what it reports.

Permission tests come first and are phrased as the exploit, per
docs/07-backend-rules.md. This router exposes the WABA id, the delivery log
for the whole company and a button that spends money, so "a TL cannot read
/whatsapp/status" is a regression test, not a formality.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.models.whatsapp import WhatsAppMessage, WhatsAppSettings, WhatsAppTemplate
from app.services.whatsapp import registry
from tests.factories import auth, reload

pytestmark = pytest.mark.integration


@pytest.fixture
def wa_configured(monkeypatch):
    monkeypatch.setenv("WHATSAPP_ACCESS_TOKEN", "test-token")
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "1234567890")
    monkeypatch.setenv("WHATSAPP_BUSINESS_ACCOUNT_ID", "9876543210")
    monkeypatch.setenv("WHATSAPP_APP_SECRET", "secret")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def graph(monkeypatch):
    """A scripted Graph API. Every admin route that reaches Meta goes through
    `GraphClient`, so the two verbs are all that need standing in for."""
    calls: list[dict] = []
    responses: dict[str, dict] = {}

    async def fake_get(self, path, params=None):
        calls.append({"verb": "GET", "path": path, "params": params})
        return responses.get(f"GET {path}", {})

    async def fake_post(self, path, json):
        calls.append({"verb": "POST", "path": path, "body": json})
        return responses.get(f"POST {path}", {"id": "meta-1", "status": "PENDING"})

    async def fake_delete(self, path, params=None):
        calls.append({"verb": "DELETE", "path": path, "params": params})
        return {"success": True}

    monkeypatch.setattr("app.services.whatsapp.client.GraphClient.get", fake_get)
    monkeypatch.setattr("app.services.whatsapp.client.GraphClient.post", fake_post)
    monkeypatch.setattr("app.services.whatsapp.client.GraphClient.delete", fake_delete)
    return {"calls": calls, "responses": responses}


# --------------------------------------------------------------------------
# Permissions — phrased as the exploit
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/api/whatsapp/status",
        "/api/whatsapp/templates",
        "/api/whatsapp/events",
        "/api/whatsapp/settings",
        "/api/whatsapp/messages",
        "/api/whatsapp/numbers",
    ],
)
async def test_a_tl_cannot_read_any_admin_route(client, world, path, wa_configured):
    """These expose the WABA id, the whole company's delivery log and every
    staff phone number. `ADMIN_ROLES` is the Owner and only the Owner."""
    response = await client.get(path, headers=auth(world.tl))
    assert response.status_code == 403


async def test_an_editor_cannot_switch_messaging_on(client, world, wa_configured):
    response = await client.patch(
        "/api/whatsapp/settings", json={"enabled": True}, headers=auth(world.ve)
    )
    assert response.status_code == 403


async def test_an_editor_cannot_submit_a_template(client, world, wa_configured, graph):
    response = await client.post(
        "/api/whatsapp/templates/video_assigned_v2/submit", headers=auth(world.ve)
    )
    assert response.status_code == 403


async def test_an_editor_cannot_read_someone_elses_number(client, world, wa_configured):
    response = await client.get("/api/whatsapp/numbers", headers=auth(world.ve))
    assert response.status_code == 403


async def test_anyone_can_read_and_set_their_own_opt_in(client, db, world, wa_configured):
    """Consent that only an Owner can record is consent nobody gives. `/me`
    returns the caller's own row and nothing else."""
    response = await client.get("/api/whatsapp/me", headers=auth(world.ve))
    assert response.status_code == 200
    assert response.json()["user_id"] == str(world.ve.id)
    assert response.json()["opt_in"] is False

    updated = await client.patch(
        "/api/whatsapp/me", json={"opt_in": True}, headers=auth(world.ve)
    )
    assert updated.status_code == 200
    assert updated.json()["opt_in"] is True
    assert (await reload(db, world.ve)).whatsapp_opt_in is True


# --------------------------------------------------------------------------
# Unconfigured is a normal state, and says so
# --------------------------------------------------------------------------


async def test_an_unconfigured_deployment_answers_503_with_the_missing_variable(
    client, world, monkeypatch
):
    monkeypatch.setenv("WHATSAPP_ACCESS_TOKEN", "")
    monkeypatch.setenv("WHATSAPP_BUSINESS_ACCOUNT_ID", "")
    get_settings.cache_clear()
    try:
        response = await client.post("/api/whatsapp/templates/sync", headers=auth(world.owner))
        assert response.status_code == 503
        assert "WHATSAPP_ACCESS_TOKEN" in response.json()["detail"]
    finally:
        get_settings.cache_clear()


async def test_status_reports_missing_credentials_without_leaking_the_token(
    client, world, wa_configured, graph
):
    graph["responses"]["GET 1234567890"] = {
        "display_phone_number": "+91 99999 00000",
        "verified_name": "Kontent Media",
        "quality_rating": "GREEN",
        "messaging_limit_tier": "TIER_1K",
    }
    response = await client.get("/api/whatsapp/status", headers=auth(world.owner))
    assert response.status_code == 200
    body = response.json()
    assert body["configured"] is True
    assert body["has_token"] is True
    assert body["quality_rating"] == "GREEN"
    # The token itself must not be anywhere in the response.
    assert "test-token" not in response.text


async def test_status_survives_meta_being_unreachable(client, world, wa_configured, monkeypatch):
    """An admin page that 500s because somebody else's API is down tells you
    nothing about which of the two is broken."""
    from app.services.whatsapp.client import MetaUnreachable

    async def boom(self, path, params=None):
        raise MetaUnreachable("connection reset")

    monkeypatch.setattr("app.services.whatsapp.client.GraphClient.get", boom)
    response = await client.get("/api/whatsapp/status", headers=auth(world.owner))
    assert response.status_code == 200
    assert "Unreachable" in response.json()["error"]


# --------------------------------------------------------------------------
# Templates
# --------------------------------------------------------------------------


async def test_templates_lists_every_registry_entry_as_missing_before_submission(
    client, world, wa_configured
):
    response = await client.get("/api/whatsapp/templates", headers=auth(world.owner))
    assert response.status_code == 200
    body = response.json()
    assert len(body) == len(registry.TEMPLATES)
    assert all(row["missing"] is True for row in body)
    assert all(row["status"] == "NOT_SUBMITTED" for row in body)


async def test_submitting_sends_the_registry_components_and_stamps_the_hash(
    client, db, world, wa_configured, graph
):
    graph["responses"]["POST 9876543210/message_templates"] = {
        "id": "meta-777",
        "status": "PENDING",
        "category": "UTILITY",
    }
    response = await client.post(
        "/api/whatsapp/templates/video_assigned_v2/submit", headers=auth(world.owner)
    )
    assert response.status_code == 200

    posted = next(c for c in graph["calls"] if c["verb"] == "POST")
    assert posted["body"]["name"] == "video_assigned_v2"
    assert posted["body"]["category"] == "UTILITY"
    assert all(component["type"] != "BUTTONS" for component in posted["body"]["components"])
    # Meta rejects a template whose sample values are missing — the commonest
    # first-submission rejection there is.
    body_component = next(c for c in posted["body"]["components"] if c["type"] == "BODY")
    assert body_component["example"]["body_text"]

    row = (
        await db.execute(
            select(WhatsAppTemplate).where(WhatsAppTemplate.name == "video_assigned_v2")
        )
    ).scalar_one()
    assert row.meta_template_id == "meta-777"
    assert row.registry_hash == registry.get("video_assigned_v2").hash()


async def test_meta_filing_a_submission_as_marketing_is_visible_immediately(
    client, db, world, wa_configured, graph
):
    """Meta re-categorises at creation time as well as after approval. Taking
    its word here means the drift shows up now rather than at the first send."""
    graph["responses"]["POST 9876543210/message_templates"] = {
        "id": "meta-888",
        "status": "PENDING",
        "category": "MARKETING",
    }
    response = await client.post(
        "/api/whatsapp/templates/first_draft_ready_v2/submit", headers=auth(world.owner)
    )
    assert response.status_code == 200
    assert response.json()["category"] == "MARKETING"
    assert response.json()["category_drifted"] is True


async def test_submitting_an_unknown_template_is_a_404_not_a_meta_call(
    client, world, wa_configured, graph
):
    response = await client.post(
        "/api/whatsapp/templates/not_a_template_v1/submit", headers=auth(world.owner)
    )
    assert response.status_code == 404
    assert graph["calls"] == []


async def test_a_meta_refusal_comes_back_in_metas_own_words(
    client, world, wa_configured, monkeypatch
):
    """Meta's messages on a submission are usually specific enough to act on.
    Replacing them with a generic sentence throws away the only useful thing in
    the response."""
    from app.services.whatsapp.client import MetaError

    async def refuse(self, path, json):
        raise MetaError(
            code=100,
            title="Invalid parameter",
            detail="body text cannot end with a variable",
            status=400,
        )

    monkeypatch.setattr("app.services.whatsapp.client.GraphClient.post", refuse)
    response = await client.post(
        "/api/whatsapp/templates/video_assigned_v2/submit", headers=auth(world.owner)
    )
    assert response.status_code == 400
    assert "cannot end with a variable" in response.json()["detail"]


async def test_drift_is_reported_when_the_code_moves_after_approval(
    client, db, world, wa_configured
):
    """The one failure Meta's own API cannot reveal: from its side the template
    is approved and unchanged, while the sender now fills a different parameter
    list into it."""
    spec = registry.get("video_assigned_v2")
    db.add(
        WhatsAppTemplate(
            name=spec.name,
            language=spec.language,
            status="APPROVED",
            registry_hash="a-hash-from-an-older-version",
            requested_category="UTILITY",
        )
    )
    await db.commit()

    response = await client.get("/api/whatsapp/templates", headers=auth(world.owner))
    row = next(r for r in response.json() if r["name"] == "video_assigned_v2")
    assert row["drifted"] is True
    assert row["missing"] is False


async def test_a_template_made_by_hand_at_meta_is_shown_as_unmanaged(
    client, db, world, wa_configured
):
    """Nothing here knows how to fill it, so it is never sent — but it is shown,
    because a row that appears nowhere is a row people conclude was lost."""
    db.add(
        WhatsAppTemplate(
            name="someone_made_this_by_hand", language="en", status="APPROVED"
        )
    )
    await db.commit()

    response = await client.get("/api/whatsapp/templates", headers=auth(world.owner))
    row = next(r for r in response.json() if r["name"] == "someone_made_this_by_hand")
    assert row["unmanaged"] is True


async def test_sync_overwrites_status_but_not_what_we_submitted(
    client, db, world, wa_configured, graph
):
    """Meta returns its own normalised components. Letting them win would erase
    the drift signal at the exact moment it became useful."""
    spec = registry.get("video_assigned_v2")
    db.add(
        WhatsAppTemplate(
            name=spec.name,
            language=spec.language,
            meta_template_id="meta-999",
            status="PENDING",
            registry_hash=spec.hash(),
            components={"components": spec.components()},
            requested_category="UTILITY",
        )
    )
    await db.commit()

    graph["responses"]["GET 9876543210/message_templates"] = {
        "data": [
            {
                "id": "meta-999",
                "name": spec.name,
                "language": spec.language,
                "status": "APPROVED",
                "category": "UTILITY",
                "quality_score": {"score": "GREEN"},
                "components": [{"type": "BODY", "text": "metas own normalised copy"}],
            }
        ]
    }
    response = await client.post("/api/whatsapp/templates/sync", headers=auth(world.owner))
    assert response.status_code == 200
    assert response.json()["seen"] == 1
    assert response.json()["changed"] == 1

    row = (
        await db.execute(
            select(WhatsAppTemplate).where(WhatsAppTemplate.name == spec.name)
        )
    ).scalar_one()
    assert row.status == "APPROVED"
    assert row.quality_score == "GREEN"
    assert row.registry_hash == spec.hash()
    assert row.components == {"components": spec.components()}


async def test_sync_reports_templates_meta_has_that_the_registry_does_not(
    client, world, wa_configured, graph
):
    graph["responses"]["GET 9876543210/message_templates"] = {
        "data": [
            {
                "id": "x",
                "name": "made_in_the_meta_ui",
                "language": "en",
                "status": "APPROVED",
                "category": "MARKETING",
            }
        ]
    }
    response = await client.post("/api/whatsapp/templates/sync", headers=auth(world.owner))
    assert response.json()["unmanaged"] == ["made_in_the_meta_ui"]


# --------------------------------------------------------------------------
# Events and settings
# --------------------------------------------------------------------------


async def test_events_reports_a_toggle_that_is_on_but_would_send_nothing(
    client, db, world, wa_configured
):
    """A switch can be on while the template behind it sits in review. Without
    saying so, the page shows green for something that sends nothing."""
    spec = registry.get("video_assigned_v2")
    db.add(
        WhatsAppTemplate(
            name=spec.name, language=spec.language, status="PENDING", requested_category="UTILITY"
        )
    )
    await db.commit()

    response = await client.get("/api/whatsapp/events", headers=auth(world.owner))
    row = next(r for r in response.json() if r["event_key"] == "stage_changed:assigned")
    assert row["enabled"] is True
    assert row["template_ready"] is False
    assert row["template_status"] == "PENDING"


async def test_settings_start_switched_off(client, world, wa_configured):
    """A migration that turned messaging on for the whole company the moment it
    ran would be a deploy nobody could take back."""
    response = await client.get("/api/whatsapp/settings", headers=auth(world.owner))
    assert response.status_code == 200
    assert response.json()["enabled"] is False


async def test_event_flags_are_merged_not_replaced(client, db, world, wa_configured):
    """The page sends the toggle that moved. A replace would silently re-enable
    everything turned off in a tab the operator did not have open."""
    await client.patch(
        "/api/whatsapp/settings",
        json={"event_flags": {"job_scrapped": False}},
        headers=auth(world.owner),
    )
    response = await client.patch(
        "/api/whatsapp/settings",
        json={"event_flags": {"qc1_flag_raised": False}},
        headers=auth(world.owner),
    )
    flags = response.json()["event_flags"]
    assert flags["job_scrapped"] is False
    assert flags["qc1_flag_raised"] is False


async def test_the_kill_switch_persists(client, db, world, wa_configured):
    response = await client.patch(
        "/api/whatsapp/settings", json={"enabled": True}, headers=auth(world.owner)
    )
    assert response.json()["enabled"] is True
    row = (await db.execute(select(WhatsAppSettings))).scalar_one()
    assert row.enabled is True


# --------------------------------------------------------------------------
# Numbers and the delivery log
# --------------------------------------------------------------------------


async def test_numbers_flags_who_cannot_be_reached_and_why(client, db, world, wa_configured):
    world.ve.phone = "9876543210"
    world.ve.phone_e164 = "919876543210"
    world.ve.whatsapp_opt_in = True
    world.qc.phone = "not a number"
    world.qc.phone_e164 = None
    await db.commit()

    response = await client.get("/api/whatsapp/numbers", headers=auth(world.owner))
    rows = {r["user_id"]: r for r in response.json()}
    assert rows[str(world.ve.id)]["reachable"] is True
    assert rows[str(world.qc.id)]["valid"] is False
    assert rows[str(world.qc.id)]["reachable"] is False


async def test_numbers_flags_a_number_shared_by_two_accounts(client, db, world, wa_configured):
    """A tap carries only the number it came from, so a shared one makes the
    button unusable for both of them."""
    world.ve.phone_e164 = "919876543210"
    world.ve.whatsapp_opt_in = True
    world.ve2.phone_e164 = "919876543210"
    world.ve2.whatsapp_opt_in = True
    await db.commit()

    response = await client.get("/api/whatsapp/numbers", headers=auth(world.owner))
    rows = {r["user_id"]: r for r in response.json()}
    assert rows[str(world.ve.id)]["duplicate"] is True
    assert rows[str(world.ve.id)]["reachable"] is False


async def test_renormalise_re_derives_the_dialable_number(client, db, world, wa_configured):
    world.ve.phone = "+91 98765 43210"
    world.ve.phone_e164 = None
    await db.commit()

    response = await client.patch(
        f"/api/whatsapp/numbers/{world.ve.id}",
        json={"renormalise": True},
        headers=auth(world.owner),
    )
    assert response.json()["phone_e164"] == "919876543210"
    assert response.json()["phone_display"] == "+919876543210"


async def test_the_delivery_log_pages_and_filters_in_sql(client, db, world, wa_configured):
    for index in range(5):
        db.add(
            WhatsAppMessage(
                user_id=world.ve.id,
                template_name="video_assigned_v2",
                status="sent" if index % 2 == 0 else "failed",
                event_key="stage_changed:assigned",
            )
        )
    await db.commit()

    page = await client.get(
        "/api/whatsapp/messages", params={"page_size": 2}, headers=auth(world.owner)
    )
    assert page.json()["total"] == 5
    assert len(page.json()["items"]) == 2

    failed = await client.get(
        "/api/whatsapp/messages", params={"status": "failed"}, headers=auth(world.owner)
    )
    assert failed.json()["total"] == 2


async def test_message_stats_count_the_window_not_the_page(client, db, world, wa_configured):
    for status_name in ("sent", "delivered", "read", "read", "failed", "skipped"):
        db.add(
            WhatsAppMessage(
                user_id=world.ve.id, template_name="video_assigned_v2", status=status_name
            )
        )
    await db.commit()

    response = await client.get("/api/whatsapp/messages/stats", headers=auth(world.owner))
    body = response.json()
    # Cumulative: read implies delivered implies sent.
    assert body["sent"] == 4
    assert body["delivered"] == 3
    assert body["read"] == 2
    assert body["failed"] == 1
    assert body["skipped"] == 1


async def test_a_test_send_runs_the_real_guard_rails(client, db, world, wa_configured, graph):
    """Deliberately not a bypass. "Nothing arrived" is diagnosed here rather
    than after a real hand-off goes missing."""
    response = await client.post(
        "/api/whatsapp/test-send",
        json={"template_name": "video_assigned_v2"},
        headers=auth(world.owner),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "skipped"
    # The Owner in the fixture world has no number and has not opted in.
    assert body["reason"]
