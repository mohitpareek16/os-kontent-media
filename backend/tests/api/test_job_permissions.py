"""Server-side permission enforcement on /jobs — the regressions from
docs/04-permissions.md: "Enforcement is server-side, not just hidden UI."

Covers the three holes that were open on this router:
  1. POST /jobs and POST /jobs/batch had no permission check at all.
  2. GET /jobs/{id} and GET /jobs/{id}/events only checked the VE case.
  3. POST /jobs/{id}/advance had no permission check at all.
Plus 6: a QC account could be set as a job's assigned editor.
"""
from __future__ import annotations

import uuid

import pytest

from app.models.job import Job
from app.models.pod_member import PodMember
from tests.factories import add_member, auth, make_job, make_pod, make_user, reload

pytestmark = pytest.mark.integration


def _job_payload(pod, **extra):
    return {"title": "A new video", "pod_id": str(pod.id), **extra}


# --------------------------------------------------------------------------
# 1. POST /jobs  — Owner or that pod's own TL only
# --------------------------------------------------------------------------


async def test_pod_tl_can_create_a_job(client, world):
    response = await client.post(
        "/api/jobs", json=_job_payload(world.pod), headers=auth(world.tl)
    )
    assert response.status_code == 201
    assert response.json()["stage"] == "intake"


async def test_owner_can_create_a_job_in_any_pod(client, world):
    response = await client.post(
        "/api/jobs", json=_job_payload(world.other_pod), headers=auth(world.owner)
    )
    assert response.status_code == 201


async def test_a_ve_cannot_create_work_in_their_own_pod(client, db, world):
    """The regression: any authenticated user could create work in any pod."""
    response = await client.post(
        "/api/jobs", json=_job_payload(world.pod), headers=auth(world.ve)
    )
    assert response.status_code == 403
    assert await _job_count(db) == 0


async def test_a_qc_cannot_create_work(client, db, world):
    response = await client.post(
        "/api/jobs", json=_job_payload(world.pod), headers=auth(world.qc)
    )
    assert response.status_code == 403
    assert await _job_count(db) == 0


async def test_a_tl_cannot_create_work_in_someone_elses_pod(client, db, world):
    response = await client.post(
        "/api/jobs", json=_job_payload(world.other_pod), headers=auth(world.tl)
    )
    assert response.status_code == 403
    assert await _job_count(db) == 0


async def test_creating_a_job_requires_authentication(client, world):
    response = await client.post("/api/jobs", json=_job_payload(world.pod))
    assert response.status_code == 401


async def test_creating_a_job_in_an_unknown_pod_is_404(client, world):
    response = await client.post(
        "/api/jobs",
        json={"title": "Ghost", "pod_id": str(uuid.uuid4())},
        headers=auth(world.owner),
    )
    assert response.status_code == 404


async def _job_count(db) -> int:
    from sqlalchemy import func, select

    return (await db.execute(select(func.count()).select_from(Job))).scalar_one()


# --------------------------------------------------------------------------
# 1b. POST /jobs/batch — same guard
# --------------------------------------------------------------------------


def _batch_payload(pod, count=2):
    return {"pod_id": str(pod.id), "jobs": [{"title": f"Clip {i}"} for i in range(count)]}


async def test_pod_tl_can_batch_create(client, world):
    response = await client.post(
        "/api/jobs/batch", json=_batch_payload(world.pod, 3), headers=auth(world.tl)
    )
    assert response.status_code == 201
    body = response.json()
    assert len(body) == 3
    assert len({job["code"] for job in body}) == 3


@pytest.mark.parametrize("actor", ["ve", "qc", "other_tl"])
async def test_batch_create_is_refused_for_everyone_below_the_pods_tl(
    client, db, world, actor
):
    response = await client.post(
        "/api/jobs/batch", json=_batch_payload(world.pod), headers=auth(getattr(world, actor))
    )
    assert response.status_code == 403
    assert await _job_count(db) == 0


# --------------------------------------------------------------------------
# 2. GET /jobs/{id} and /jobs/{id}/events — scoped by services/access.py
# --------------------------------------------------------------------------


