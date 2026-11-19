"""The tools added so the bot stops answering "I can't".

Every question in here was one the bot used to refuse — not because the data
was out of reach, but because no tool existed to ask with. So these tests are
as much about *coverage* as correctness: "who is the best editor in this pod"
must come back with numbers, and it must still come back with nothing when
the pod belongs to someone else.

The scoping assertions matter more than the arithmetic ones. `compare_editors`
puts people side by side, which docs/04-permissions.md gates on pod
leadership — a TL sitting in another TL's pod as a member gets the same
refusal here that they get from /pods/{id}/analytics/avg-rounds-by-editor.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.services.ai.tools import run_tool
from tests.factories import make_job

pytestmark = pytest.mark.asyncio


async def deliver(db, *, pod, created_by, editor, rounds=0, days_ago=1, weight="standard"):
    """A delivered job, dated. `make_job` has no delivered_at of its own —
    every trend and window in here reads that column, so it is set here."""
    job = await make_job(
        db,
        pod=pod,
        created_by=created_by,
        stage="delivered",
        editor=editor,
        round=rounds,
        weight=weight,
    )
    job.delivered_at = datetime.now(timezone.utc) - timedelta(days=days_ago)
    await db.flush()
    return job


async def test_counting_by_stage_and_by_date_give_the_same_total(db, world):
    """The bug this encodes was found in live data, not in a test.

    `list_pods` counts rows at stage 'delivered'; `get_delivery_trend` counts
    rows whose `delivered_at` falls in a window, and has to skip a NULL —
    there is no bucket for a dateless delivery. One job delivered before the
    code stamped that column was enough to make the bot answer "2" and "1" to
    the same question depending on which tool it reached for.

    The database now refuses a delivered job without a date (migration 0009),
    so the two counts agree by construction. This asserts the agreement
    rather than the constraint, because the agreement is the thing anyone
    actually cares about.
    """
    for days_ago in (1, 5, 9):
        await deliver(db, pod=world.pod, created_by=world.tl, editor=world.ve, days_ago=days_ago)
    await db.commit()

    by_stage = await run_tool(
        db,
        world.tl,
        name="list_pods",
        arguments={"delivered_from": (date.today() - timedelta(days=30)).isoformat()},
    )
    by_date = await run_tool(
        db,
        world.tl,
        name="get_delivery_trend",
        arguments={
            "bucket": "week",
            "date_from": (date.today() - timedelta(days=30)).isoformat(),
        },
    )

    acme = next(row for row in by_stage["pods"] if row["name"] == "Acme")
    assert acme["delivered_in_window"] == by_date["total_delivered"] == 3


async def test_a_delivered_job_cannot_exist_without_a_delivery_date(db, world):
    """The invariant, at the only layer that can actually hold it. Application
    code already sets the column; a constraint is what makes that true of rows
    the application did not write."""
    from sqlalchemy.exc import IntegrityError

    from app.models.job import Job

    db.add(
        Job(
            code="KM-BAD",
            title="Delivered with no date",
            pod_id=world.pod.id,
            stage="delivered",
            created_by=world.tl.id,
        )
    )
    with pytest.raises(IntegrityError):
        await db.flush()
    await db.rollback()


async def test_compare_editors_answers_who_delivered_most(db, world):
    await deliver(db, pod=world.pod, created_by=world.tl, editor=world.ve, rounds=0)
    await deliver(db, pod=world.pod, created_by=world.tl, editor=world.ve, rounds=2)
    await deliver(db, pod=world.pod, created_by=world.tl, editor=world.ve2, rounds=0)
    await db.commit()

    result = await run_tool(
        db, world.tl, name="compare_editors", arguments={"pod_id": str(world.pod.id)}
    )

    people = {row["name"]: row for row in result["people"]}
    assert people["Editor One"]["delivered_in_window"] == 2
    assert people["Editor One"]["clean_first_pass"] == 1
    assert people["Editor One"]["first_pass_rate"] == 0.5
    assert people["Editor One"]["avg_qc_rounds"] == 1.0
    assert people["Editor Two"]["first_pass_rate"] == 1.0
    # Sorted by volume, so the answer to "who delivered most" is row one.
    assert result["people"][0]["name"] == "Editor One"


async def test_compare_editors_carries_the_caveat_not_just_the_ranking(db, world):
    """A bare ranking is the thing this must never become — the numbers are
    not commensurable, so the reading notes travel with them."""
    await deliver(db, pod=world.pod, created_by=world.tl, editor=world.ve)
    await db.commit()

    result = await run_tool(
        db, world.tl, name="compare_editors", arguments={"pod_id": str(world.pod.id)}
    )

    notes = result["reading_notes"]
    assert "not the same as sorted by best" in notes
    assert "briefing problem" in notes


async def test_compare_editors_refuses_a_pod_you_do_not_lead(db, world):
    result = await run_tool(
        db, world.tl, name="compare_editors", arguments={"pod_id": str(world.other_pod.id)}
    )

    assert result["status"] == 403


async def test_compare_editors_without_a_pod_covers_only_pods_you_lead(db, world):
    await deliver(db, pod=world.pod, created_by=world.tl, editor=world.ve)
    await deliver(db, pod=world.other_pod, created_by=world.other_tl, editor=world.other_ve)
    await db.commit()

    result = await run_tool(db, world.tl, name="compare_editors", arguments={})

    assert [row["name"] for row in result["people"]] == ["Editor One"]
    assert "only the pods you lead" in result["scope_note"]


async def test_the_owner_compares_across_every_pod(db, world):
    await deliver(db, pod=world.pod, created_by=world.tl, editor=world.ve)
    await deliver(db, pod=world.other_pod, created_by=world.other_tl, editor=world.other_ve)
    await db.commit()

    result = await run_tool(db, world.owner, name="compare_editors", arguments={})

    assert {row["name"] for row in result["people"]} == {"Editor One", "Other Editor"}
    assert result["scope_note"] is None


async def test_editors_are_never_reported_in_points(db, world):
    """Points are a QC2 budget and nothing else (docs/12).

    An editor comparison used to carry `weighted_points_delivered`, scored off
    `weight` — a column every job takes the default of since migration 0018.
    It was the delivery count doubled, and the bot quoted it as if it knew
    something the count didn't: "7 jobs open, a weighted load of 14 points".
    """
    await deliver(db, pod=world.pod, created_by=world.tl, editor=world.ve, weight="heavy")
    await deliver(db, pod=world.pod, created_by=world.tl, editor=world.ve2, weight="light")
    await db.commit()

    result = await run_tool(
        db, world.tl, name="compare_editors", arguments={"pod_id": str(world.pod.id)}
    )

    assert "points_scale" not in result
    for row in result["people"]:
        assert not [key for key in row if "point" in key], row
    volume = {row["name"]: row["delivered_in_window"] for row in result["people"]}
    assert volume == {"Editor One": 1, "Editor Two": 1}


async def test_a_client_pods_load_is_a_count_of_videos_not_points(db, world):
    """Same rule from the other end — this is the answer the bot got wrong on
    screen, on a client with seven open jobs and "14 points" of load."""
    await make_job(db, pod=world.pod, created_by=world.tl, stage="editing")
    await make_job(db, pod=world.pod, created_by=world.tl, stage="qc1")
    await db.commit()

    listed = await run_tool(db, world.owner, name="list_pods", arguments={})
    health = await run_tool(
        db, world.tl, name="get_pod_health", arguments={"pod_id": str(world.pod.id)}
    )

    acme = next(row for row in listed["pods"] if row["name"] == "Acme")
    assert acme["open_jobs_now"] == 2
    assert not [key for key in acme if "point" in key or "weighted" in key], acme
    assert health["open_jobs_now"] == 2
    assert not [key for key in health if "point" in key or "weighted" in key], health


async def test_list_pods_gives_every_client_in_one_call(db, world):
    await make_job(db, pod=world.pod, created_by=world.tl, stage="editing")
    await deliver(db, pod=world.pod, created_by=world.tl, editor=world.ve, rounds=0)
    await db.commit()

    result = await run_tool(db, world.owner, name="list_pods", arguments={})

    pods = {row["name"]: row for row in result["pods"]}
    assert set(pods) == {"Acme", "Globex"}
    assert pods["Acme"]["open_jobs_now"] == 1
    assert pods["Acme"]["delivered_in_window"] == 1
    assert pods["Acme"]["first_pass_rate"] == 1.0
    # No deliveries is no rate, not a perfect one.
    assert pods["Globex"]["first_pass_rate"] is None


async def test_list_pods_shows_a_tl_only_their_own(db, world):
    result = await run_tool(db, world.tl, name="list_pods", arguments={})

    assert [row["name"] for row in result["pods"]] == ["Acme"]
    assert result["pods"][0]["you_lead_this_pod"] is True


async def test_delivery_trend_buckets_by_week(db, world):
    await deliver(db, pod=world.pod, created_by=world.tl, editor=world.ve, days_ago=2)
    await deliver(db, pod=world.pod, created_by=world.tl, editor=world.ve, days_ago=3)
    await deliver(db, pod=world.pod, created_by=world.tl, editor=world.ve, days_ago=20)
    await db.commit()

    result = await run_tool(
        db,
        world.tl,
        name="get_delivery_trend",
        arguments={
            "bucket": "week",
            "date_from": (date.today() - timedelta(days=30)).isoformat(),
        },
    )

    assert result["total_delivered"] == 3
    assert len(result["series"]) == 1
    series = result["series"][0]
    # Labels and every series array are the same length — that alignment is
    # what makes the result safe to hand straight to render_chart.
    assert len(series["delivered"]) == len(result["labels"])
    assert sum(series["delivered"]) == 3


async def test_delivery_trend_grouped_by_pod_is_dense(db, world):
    """A bucket where one client delivered nothing must read 0, not go
    missing — a ragged series shifts every later point onto the wrong date."""
    await deliver(db, pod=world.pod, created_by=world.tl, editor=world.ve, days_ago=1)
    await deliver(db, pod=world.other_pod, created_by=world.other_tl, editor=world.other_ve, days_ago=25)
    await db.commit()

    result = await run_tool(
        db,
        world.owner,
        name="get_delivery_trend",
        arguments={
            "bucket": "week",
            "date_from": (date.today() - timedelta(days=40)).isoformat(),
            "group_by": "pod",
        },
    )

    assert {s["name"] for s in result["series"]} == {"Acme", "Globex"}
    for series in result["series"]:
        assert len(series["delivered"]) == len(result["labels"])
    assert 0 in result["series"][0]["delivered"]


async def test_delivery_trend_refuses_a_window_that_will_not_plot(db, world):
    result = await run_tool(
        db,
        world.tl,
        name="get_delivery_trend",
        arguments={"bucket": "day", "date_from": (date.today() - timedelta(days=200)).isoformat()},
    )

    assert "wider bucket" in result["error"]


async def test_a_tl_sees_only_their_own_pods_in_a_trend(db, world):
    await deliver(db, pod=world.other_pod, created_by=world.other_tl, editor=world.other_ve)
    await db.commit()

    result = await run_tool(
        db,
        world.tl,
        name="get_delivery_trend",
        arguments={"bucket": "week", "date_from": (date.today() - timedelta(days=14)).isoformat()},
    )

    assert result["total_delivered"] == 0


async def test_pod_team_lists_members_and_certification(db, world):
    result = await run_tool(
        db, world.tl, name="get_pod_team", arguments={"pod_id": str(world.pod.id)}
    )

    names = {member["name"] for member in result["members"]}
    assert names == {"Pod TL", "Editor One", "Editor Two", "Reviewer One"}
    assert all(member["certified_on_this_pod"] is False for member in result["members"])


async def test_pod_team_refuses_a_pod_you_are_not_in(db, world):
    result = await run_tool(
        db, world.tl, name="get_pod_team", arguments={"pod_id": str(world.other_pod.id)}
    )

    assert "not a member" in result["error"]


async def test_brand_assets_flag_what_a_client_is_missing(db, world):
    result = await run_tool(
        db, world.tl, name="list_brand_assets", arguments={"pod_id": str(world.pod.id)}
    )

    assert result["assets"] == []
    assert set(result["missing_types"]) == {"brief", "sop", "kit", "do_not"}


async def test_voice_notes_are_owner_only(db, world):
    """No pod column on a voice note means no honest way to scope one to a
    TL, so the tool is never offered to them — and refuses if invented."""
    from app.services.ai.tools import schemas_for

    offered = {schema["function"]["name"] for schema in schemas_for(world.tl)}
    assert "search_voice_notes" not in offered
    assert "search_voice_notes" in {
        schema["function"]["name"] for schema in schemas_for(world.owner)
    }

    result = await run_tool(db, world.tl, name="search_voice_notes", arguments={})
    assert "not permitted" in result["error"]
