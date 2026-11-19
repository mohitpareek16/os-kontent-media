"""Server-side filtering, sorting and pagination on every list endpoint.

The screens these back used to pull the whole table and filter it in the
browser, which made the pager lie (it counted downloaded rows, not matching
ones) and quietly capped what you could ever see. These tests pin the
behaviour that replaced it: the filter runs in SQL, `total` counts matching
rows rather than returned ones, and paging is stable across ties.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.job_event import JobEvent
from app.models.notification import Notification
from tests.factories import auth, make_job, make_pod, make_user

pytestmark = pytest.mark.integration


async def notify(db, *, job, recipient, actor, event_type="note_added", payload=None):
    """A notification the way the app makes one — an event, then a row
    pointing at it. The list endpoint joins through both."""
    event = JobEvent(
        job_id=job.id, event_type=event_type, actor_id=actor.id, payload=payload or {}
    )
    db.add(event)
    await db.flush()
    notification = Notification(user_id=recipient.id, event_id=event.id)
    db.add(notification)
    await db.flush()
    return notification


# --------------------------------------------------------------------------
# GET /jobs — the pipeline table
# --------------------------------------------------------------------------


async def test_stage_filter_is_applied_in_sql(client, db, world):
    await make_job(db, pod=world.pod, created_by=world.owner, stage="qc1")
    await make_job(db, pod=world.pod, created_by=world.owner, stage="qc2")
    await make_job(db, pod=world.pod, created_by=world.owner, stage="editing")
    await db.commit()

    response = await client.get(
        "/api/jobs?status=all&stage=qc1&stage=qc2", headers=auth(world.owner)
    )
    body = response.json()
    assert body["total"] == 2
    assert {j["stage"] for j in body["items"]} == {"qc1", "qc2"}


async def test_stage_sort_follows_board_order_across_pages(client, db, world):
    stages = (
        "qc2", "delivered", "editing", "intake", "final", "qc1", "assigned", "revisions"
    )
    jobs = {}
    for stage in stages:
        jobs[stage] = await make_job(db, pod=world.pod, created_by=world.owner, stage=stage)
    await db.commit()

    first = await client.get(
        "/api/jobs?status=all&sort_by=stage&page_size=3&page=1", headers=auth(world.owner)
    )
    second = await client.get(
        "/api/jobs?status=all&sort_by=stage&page_size=3&page=2", headers=auth(world.owner)
    )
    third = await client.get(
        "/api/jobs?status=all&sort_by=stage&page_size=3&page=3", headers=auth(world.owner)
    )
    assert first.status_code == second.status_code == third.status_code == 200
    ids = [
        item["id"]
        for response in (first, second, third)
        for item in response.json()["items"]
    ]
    expected = (
        "intake", "assigned", "editing", "qc1", "qc2", "revisions", "final", "delivered"
    )
    assert ids == [str(jobs[stage].id) for stage in expected]


async def test_weight_and_editor_filters_combine(client, db, world):
    await make_job(db, pod=world.pod, created_by=world.owner, weight="heavy", editor=world.ve)
    await make_job(db, pod=world.pod, created_by=world.owner, weight="light", editor=world.ve)
    await make_job(db, pod=world.pod, created_by=world.owner, weight="heavy", editor=world.ve2)
    await db.commit()

    response = await client.get(
        f"/api/jobs?status=all&weight=heavy&editor_id={world.ve.id}", headers=auth(world.owner)
    )
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["editor_name"] == world.ve.name


async def test_unassigned_and_unrouted_are_filterable(client, db, world):
    await make_job(db, pod=world.pod, created_by=world.owner, editor=world.ve)
    await make_job(db, pod=world.pod, created_by=world.owner)
    await make_job(db, pod=world.pod, created_by=world.owner, stage="qc2")
    await make_job(
        db, pod=world.pod, created_by=world.owner, stage="qc2", reviewer=world.qc
    )
    await db.commit()

    unassigned = await client.get(
        "/api/jobs?status=all&unassigned=true", headers=auth(world.owner)
    )
    assert unassigned.json()["total"] == 3

    unrouted = await client.get("/api/jobs?status=all&unrouted=true", headers=auth(world.owner))
    assert unrouted.json()["total"] == 1
    assert unrouted.json()["items"][0]["qc2_reviewer_name"] is None


async def test_deadline_range_filter_excludes_jobs_with_no_deadline(client, db, world):
    today = date.today()
    await make_job(db, pod=world.pod, created_by=world.owner, deadline=today)
    await make_job(db, pod=world.pod, created_by=world.owner, deadline=today + timedelta(days=30))
    await make_job(db, pod=world.pod, created_by=world.owner, deadline=None)
    await db.commit()

    ranged = await client.get(
        f"/api/jobs?status=all&deadline_from={today}&deadline_to={today + timedelta(days=7)}",
        headers=auth(world.owner),
    )
    assert ranged.json()["total"] == 1

    missing = await client.get(
        "/api/jobs?status=all&no_deadline=true", headers=auth(world.owner)
    )
    assert missing.json()["total"] == 1
    assert missing.json()["items"][0]["deadline"] is None


async def test_total_counts_matching_rows_not_returned_rows(client, db, world):
    for _ in range(7):
        await make_job(db, pod=world.pod, created_by=world.owner, stage="editing")
    await db.commit()

    response = await client.get(
        "/api/jobs?status=all&page=2&page_size=3", headers=auth(world.owner)
    )
    body = response.json()
    assert body["total"] == 7
    assert len(body["items"]) == 3
    assert body["page"] == 2


async def test_paging_over_tied_sort_values_never_repeats_a_row(client, db, world):
    """Every job here has the same deadline. Without a tiebreak the database
    is free to order them differently per query, so a row lands on two pages
    and another on none."""
    deadline = date.today()
    for _ in range(10):
        await make_job(db, pod=world.pod, created_by=world.owner, deadline=deadline)
    await db.commit()

    seen: list[str] = []
    for page in (1, 2):
        response = await client.get(
            f"/api/jobs?status=all&sort_by=deadline&page={page}&page_size=5",
            headers=auth(world.owner),
        )
        seen += [j["id"] for j in response.json()["items"]]

    assert len(seen) == len(set(seen)) == 10


async def test_sorting_by_pod_uses_the_pod_name(client, db, world):
    await make_job(db, pod=world.other_pod, created_by=world.owner)
    await make_job(db, pod=world.pod, created_by=world.owner)
    await db.commit()

    response = await client.get(
        "/api/jobs?status=all&sort_by=pod&sort_dir=asc", headers=auth(world.owner)
    )
    assert [j["pod_name"] for j in response.json()["items"]] == ["Acme", "Globex"]


async def test_an_unknown_sort_field_is_rejected(client, world):
    response = await client.get(
        "/api/jobs?sort_by=password_hash", headers=auth(world.owner)
    )
    assert response.status_code == 422


async def test_stats_honour_the_same_filters_as_the_table(client, db, world):
    """The cards sit on top of the rows; counting a wider set than the table
    shows is just a wrong number."""
    await make_job(db, pod=world.pod, created_by=world.owner, stage="editing", weight="heavy")
    await make_job(db, pod=world.pod, created_by=world.owner, stage="editing", weight="light")
    await db.commit()

    stats = await client.get("/api/jobs/stats?weight=heavy", headers=auth(world.owner))
    assert stats.json()["all"] == 1
    assert stats.json()["active"] == 1


async def test_delivered_work_has_a_tab_of_its_own(client, db, world):
    """Finished work is excluded from every other status by construction — a
    delivered job is never active, never overdue, never Mine and cannot be
    scrapped — so without this tab the only place it appeared was ALL, and
    asking the ACTIVE tab for the Delivered stage returned nothing at all,
    which reads as the system having lost it."""
    await make_job(db, pod=world.pod, created_by=world.owner, stage="delivered")
    await make_job(db, pod=world.pod, created_by=world.owner, stage="editing")
    await db.commit()

    delivered = await client.get("/api/jobs?status=delivered", headers=auth(world.owner))
    assert delivered.json()["total"] == 1
    assert delivered.json()["items"][0]["stage"] == "delivered"

    active = await client.get("/api/jobs?status=active", headers=auth(world.owner))
    assert {j["stage"] for j in active.json()["items"]} == {"editing"}

    stats = await client.get("/api/jobs/stats", headers=auth(world.owner))
    assert stats.json()["delivered"] == 1


async def test_job_filters_cannot_widen_row_scope(client, db, world):
    """A filter narrows what you can already see — it never reaches past the
    role scoping in services/access.py."""
    await make_job(db, pod=world.other_pod, created_by=world.owner, editor=world.other_ve)
    await db.commit()

    response = await client.get(
        f"/api/jobs?status=all&editor_id={world.other_ve.id}", headers=auth(world.ve)
    )
    assert response.status_code == 200
    assert response.json()["total"] == 0


# --------------------------------------------------------------------------
# GET /jobs/overview — the Overview screen
# --------------------------------------------------------------------------


async def test_overview_counts_are_computed_server_side(client, db, world):
    yesterday = date.today() - timedelta(days=1)
    await make_job(db, pod=world.pod, created_by=world.owner, stage="qc1")
    await make_job(db, pod=world.pod, created_by=world.owner, stage="editing", deadline=yesterday)
    await make_job(db, pod=world.pod, created_by=world.owner, stage="delivered", round=0)
    await make_job(db, pod=world.pod, created_by=world.owner, stage="delivered", round=2)
    await db.commit()

    body = (await client.get("/api/jobs/overview", headers=auth(world.owner))).json()
    assert body["in_flight"] == 2
    assert body["overdue"] == 1
    assert body["delivered"] == 2
    assert body["clean_delivered"] == 1
    assert body["pending_qc1"] == 1
    assert body["first_pass_pct"] == 50


async def test_overview_reports_no_first_pass_rate_before_any_delivery(client, db, world):
    await make_job(db, pod=world.pod, created_by=world.owner, stage="editing")
    await db.commit()

    body = (await client.get("/api/jobs/overview", headers=auth(world.owner))).json()
    # None, not 0 — "0%" would read as every delivery having failed.
    assert body["first_pass_pct"] is None


async def test_overview_lists_pods_with_no_jobs(client, world):
    body = (await client.get("/api/jobs/overview", headers=auth(world.owner))).json()
    assert [p["pod_name"] for p in body["pods"]] == ["Acme", "Globex"]
    assert body["pods"][0]["in_flight"] == 0


async def test_overview_is_scoped_to_what_the_caller_may_see(client, db, world):
    await make_job(db, pod=world.other_pod, created_by=world.owner, stage="editing")
    await make_job(db, pod=world.pod, created_by=world.owner, stage="editing")
    await db.commit()

    body = (await client.get("/api/jobs/overview", headers=auth(world.tl))).json()
    assert body["in_flight"] == 1
    assert [p["pod_name"] for p in body["pods"]] == ["Acme"]


# --------------------------------------------------------------------------
# GET /users — the account directory
# --------------------------------------------------------------------------


async def test_user_search_matches_name_or_email(client, world):
    response = await client.get("/api/users?search=Editor One", headers=auth(world.owner))
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["email"] == world.ve.email

    by_email = await client.get(
        f"/api/users?search={world.qc.email}", headers=auth(world.owner)
    )
    assert by_email.json()["total"] == 1


async def test_user_role_and_status_filters(client, db, world):
    await make_user(db, role="ve", name="Departed Editor", is_active=False)
    await db.commit()

    editors = await client.get("/api/users?role=ve", headers=auth(world.owner))
    assert editors.json()["total"] == 4

    active = await client.get("/api/users?role=ve&status=active", headers=auth(world.owner))
    assert active.json()["total"] == 3

    inactive = await client.get("/api/users?status=inactive", headers=auth(world.owner))
    assert [u["name"] for u in inactive.json()["items"]] == ["Departed Editor"]


async def test_include_inactive_false_still_works_for_pickers(client, db, world):
    """The older parameter the assignment pickers pass — dropping it would
    have silently started offering deactivated teammates work."""
    await make_user(db, role="ve", is_active=False)
    await db.commit()

    response = await client.get("/api/users?include_inactive=false", headers=auth(world.owner))
    assert all(u["is_active"] for u in response.json()["items"])


async def test_user_directory_pages(client, world):
    response = await client.get("/api/users?page_size=3", headers=auth(world.owner))
    body = response.json()
    assert body["total"] == 8
    assert len(body["items"]) == 3
    # Default sort is by name, ascending.
    assert body["items"] == sorted(body["items"], key=lambda u: u["name"])


async def test_user_stats_count_the_whole_roster(client, db, world):
    await make_user(db, role="qc", is_active=False)
    await db.commit()

    stats = (await client.get("/api/users/stats", headers=auth(world.owner))).json()
    assert stats["by_role"]["qc"] == {"total": 3, "inactive": 1}
    assert stats["active"] == 8
    assert stats["inactive"] == 1


async def test_a_ve_still_cannot_read_the_directory(client, world):
    response = await client.get("/api/users?search=a", headers=auth(world.ve))
    assert response.status_code == 403


# --------------------------------------------------------------------------
# GET /pods
# --------------------------------------------------------------------------


async def test_pod_status_filter_and_counts(client, db, world):
    await make_pod(db, tl=world.tl, name="Initech", status="paused", onboarded_by=world.owner)
    await db.commit()

    response = await client.get("/api/pods?status=active", headers=auth(world.owner))
    body = response.json()
    assert body["total"] == 2
    # The tabs count every status, so you can see where to click next.
    assert body["counts"] == {"all": 3, "active": 2, "paused": 1, "churned": 0}


async def test_pod_search_narrows_both_rows_and_counts(client, world):
    response = await client.get("/api/pods?search=acm", headers=auth(world.owner))
    body = response.json()
    assert [p["name"] for p in body["items"]] == ["Acme"]
    assert body["counts"]["all"] == 1


# --------------------------------------------------------------------------
# GET /notifications
# --------------------------------------------------------------------------


async def test_unread_only_filter_and_whole_inbox_unread_count(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.owner, editor=world.ve)
    for _ in range(3):
        await notify(db, job=job, recipient=world.ve, actor=world.tl, payload={"note": "hi"})

    rows = await db.execute(select(Notification).where(Notification.user_id == world.ve.id))
    rows.scalars().first().read_at = datetime.now(timezone.utc)
    await db.commit()

    inbox = (await client.get("/api/notifications", headers=auth(world.ve))).json()
    assert inbox["total"] == 3
    assert inbox["unread"] == 2

    unread_only = (
        await client.get("/api/notifications?unread_only=true", headers=auth(world.ve))
    ).json()
    assert unread_only["total"] == 2
    # `unread` is the inbox's, not the filtered page's — the bell shows it.
    assert unread_only["unread"] == 2


async def test_mark_all_read_clears_the_whole_inbox_not_one_page(client, db, world):
    """30 notifications, a 25-row page. Marking all read used to fire one
    request per *loaded* row, so the tail stayed unread."""
    job = await make_job(db, pod=world.pod, created_by=world.owner, editor=world.ve)
    for _ in range(30):
        await notify(db, job=job, recipient=world.ve, actor=world.tl)
    await db.commit()

    response = await client.post("/api/notifications/read-all", headers=auth(world.ve))
    assert response.status_code == 204

    inbox = (await client.get("/api/notifications", headers=auth(world.ve))).json()
    assert inbox["unread"] == 0


async def test_notifications_stay_scoped_to_their_owner(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.owner, editor=world.ve)
    await notify(db, job=job, recipient=world.ve, actor=world.tl)
    await db.commit()

    other = (await client.get("/api/notifications", headers=auth(world.ve2))).json()
    assert other["total"] == 0
    assert other["unread"] == 0


async def test_video_type_filter_is_multi_select(client, db, world):
    """The column that replaced weight on every screen. Repeatable param, same
    shape as `stage`, so "podcasts and shorts" is one request."""
    for video_type in ("podcast", "long_form", "short_form", "short_form"):
        await make_job(db, pod=world.pod, created_by=world.owner, video_type=video_type)
    await db.commit()

    one = await client.get(
        "/api/jobs?status=all&video_type=podcast", headers=auth(world.owner)
    )
    assert one.json()["total"] == 1
    assert one.json()["items"][0]["video_type"] == "podcast"

    two = await client.get(
        "/api/jobs?status=all&video_type=podcast&video_type=short_form",
        headers=auth(world.owner),
    )
    assert two.json()["total"] == 3


async def test_a_job_is_long_form_unless_somebody_says_otherwise(client, world):
    """Nobody has to pick: a brief that says nothing about format is the
    format most of the back catalogue already is."""
    created = await client.post(
        "/api/jobs",
        json={"title": "Unspecified", "pod_id": str(world.pod.id)},
        headers=auth(world.tl),
    )
    assert created.status_code == 201
    assert created.json()["video_type"] == "long_form"


async def test_an_unknown_video_type_is_422_not_a_500(client, world):
    response = await client.post(
        "/api/jobs",
        json={"title": "Reel?", "pod_id": str(world.pod.id), "video_type": "vertical"},
        headers=auth(world.tl),
    )
    assert response.status_code == 422


# --------------------------------------------------------------------------
# ACTIVE vs INTAKE, and the order the table comes back in
# --------------------------------------------------------------------------


async def test_active_and_intake_are_disjoint(client, db, world):
    """ACTIVE used to mean "anything not delivered", which contained INTAKE
    whole: a board with three cuts in progress and five videos still waiting
    for an editor reported eight ACTIVE, the two cards sitting side by side
    did not add up, and unassigned rows were interleaved with work underway.

    They are two questions for two people — "how is the work going" and "who
    takes this next" — so the tabs no longer overlap.
    """
    for _ in range(5):
        await make_job(db, pod=world.pod, created_by=world.owner, stage="intake")
    await make_job(db, pod=world.pod, created_by=world.owner, stage="editing", editor=world.ve)
    await make_job(db, pod=world.pod, created_by=world.owner, stage="qc1")
    await make_job(db, pod=world.pod, created_by=world.owner, stage="delivered")
    await db.commit()

    active = await client.get("/api/jobs?status=active", headers=auth(world.owner))
    intake = await client.get("/api/jobs?status=intake", headers=auth(world.owner))

    assert {j["stage"] for j in active.json()["items"]} == {"editing", "qc1"}
    assert active.json()["total"] == 2
    assert intake.json()["total"] == 5

    stats = (await client.get("/api/jobs/stats", headers=auth(world.owner))).json()
    assert stats["active"] == 2
    assert stats["intake"] == 5
    # The two cards add up to everything still open, with nothing counted twice.
    assert stats["active"] + stats["intake"] + stats["delivered"] == stats["all"]


async def test_overdue_still_counts_unassigned_work(client, db, world):
    """The one place intake is deliberately *not* split off. A video past its
    deadline that nobody has even been given is the most overdue thing on the
    board, and dropping it out of the alarm because it is not "active" would
    hide exactly the case worth shouting about."""
    await make_job(
        db,
        pod=world.pod,
        created_by=world.owner,
        stage="intake",
        deadline=date.today() - timedelta(days=2),
    )
    await db.commit()

    overdue = await client.get("/api/jobs?status=overdue", headers=auth(world.owner))
    assert overdue.json()["total"] == 1
    assert (await client.get("/api/jobs/stats", headers=auth(world.owner))).json()["overdue"] == 1


async def test_the_default_order_puts_work_in_progress_above_the_backlog(client, db, world):
    """`sort_by=pipeline`, and the default. Rows group by what state the work
    is in — being worked on, then waiting for an editor, then delivered, then
    scrapped — because sorting by creation date put a video pasted in this
    morning with nobody on it above one due today and half cut."""
    intake = await make_job(db, pod=world.pod, created_by=world.owner, stage="intake")
    editing = await make_job(
        db, pod=world.pod, created_by=world.owner, stage="editing", editor=world.ve
    )
    delivered = await make_job(db, pod=world.pod, created_by=world.owner, stage="delivered")
    scrapped = await make_job(db, pod=world.pod, created_by=world.owner, scrapped_by=world.tl)
    await db.commit()

    response = await client.get("/api/jobs?status=all", headers=auth(world.owner))
    assert response.status_code == 200
    assert [j["id"] for j in response.json()["items"]] == [
        str(editing.id),
        str(intake.id),
        str(delivered.id),
        str(scrapped.id),
    ]


async def test_undated_work_sorts_last_inside_its_group(client, db, world):
    """A row with no deadline cannot be urgent. Postgres sorts NULLs last only
    on DESC, so a plain ascending sort floated every undated job to the top of
    the table and buried the work that was actually due."""
    soon = await make_job(
        db,
        pod=world.pod,
        created_by=world.owner,
        stage="editing",
        editor=world.ve,
        deadline=date.today() + timedelta(days=1),
    )
    later = await make_job(
        db,
        pod=world.pod,
        created_by=world.owner,
        stage="editing",
        editor=world.ve,
        deadline=date.today() + timedelta(days=9),
    )
    undated = await make_job(
        db, pod=world.pod, created_by=world.owner, stage="editing", deadline=None
    )
    await db.commit()

    response = await client.get("/api/jobs?status=active", headers=auth(world.owner))
    assert [j["id"] for j in response.json()["items"]] == [
        str(soon.id),
        str(later.id),
        str(undated.id),
    ]


async def test_the_pipeline_order_reverses_as_a_whole(client, db, world):
    """Clicking a header twice means "the other end of this list". Flipping
    the group while leaving the deadline ascending would be neither order."""
    intake = await make_job(db, pod=world.pod, created_by=world.owner, stage="intake")
    editing = await make_job(
        db, pod=world.pod, created_by=world.owner, stage="editing", editor=world.ve
    )
    await db.commit()

    response = await client.get(
        "/api/jobs?status=all&sort_by=pipeline&sort_dir=desc", headers=auth(world.owner)
    )
    assert [j["id"] for j in response.json()["items"]][:2] == [str(intake.id), str(editing.id)]