@pytest.fixture
async def jobs(db, world):
    """One job per visibility case, all in `world.pod` unless stated."""
    built = {
        "ve_job": await make_job(db, pod=world.pod, created_by=world.tl, stage="editing", editor=world.ve),
        "ve2_job": await make_job(db, pod=world.pod, created_by=world.tl, stage="editing", editor=world.ve2),
        "routed": await make_job(db, pod=world.pod, created_by=world.tl, stage="qc2", reviewer=world.qc),
        "unrouted_qc2": await make_job(db, pod=world.pod, created_by=world.tl, stage="qc2"),
        "pod_qc1": await make_job(db, pod=world.pod, created_by=world.tl, stage="qc1"),
        "foreign": await make_job(db, pod=world.other_pod, created_by=world.other_tl, stage="qc2"),
    }
    await db.commit()
    return built


@pytest.mark.parametrize("path", ["", "/events"])
@pytest.mark.parametrize(
    "actor,key,expected",
    [
        ("owner", "foreign", 200),
        ("owner", "ve_job", 200),
        ("tl", "ve_job", 200),
        ("tl", "pod_qc1", 200),
        ("tl", "unrouted_qc2", 200),
        ("tl", "foreign", 403),
        ("ve", "ve_job", 200),
        ("ve", "ve2_job", 403),
        ("ve", "pod_qc1", 403),
        ("ve", "foreign", 403),
        ("qc", "routed", 200),
        ("qc", "unrouted_qc2", 200),
        ("qc", "pod_qc1", 403),
        ("qc", "ve_job", 403),
        ("qc", "foreign", 403),
        ("other_qc", "unrouted_qc2", 403),
        ("other_tl", "ve_job", 403),
    ],
)
async def test_single_job_read_scoping(client, world, jobs, actor, key, expected, path):
    response = await client.get(
        f"/api/jobs/{jobs[key].id}{path}", headers=auth(getattr(world, actor))
    )
    assert response.status_code == expected


async def test_reading_an_unknown_job_is_404(client, world):
    response = await client.get(f"/api/jobs/{uuid.uuid4()}", headers=auth(world.owner))
    assert response.status_code == 404


async def test_list_and_single_read_agree_for_every_role(client, world, jobs):
    """The bug existed because the list query and the by-id read implemented
    the same rule twice. Anything the list shows must be readable by id, and
    anything it hides must not be."""
    for actor in ("owner", "tl", "ve", "qc"):
        user = getattr(world, actor)
        listed = await client.get("/api/jobs?status=all&page_size=100", headers=auth(user))
        assert listed.status_code == 200
        visible = {item["id"] for item in listed.json()["items"]}

        for job in jobs.values():
            by_id = await client.get(f"/api/jobs/{job.id}", headers=auth(user))
            assert (by_id.status_code == 200) is (str(job.id) in visible), (
                f"{actor} disagrees on job {job.id}"
            )


# --------------------------------------------------------------------------
# 3. POST /jobs/{id}/advance — stage_machine.can_advance, enforced by the route
# --------------------------------------------------------------------------


async def _advance(client, job, user, stage, **extra):
    return await client.post(
        f"/api/jobs/{job.id}/advance", json={"stage": stage, **extra}, headers=auth(user)
    )


async def test_ve_may_walk_their_own_job_through_the_editor_loop(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="assigned", editor=world.ve)
    await db.commit()

    assert (await _advance(client, job, world.ve, "editing")).status_code == 200
    assert (await _advance(client, job, world.ve, "qc1")).status_code == 200
    assert (await reload(db, job)).stage == "qc1"


async def test_ve_cannot_start_a_job_that_has_no_deadline(client, db, world):
    """Half a hand-off. The job has their name on it and no date, so it is
    still the TL's move — the editor's start is refused on the route, not
    only hidden in the UI (docs/04)."""
    job = await make_job(
        db,
        pod=world.pod,
        created_by=world.tl,
        stage="assigned",
        editor=world.ve,
        deadline=None,
    )
    await db.commit()

    response = await _advance(client, job, world.ve, "editing")
    assert response.status_code == 403
    assert (await reload(db, job)).stage == "assigned"


