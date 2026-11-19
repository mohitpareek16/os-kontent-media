"""/auth and /users — password rules, role validation, and deactivation.

Items 12 (invalid role -> 422), 13 (password minimum length 8 on both
create-user and reset-password) and 16 (a deactivated user cannot log in and
their existing token stops working).
"""
from __future__ import annotations

import uuid

import pytest

from app.core.security import decode_access_token
from app.schemas.user import PASSWORD_MIN_LENGTH
from tests.factories import PASSWORD, add_member, auth, make_job, make_pod, make_user, reload

pytestmark = pytest.mark.integration


# --------------------------------------------------------------------------
# Login
# --------------------------------------------------------------------------


async def test_login_returns_a_working_token(client, db, world):
    response = await client.post(
        "/api/auth/login", json={"email": world.tl.email, "password": PASSWORD}
    )
    assert response.status_code == 200
    token = response.json()["access_token"]

    me = await client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == world.tl.email


async def test_login_with_a_wrong_password_is_401(client, world):
    response = await client.post(
        "/api/auth/login", json={"email": world.tl.email, "password": "not-the-password"}
    )
    assert response.status_code == 401


async def test_login_with_an_unknown_email_is_401(client, world):
    response = await client.post(
        "/api/auth/login", json={"email": "nobody@example.com", "password": PASSWORD}
    )
    assert response.status_code == 401


async def test_a_garbage_token_is_401(client, world):
    response = await client.get("/api/users/me", headers={"Authorization": "Bearer nonsense"})
    assert response.status_code == 401


async def test_an_unauthenticated_request_is_401(client, world):
    assert (await client.get("/api/users/me")).status_code == 401


# --------------------------------------------------------------------------
# 16. Deactivation
# --------------------------------------------------------------------------


async def test_a_deactivated_user_cannot_log_in(client, db, world):
    world.ve.is_active = False
    await db.commit()

    response = await client.post(
        "/api/auth/login", json={"email": world.ve.email, "password": PASSWORD}
    )
    assert response.status_code == 403
    assert "deactivated" in response.json()["detail"]


async def test_an_existing_token_stops_working_once_deactivated(client, db, world):
    """Checked per-request, not just at login: switching someone off takes
    effect immediately rather than whenever their token expires."""
    headers = auth(world.ve)
    assert (await client.get("/api/users/me", headers=headers)).status_code == 200

    world.ve.is_active = False
    await db.commit()

    later = await client.get("/api/users/me", headers=headers)
    assert later.status_code == 401
    assert "deactivated" in later.json()["detail"].lower()


async def test_deactivation_through_the_api_has_the_same_effect(client, db, world):
    headers = auth(world.ve)
    patched = await client.patch(
        f"/api/users/{world.ve.id}", json={"is_active": False}, headers=auth(world.owner)
    )
    assert patched.status_code == 200
    assert patched.json()["is_active"] is False

    assert (await client.get("/api/users/me", headers=headers)).status_code == 401
    assert (await reload(db, world.ve)).is_active is False


async def test_a_reactivated_user_can_log_in_again(client, db, world):
    world.ve.is_active = False
    await db.commit()
    await client.patch(
        f"/api/users/{world.ve.id}", json={"is_active": True}, headers=auth(world.owner)
    )

    response = await client.post(
        "/api/auth/login", json={"email": world.ve.email, "password": PASSWORD}
    )
    assert response.status_code == 200


async def test_an_owner_cannot_deactivate_themselves(client, world):
    response = await client.patch(
        f"/api/users/{world.owner.id}", json={"is_active": False}, headers=auth(world.owner)
    )
    assert response.status_code == 400


async def test_the_last_active_owner_cannot_be_demoted(client, world):
    response = await client.patch(
        f"/api/users/{world.owner.id}", json={"role": "tl"}, headers=auth(world.owner)
    )
    assert response.status_code == 400
    assert "last active Owner" in response.json()["detail"]


# --------------------------------------------------------------------------
# 13. One password rule, enforced server-side
# --------------------------------------------------------------------------


def _new_user(**extra):
    return {
        "name": "Newcomer",
        "email": f"new-{uuid.uuid4().hex[:8]}@example.com",
        "password": "longenough1",
        "role": "ve",
        **extra,
    }


def test_the_documented_minimum():
    assert PASSWORD_MIN_LENGTH == 8


