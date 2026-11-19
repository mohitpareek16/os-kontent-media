"""The two date-driven WhatsApp messages requested for editors."""
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.models.whatsapp import WhatsAppMessage, WhatsAppSettings, WhatsAppTemplate
from app.services.whatsapp import registry, scheduler
from tests.factories import make_job

pytestmark = pytest.mark.integration


@pytest.fixture
def wa_on(monkeypatch):
    monkeypatch.setenv("WHATSAPP_ACCESS_TOKEN", "test-token")
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "1234567890")
    monkeypatch.setenv("WHATSAPP_BUSINESS_ACCOUNT_ID", "9876543210")
    get_settings.cache_clear()
    sent = []

    async def fake_post(self, path, json):
        sent.append(json)
        return {"messages": [{"id": f"wamid.SCHED{len(sent)}"}]}

    monkeypatch.setattr("app.services.whatsapp.client.GraphClient.post", fake_post)
    yield sent
    get_settings.cache_clear()


async def setup_world(db, world, *names):
    for name in names:
        spec = registry.get(name)
        db.add(WhatsAppTemplate(
            name=name, language=spec.language, status="APPROVED",
            category="UTILITY", requested_category="UTILITY", registry_hash=spec.hash(),
        ))
    db.add(WhatsAppSettings(enabled=True, pilot_user_ids=[], event_flags={}))
    world.ve.phone_e164 = "919876543210"
    world.ve.whatsapp_opt_in = True
    await db.flush()


async def messages(db):
    return (await db.execute(select(WhatsAppMessage))).scalars().all()


async def test_approaching_deadline_reminds_editor_once(db, world, wa_on):
    await setup_world(db, world, "deadline_approaching_v2")
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="editing",
        editor=world.ve, deadline=scheduler._today() + timedelta(days=1),
    )
    await db.commit()

    assert await scheduler.send_deadline_warnings(db) == 1
    await db.commit()
    assert await scheduler.send_deadline_warnings(db) == 0
    rows = await messages(db)
    assert len(rows) == 1
    assert rows[0].template_name == "deadline_approaching_v2"
    assert rows[0].user_id == world.ve.id
    assert str(job.id) in rows[0].params["body"][-1]


async def test_missed_deadline_alerts_editor_once(db, world, wa_on):
    await setup_world(db, world, "deadline_missed_v2")
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2",
        editor=world.ve, deadline=scheduler._today() - timedelta(days=1),
    )
    await db.commit()

    assert await scheduler.send_deadline_warnings(db) == 0
    assert await scheduler.send_deadline_missed(db) == 1
    await db.commit()
    assert await scheduler.send_deadline_missed(db) == 0
    rows = await messages(db)
    assert len(rows) == 1
    assert rows[0].template_name == "deadline_missed_v2"
    assert rows[0].user_id == world.ve.id
    assert str(job.id) in rows[0].params["body"][-1]


async def test_delivered_job_sends_neither_deadline_message(db, world, wa_on):
    await setup_world(db, world, "deadline_approaching_v2", "deadline_missed_v2")
    await make_job(
        db, pod=world.pod, created_by=world.tl, stage="delivered",
        editor=world.ve, deadline=scheduler._today() - timedelta(days=1),
    )
    await db.commit()
    assert await scheduler.send_deadline_warnings(db) == 0
    assert await scheduler.send_deadline_missed(db) == 0
    assert await messages(db) == []