async def test_setting_the_deadline_hands_the_job_over(client, db, world):
    """And the other side of it: once the TL fills the gap in, the same move
    the editor was refused a second ago goes through."""
    job = await make_job(
        db,
        pod=world.pod,
        created_by=world.tl,
        stage="assigned",
        editor=world.ve,
        deadline=None,
    )
    await db.commit()

    patched = await client.patch(
        f"/api/jobs/{job.id}", json={"deadline": "2099-01-01"}, headers=auth(world.tl)
    )
    assert patched.status_code == 200

    assert (await _advance(client, job, world.ve, "editing")).status_code == 200
    assert (await reload(db, job)).stage == "editing"


async def test_a_ve_cannot_set_the_deadline_on_the_way_past(client, db, world):
    """The date is a lead's decision, like the editor's name next to it — an
    editor cannot unblock their own job by inventing one."""
    job = await make_job(
        db,
        pod=world.pod,
        created_by=world.tl,
        stage="assigned",
        editor=world.ve,
        deadline=None,
    )
    await db.commit()

    response = await _advance(client, job, world.ve, "editing", deadline="2099-01-01")
    assert response.status_code == 403
    assert (await reload(db, job)).deadline is None


async def test_ve_cannot_advance_someone_elses_job(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="assigned", editor=world.ve2)
    await db.commit()

    response = await _advance(client, job, world.ve, "editing")
    assert response.status_code == 403
    assert (await reload(db, job)).stage == "assigned"


async def test_ve_cannot_deliver_their_own_job(client, db, world):
    """The regression in full: the route had no check, so a VE could push a
    job straight to delivered."""
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="final", editor=world.ve,
        client_sheet_ok=True, ops_tracker_ok=True,
    )
    await db.commit()

    response = await _advance(client, job, world.ve, "delivered")
    assert response.status_code == 403
    job = await reload(db, job)
    assert job.stage == "final" and job.delivered_at is None


async def test_ve_cannot_send_their_own_job_back(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="qc1", editor=world.ve)
    await db.commit()

    response = await _advance(client, job, world.ve, "revisions", note="looks fine to me")
    assert response.status_code == 403
    job = await reload(db, job)
    assert job.stage == "qc1" and job.round == 0


async def test_ve_cannot_clear_their_own_qc2(client, db, world):
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2", editor=world.ve, reviewer=world.qc
    )
    await db.commit()

    assert (await _advance(client, job, world.ve, "final")).status_code == 403


@pytest.mark.parametrize("target", ["final", "revisions"])
async def test_qc_may_clear_or_send_back_a_job_routed_to_them(client, db, world, target):
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2", editor=world.ve, reviewer=world.qc
    )
    await db.commit()

    response = await _advance(client, job, world.qc, target, note="change list")
    assert response.status_code == 200
    assert (await reload(db, job)).stage == target


async def test_qc_cannot_touch_a_job_routed_to_another_reviewer(client, db, world):
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="qc2", editor=world.ve, reviewer=world.other_qc
    )
    await db.commit()

    assert (await _advance(client, job, world.qc, "final")).status_code == 403


async def test_qc_cannot_advance_an_unrouted_job_they_can_see(client, db, world):
    """Readable (it's an unrouted QC2 job in their pod) but not theirs to move."""
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="qc2", editor=world.ve)
    await db.commit()

    assert (await client.get(f"/api/jobs/{job.id}", headers=auth(world.qc))).status_code == 200
    assert (await _advance(client, job, world.qc, "final")).status_code == 403


async def test_qc_cannot_deliver(client, db, world):
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="final", editor=world.ve,
        reviewer=world.qc, client_sheet_ok=True, ops_tracker_ok=True,
    )
    await db.commit()

    assert (await _advance(client, job, world.qc, "delivered")).status_code == 403


async def test_pod_tl_may_make_any_move_on_their_pod(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="intake")
    await db.commit()

    response = await _advance(client, job, world.tl, "assigned", assigned_editor_id=str(world.ve.id))
    assert response.status_code == 200
    assert (await reload(db, job)).assigned_editor_id == world.ve.id


async def test_a_tl_who_is_not_this_pods_tl_is_refused(client, db, world):
    """docs/04: a TL sitting in another pod as a member gets no job controls.
    Membership is granted here to prove membership alone isn't enough."""
    from tests.factories import add_member

    await add_member(db, world.pod, world.other_tl, "tl")
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="intake")
    await db.commit()

    assert (await _advance(client, job, world.other_tl, "assigned")).status_code == 403