@pytest.mark.parametrize("password", ["", "ab", "short12"])
async def test_create_user_rejects_a_short_password(client, world, password):
    """Account creation used to accept a two-character password; the only
    thing enforcing 8 was a browser attribute."""
    response = await client.post(
        "/api/users", json=_new_user(password=password), headers=auth(world.owner)
    )
    assert response.status_code == 422


async def test_create_user_accepts_a_password_of_exactly_eight(client, world):
    response = await client.post(
        "/api/users", json=_new_user(password="12345678"), headers=auth(world.owner)
    )
    assert response.status_code == 201


@pytest.mark.parametrize("password", ["", "ab", "short12"])
async def test_reset_password_rejects_a_short_password(client, world, password):
    response = await client.post(
        f"/api/users/{world.ve.id}/reset-password",
        json={"new_password": password},
        headers=auth(world.owner),
    )
    assert response.status_code == 422


async def test_reset_password_sets_a_working_password(client, world):
    response = await client.post(
        f"/api/users/{world.ve.id}/reset-password",
        json={"new_password": "brand-new-password"},
        headers=auth(world.owner),
    )
    assert response.status_code == 204

    login = await client.post(
        "/api/auth/login",
        json={"email": world.ve.email, "password": "brand-new-password"},
    )
    assert login.status_code == 200


@pytest.mark.parametrize("password", ["ab", "short12"])
async def test_change_password_rejects_a_short_password(client, world, password):
    response = await client.post(
        "/api/auth/change-password",
        json={"current_password": PASSWORD, "new_password": password},
        headers=auth(world.ve),
    )
    assert response.status_code == 422


async def test_change_password_requires_the_current_password(client, world):
    response = await client.post(
        "/api/auth/change-password",
        json={"current_password": "wrong", "new_password": "a-new-password"},
        headers=auth(world.ve),
    )
    assert response.status_code == 401


# --------------------------------------------------------------------------
# 12. Role validation, and who may administer users
# --------------------------------------------------------------------------


async def test_an_unknown_role_is_422_on_create(client, world):
    response = await client.post(
        "/api/users", json=_new_user(role="admin"), headers=auth(world.owner)
    )
    assert response.status_code == 422


async def test_an_unknown_role_is_422_on_update(client, world):
    response = await client.patch(
        f"/api/users/{world.ve.id}", json={"role": "admin"}, headers=auth(world.owner)
    )
    assert response.status_code == 422


@pytest.mark.parametrize("role", ["owner", "tl", "qc", "ve", "hr", "fo"])
async def test_every_documented_role_is_accepted(client, world, role):
    response = await client.post(
        "/api/users", json=_new_user(role=role), headers=auth(world.owner)
    )
    assert response.status_code == 201
    assert response.json()["role"] == role


async def test_a_malformed_email_is_422(client, world):
    response = await client.post(
        "/api/users", json=_new_user(email="not-an-email"), headers=auth(world.owner)
    )
    assert response.status_code == 422


async def test_a_duplicate_email_is_400_not_a_500(client, world):
    response = await client.post(
        "/api/users", json=_new_user(email=world.ve.email), headers=auth(world.owner)
    )
    assert response.status_code == 400


@pytest.mark.parametrize("actor", ["tl", "qc", "ve"])
async def test_a_tl_qc_or_ve_may_not_create_accounts(client, world, actor):
    """docs/04: a TL does not onboard their own editors. Owner and HR are the
    only two roles that create accounts."""
    response = await client.post(
        "/api/users", json=_new_user(), headers=auth(getattr(world, actor))
    )
    assert response.status_code == 403


# --------------------------------------------------------------------------
# HR — onboards the roster, administers nothing else
# --------------------------------------------------------------------------


@pytest.fixture
async def hr(db):
    user = await make_user(db, role="hr")
    await db.commit()
    return user


@pytest.mark.parametrize("role", ["tl", "qc", "ve"])
async def test_hr_can_onboard_the_roles_that_do_the_work(client, hr, role):
    response = await client.post("/api/users", json=_new_user(role=role), headers=auth(hr))
    assert response.status_code == 201
    assert response.json()["role"] == role


@pytest.mark.parametrize("role", ["owner", "hr"])
async def test_hr_cannot_mint_an_owner_or_another_hr(client, hr, role):
    """Only an Owner creates those — otherwise HR is a self-service route
    around every owner-only endpoint in the app."""
    response = await client.post("/api/users", json=_new_user(role=role), headers=auth(hr))
    assert response.status_code == 403


