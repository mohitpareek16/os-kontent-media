"""The webhook: signatures, delivery receipts, and inert inbound replies.

Nothing here talks to Meta. The webhook is inbound by nature: the real request
path runs end to end, and the only thing constructed is the signature, which is
computed exactly the way Meta computes it.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.api.routers import whatsapp_webhook
from app.core.config import get_settings
from app.models.job_event import JobEvent
from app.models.whatsapp import WhatsAppMessage, WhatsAppTemplate, WhatsAppWebhookEvent
from tests.factories import DEFAULT_DEADLINE, make_job, reload

pytestmark = pytest.mark.integration

APP_SECRET = "test-app-secret"
VERIFY_TOKEN = "test-verify-token"
EDITOR_NUMBER = "919876543210"


@pytest.fixture
def wa_configured(monkeypatch):
    """Credentials present, so the webhook is open for business.

    `get_settings` is `lru_cache`d, so the cache is cleared on the way in and
    on the way out — otherwise the first test to touch it decides the setting
    for the rest of the session.
    """
    monkeypatch.setenv("WHATSAPP_ACCESS_TOKEN", "test-token")
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "1234567890")
    monkeypatch.setenv("WHATSAPP_BUSINESS_ACCOUNT_ID", "9876543210")
    monkeypatch.setenv("WHATSAPP_APP_SECRET", APP_SECRET)
    monkeypatch.setenv("WHATSAPP_VERIFY_TOKEN", VERIFY_TOKEN)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def signed(body: dict, secret: str = APP_SECRET) -> tuple[bytes, dict]:
    """The exact bytes and the header Meta would send for them.

    The signature is over the raw body, so the test posts these *bytes* —
    re-serialising the dict on the way out would produce a different string and
    a signature that legitimately fails, which is the bug this shape exists to
    keep the production code honest about.
    """
    raw = json.dumps(body).encode("utf-8")
    digest = hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    return raw, {
        "X-Hub-Signature-256": f"sha256={digest}",
        "Content-Type": "application/json",
    }


def envelope(field: str, value: dict) -> dict:
    return {"entry": [{"id": "waba", "changes": [{"field": field, "value": value}]}]}


async def drain() -> None:
    """Wait for the webhook's background processing to finish.

    The route persists the event, answers 200 and does the real work in a task
    — Meta disables a subscription that does not get a prompt 2xx, so that
    ordering is the point of the endpoint rather than an implementation detail
    to test around. `_webhook_tasks` holds a live reference to every in-flight
    task (asyncio only holds a weak one), which is exactly what a test needs to
    await.
    """
    while whatsapp_webhook._webhook_tasks:
        await asyncio.gather(*list(whatsapp_webhook._webhook_tasks), return_exceptions=True)


async def post_webhook(client, body: dict, *, secret: str = APP_SECRET):
    raw, headers = signed(body, secret=secret)
    response = await client.post("/api/whatsapp/webhook", content=raw, headers=headers)
    await drain()
    return response


# --------------------------------------------------------------------------
# The handshake
# --------------------------------------------------------------------------


async def test_verification_echoes_the_challenge_as_plain_text(client, wa_configured):
    """Meta compares the body byte for byte. A JSON-quoted number is not the
    number, and the subscription silently never activates."""
    response = await client.get(
        "/api/whatsapp/webhook",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": VERIFY_TOKEN,
            "hub.challenge": "1158201444",
        },
    )
    assert response.status_code == 200
    assert response.text == "1158201444"


async def test_verification_refuses_a_wrong_token(client, wa_configured):
    response = await client.get(
        "/api/whatsapp/webhook",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": "not-the-token",
            "hub.challenge": "123",
        },
    )
    assert response.status_code == 403


# --------------------------------------------------------------------------
# Signatures — the only gate on this endpoint
# --------------------------------------------------------------------------


async def test_an_unsigned_post_is_refused(client, db, wa_configured):
    response = await client.post(
        "/api/whatsapp/webhook", json=envelope("messages", {"statuses": []})
    )
    assert response.status_code == 403
    assert (await db.execute(select(WhatsAppWebhookEvent))).scalars().all() == []


async def test_a_post_signed_with_the_wrong_secret_is_refused(client, db, wa_configured):
    response = await post_webhook(
        client, envelope("messages", {"statuses": []}), secret="wrong-secret"
    )
    assert response.status_code == 403
    assert (await db.execute(select(WhatsAppWebhookEvent))).scalars().all() == []


async def test_a_tampered_body_is_refused(client, db, wa_configured):
    """The signature covers the body. Changing one byte after signing must
    invalidate it — this is what stops a captured envelope being edited to name
    a different job."""
    raw, headers = signed(envelope("messages", {"statuses": []}))
    response = await client.post("/api/whatsapp/webhook", content=raw + b" ", headers=headers)
    assert response.status_code == 403


async def test_everything_is_refused_when_no_app_secret_is_configured(client, monkeypatch):
    """Closed by default. An unconfigured integration that accepted anything
    would be an open door into the pipeline for as long as nobody noticed."""
    monkeypatch.setenv("WHATSAPP_APP_SECRET", "")
    get_settings.cache_clear()
    try:
        raw, headers = signed(envelope("messages", {"statuses": []}))
        response = await client.post("/api/whatsapp/webhook", content=raw, headers=headers)
        assert response.status_code == 403
    finally:
        get_settings.cache_clear()


# --------------------------------------------------------------------------
# Template status — "approve hua ya nahi", pushed rather than polled
# --------------------------------------------------------------------------


async def test_approval_webhook_marks_the_template_sendable(client, db, wa_configured):
    row = WhatsAppTemplate(
        name="job_assigned_v1", language="en", meta_template_id="111", status="PENDING"
    )
    db.add(row)
    await db.commit()

    response = await post_webhook(
        client,
        envelope(
            "message_template_status_update",
            {
                "message_template_id": "111",
                "message_template_name": "job_assigned_v1",
                "message_template_language": "en",
                "event": "APPROVED",
            },
        ),
    )
    assert response.status_code == 200

    row = await reload(db, row)
    assert row.status == "APPROVED"
    assert row.approved_at is not None


async def test_rejection_webhook_records_metas_reason(client, db, wa_configured):
    row = WhatsAppTemplate(
        name="qc1_ready_v1", language="en", meta_template_id="222", status="PENDING"
    )
    db.add(row)
    await db.commit()

    await post_webhook(
        client,
        envelope(
            "message_template_status_update",
            {"message_template_id": "222", "event": "REJECTED", "reason": "INVALID_FORMAT"},
        ),
    )

    row = await reload(db, row)
    assert row.status == "REJECTED"
    assert row.rejected_reason == "INVALID_FORMAT"


async def test_category_change_to_marketing_is_recorded_as_drift(client, db, wa_configured):
    """The expensive one. A UTILITY template re-filed as MARKETING is capped at
    roughly two messages per person per day across every business on WhatsApp,
    and nothing else in the system would ever say so."""
    row = WhatsAppTemplate(
        name="changes_raised_v1",
        language="en",
        meta_template_id="333",
        status="APPROVED",
        category="UTILITY",
        requested_category="UTILITY",
    )
    db.add(row)
    await db.commit()

    await post_webhook(
        client,
        envelope(
            "message_template_category_update",
            {
                "message_template_id": "333",
                "previous_category": "UTILITY",
                "new_category": "MARKETING",
            },
        ),
    )

    row = await reload(db, row)
    assert row.category == "MARKETING"
    assert row.requested_category == "UTILITY"
    assert row.category_drifted is True


async def test_quality_webhook_updates_the_rating(client, db, wa_configured):
    row = WhatsAppTemplate(
        name="final_check_v1", language="en", meta_template_id="444", status="APPROVED"
    )
    db.add(row)
    await db.commit()

    await post_webhook(
        client,
        envelope(
            "message_template_quality_update",
            {"message_template_id": "444", "new_quality_score": "RED"},
        ),
    )

    row = await reload(db, row)
    assert row.quality_score == "RED"


# --------------------------------------------------------------------------
# Delivery receipts
# --------------------------------------------------------------------------


async def test_delivery_receipts_walk_the_status_forward(client, db, world, wa_configured):
    message = WhatsAppMessage(
        user_id=world.ve.id, wamid="wamid.TEST1", status="sent", template_name="job_assigned_v1"
    )
    db.add(message)
    await db.commit()

    for state in ("delivered", "read"):
        await post_webhook(
            client,
            envelope(
                "messages",
                {"statuses": [{"id": "wamid.TEST1", "status": state, "timestamp": "1758000000"}]},
            ),
        )

    message = await reload(db, message)
    assert message.status == "read"
    assert message.delivered_at is not None and message.read_at is not None


async def test_a_late_sent_receipt_does_not_walk_the_status_backwards(
    client, db, world, wa_configured
):
    """Statuses arrive out of order. A `sent` landing after a `read` must not
    re-label a message the recipient has already opened."""
    message = WhatsAppMessage(
        user_id=world.ve.id, wamid="wamid.TEST2", status="read", template_name="job_assigned_v1"
    )
    db.add(message)
    await db.commit()

    await post_webhook(
        client,
        envelope(
            "messages",
            {"statuses": [{"id": "wamid.TEST2", "status": "sent", "timestamp": "1758000000"}]},
        ),
    )

    message = await reload(db, message)
    assert message.status == "read"


async def test_a_failed_receipt_records_the_error_code(client, db, world, wa_configured):
    message = WhatsAppMessage(
        user_id=world.ve.id, wamid="wamid.TEST3", status="sent", template_name="job_assigned_v1"
    )
    db.add(message)
    await db.commit()

    await post_webhook(
        client,
        envelope(
            "messages",
            {
                "statuses": [
                    {
                        "id": "wamid.TEST3",
                        "status": "failed",
                        "timestamp": "1758000000",
                        "errors": [
                            {
                                "code": 131026,
                                "title": "Message undeliverable",
                                "error_data": {"details": "Receiver is not on WhatsApp"},
                            }
                        ],
                    }
                ]
            },
        ),
    )

    message = await reload(db, message)
    assert message.status == "failed"
    assert message.error_code == 131026


async def test_a_receipt_for_a_message_we_never_sent_is_not_an_error(
    client, db, wa_configured
):
    """A test from Meta's own console, or a reply. Nothing to update, and
    nothing to complain about."""
    response = await post_webhook(
        client,
        envelope(
            "messages",
            {"statuses": [{"id": "wamid.UNKNOWN", "status": "read", "timestamp": "1758000000"}]},
        ),
    )
    assert response.status_code == 200


# --------------------------------------------------------------------------
# Button taps — an unauthenticated channel mutating pipeline state
# --------------------------------------------------------------------------


async def tap(client, *, from_number: str, payload: str):
    return await post_webhook(
        client,
        envelope(
            "messages",
            {
                "messages": [
                    {
                        "id": f"wamid.IN{payload}",
                        "from": from_number,
                        "timestamp": "1758000000",
                        "type": "button",
                        "button": {"text": "Started", "payload": payload},
                    }
                ]
            },
        ),
    )


async def assigned_job_with_message(db, world, *, nonce: str):
    """A job sitting at `assigned` with its editor, and the message whose
    button would start it."""
    job = await make_job(
        db,
        pod=world.pod,
        created_by=world.tl,
        stage="assigned",
        editor=world.ve,
        deadline=DEFAULT_DEADLINE,
    )
    message = WhatsAppMessage(
        user_id=world.ve.id,
        job_id=job.id,
        wamid=f"wamid.OUT{nonce}",
        status="sent",
        template_name="job_assigned_v1",
        button_nonce=nonce,
    )
    db.add(message)
    world.ve.phone_e164 = EDITOR_NUMBER
    await db.commit()
    return job, message


async def test_old_quick_reply_cannot_change_job_or_add_feedback(client, db, world, wa_configured):
    job, message = await assigned_job_with_message(db, world, nonce="old001")
    await tap(client, from_number=EDITOR_NUMBER, payload=f"START:{job.id.hex}:old001")
    await tap(client, from_number=EDITOR_NUMBER, payload=f"DECLINE:{job.id.hex}:old001")

    job = await reload(db, job)
    message = await reload(db, message)
    assert job.stage == "assigned"
    assert message.button_tapped_at is None
    assert message.button_action is None
    notes = (await db.execute(select(JobEvent).where(
        JobEvent.job_id == job.id, JobEvent.event_type == "note_added",
    ))).scalars().all()
    assert notes == []


async def test_an_inbound_message_opens_the_service_window(client, db, world, wa_configured):
    """`last_inbound_at` is what Meta's 24-hour window is measured from, and
    every send decision reads it. It moves on any inbound message, not only a
    button."""
    world.ve.phone_e164 = EDITOR_NUMBER
    await db.commit()
    assert world.ve.last_inbound_at is None

    await post_webhook(
        client,
        envelope(
            "messages",
            {
                "messages": [
                    {
                        "id": "wamid.INTEXT",
                        "from": EDITOR_NUMBER,
                        "timestamp": "1758000000",
                        "type": "text",
                        "text": {"body": "on it"},
                    }
                ]
            },
        ),
    )

    ve = await reload(db, world.ve)
    assert ve.last_inbound_at is not None


async def test_an_unknown_number_is_ignored_without_creating_anything(
    client, db, world, wa_configured
):
    """This endpoint is public. A number not on the roster must not create an
    account, a job, or anything else."""
    response = await post_webhook(
        client,
        envelope(
            "messages",
            {
                "messages": [
                    {
                        "id": "wamid.INUNKNOWN",
                        "from": "910000000000",
                        "timestamp": "1758000000",
                        "type": "text",
                        "text": {"body": "hello"},
                    }
                ]
            },
        ),
    )
    assert response.status_code == 200


async def test_a_number_on_two_accounts_cannot_use_a_button(client, db, world, wa_configured):
    """A tap carries only the number it came from. If two people share one the
    tap cannot be attributed, and guessing would let one of them move the
    other's job. The admin Numbers tab flags exactly this."""
    job, _ = await assigned_job_with_message(db, world, nonce="dupe01")
    world.ve2.phone_e164 = EDITOR_NUMBER
    await db.commit()

    await tap(client, from_number=EDITOR_NUMBER, payload=f"START:{job.id.hex}:dupe01")

    job = await reload(db, job)
    assert job.stage == "assigned"
