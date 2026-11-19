"""The guard rails, the fan-out, and what a job move actually sends.

Nothing here reaches Meta. `GraphClient.post` is the single call that does, so
it is the single thing replaced — everything above it (which events send, to
whom, with what parameters, and every reason not to) is the real code path.

The assertions that matter most are the negative ones. A skipped message leaves
a row saying *why*, and "why didn't Farah get it" is the question this
integration exists to be able to answer.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.models.whatsapp import WhatsAppMessage, WhatsAppSettings, WhatsAppTemplate
from app.services.whatsapp import registry, send
from app.services.whatsapp.client import MetaError
from tests.factories import DEFAULT_DEADLINE, auth, make_job

pytestmark = pytest.mark.integration


@pytest.fixture
def wa_on(monkeypatch):
    """A fully configured, switched-on integration that records sends.

    Returns the list of payloads handed to Meta, so a test can assert on the
    template name, the parameters and the button payload without a network.
    """
    monkeypatch.setenv("WHATSAPP_ACCESS_TOKEN", "test-token")
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "1234567890")
    monkeypatch.setenv("WHATSAPP_BUSINESS_ACCOUNT_ID", "9876543210")
    monkeypatch.setenv("WHATSAPP_APP_SECRET", "secret")
    get_settings.cache_clear()

    sent: list[dict] = []
    failures: dict[str, Exception] = {}

    async def fake_post(self, path, json):
        sent.append({"path": path, "body": json})
        name = (json.get("template") or {}).get("name")
        if name in failures:
            raise failures[name]
        return {"messages": [{"id": f"wamid.FAKE{len(sent)}"}]}

    monkeypatch.setattr("app.services.whatsapp.client.GraphClient.post", fake_post)
    yield {"sent": sent, "failures": failures}
    get_settings.cache_clear()


async def approve(db, *names: str) -> None:
    """Mark templates approved in the mirror — the sender reads this, not Meta."""
    for name in names:
        spec = registry.get(name)
        db.add(
            WhatsAppTemplate(
                name=name,
                language=spec.language,
                meta_template_id=f"id-{name}",
                status="APPROVED",
                category="UTILITY",
                requested_category="UTILITY",
                registry_hash=spec.hash(),
            )
        )
    await db.flush()


async def switch_on(db, **overrides) -> WhatsAppSettings:
    fields = {"enabled": True, "pilot_user_ids": [], "event_flags": {}, **overrides}
    row = WhatsAppSettings(**fields)
    db.add(row)
    await db.flush()
    return row


async def reachable(db, user, number="919876543210"):
    user.phone_e164 = number
    user.whatsapp_opt_in = True
    await db.flush()
    return user


async def messages_for(db, user_id) -> list[WhatsAppMessage]:
    return (
        (
            await db.execute(
                select(WhatsAppMessage)
                .where(WhatsAppMessage.user_id == user_id)
                .order_by(WhatsAppMessage.created_at)
            )
        )
        .scalars()
        .all()
    )


# --------------------------------------------------------------------------
# The guard rails, in the order they run
# --------------------------------------------------------------------------


async def test_a_switched_off_integration_skips_with_a_reason(db, world, wa_on):
    await approve(db, "video_assigned_v2")
    await switch_on(db)
    settings_row = (await db.execute(select(WhatsAppSettings))).scalar_one()
    settings_row.enabled = False
    await reachable(db, world.ve)
    await db.commit()

    message = await send.send_template(
        db,
        recipient=world.ve,
        template_name="video_assigned_v2",
        context=_context(world.ve),
        event_key="test",
    )
    assert message.status == "skipped"
    assert "switched off" in message.reason
    assert wa_on["sent"] == []


async def test_an_opted_out_account_is_skipped(db, world, wa_on):
    await approve(db, "video_assigned_v2")
    await switch_on(db)
    world.ve.phone_e164 = "919876543210"
    world.ve.whatsapp_opt_in = False
    await db.commit()

    message = await send.send_template(
        db,
        recipient=world.ve,
        template_name="video_assigned_v2",
        context=_context(world.ve),
        event_key="test",
    )
    assert message.status == "skipped"
    assert "opted in" in message.reason


async def test_no_phone_number_is_skipped_with_a_pointer_to_the_fix(db, world, wa_on):
    """Six people with no usable number means six people silently missing every
    hand-off. The row says where to go and fix it."""
    await approve(db, "video_assigned_v2")
    await switch_on(db)
    world.ve.whatsapp_opt_in = True
    world.ve.phone_e164 = None
    await db.commit()

    message = await send.send_template(
        db,
        recipient=world.ve,
        template_name="video_assigned_v2",
        context=_context(world.ve),
        event_key="test",
    )
    assert message.status == "skipped"
    assert "Numbers tab" in message.reason


async def test_an_unapproved_template_is_never_sent(db, world, wa_on):
    """The check that matters most. Meta review can take a day, and without
    this every hand-off in that window is a 132001 logged as an error that is
    nobody's fault."""
    spec = registry.get("video_assigned_v2")
    db.add(
        WhatsAppTemplate(
            name="video_assigned_v2",
            language=spec.language,
            status="PENDING",
            requested_category="UTILITY",
        )
    )
    await switch_on(db)
    await reachable(db, world.ve)
    await db.commit()

    message = await send.send_template(
        db,
        recipient=world.ve,
        template_name="video_assigned_v2",
        context=_context(world.ve),
        event_key="test",
    )
    assert message.status == "skipped"
    assert "PENDING" in message.reason
    assert wa_on["sent"] == []


