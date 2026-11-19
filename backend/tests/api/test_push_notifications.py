"""Desktop push: subscribing, the test button, and what `notify()` queues.

Nothing here talks to a real push service. `services/push.py::_send_one` is
the single blocking call that does, so it is the single thing monkeypatched —
everything above it (which subscriptions are chosen, whose they are, what
happens to a dead one) is the real code path.

VAPID keys are empty in a fresh checkout and on CI, and push is off without
them. Rather than skip, these tests set the keys and clear the settings cache,
so the off state has its own test instead of being the state the whole file
runs in.
"""
from __future__ import annotations

import asyncio

import pytest

from sqlalchemy import select

from app.core.config import get_settings
from app.models.push_subscription import PushSubscription
from app.services import push
from tests.factories import auth, make_job

pytestmark = pytest.mark.integration


@pytest.fixture
def push_on(monkeypatch):
    """Turn push on for one test, and record every send instead of making it.

    `get_settings` is `lru_cache`d, so the cache is cleared on the way in and
    on the way out — otherwise the first test to touch it would decide the
    setting for the rest of the session.
    """
    monkeypatch.setenv("VAPID_PUBLIC_KEY", "test-public-key")
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "test-private-key")
    get_settings.cache_clear()

    sent: list[dict] = []
    outcomes: dict[str, object] = {}
    flushed: list[str] = []

    def fake_send(endpoint, p256dh, auth_secret, payload):
        sent.append({"endpoint": endpoint, "payload": payload})
        # Default True; a test can script a 410 for one endpoint by putting it
        # in `outcomes`.
        return outcomes.get(endpoint, True)

    # The middleware calls `push.flush` by attribute, after the response, in a
    # task — so wrapping the attribute is how a test can both see what was
    # queued and still exercise the real send path underneath.
    real_flush = push.flush

    async def recording_flush(ids):
        flushed.extend(str(i) for i in ids)
        await real_flush(ids)

    monkeypatch.setattr(push, "_send_one", fake_send)
    monkeypatch.setattr(push, "flush", recording_flush)
    yield {"sent": sent, "outcomes": outcomes, "flushed": flushed}
    get_settings.cache_clear()


def _subscription(endpoint="https://fcm.example/abc"):
    return {"endpoint": endpoint, "p256dh": "key", "auth": "secret", "user_agent": "Chrome"}


# --------------------------------------------------------------------------
# Subscribing
# --------------------------------------------------------------------------


async def test_subscribe_then_unsubscribe(client, db, world, push_on):
    response = await client.post(
        "/api/notifications/push/subscribe", json=_subscription(), headers=auth(world.ve)
    )
    assert response.status_code == 204
    rows = (await db.execute(select(PushSubscription))).scalars().all()
    assert len(rows) == 1 and rows[0].user_id == world.ve.id

    gone = await client.post(
        "/api/notifications/push/unsubscribe", json=_subscription(), headers=auth(world.ve)
    )
    assert gone.status_code == 204
    assert (await db.execute(select(PushSubscription))).scalars().all() == []


async def test_subscribing_twice_from_one_browser_is_one_row(client, db, world, push_on):
    """The frontend re-sends on every load. Without the upsert, every page
    load would add a row and every notification would arrive again."""
    for _ in range(3):
        await client.post(
            "/api/notifications/push/subscribe", json=_subscription(), headers=auth(world.ve)
        )
    rows = (await db.execute(select(PushSubscription))).scalars().all()
    assert len(rows) == 1


async def test_a_shared_browser_moves_to_whoever_logged_in(client, db, world, push_on):
    """One browser has one subscription to give. Left pointing at the
    previous account it would push one person's work to another's screen."""
    await client.post(
        "/api/notifications/push/subscribe", json=_subscription(), headers=auth(world.ve)
    )
    await client.post(
        "/api/notifications/push/subscribe", json=_subscription(), headers=auth(world.ve2)
    )
    rows = (await db.execute(select(PushSubscription))).scalars().all()
    assert len(rows) == 1 and rows[0].user_id == world.ve2.id


async def test_one_person_cannot_unsubscribe_another(client, db, world, push_on):
    """The endpoint string is something a browser hands to any page on the
    origin — it must not be enough to silence somebody else."""
    await client.post(
        "/api/notifications/push/subscribe", json=_subscription(), headers=auth(world.ve)
    )
    await client.post(
        "/api/notifications/push/unsubscribe", json=_subscription(), headers=auth(world.ve2)
    )
    assert len((await db.execute(select(PushSubscription))).scalars().all()) == 1


async def test_subscribing_is_refused_when_push_is_not_configured(client, world):
    get_settings.cache_clear()
    response = await client.post(
        "/api/notifications/push/subscribe", json=_subscription(), headers=auth(world.ve)
    )
    assert response.status_code == 503
    assert "not set up" in response.json()["detail"]


# --------------------------------------------------------------------------
# The test button
# --------------------------------------------------------------------------