async def test_hr_reads_the_directory_and_the_role_counts(client, hr, world):
    directory = await client.get("/api/users", headers=auth(hr))
    assert directory.status_code == 200
    assert directory.json()["total"] >= 8

    stats = await client.get("/api/users/stats", headers=auth(hr))
    assert stats.status_code == 200
    assert stats.json()["by_role"]["hr"]["total"] == 1


@pytest.mark.parametrize(
    "method,path,payload",
    [
        ("patch", "/api/users/{ve}", {"role": "qc"}),
        ("patch", "/api/users/{ve}", {"is_active": False}),
    ],
)
async def test_hr_cannot_administer_existing_accounts(client, hr, world, method, path, payload):
    """Creating a login is people-ops; changing someone's role stays with the
    Owner. (HR may reset passwords of the roles it creates — see below.)"""
    response = await getattr(client, method)(
        path.format(ve=world.ve.id), json=payload, headers=auth(hr)
    )
    assert response.status_code == 403


async def test_hr_sees_none_of_the_work(client, db, hr, world):
    """The reversal. HR used to hold a TL's powers over every pod in the
    company by virtue of the role name. It now holds none: the roster is the
    surface, and work reaches HR only when somebody hands them a pod."""
    await make_job(db, pod=world.pod, created_by=world.tl)
    await make_job(db, pod=world.other_pod, created_by=world.other_tl)
    await db.commit()

    pods = await client.get("/api/pods", headers=auth(hr))
    assert pods.status_code == 200
    assert pods.json()["items"] == []

    jobs = await client.get("/api/jobs?status=all", headers=auth(hr))
    assert jobs.status_code == 200
    assert jobs.json()["items"] == []


async def test_hr_has_no_capacity_analytics_or_bot(client, hr, world):
    """The lead surfaces are for people who lead work. Onboarding somebody is
    not leading them."""
    for path in (
        "/api/users/qc-load",
        "/api/users/editor-capacity",
        "/api/users/capacity",
        f"/api/pods/{world.pod.id}/analytics/first-pass-rate",
    ):
        response = await client.get(path, headers=auth(hr))
        assert response.status_code == 403, path


async def test_hr_cannot_run_the_pipeline(client, db, hr, world):
    """No membership row, no `Pod.tl_id`, no lent role — so nothing."""
    created = await client.post(
        "/api/jobs",
        json={"pod_id": str(world.pod.id), "title": "HR-created cut", "weight": "standard"},
        headers=auth(hr),
    )
    assert created.status_code == 403

    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="assigned", editor=world.ve
    )
    await db.commit()

    advanced = await client.post(
        f"/api/jobs/{job.id}/advance", json={"stage": "editing"}, headers=auth(hr)
    )
    assert advanced.status_code == 403
    assert (await reload(db, job)).stage == "assigned"


async def test_an_hr_with_a_lent_tl_role_runs_the_pods_it_was_given(client, db, world):
    """And the feature that replaces the old blanket reach: an HR who also
    runs clients is given the TL role and the pods to go with it. Everything
    they can now do, they can do *there* — the pod nobody handed them stays
    as invisible as it is to any other TL."""
    people_ops = await make_user(db, role="hr", secondary_role="tl")
    their_pod = await make_pod(db, tl=people_ops, name="Ledger", onboarded_by=world.owner)
    await add_member(db, their_pod, people_ops, "tl")
    await db.commit()

    pods = await client.get("/api/pods", headers=auth(people_ops))
    assert {p["name"] for p in pods.json()["items"]} == {"Ledger"}

    created = await client.post(
        "/api/jobs",
        json={"pod_id": str(their_pod.id), "title": "Their own client", "weight": "standard"},
        headers=auth(people_ops),
    )
    assert created.status_code == 201

    # ...and not on somebody else's pod, exactly like a primary TL.
    refused = await client.post(
        "/api/jobs",
        json={"pod_id": str(world.other_pod.id), "title": "Not theirs", "weight": "standard"},
        headers=auth(people_ops),
    )
    assert refused.status_code == 403

    # The roster is still theirs — a lent role adds, it does not replace.
    assert (await client.get("/api/users", headers=auth(people_ops))).status_code == 200