async def test_owner_may_make_any_move_anywhere(client, db, world):
    job = await make_job(db, pod=world.other_pod, created_by=world.other_tl, stage="intake")
    await db.commit()

    assert (await _advance(client, job, world.owner, "assigned")).status_code == 200


async def test_the_founders_office_moves_nothing_it_was_not_given(client, db, world):
    """It used to carry the Owner's reach over the work by virtue of the role
    name. Now it is a TL on its own pods and a stranger everywhere else —
    see test_auth_and_users.py for the account side of the same change."""
    fo = await make_user(db, role="fo", secondary_role="tl")
    job = await make_job(db, pod=world.other_pod, created_by=world.other_tl, stage="intake")
    await db.commit()

    assert (await _advance(client, job, fo, "assigned")).status_code == 403
    created = await client.post("/api/jobs", json=_job_payload(world.other_pod), headers=auth(fo))
    assert created.status_code == 403
    assert (await client.get(f"/api/jobs/{job.id}", headers=auth(fo))).status_code == 403


async def test_a_lent_tl_makes_every_move_on_the_pod_they_were_given(client, db, world):
    """The other side of it, and the point of the whole feature: an *editor*
    who runs a client pod of their own is a full TL there — assigning, QC1,
    delivery — while staying an ordinary editor on the pod they cut for."""
    editor_lead = await make_user(db, role="ve", secondary_role="tl")
    their_pod = await make_pod(db, tl=editor_lead, name="Their client", onboarded_by=world.owner)
    await add_member(db, their_pod, editor_lead, "tl")
    job = await make_job(db, pod=their_pod, created_by=world.owner, stage="intake")
    await db.commit()

    assert (
        await _advance(client, job, editor_lead, "assigned", assigned_editor_id=str(world.ve.id))
    ).status_code == 200
    created = await client.post(
        "/api/jobs", json=_job_payload(their_pod), headers=auth(editor_lead)
    )
    assert created.status_code == 201

    # And nothing changes about the pods that were never theirs.
    elsewhere = await make_job(db, pod=world.other_pod, created_by=world.other_tl, stage="intake")
    await db.commit()
    assert (await _advance(client, elsewhere, editor_lead, "assigned")).status_code == 403


async def test_an_illegal_transition_is_400_before_any_permission_question(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="intake")
    await db.commit()

    response = await _advance(client, job, world.tl, "delivered")
    assert response.status_code == 400
    assert "Cannot move" in response.json()["detail"]


async def test_advance_requires_authentication(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="intake")
    await db.commit()

    response = await client.post(f"/api/jobs/{job.id}/advance", json={"stage": "assigned"})
    assert response.status_code == 401


# --------------------------------------------------------------------------
# 6. assigned_editor_id must be an active VE in that job's pod
# --------------------------------------------------------------------------


async def test_a_qc_account_cannot_be_assigned_as_the_editor_on_create(client, db, world):
    response = await client.post(
        "/api/jobs",
        json=_job_payload(world.pod, assigned_editor_id=str(world.qc.id)),
        headers=auth(world.tl),
    )
    assert response.status_code == 400
    assert "VE account" in response.json()["detail"]
    assert await _job_count(db) == 0


async def test_an_editor_from_another_pod_is_added_to_this_one_and_assigned(client, db, world):
    """Every editor picker offers active VEs company-wide (load is cross-pod,
    docs/05), so choosing one who isn't in this pod yet is the TL saying they
    should be — not a mistake to refuse. The membership row follows the
    assignment, uncertified."""
    response = await client.post(
        "/api/jobs",
        json=_job_payload(world.pod, assigned_editor_id=str(world.other_ve.id)),
        headers=auth(world.tl),
    )
    assert response.status_code == 201
    assert response.json()["stage"] == "assigned"

    member = await db.get(PodMember, {"pod_id": world.pod.id, "user_id": world.other_ve.id})
    assert member is not None
    assert member.pod_role == "ve"
    assert member.certified_at is None
    # And they keep the pod they came from.
    assert await db.get(PodMember, {"pod_id": world.other_pod.id, "user_id": world.other_ve.id})


