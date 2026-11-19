"""Flagging a QC1 that never happened, through the real HTTP path.

The thing being defended is who may say it and who may make it go away. A flag
the accused can clear is not a flag, and a flag a stranger can raise on any
pod's work is a weapon — so both ends are enforced server-side rather than by
hiding a button (docs/04).

The second half is that the evidence and the record survive: the reason lands
on the job *and* on the append-only log, the person named is told, and
clearing the flag leaves both events behind.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.job_event import JobEvent
from app.models.notification import Notification
from tests.factories import auth, make_job, make_user, reload

pytestmark = pytest.mark.integration

REASON = "Cleared in 20 seconds with no notes — the hook is still the wrong aspect ratio"


async def advance(client, job_id, user, stage, note=None):
    payload = {"stage": stage}
    if note is not None:
        payload["note"] = note
    return await client.post(f"/api/jobs/{job_id}/advance", json=payload, headers=auth(user))


async def flag(client, job_id, user, reason=REASON):
    return await client.post(
        f"/api/jobs/{job_id}/qc1-flag", json={"reason": reason}, headers=auth(user)
    )


async def clear(client, job_id, user, reason=None):
    return await client.post(
        f"/api/jobs/{job_id}/qc1-flag/clear", json={"reason": reason}, headers=auth(user)
    )


@pytest.fixture
async def waved_through(client, db, world):
    """A job the TL pushed from QC1 to QC2 without saying anything — the exact
    shape the feature exists for. Routed to `world.qc`, who is the only person
    outside the admin tier that may flag it.

    It goes in through the edit bay rather than being seeded at QC1, so the
    *arrival* at QC1 is on the log too — without it there is no start time and
    "sat there for eight seconds" is a number nobody has."""
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="editing", editor=world.ve, reviewer=world.qc
    )
    await db.commit()
    assert (await advance(client, job.id, world.ve, "qc1")).status_code == 200
    assert (await advance(client, job.id, world.tl, "qc2")).status_code == 200
    return job


# --------------------------------------------------------------------------
# What the reviewer can see before deciding
# --------------------------------------------------------------------------


async def test_the_pass_names_who_cleared_it_and_says_nothing_was_said(
    client, world, waved_through
):
    response = await client.get(
        f"/api/jobs/{waved_through.id}/qc1-pass", headers=auth(world.qc)
    )
    assert response.status_code == 200
    body = response.json()
    assert body["cleared_by_name"] == world.tl.name
    assert body["comments"] == 0


async def test_a_hand_off_note_counts_as_having_said_something(client, db, world):
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc1", editor=world.ve, reviewer=world.qc
    )
    await db.commit()
    await advance(client, job.id, world.tl, "qc2", note="Music bed is 2dB hot from 0:12")

    response = await client.get(f"/api/jobs/{job.id}/qc1-pass", headers=auth(world.qc))
    assert response.json()["comments"] == 1


async def test_a_job_that_has_never_been_to_qc1_has_no_pass(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="editing", editor=world.ve)
    await db.commit()

    response = await client.get(f"/api/jobs/{job.id}/qc1-pass", headers=auth(world.tl))
    assert response.status_code == 200
    assert response.json() is None


# --------------------------------------------------------------------------
# Who may raise it
# --------------------------------------------------------------------------


async def test_the_routed_reviewer_may_flag(client, world, waved_through):
    response = await flag(client, waved_through.id, world.qc)
    assert response.status_code == 200
    body = response.json()
    assert body["qc1_flagged_at"] is not None
    assert body["qc1_flag_reason"] == REASON
    assert body["qc1_flagged_by_name"] == world.qc.name
    # The flag names the person who cleared QC1, not whoever leads the pod today.
    assert body["qc1_flag_tl_name"] == world.tl.name
    # Nothing about the job itself moves — this is a statement about the past.
    assert body["stage"] == "qc2" and body["round"] == 0


async def test_the_owner_may_flag_after_the_fact(client, world, waved_through):
    assert (await flag(client, waved_through.id, world.owner)).status_code == 200


async def test_the_pod_tl_may_not_flag_their_own_review(client, db, world, waved_through):
    """QC1 *is* the TL's review. A TL clearing this would be marking their own
    homework, which is the failure the flag exists to catch."""
    assert (await flag(client, waved_through.id, world.tl)).status_code == 403
    assert (await reload(db, waved_through)).qc1_flagged_at is None


@pytest.mark.parametrize("actor_name", ["ve", "other_qc", "other_tl"])
async def test_the_editor_and_outsiders_may_not(client, db, world, waved_through, actor_name):
    actor = getattr(world, actor_name)
    assert (await flag(client, waved_through.id, actor)).status_code in (403, 404)
    assert (await reload(db, waved_through)).qc1_flagged_at is None


async def test_you_cannot_flag_a_pass_you_made_yourself(client, db, world):
    """An admin who cleared QC1 themselves is in the TL's position, not the
    reviewer's."""
    job = await make_job(
        db, pod=world.pod, created_by=world.owner, stage="qc1", editor=world.ve, reviewer=world.qc
    )
    await db.commit()
    await advance(client, job.id, world.owner, "qc2")

    response = await flag(client, job.id, world.owner)
    assert response.status_code == 400
    assert "yourself" in response.json()["detail"]


