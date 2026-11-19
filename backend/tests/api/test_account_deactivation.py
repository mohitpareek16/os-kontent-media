"""HR can switch an account off — and only the kinds of account HR can
switch on.

The rule under test is one sentence: **you may deactivate only the roles you
may create**, which is `CREATABLE_ROLES` and is already the rule for
onboarding and for changing a role. Written as the exploits, per docs/07:
*HR deactivates the Owner*, *HR deactivates another HR*, *HR deactivates
themselves*, *the last Owner is switched off and nobody can administer
anything again*.

Plus the thing that makes the record worth having: every path that flips the
switch — HR's route and the Owner's `PATCH` — writes the same audit row.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.user_event import UserEvent
from tests.factories import auth, make_job, make_user, reload

pytestmark = pytest.mark.integration


async def _events_for(db, user):
    rows = await db.execute(select(UserEvent).where(UserEvent.target_id == user.id))
    return list(rows.scalars().all())


# --------------------------------------------------------------------------
# What HR may do
# --------------------------------------------------------------------------


async def test_hr_can_deactivate_an_editor(client, db, world):
    hr = await make_user(db, role="hr")
    await db.commit()

    response = await client.post(
        f"/api/users/{world.ve.id}/deactivate",
        json={"reason": "Left the company — last day 15 Sep"},
        headers=auth(hr),
    )
    assert response.status_code == 200
    assert response.json()["is_active"] is False
    assert (await reload(db, world.ve)).is_active is False


async def test_the_deactivated_account_cannot_log_in(client, db, world):
    hr = await make_user(db, role="hr")
    await db.commit()
    await client.post(f"/api/users/{world.ve.id}/deactivate", json={}, headers=auth(hr))

    # The token they already held is the interesting case: a flag that only
    # gates the login form leaves an open session running until it expires.
    response = await client.get("/api/users/me", headers=auth(world.ve))
    assert response.status_code in (401, 403)


async def test_hr_can_reactivate(client, db, world):
    hr = await make_user(db, role="hr")
    parked = await make_user(db, role="ve", is_active=False)
    await db.commit()

    response = await client.post(
        f"/api/users/{parked.id}/reactivate", json={}, headers=auth(hr)
    )
    assert response.status_code == 200
    assert (await reload(db, parked)).is_active is True


async def test_hr_can_deactivate_a_tl_qc_and_staff(client, db, world):
    hr = await make_user(db, role="hr")
    targets = [
        await make_user(db, role="tl"),
        await make_user(db, role="qc"),
        await make_user(db, role="staff"),
    ]
    await db.commit()
    for target in targets:
        response = await client.post(
            f"/api/users/{target.id}/deactivate", json={}, headers=auth(hr)
        )
        assert response.status_code == 200, f"{target.role} should be HR's to switch off"


# --------------------------------------------------------------------------
# What HR may not do — phrased as the exploit
# --------------------------------------------------------------------------


async def test_hr_cannot_deactivate_the_owner(client, db, world):
    hr = await make_user(db, role="hr")
    await db.commit()
    response = await client.post(
        f"/api/users/{world.owner.id}/deactivate", json={}, headers=auth(hr)
    )
    assert response.status_code == 403
    assert (await reload(db, world.owner)).is_active is True


async def test_hr_cannot_deactivate_the_founders_office(client, db, world):
    hr = await make_user(db, role="hr")
    fo = await make_user(db, role="fo")
    await db.commit()
    response = await client.post(f"/api/users/{fo.id}/deactivate", json={}, headers=auth(hr))
    assert response.status_code == 403


async def test_hr_cannot_deactivate_another_hr(client, db, world):
    """Growing and shrinking people-ops is an Owner decision — the same
    reason HR cannot create another HR."""
    hr = await make_user(db, role="hr")
    colleague = await make_user(db, role="hr")
    await db.commit()
    response = await client.post(
        f"/api/users/{colleague.id}/deactivate", json={}, headers=auth(hr)
    )
    assert response.status_code == 403


async def test_nobody_can_deactivate_themselves(client, db, world):
    # An HR trying it on themselves is caught by the role rule first (HR is
    # not HR's to switch off), so the Owner is the account that actually
    # exercises the self-check.
    response = await client.post(
        f"/api/users/{world.owner.id}/deactivate", json={}, headers=auth(world.owner)
    )
    assert response.status_code == 400
    assert "your own account" in response.json()["detail"].lower()


async def test_the_company_cannot_be_left_without_an_owner(client, db, world):
    """With no active Owner nobody can administer accounts, impersonate, or
    see across pods again — so the last one has to survive.

    Two rules hold it, and this walks the only path that gets close. A second
    Owner may switch the first off, because one is still standing. After
    that the survivor is the only account with the authority to switch an
    Owner off at all, and they cannot switch off themselves. (The explicit
    last-Owner guard in `set_account_active` is belt and braces behind that
    — it is what would catch a future route that forgot the self-check.)
    """
    second_owner = await make_user(db, role="owner")
    await db.commit()

    switched = await client.post(
        f"/api/users/{world.owner.id}/deactivate", json={}, headers=auth(second_owner)
    )
    assert switched.status_code == 200

    themselves = await client.post(
        f"/api/users/{second_owner.id}/deactivate", json={}, headers=auth(second_owner)
    )
    assert themselves.status_code == 400
    assert (await reload(db, second_owner)).is_active is True

    hr = await make_user(db, role="hr")
    await db.commit()
    assert (
        await client.post(
            f"/api/users/{second_owner.id}/deactivate", json={}, headers=auth(hr)
        )
    ).status_code == 403


async def test_a_tl_cannot_deactivate_anyone(client, db, world):
    """`CREATABLE_ROLES` has no entry for TL, so a TL switches nobody off —
    the empty-list branch of the rule, which is easy to leave open."""
    response = await client.post(
        f"/api/users/{world.ve.id}/deactivate", json={}, headers=auth(world.tl)
    )
    assert response.status_code == 403


# --------------------------------------------------------------------------
# The record
# --------------------------------------------------------------------------


async def test_the_audit_row_names_who_did_it(client, db, world):
    hr = await make_user(db, role="hr", name="Milan")
    await db.commit()
    await client.post(
        f"/api/users/{world.ve.id}/deactivate",
        json={"reason": "Resigned"},
        headers=auth(hr),
    )

    events = await _events_for(db, world.ve)
    assert len(events) == 1
    assert events[0].action == "deactivated"
    assert events[0].actor_id == hr.id
    assert events[0].reason == "Resigned"


async def test_the_owners_patch_writes_the_same_row(client, db, world):
    """Two routes flip this switch. An audit log only means anything if
    *every* path writes one."""
    response = await client.patch(
        f"/api/users/{world.ve.id}",
        json={"is_active": False},
        headers=auth(world.owner),
    )
    assert response.status_code == 200
    events = await _events_for(db, world.ve)
    assert [e.action for e in events] == ["deactivated"]
    assert events[0].actor_id == world.owner.id


async def test_deactivating_twice_records_one_departure(client, db, world):
    hr = await make_user(db, role="hr")
    await db.commit()
    for _ in range(2):
        await client.post(f"/api/users/{world.ve.id}/deactivate", json={}, headers=auth(hr))
    assert len(await _events_for(db, world.ve)) == 1


async def test_the_directory_says_who_switched_it_off(client, db, world):
    hr = await make_user(db, role="hr", name="Milan Kumawat")
    await db.commit()
    await client.post(
        f"/api/users/{world.ve.id}/deactivate", json={"reason": "Resigned"}, headers=auth(hr)
    )

    listed = await client.get("/api/users", headers=auth(hr))
    row = next(u for u in listed.json()["items"] if u["id"] == str(world.ve.id))
    assert row["last_status_change"]["action"] == "deactivated"
    assert row["last_status_change"]["actor_name"] == "Milan Kumawat"
    assert row["last_status_change"]["reason"] == "Resigned"


# --------------------------------------------------------------------------
# What the confirm dialog reads
# --------------------------------------------------------------------------


async def test_open_work_counts_what_stays_behind(client, db, world):
    """Deactivation reassigns nothing. The dialog says how much is about to
    be left with nobody, which is the number that changes the decision."""
    hr = await make_user(db, role="hr")
    await make_job(db, pod=world.pod, created_by=world.tl, stage="editing", editor=world.ve)
    await make_job(db, pod=world.pod, created_by=world.tl, stage="qc1", editor=world.ve)
    await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2", editor=world.ve2, reviewer=world.qc
    )
    await db.commit()

    editor = await client.get(f"/api/users/{world.ve.id}/open-work", headers=auth(hr))
    assert editor.json()["editing"] == 2

    reviewer = await client.get(f"/api/users/{world.qc.id}/open-work", headers=auth(hr))
    assert reviewer.json()["reviewing"] == 1

    lead = await client.get(f"/api/users/{world.tl.id}/open-work", headers=auth(hr))
    assert lead.json()["leading_pods"] == 1


async def test_open_work_is_not_a_window_onto_the_board(client, db, world):
    """It answers with three integers and no job data — HR reads the roster,
    not the work (docs/04)."""
    hr = await make_user(db, role="hr")
    await make_job(
        db, pod=world.pod, created_by=world.tl, stage="editing", editor=world.ve, title="Secret"
    )
    await db.commit()
    body = await client.get(f"/api/users/{world.ve.id}/open-work", headers=auth(hr))
    assert set(body.json()) == {"editing", "reviewing", "leading_pods"}


async def test_an_editor_cannot_read_open_work(client, db, world):
    response = await client.get(f"/api/users/{world.ve.id}/open-work", headers=auth(world.ve))
    assert response.status_code == 403