async def test_a_batch_joins_an_outside_editor_once(client, db, world):
    """Two rows for the same newcomer must not try to write the membership
    row twice — the second `is_pod_member` has to see the first row."""
    response = await client.post(
        "/api/jobs/batch",
        json={
            "pod_id": str(world.pod.id),
            "jobs": [
                {"title": "One", "assigned_editor_id": str(world.other_ve.id)},
                {"title": "Two", "assigned_editor_id": str(world.other_ve.id)},
            ],
        },
        headers=auth(world.tl),
    )
    assert response.status_code == 201
    assert await db.get(PodMember, {"pod_id": world.pod.id, "user_id": world.other_ve.id})


async def test_a_refused_assignment_leaves_no_membership_behind(client, db, world):
    """The join is written after every check that can say no: a batch whose
    later row blows the cap must not leave the newcomer half-joined."""
    world.other_ve.max_concurrent_jobs = 1
    await db.commit()

    response = await client.post(
        "/api/jobs/batch",
        json={
            "pod_id": str(world.pod.id),
            "jobs": [
                {"title": "One", "assigned_editor_id": str(world.other_ve.id)},
                {"title": "Two", "assigned_editor_id": str(world.other_ve.id)},
            ],
        },
        headers=auth(world.tl),
    )
    assert response.status_code == 400
    assert await _job_count(db) == 0
    assert await db.get(PodMember, {"pod_id": world.pod.id, "user_id": world.other_ve.id}) is None


async def test_a_deactivated_editor_cannot_be_assigned(client, db, world):
    world.ve.is_active = False
    await db.commit()

    response = await client.post(
        "/api/jobs",
        json=_job_payload(world.pod, assigned_editor_id=str(world.ve.id)),
        headers=auth(world.tl),
    )
    assert response.status_code == 400
    assert "deactivated" in response.json()["detail"]


async def test_assigning_a_valid_editor_starts_the_job_at_assigned(client, db, world):
    response = await client.post(
        "/api/jobs",
        json=_job_payload(world.pod, assigned_editor_id=str(world.ve.id)),
        headers=auth(world.tl),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["stage"] == "assigned"
    assert body["assigned_editor_id"] == str(world.ve.id)


async def test_a_qc_account_cannot_be_assigned_via_advance(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="intake")
    await db.commit()

    response = await _advance(
        client, job, world.tl, "assigned", assigned_editor_id=str(world.qc.id)
    )
    assert response.status_code == 400
    job = await reload(db, job)
    assert job.stage == "intake" and job.assigned_editor_id is None


async def test_a_qc_account_cannot_be_assigned_via_patch(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="intake")
    await db.commit()

    response = await client.patch(
        f"/api/jobs/{job.id}",
        json={"assigned_editor_id": str(world.qc.id)},
        headers=auth(world.tl),
    )
    assert response.status_code == 400
    assert (await reload(db, job)).assigned_editor_id is None


async def test_a_qc_account_cannot_be_assigned_in_a_batch(client, db, world):
    response = await client.post(
        "/api/jobs/batch",
        json={
            "pod_id": str(world.pod.id),
            "jobs": [
                {"title": "Fine"},
                {"title": "Bad editor", "assigned_editor_id": str(world.qc.id)},
            ],
        },
        headers=auth(world.tl),
    )
    assert response.status_code == 400
    # The whole batch is one transaction — the valid item must not survive.
    assert await _job_count(db) == 0


async def test_a_ve_cannot_hand_their_job_to_a_different_editor(client, db, world):
    """Regression: `can_advance` gates the *move*, but `assigned_editor_id`
    is a separate authority the handler used to apply for whoever sent it.
    A VE making one of their three legal moves could hand the job to another
    editor — docs/04 scopes assignment to the TL. Fixed in advance_stage.
    """
    job = await make_job(db, pod=world.pod, created_by=world.tl, stage="assigned", editor=world.ve)
    await db.commit()

    response = await _advance(
        client, job, world.ve, "editing", assigned_editor_id=str(world.ve2.id)
    )

    assert response.status_code == 403, "a VE must not be able to reassign the editor"
    assert (await reload(db, job)).assigned_editor_id == world.ve.id


async def test_an_unknown_editor_id_is_rejected(client, db, world):
    response = await client.post(
        "/api/jobs",
        json=_job_payload(world.pod, assigned_editor_id=str(uuid.uuid4())),
        headers=auth(world.tl),
    )
    assert response.status_code == 400
