"""Identity edits, email uniqueness and case-insensitive sign-in."""
import pytest

from tests.factories import PASSWORD, auth, make_user, reload

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("stored_email", ["mixed.User@example.com", "mixed.user@example.com"])
async def test_login_ignores_email_case_and_padding(client, db, stored_email):
    user = await make_user(db, role="ve", email=stored_email)
    await db.commit()
    response = await client.post(
        "/api/auth/login", json={"email": "  MIXED.USER@EXAMPLE.COM  ", "password": PASSWORD}
    )
    assert response.status_code == 200


@pytest.mark.parametrize("actor_role", ["owner", "hr"])
@pytest.mark.parametrize("target_role", ["ve", "owner"])
async def test_admin_and_hr_edit_identity_without_changing_access(client, db, actor_role, target_role):
    actor = await make_user(db, role=actor_role)
    target = await make_user(db, role=target_role)
    await db.commit()
    old_email, old_hash = target.email, target.password_hash
    response = await client.patch(
        f"/api/users/{target.id}",
        json={"name": "  Correct Name  ", "email": "Correct.Name@EXAMPLE.COM"},
        headers=auth(actor),
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Correct Name"
    assert response.json()["email"] == "correct.name@example.com"
    saved = await reload(db, target)
    assert saved.role == target_role
    assert saved.password_hash == old_hash
    assert saved.is_active
    assert (await client.post("/api/auth/login", json={"email": old_email, "password": PASSWORD})).status_code == 401
    assert (await client.post("/api/auth/login", json={"email": "CORRECT.NAME@example.com", "password": PASSWORD})).status_code == 200


@pytest.mark.parametrize("actor_role", ["owner", "hr"])
async def test_admin_and_hr_can_update_and_clear_phone(client, db, world, actor_role):
    actor = await make_user(db, role=actor_role)
    await db.commit()
    url = f"/api/users/{world.ve.id}"

    updated = await client.patch(url, json={"phone": "98765 43210"}, headers=auth(actor))
    assert updated.status_code == 200
    assert updated.json()["phone"] == "98765 43210"
    assert (await reload(db, world.ve)).phone_e164 == "919876543210"

    cleared = await client.patch(url, json={"phone": ""}, headers=auth(actor))
    assert cleared.status_code == 200
    assert cleared.json()["phone"] == ""
    assert (await reload(db, world.ve)).phone_e164 is None


async def test_non_admin_non_hr_cannot_edit_phone(client, db, world):
    response = await client.patch(
        f"/api/users/{world.ve.id}", json={"phone": "9876543210"}, headers=auth(world.tl)
    )
    assert response.status_code == 403


@pytest.mark.parametrize("payload", [
    {"role": "owner"}, {"secondary_role": "tl"}, {"clear_secondary_role": True},
    {"is_active": False}, {"available": False}, {"max_concurrent_jobs": 50},
    {"employment_type": "part_time"},
])
async def test_hr_cannot_combine_identity_edit_with_other_powers(client, db, world, payload):
    hr = await make_user(db, role="hr")
    await db.commit()
    old_name = world.ve.name
    response = await client.patch(
        f"/api/users/{world.ve.id}", json={"name": "Must not save", **payload}, headers=auth(hr)
    )
    assert response.status_code == 403
    assert (await reload(db, world.ve)).name == old_name


@pytest.mark.parametrize("actor_role", ["tl", "qc", "ve", "fo", "staff"])
async def test_other_roles_cannot_edit_identity(client, db, world, actor_role):
    actor = await make_user(db, role=actor_role)
    await db.commit()
    response = await client.patch(
        f"/api/users/{world.ve.id}", json={"email": "forbidden@example.com"}, headers=auth(actor)
    )
    assert response.status_code == 403


async def test_case_variant_email_cannot_be_reused_on_create_or_edit(client, db, world):
    world.ve.email = "Already.Used@example.com"
    await db.commit()
    payload = {"name": "Duplicate", "email": "ALREADY.USED@example.com", "password": PASSWORD, "role": "ve"}
    assert (await client.post("/api/users", json=payload, headers=auth(world.owner))).status_code == 400
    changed = await client.patch(
        f"/api/users/{world.ve2.id}", json={"email": payload["email"]}, headers=auth(world.owner)
    )
    assert changed.status_code == 400
    # Re-entering your own email with different casing remains valid.
    assert (await client.patch(f"/api/users/{world.ve.id}", json={"email": payload["email"]}, headers=auth(world.owner))).status_code == 200


@pytest.mark.parametrize("payload", [{"name": "   "}, {"email": "invalid"}])
async def test_invalid_identity_is_rejected(client, world, payload):
    response = await client.patch(f"/api/users/{world.ve.id}", json=payload, headers=auth(world.owner))
    assert response.status_code == 422


async def test_create_normalizes_email(client, world):
    response = await client.post(
        "/api/users", json={"name": "New User", "email": "New.User@example.com", "password": PASSWORD, "role": "ve"}, headers=auth(world.owner)
    )
    assert response.status_code == 201
    assert response.json()["email"] == "new.user@example.com"