async def test_a_never_submitted_template_is_skipped(db, world, wa_on):
    await switch_on(db)
    await reachable(db, world.ve)
    await db.commit()

    message = await send.send_template(
        db,
        recipient=world.ve,
        template_name="video_assigned_v2",
        context=_context(world.ve),
        event_key="test",
    )
    assert message.status == "skipped"
    assert "never been submitted" in message.reason


async def test_an_account_outside_the_pilot_is_skipped(db, world, wa_on):
    """An empty pilot list means everybody; a non-empty one is a ramp."""
    await approve(db, "video_assigned_v2")
    await switch_on(db, pilot_user_ids=[str(world.tl.id)])
    await reachable(db, world.ve)
    await db.commit()

    message = await send.send_template(
        db,
        recipient=world.ve,
        template_name="video_assigned_v2",
        context=_context(world.ve),
        event_key="test",
    )
    assert message.status == "skipped"
    assert "pilot" in message.reason


async def test_a_switched_off_event_is_skipped(db, world, wa_on):
    await approve(db, "video_assigned_v2")
    await switch_on(db, event_flags={"stage_changed:assigned": False})
    await reachable(db, world.ve)
    await db.commit()

    message = await send.send_template(
        db,
        recipient=world.ve,
        template_name="video_assigned_v2",
        context=_context(world.ve),
        event_key="stage_changed:assigned",
    )
    assert message.status == "skipped"
    assert "switched off" in message.reason


async def test_a_missing_event_flag_means_enabled(db, world, wa_on):
    """A new event added in code should work on deploy, not wait for somebody
    to notice a toggle they have never seen."""
    await approve(db, "video_assigned_v2")
    await switch_on(db, event_flags={"something:else": False})
    await reachable(db, world.ve)
    await db.commit()

    message = await send.send_template(
        db,
        recipient=world.ve,
        template_name="video_assigned_v2",
        context=_context(world.ve),
        event_key="stage_changed:assigned",
    )
    assert message.status == "sent"


# --------------------------------------------------------------------------
# What actually goes over the wire
# --------------------------------------------------------------------------


def _context(user) -> dict:
    return {
        "recipient_name": user.name,
        "actor_name": "Rahul",
        "job_code": "KM-1052",
        "job_title": "Diwali teaser",
        "pod_name": "Dhan",
        "video_type": "Short form",
        "deadline": "24 Sep",
        "round": 1,
        "stage_label": "Assigned",
        "from_stage_label": "QC 2",
        "note": "nothing",
        "points": 1,
        "editor_name": user.name,
    }


async def test_a_sent_message_records_the_wamid_and_the_parameters(db, world, wa_on):
    await approve(db, "video_assigned_v2")
    await switch_on(db)
    await reachable(db, world.ve)
    await db.commit()

    message = await send.send_template(
        db,
        recipient=world.ve,
        template_name="video_assigned_v2",
        context=_context(world.ve),
        event_key="stage_changed:assigned",
    )
    assert message.status == "sent"
    assert message.wamid == "wamid.FAKE1"
    # The interpolated values are kept: without them "why did it say the
    # deadline was yesterday" has no answer once the job has moved on.
    assert message.params["body"][1] == "Diwali teaser"

    body = wa_on["sent"][0]["body"]
    assert body["messaging_product"] == "whatsapp"
    assert body["to"] == "919876543210"
    assert body["template"]["name"] == "video_assigned_v2"


