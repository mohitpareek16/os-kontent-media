"""Onboarding somebody the pipeline has no word for.

Two facts that used to be one column: **what a person is called** and **what
they may do**. A Graphic Designer was filed under "VE" so the form would
accept them, which put them in editor pickers and QC routing; a Founder's
Office was an Owner everywhere because of what the role was named. Now the
title is a `role_titles` row on a `staff` account that grants nothing, and any
power is a `secondary_role` an Owner handed over on purpose.
"""
from __future__ import annotations

import pytest

from app.models.user import User
from tests.factories import auth, make_user

pytestmark = pytest.mark.integration


def _new_user(**extra):
    return {
        "name": "Nikita",
        "email": f"nikita{extra.pop('n', 1)}@example.com",
        "password": "longenough1",
        **extra,
    }


async def _reload_by_email(db, email: str) -> User:
    from sqlalchemy import select

    rows = await db.execute(select(User).where(User.email == email))
    return rows.scalar_one()


async def test_a_custom_title_is_created_the_first_time_it_is_typed(client, db, world):
    response = await client.post(
        "/api/users",
        json=_new_user(role="staff", role_title="Graphic Designer"),
        headers=auth(world.owner),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["role"] == "staff"
    assert body["role_title"] == "Graphic Designer"

    listed = await client.get("/api/users/role-titles", headers=auth(world.owner))
    assert [t["name"] for t in listed.json()] == ["Graphic Designer"]


async def test_the_second_designer_joins_the_first_ones_title(client, db, world):
    """Case-insensitively, so the roster does not end up with three spellings
    of one job."""
    for n, typed in enumerate(("Graphic Designer", "graphic designer"), start=1):
        created = await client.post(
            "/api/users",
            json=_new_user(n=n, role="staff", role_title=typed),
            headers=auth(world.owner),
        )
        assert created.status_code == 201

    titles = (await client.get("/api/users/role-titles", headers=auth(world.owner))).json()
    assert len(titles) == 1

    first = await _reload_by_email(db, "nikita1@example.com")
    second = await _reload_by_email(db, "nikita2@example.com")
    assert first.role_title_id == second.role_title_id


async def test_a_custom_role_carries_no_permissions_at_all(client, db, world):
    """The point of `staff`: an account that exists on the roster and reaches
    nothing until somebody says otherwise."""
    designer = await make_user(db, role="staff")
    await db.commit()

    for path in ("/api/jobs?status=all", "/api/pods"):
        response = await client.get(path, headers=auth(designer))
        assert response.status_code == 200, path
        assert response.json()["items"] == []

    for path in ("/api/users", "/api/users/capacity", "/api/chat/status"):
        assert (await client.get(path, headers=auth(designer))).status_code == 403, path


async def test_a_title_and_a_built_in_role_are_refused_together(client, world):
    """A VE called "Graphic Designer" would sit in the editor pickers under a
    name that says they do not cut. Custom role *is* the role."""
    response = await client.post(
        "/api/users",
        json=_new_user(role="ve", role_title="Graphic Designer"),
        headers=auth(world.owner),
    )
    assert response.status_code == 400
    assert "one or the other" in response.json()["detail"]


async def test_a_custom_role_without_a_title_is_refused(client, world):
    """"staff" is not a name for anybody."""
    response = await client.post(
        "/api/users", json=_new_user(role="staff"), headers=auth(world.owner)
    )
    assert response.status_code == 400
    assert "what is this person called" in response.json()["detail"]


async def test_hr_can_onboard_a_custom_role(client, db, world):
    """The whole point of the feature for people-ops: hiring is faster than
    the permission model changes."""
    hr = await make_user(db, role="hr")
    await db.commit()

    response = await client.post(
        "/api/users",
        json=_new_user(role="staff", role_title="Social Media"),
        headers=auth(hr),
    )
    assert response.status_code == 201


@pytest.mark.parametrize("role", ["owner", "fo", "hr"])
async def test_hr_still_cannot_onboard_above_the_work(client, db, world, role):
    hr = await make_user(db, role="hr")
    await db.commit()

    response = await client.post("/api/users", json=_new_user(role=role), headers=auth(hr))
    assert response.status_code == 403


# --------------------------------------------------------------------------
# The secondary role — powers lent, not renamed
# --------------------------------------------------------------------------


async def test_a_secondary_role_can_be_granted_at_onboarding(client, db, world):
    response = await client.post(
        "/api/users",
        json=_new_user(role="staff", role_title="Motion", secondary_role="tl"),
        headers=auth(world.owner),
    )
    assert response.status_code == 201
    assert response.json()["secondary_role"] == "tl"

    designer = await _reload_by_email(db, "nikita1@example.com")
    # They can be handed a pod now — which is the only thing the grant does.
    pod = await client.post(
        "/api/pods",
        json={"name": "Their client", "tl_id": str(designer.id)},
        headers=auth(world.owner),
    )
    assert pod.status_code == 201


async def test_only_tl_can_be_lent(client, world):
    """`SECONDARY_ROLES` is a tuple of one, and the schema says so — every
    other role is either company-wide (unlendable) or a work queue somebody
    is assigned into by name."""
    for role in ("owner", "qc", "ve", "hr"):
        response = await client.post(
            "/api/users",
            json=_new_user(role="ve", secondary_role=role),
            headers=auth(world.owner),
        )
        assert response.status_code == 422, role


async def test_an_owner_lends_and_takes_back_the_tl_role(client, db, world):
    editor = await make_user(db, role="ve")
    await db.commit()

    lent = await client.patch(
        f"/api/users/{editor.id}", json={"secondary_role": "tl"}, headers=auth(world.owner)
    )
    assert lent.status_code == 200
    assert lent.json()["secondary_role"] == "tl"

    taken_back = await client.patch(
        f"/api/users/{editor.id}",
        json={"clear_secondary_role": True},
        headers=auth(world.owner),
    )
    assert taken_back.status_code == 200
    assert taken_back.json()["secondary_role"] is None


async def test_hr_cannot_lend_a_role_to_an_existing_account(client, db, world):
    """Onboarding is HR's; changing an account that already exists is not
    (docs/04) — and a role grant is the sharpest version of that."""
    hr = await make_user(db, role="hr")
    editor = await make_user(db, role="ve")
    await db.commit()

    response = await client.patch(
        f"/api/users/{editor.id}", json={"secondary_role": "tl"}, headers=auth(hr)
    )
    assert response.status_code == 403