# --------------------------------------------------------------------------
# What a flag requires and refuses
# --------------------------------------------------------------------------


@pytest.mark.parametrize("reason", ["", "no", "   "])
async def test_a_real_reason_is_required(client, db, world, waved_through, reason):
    assert (await flag(client, waved_through.id, world.qc, reason=reason)).status_code == 422
    assert (await reload(db, waved_through)).qc1_flagged_at is None


async def test_a_job_that_never_reached_qc1_cannot_be_flagged(client, db, world):
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2", editor=world.ve, reviewer=world.qc
    )
    await db.commit()

    response = await flag(client, job.id, world.qc)
    assert response.status_code == 400
    assert "QC1" in response.json()["detail"]


async def test_flagging_twice_is_refused(client, world, waved_through):
    assert (await flag(client, waved_through.id, world.qc)).status_code == 200
    assert (await flag(client, waved_through.id, world.qc)).status_code == 400


# --------------------------------------------------------------------------
# What a flag leaves behind
# --------------------------------------------------------------------------


async def test_the_evidence_is_on_the_event_log(client, db, world, waved_through):
    await flag(client, waved_through.id, world.qc)
    rows = await db.execute(
        select(JobEvent).where(
            JobEvent.job_id == waved_through.id, JobEvent.event_type == "qc1_flag_raised"
        )
    )
    event = rows.scalar_one()
    assert event.actor_id == world.qc.id
    assert event.payload["reason"] == REASON
    assert event.payload["tl_name"] == world.tl.name
    # What was on screen when the call was made, not something re-derived
    # later: a stage correction afterwards must not rewrite it.
    assert event.payload["comments_at_qc1"] == 0
    assert event.payload["seconds_at_qc1"] is not None


async def test_the_person_it_names_is_told(client, db, world, waved_through):
    await flag(client, waved_through.id, world.qc)
    rows = await db.execute(
        select(Notification.user_id)
        .join(JobEvent, JobEvent.id == Notification.event_id)
        .where(JobEvent.job_id == waved_through.id, JobEvent.event_type == "qc1_flag_raised")
    )
    told = set(rows.scalars().all())
    # The TL who cleared it (also the pod TL here), never the reviewer who
    # raised it — finding out from a dashboard tint weeks later is an
    # accusation made behind someone's back.
    assert told == {world.tl.id}


async def test_it_shows_on_the_row_and_filters(client, world, waved_through):
    await flag(client, waved_through.id, world.qc)

    flagged = await client.get("/api/jobs?status=all&qc1_flagged=true", headers=auth(world.owner))
    assert [row["id"] for row in flagged.json()["items"]] == [str(waved_through.id)]

    overview = await client.get("/api/jobs/overview", headers=auth(world.owner))
    assert overview.json()["qc1_flagged"] == 1