async def test_an_hr_can_be_a_pod_member_when_it_holds_the_role(client, db, world):
    """The old rule was "HR accounts are not pod members", flat. The rule now
    is about the role, not the name: hold TL and you can be a pod's TL."""
    people_ops = await make_user(db, role="hr", secondary_role="tl")
    await db.commit()

    added = await client.post(
        f"/api/pods/{world.pod.id}/members",
        json={"user_id": str(people_ops.id), "pod_role": "tl"},
        headers=auth(world.tl),
    )
    assert added.status_code == 201


async def test_hr_still_cannot_touch_the_admin_tier(client, hr, world):
    """What the global work scope deliberately did *not* hand over: HR runs
    the work, the Owner still runs the accounts (docs/04)."""
    impersonation = await client.post(f"/api/auth/impersonate/{world.ve.id}", headers=auth(hr))
    assert impersonation.status_code == 403

    voice_notes = await client.get("/api/voice-notes/admin/videos", headers=auth(hr))
    assert voice_notes.status_code == 403

    # A TL cannot hand their pod to someone else either — HR having a TL's
    # powers everywhere must not quietly upgrade that one to an Owner's.
    handover = await client.patch(
        f"/api/pods/{world.pod.id}", json={"tl_id": str(world.other_tl.id)}, headers=auth(hr)
    )
    assert handover.status_code == 403


# --------------------------------------------------------------------------
# Founder's Office — a role name, and nothing else, until it is given pods
# --------------------------------------------------------------------------


@pytest.fixture
async def fo(db):
    user = await make_user(db, role="fo")
    await db.commit()
    return user


async def test_the_founders_office_holds_nothing_by_itself(client, fo, world):
    """It used to be an Owner everywhere — every pod, every job, analytics,
    the bot, impersonation — because of what the role was called. The reach
    is gone; what is left is an account, and whatever an Owner hands it.

    Existing FO accounts were not stranded by this: migration 0017 gave every
    one of them `secondary_role='tl'`, which is the test below."""
    pods = await client.get("/api/pods", headers=auth(fo))
    assert pods.status_code == 200
    assert pods.json()["total"] == 0

    for path in (
        "/api/users/capacity",
        "/api/users/qc-load",
        "/api/users/editor-capacity",
        f"/api/pods/{world.other_pod.id}/analytics/stage-distribution",
        f"/api/pods/{world.other_pod.id}/members",
    ):
        response = await client.get(path, headers=auth(fo))
        assert response.status_code == 403, path


async def test_the_founders_office_cannot_run_a_pod_it_does_not_lead(client, fo, world):
    response = await client.patch(
        f"/api/pods/{world.other_pod.id}", json={"name": "Renamed by FO"}, headers=auth(fo)
    )
    assert response.status_code == 403


async def test_the_founders_office_runs_the_pods_it_was_given(client, db, world):
    """What migration 0017 leaves every existing Founder's Office account
    holding: a TL's powers, on the pods that are actually theirs."""
    office = await make_user(db, role="fo", secondary_role="tl")
    pod = await make_pod(db, tl=office, name="Studio", onboarded_by=world.owner)
    await add_member(db, pod, office, "tl")
    await db.commit()

    renamed = await client.patch(
        f"/api/pods/{pod.id}", json={"name": "Studio Kontent"}, headers=auth(office)
    )
    assert renamed.status_code == 200

    elsewhere = await client.patch(
        f"/api/pods/{world.other_pod.id}", json={"name": "Nope"}, headers=auth(office)
    )
    assert elsewhere.status_code == 403


@pytest.mark.parametrize("role", ["tl", "qc", "ve", "hr"])
async def test_the_founders_office_no_longer_onboards_anyone(client, fo, role):
    """Onboarding is the Owner's and HR's. It was the Founder's Office's only
    because the role once meant "an Owner, nearly"."""
    response = await client.post("/api/users", json=_new_user(role=role), headers=auth(fo))
    assert response.status_code == 403


async def test_the_founders_office_administers_nobody(client, db, fo, world):
    for method, path, payload in (
        ("patch", f"/api/users/{world.ve.id}", {"role": "qc"}),
        ("patch", f"/api/users/{world.ve2.id}", {"is_active": False}),
        ("post", f"/api/users/{world.qc.id}/reset-password", {"new_password": "longenough1"}),
    ):
        response = await getattr(client, method)(path, json=payload, headers=auth(fo))
        assert response.status_code == 403, path

    assert (await reload(db, world.ve)).role == "ve"