async def test_notification_template_sends_no_buttons(db, world, wa_on):
    await approve(db, "video_assigned_v2")
    await switch_on(db)
    await reachable(db, world.ve)
    await db.commit()

    message = await send.send_template(
        db, recipient=world.ve, template_name="video_assigned_v2",
        context=_context(world.ve), event_key="stage_changed:assigned",
    )
    components = wa_on["sent"][0]["body"]["template"]["components"]
    assert all(component["type"] != "button" for component in components)
    assert message.button_nonce is None


async def test_template_reclassified_as_marketing_is_not_sent(db, world, wa_on):
    await approve(db, "video_assigned_v2")
    await switch_on(db)
    await reachable(db, world.ve)
    template = (await db.execute(select(WhatsAppTemplate))).scalar_one()
    template.category = "MARKETING"
    await db.commit()

    message = await send.send_template(
        db, recipient=world.ve, template_name="video_assigned_v2",
        context=_context(world.ve), event_key="stage_changed:assigned",
    )
    assert message.status == "skipped"
    assert "Utility" in message.reason
    assert wa_on["sent"] == []


async def test_a_meta_refusal_is_recorded_in_english_with_its_code(db, world, wa_on):
    await approve(db, "video_assigned_v2")
    await switch_on(db)
    await reachable(db, world.ve)
    await db.commit()
    wa_on["failures"]["video_assigned_v2"] = MetaError(
        code=131049, title="Limit reached", detail="Marketing cap", status=400
    )

    message = await send.send_template(
        db,
        recipient=world.ve,
        template_name="video_assigned_v2",
        context=_context(world.ve),
        event_key="stage_changed:assigned",
    )
    assert message.status == "failed"
    assert message.error_code == 131049
    assert message.reason == "Marketing cap"
    assert "MARKETING" in message.error_detail


async def test_send_never_raises_even_when_everything_is_wrong(db, world, wa_on):
    """A contract, not laziness. This runs in a background task after the
    response, and an exception escaping one takes the worker with it."""
    await approve(db, "video_assigned_v2")
    await switch_on(db)
    await reachable(db, world.ve)
    await db.commit()
    wa_on["failures"]["video_assigned_v2"] = RuntimeError("something unexpected")

    message = await send.send_template(
        db,
        recipient=world.ve,
        template_name="video_assigned_v2",
        context=_context(world.ve),
        event_key="stage_changed:assigned",
    )
    assert message.status == "failed"
    assert message.reason == "Unexpected error"


# --------------------------------------------------------------------------
# The fan-out: a real job move, end to end
# --------------------------------------------------------------------------


async def test_assigning_a_job_messages_the_editor(client, db, world, wa_on):
    """The whole path: an HTTP move writes a notification, the middleware
    flushes it after the response, and the editor's phone rings."""
    await approve(db, "video_assigned_v2")
    await switch_on(db)
    await reachable(db, world.ve)
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="intake")
    await db.commit()

    response = await client.post(
        f"/api/jobs/{job.id}/advance",
        json={
            "stage": "assigned",
            "assigned_editor_id": str(world.ve.id),
            "deadline": str(DEFAULT_DEADLINE),
        },
        headers=auth(world.tl),
    )
    assert response.status_code == 200
    await _drain_dispatch()

    rows = await messages_for(db, world.ve.id)
    assert len(rows) == 1
    assert rows[0].template_name == "video_assigned_v2"
    assert rows[0].status == "sent"
    assert rows[0].job_id == job.id


async def test_a_tier_three_event_sends_nothing(client, db, world, wa_on):
    """Most events are in-app only, and that is the design — six messages a
    video across twenty-two people is eighty pings each a month before anything
    optional is added."""
    await approve(db, "video_assigned_v2")
    await switch_on(db)
    await reachable(db, world.ve)
    job = await make_job(
        db,
        pod=world.pod,
        created_by=world.tl,
        stage="assigned",
        editor=world.ve,
        deadline=DEFAULT_DEADLINE,
    )
    await db.commit()

    # assigned -> editing: the editor's own move, in-app only.
    response = await client.post(
        f"/api/jobs/{job.id}/advance", json={"stage": "editing"}, headers=auth(world.ve)
    )
    assert response.status_code == 200
    await _drain_dispatch()

    assert await messages_for(db, world.ve.id) == []


async def test_qc2_send_back_messages_editor_without_feedback_in_whatsapp(client, db, world, wa_on):
    await approve(db, "qc_changes_v2")
    await switch_on(db)
    await reachable(db, world.ve)
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2",
        editor=world.ve, reviewer=world.qc, deadline=DEFAULT_DEADLINE,
    )
    await db.commit()

    response = await client.post(
        f"/api/jobs/{job.id}/advance",
        json={"stage": "revisions", "note": "Colour grade is too warm from 0:14"},
        headers=auth(world.qc),
    )
    assert response.status_code == 200
    await _drain_dispatch()
    rows = await messages_for(db, world.ve.id)
    assert len(rows) == 1
    assert rows[0].template_name == "qc_changes_v2"
    assert "Colour grade" not in rows[0].params["body"]