async def test_the_test_alert_goes_to_the_callers_own_browsers(client, db, world, push_on):
    await client.post(
        "/api/notifications/push/subscribe", json=_subscription(), headers=auth(world.ve)
    )
    await client.post(
        "/api/notifications/push/subscribe",
        json=_subscription("https://fcm.example/someone-else"),
        headers=auth(world.qc),
    )

    response = await client.post(
        "/api/notifications/push/test?delay_seconds=0", headers=auth(world.ve)
    )
    assert response.status_code == 200
    assert response.json() == {"sent_to": 1, "delay_seconds": 0}


async def test_the_test_alert_says_so_when_nothing_is_registered(client, world, push_on):
    """"Sent to nowhere" is the answer somebody who heard nothing needs —
    the problem is the subscription, not their speakers."""
    response = await client.post(
        "/api/notifications/push/test?delay_seconds=0", headers=auth(world.ve)
    )
    assert response.status_code == 400
    assert "not registered" in response.json()["detail"]


async def test_the_delay_is_capped(client, world, push_on):
    """A test you wait a minute for is one nobody runs twice."""
    response = await client.post(
        "/api/notifications/push/test?delay_seconds=600", headers=auth(world.ve)
    )
    assert response.status_code == 422


# --------------------------------------------------------------------------
# What a notification queues
# --------------------------------------------------------------------------


async def _hand_off(client, world, job):
    """The TL assigns the job to an editor — one notification, to the editor."""
    return await client.post(
        f"/api/jobs/{job.id}/advance",
        json={
            "stage": "assigned",
            "assigned_editor_id": str(world.ve.id),
            "deadline": "2026-10-01",
        },
        headers=auth(world.tl),
    )


async def _let_the_flush_run():
    """The middleware sends after the response, in a task. Yield to it."""
    await asyncio.sleep(0.05)


async def test_a_stage_change_queues_exactly_one_push(client, db, world, push_on):
    """`notify()` is the single dispatch point and push hangs off it — one
    notification, one push, whatever route produced it."""
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="intake", deadline=None)
    await db.commit()

    assert (await _hand_off(client, world, job)).status_code == 200
    await _let_the_flush_run()
    assert len(push_on["flushed"]) == 1


async def test_a_refused_move_pushes_nothing(client, db, world, push_on):
    """The middleware only flushes on a 2xx. A 4xx means the transaction is
    gone, so there is nothing to announce — and announcing it anyway would
    have the app contradicting itself on two screens."""
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="assigned", editor=world.ve
    )
    await db.commit()

    # Already has an editor: this route sets the first one, it does not swap.
    refused = await client.post(
        f"/api/jobs/{job.id}/advance",
        json={"stage": "assigned", "assigned_editor_id": str(world.ve2.id)},
        headers=auth(world.tl),
    )
    assert refused.status_code == 400
    await _let_the_flush_run()
    assert push_on["flushed"] == []


async def test_nothing_is_queued_when_push_is_off(client, db, world):
    get_settings.cache_clear()
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="intake", deadline=None)
    await db.commit()

    # No stub is installed here on purpose: if anything did try to send, it
    # would reach the real `pywebpush` and fail loudly rather than quietly
    # passing.
    assert (await _hand_off(client, world, job)).status_code == 200
    await _let_the_flush_run()
    assert (await db.execute(select(PushSubscription))).scalars().all() == []


# --------------------------------------------------------------------------
# Sending
# --------------------------------------------------------------------------


async def test_a_gone_subscription_is_deleted(client, db, world, push_on):
    """A push service answering 410 will answer 410 forever. Kept, the row
    would be retried on every notification for the life of the deployment."""
    await client.post(
        "/api/notifications/push/subscribe", json=_subscription(), headers=auth(world.ve)
    )
    # None is what `_send_one` returns for a 404/410.
    push_on["outcomes"]["https://fcm.example/abc"] = None

    sent = await push.send_to_user(
        db, user_id=world.ve.id, title="t", body="b", url="/jobs/x", tag="tag"
    )
    await db.commit()
    assert sent == 0
    assert (await db.execute(select(PushSubscription))).scalars().all() == []


async def test_a_transient_failure_keeps_the_subscription(client, db, world, push_on):
    await client.post(
        "/api/notifications/push/subscribe", json=_subscription(), headers=auth(world.ve)
    )
    push_on["outcomes"]["https://fcm.example/abc"] = False

    await push.send_to_user(db, user_id=world.ve.id, title="t", body="b", url="/x", tag="tag")
    await db.commit()
    assert len((await db.execute(select(PushSubscription))).scalars().all()) == 1


async def test_the_payload_carries_the_same_sentence_as_the_inbox(client, db, world, push_on):
    """One event, one wording. The inbox, the toast and the OS notification
    read the string `services/notification_text.py` produced — a service
    worker cannot import the browser's copy, which is why it moved."""
    await client.post(
        "/api/notifications/push/subscribe", json=_subscription(), headers=auth(world.ve)
    )
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="intake", deadline=None)
    await db.commit()

    await _hand_off(client, world, job)
    await _let_the_flush_run()

    assert push_on["sent"], "the editor should have been pushed to"
    payload = push_on["sent"][0]["payload"]
    inbox = await client.get("/api/notifications", headers=auth(world.ve))
    headline = inbox.json()["items"][0]["headline"]
    assert headline in payload
    assert f"/jobs/{job.id}" in payload