async def test_the_founders_office_no_longer_impersonates(client, fo, world):
    """Impersonation is the admin tier's, and the admin tier is the Owner."""
    response = await client.post(f"/api/auth/impersonate/{world.ve.id}", headers=auth(fo))
    assert response.status_code == 403


@pytest.mark.parametrize("role", ["owner", "fo"])
async def test_the_founders_office_cannot_onboard_another_admin(client, fo, role):
    """The stated rule — no second Founder's Office — plus the one it implies:
    no Owner either. Creating an account whose password you set is the same
    power as logging in as it, so either would be a self-promotion path."""
    response = await client.post("/api/users", json=_new_user(role=role), headers=auth(fo))
    assert response.status_code == 403


@pytest.mark.parametrize("role", ["owner", "fo"])
async def test_the_founders_office_cannot_promote_anyone_into_the_admin_tier(
    client, db, fo, world, role
):
    response = await client.patch(
        f"/api/users/{world.ve.id}", json={"role": role}, headers=auth(fo)
    )
    assert response.status_code == 403
    assert (await reload(db, world.ve)).role == "ve"


@pytest.mark.parametrize(
    "method,path,payload",
    [
        ("patch", "/api/users/{target}", {"role": "ve"}),
        ("patch", "/api/users/{target}", {"is_active": False}),
        ("patch", "/api/users/{target}", {"name": "Renamed"}),
        ("post", "/api/users/{target}/reset-password", {"new_password": "longenough1"}),
    ],
)
async def test_the_founders_office_cannot_touch_the_owners_account(
    client, db, fo, world, method, path, payload
):
    """"They cannot remove the admin" has to cover every way to take an
    account off its owner: demotion, deactivation, and — with no email
    recovery in this system — a password reset, which is a session as them."""
    response = await getattr(client, method)(
        path.format(target=world.owner.id), json=payload, headers=auth(fo)
    )
    assert response.status_code == 403

    owner = await reload(db, world.owner)
    assert owner.role == "owner" and owner.is_active


async def test_a_founders_office_cannot_administer_a_peer(client, db, fo):
    peer = await make_user(db, role="fo")
    await db.commit()

    response = await client.patch(
        f"/api/users/{peer.id}", json={"is_active": False}, headers=auth(fo)
    )
    assert response.status_code == 403


async def test_an_owner_still_administers_the_founders_office(client, db, fo, world):
    created = await client.post("/api/users", json=_new_user(role="fo"), headers=auth(world.owner))
    assert created.status_code == 201

    demoted = await client.patch(
        f"/api/users/{fo.id}", json={"role": "tl"}, headers=auth(world.owner)
    )
    assert demoted.status_code == 200
    assert (await reload(db, fo)).role == "tl"


@pytest.mark.parametrize("actor", ["tl", "qc", "ve"])
async def test_only_an_owner_may_reset_a_password(client, world, actor):
    response = await client.post(
        f"/api/users/{world.ve.id}/reset-password",
        json={"new_password": "a-long-enough-one"},
        headers=auth(getattr(world, actor)),
    )
    assert response.status_code == 403


@pytest.mark.parametrize("actor", ["qc", "ve"])
async def test_the_user_directory_is_owner_and_tl_only(client, world, actor):
    assert (await client.get("/api/users", headers=auth(getattr(world, actor)))).status_code == 403


async def test_a_ve_cannot_toggle_their_own_routing_availability(client, world):
    """docs/04: editor assignment is a TL decision, not self-service."""
    response = await client.patch(
        "/api/users/me/availability", json={"available": False}, headers=auth(world.ve)
    )
    assert response.status_code == 403


async def test_a_qc_can_toggle_their_own_routing_availability(client, db, world):
    response = await client.patch(
        "/api/users/me/availability", json={"available": False}, headers=auth(world.qc)
    )
    assert response.status_code == 200
    assert (await reload(db, world.qc)).available is False


# --------------------------------------------------------------------------
# Impersonation is Owner-only (docs/04 role matrix)
# --------------------------------------------------------------------------


@pytest.mark.parametrize("actor", ["tl", "qc", "ve"])
async def test_impersonation_is_owner_only(client, world, actor):
    response = await client.post(
        f"/api/auth/impersonate/{world.ve.id}", headers=auth(getattr(world, actor))
    )
    assert response.status_code == 403