async def test_a_delivered_job_keeps_its_flag(client, db, world):
    """The case a lead most needs to catch: nobody reviewed it and it shipped
    anyway. Delivery must not quietly clear the record."""
    job = await make_job(
        db,
        pod=world.pod,
        created_by=world.tl,
        stage="qc1",
        editor=world.ve,
        reviewer=world.qc,
        client_sheet_ok=True,
        ops_tracker_ok=True,
    )
    await db.commit()
    await advance(client, job.id, world.tl, "qc2")
    await flag(client, job.id, world.qc)
    await advance(client, job.id, world.qc, "final")
    assert (await advance(client, job.id, world.tl, "delivered")).status_code == 200

    row = await client.get(f"/api/jobs/{job.id}", headers=auth(world.owner))
    assert row.json()["stage"] == "delivered"
    assert row.json()["qc1_flagged_at"] is not None


# --------------------------------------------------------------------------
# Clearing it
# --------------------------------------------------------------------------


async def test_the_reviewer_who_raised_it_may_withdraw_it(client, world, waved_through):
    await flag(client, waved_through.id, world.qc)
    response = await clear(client, waved_through.id, world.qc)
    assert response.status_code == 200
    assert response.json()["qc1_flagged_at"] is None
    assert response.json()["qc1_flag_reason"] is None


async def test_the_flagged_tl_may_not_clear_it(client, db, world, waved_through):
    """A flag the accused can delete is not a flag."""
    await flag(client, waved_through.id, world.qc)
    assert (await clear(client, waved_through.id, world.tl)).status_code == 403
    assert (await reload(db, waved_through)).qc1_flagged_at is not None


async def test_an_admin_may_dismiss_it_and_both_events_remain(client, db, world, waved_through):
    await flag(client, waved_through.id, world.qc)
    assert (await clear(client, waved_through.id, world.owner, reason="Spoke to both")).status_code == 200

    rows = await db.execute(
        select(JobEvent.event_type)
        .where(JobEvent.job_id == waved_through.id, JobEvent.event_type.like("qc1_flag%"))
        .order_by(JobEvent.created_at)
    )
    # "Raised and withdrawn an hour later" is the pattern worth reading over a
    # few months — the columns clear, the log does not.
    assert list(rows.scalars().all()) == ["qc1_flag_raised", "qc1_flag_cleared"]


async def test_clearing_an_unflagged_job_is_refused(client, world, waved_through):
    assert (await clear(client, waved_through.id, world.qc)).status_code == 400


# --------------------------------------------------------------------------
# Where an admin finds them: the Flagged tab and its count
# --------------------------------------------------------------------------


async def test_the_flagged_tab_lists_them_and_the_card_counts_them(
    client, db, world, waved_through
):
    """Reachable in one click rather than by remembering a filter. The count
    is a process number — one is a bad day, six is a TL who has stopped
    reviewing."""
    clean = await make_job(db, pod=world.pod, created_by=world.tl, stage="qc2", editor=world.ve)
    await db.commit()

    stats = await client.get("/api/jobs/stats", headers=auth(world.owner))
    assert stats.json()["flagged"] == 0

    await flag(client, waved_through.id, world.qc)

    listed = await client.get("/api/jobs?status=flagged", headers=auth(world.owner))
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()["items"]] == [str(waved_through.id)]
    assert str(clean.id) not in {row["id"] for row in listed.json()["items"]}

    stats = await client.get("/api/jobs/stats", headers=auth(world.owner))
    assert stats.json()["flagged"] == 1


async def test_a_delivered_job_stays_on_the_flagged_tab(client, db, world, waved_through):
    """The flag is about how the work was reviewed, and that question does not
    stop mattering once the video ships — `active` would have hidden it."""
    await flag(client, waved_through.id, world.qc)
    assert (await advance(client, waved_through.id, world.qc, "final")).status_code == 200
    await client.patch(
        f"/api/jobs/{waved_through.id}/checklist",
        json={"client_sheet_ok": True, "ops_tracker_ok": True},
        headers=auth(world.tl),
    )
    assert (await advance(client, waved_through.id, world.tl, "delivered")).status_code == 200

    listed = await client.get("/api/jobs?status=flagged", headers=auth(world.owner))
    assert [row["id"] for row in listed.json()["items"]] == [str(waved_through.id)]