@pytest.mark.parametrize(
    "body, result",
    [
        ({"stage": "final"}, "Approved, ready for your final review"),
        ({"stage": "revisions", "note": "Fix the intro"}, "Changes requested, sent back to the editor"),
    ],
)
async def test_qc2_completion_messages_the_tl(client, db, world, wa_on, body, result):
    await approve(db, "qc2_completed_tl_v2")
    await switch_on(db)
    await reachable(db, world.tl)
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2",
        editor=world.ve, reviewer=world.qc, deadline=DEFAULT_DEADLINE,
    )
    await db.commit()

    response = await client.post(
        f"/api/jobs/{job.id}/advance", json=body, headers=auth(world.qc)
    )
    assert response.status_code == 200
    await _drain_dispatch()
    rows = await messages_for(db, world.tl.id)
    assert [r.template_name for r in rows] == ["qc2_completed_tl_v2"]
    assert rows[0].status == "sent"
    assert rows[0].params["body"][-1] == result


async def test_a_recut_after_a_qc1_send_back_is_the_final_draft(client, db, world, wa_on):
    """The re-cut reaches QC1 from `editing`, exactly like a first draft — the
    TL must still be told it is the revised one, not the first again."""
    await approve(db, "first_draft_ready_v2", "final_draft_ready_v2")
    await switch_on(db)
    await reachable(db, world.tl)
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc1",
        editor=world.ve, deadline=DEFAULT_DEADLINE,
    )
    await db.commit()

    for actor, body in (
        (world.tl, {"stage": "revisions", "note": "Tighten the intro"}),
        (world.ve, {"stage": "editing"}),
        (world.ve, {"stage": "qc1"}),
    ):
        response = await client.post(
            f"/api/jobs/{job.id}/advance", json=body, headers=auth(actor)
        )
        assert response.status_code == 200
    await _drain_dispatch()

    rows = await messages_for(db, world.tl.id)
    assert [r.template_name for r in rows] == ["final_draft_ready_v2"]
    assert rows[0].status == "sent"


async def test_the_person_who_made_the_move_is_never_messaged(client, db, world, wa_on):
    """Inherited from `notify()`, which already excludes the actor — this
    channel sends to whoever it decided on, and that is the point of not
    re-deriving the recipient here."""
    await approve(db, "first_draft_ready_v2")
    await switch_on(db)
    await reachable(db, world.ve, "919876543210")
    await reachable(db, world.tl, "919876543211")
    job = await make_job(
        db,
        pod=world.pod,
        created_by=world.tl,
        stage="editing",
        editor=world.ve,
        deadline=DEFAULT_DEADLINE,
    )
    await db.commit()

    await client.post(
        f"/api/jobs/{job.id}/advance", json={"stage": "qc1"}, headers=auth(world.ve)
    )
    await _drain_dispatch()

    assert await messages_for(db, world.ve.id) == []
    assert len(await messages_for(db, world.tl.id)) == 1


async def test_a_whatsapp_failure_does_not_break_the_job_move(client, db, world, wa_on):
    """WhatsApp is additive and never authoritative. The stage change is
    committed before anything is sent, and stays committed if the send dies."""
    await approve(db, "video_assigned_v2")
    await switch_on(db)
    await reachable(db, world.ve)
    wa_on["failures"]["video_assigned_v2"] = MetaError(code=131031, title="Locked", status=400)
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="intake")
    await db.commit()

    response = await client.post(
        f"/api/jobs/{job.id}/advance",
        json={
            "stage": "assigned",
            "assigned_editor_id": str(world.ve.id),
            "deadline": str(DEFAULT_DEADLINE),
        },
        headers=auth(world.tl),
    )
    assert response.status_code == 200
    await _drain_dispatch()

    from tests.factories import reload

    job = await reload(db, job)
    assert job.stage == "assigned"
    rows = await messages_for(db, world.ve.id)
    assert rows[0].status == "failed"


async def _drain_dispatch() -> None:
    """Wait for the after-response delivery tasks to finish.

    `notify()` only queues an id; the middleware flushes it in a task once the
    response has gone out, so that a message is never sent for a transaction
    that later rolled back. A test has to wait for the same task.
    """
    import asyncio

    from app.main import _dispatch_tasks

    while _dispatch_tasks:
        await asyncio.gather(*list(_dispatch_tasks), return_exceptions=True)