async def test_an_owner_can_impersonate(client, world):
    response = await client.post(
        f"/api/auth/impersonate/{world.ve.id}", headers=auth(world.owner)
    )
    assert response.status_code == 200

    token = response.json()["access_token"]
    me = await client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["id"] == str(world.ve.id)


async def test_an_owner_can_switch_straight_to_another_account(client, world):
    """The regression: impersonation hands back the *target's* token, so the
    next request was judged as a VE and refused. Switching meant stopping
    first, then starting again."""
    as_ve = (
        await client.post(f"/api/auth/impersonate/{world.ve.id}", headers=auth(world.owner))
    ).json()["access_token"]

    switch = await client.post(
        f"/api/auth/impersonate/{world.qc.id}",
        headers={"Authorization": f"Bearer {as_ve}"},
    )
    assert switch.status_code == 200

    token = switch.json()["access_token"]
    me = await client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["id"] == str(world.qc.id)


async def test_a_hop_stays_attributed_to_the_real_owner(client, world):
    """Two hops must not rewrite who is accountable — the second token still
    names the Owner, not the VE that was being simulated when it was minted."""
    as_ve = (
        await client.post(f"/api/auth/impersonate/{world.ve.id}", headers=auth(world.owner))
    ).json()["access_token"]
    as_qc = (
        await client.post(
            f"/api/auth/impersonate/{world.qc.id}",
            headers={"Authorization": f"Bearer {as_ve}"},
        )
    ).json()["access_token"]

    assert decode_access_token(as_qc)["impersonated_by"] == str(world.owner.id)


async def test_a_tl_session_cannot_be_used_to_start_impersonating(client, world):
    """`require_impersonator` reads `impersonated_by`, which a plain login
    token doesn't carry — so it falls back to the caller, and a TL is still
    refused. The switch fix must not have opened a hole."""
    response = await client.post(
        f"/api/auth/impersonate/{world.ve.id}", headers=auth(world.tl)
    )
    assert response.status_code == 403


async def test_impersonating_a_deactivated_account_is_refused(client, db, world):
    world.ve.is_active = False
    await db.commit()

    response = await client.post(
        f"/api/auth/impersonate/{world.ve.id}", headers=auth(world.owner)
    )
    assert response.status_code == 400


# --------------------------------------------------------------------------
# HR password resets, and the emailed forgot-password flow
# --------------------------------------------------------------------------


async def test_hr_can_reset_a_ve_password(client, hr, world):
    response = await client.post(
        f"/api/users/{world.ve.id}/reset-password",
        json={"new_password": "set-by-hr-123"},
        headers=auth(hr),
    )
    assert response.status_code == 204
    login = await client.post(
        "/api/auth/login", json={"email": world.ve.email, "password": "set-by-hr-123"}
    )
    assert login.status_code == 200


async def test_hr_cannot_reset_owner_or_hr_or_self(client, db, hr, world):
    other_hr = await make_user(db, role="hr")
    await db.commit()
    for target in (world.owner, other_hr, hr):
        response = await client.post(
            f"/api/users/{target.id}/reset-password",
            json={"new_password": "set-by-hr-123"},
            headers=auth(hr),
        )
        assert response.status_code == 403, target.role


async def test_forgot_password_is_204_for_unknown_and_known_emails(client, world):
    for email in ("nobody@example.com", world.ve.email):
        response = await client.post("/api/auth/forgot-password", json={"email": email})
        assert response.status_code == 204


async def test_reset_token_sets_password_once(client, world):
    from app.core.security import create_password_reset_token

    token = create_password_reset_token(str(world.ve.id), world.ve.password_hash)
    ok = await client.post(
        "/api/auth/reset-password", json={"token": token, "new_password": "fresh-password-1"}
    )
    assert ok.status_code == 204
    login = await client.post(
        "/api/auth/login", json={"email": world.ve.email, "password": "fresh-password-1"}
    )
    assert login.status_code == 200
    # The password changed, so the same link is dead.
    again = await client.post(
        "/api/auth/reset-password", json={"token": token, "new_password": "another-one-123"}
    )
    assert again.status_code == 400


async def test_a_reset_token_is_not_a_login_session(client, world):
    from app.core.security import create_password_reset_token

    token = create_password_reset_token(str(world.ve.id), world.ve.password_hash)
    response = await client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


async def test_a_garbage_reset_token_is_400(client):
    response = await client.post(
        "/api/auth/reset-password", json={"token": "nope", "new_password": "fresh-password-1"}
    )
    assert response.status_code == 400
