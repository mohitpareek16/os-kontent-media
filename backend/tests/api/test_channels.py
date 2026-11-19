"""Channels — the client's own destinations inside one pod.

Dhan publishes to Dhan HQ, to AAD and to lwdhan. Those are not three clients:
same TL, same editors, same QC, same retainer. Before this, the only way to
tell them apart on a board of forty jobs was to recognise the titles.

What is defended here is mostly the boundary. A channel belongs to exactly one
client, and a job may only be filed under one of its own client's — the
foreign key alone would happily accept another client's channel and then
render it, by name, on every screen.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.channel import Channel
from app.models.job_event import JobEvent
from tests.factories import auth, make_job, reload

pytestmark = pytest.mark.integration


async def create_channel(client, pod, user, name="Dhan HQ"):
    return await client.post(
        f"/api/pods/{pod.id}/channels", json={"name": name}, headers=auth(user)
    )


@pytest.fixture
async def channel(db, client, world):
    response = await create_channel(client, world.pod, world.tl)
    return await db.get(Channel, response.json()["id"])


async def test_a_tl_adds_channels_to_their_own_client(client, world):
    response = await create_channel(client, world.pod, world.tl)

    assert response.status_code == 201
    assert response.json()["name"] == "Dhan HQ"
    assert response.json()["job_count"] == 0


async def test_an_editor_cannot_add_channels(client, world):
    response = await create_channel(client, world.pod, world.ve)

    assert response.status_code == 403


async def test_another_tl_cannot_add_channels_to_this_client(client, world):
    response = await create_channel(client, world.pod, world.other_tl)

    assert response.status_code == 403


async def test_the_same_channel_twice_is_a_typo_not_a_second_channel(client, world):
    await create_channel(client, world.pod, world.tl)

    response = await create_channel(client, world.pod, world.tl, name="dhan hq")

    assert response.status_code == 400
    assert "already has a channel" in response.json()["detail"]


async def test_two_clients_may_each_have_a_shorts(client, world):
    first = await create_channel(client, world.pod, world.tl, name="Shorts")
    second = await create_channel(client, world.other_pod, world.other_tl, name="Shorts")

    assert first.status_code == 201
    assert second.status_code == 201


async def test_an_editor_in_the_pod_can_read_the_list(client, world, channel):
    """They see the channel on their own job and filter their board by it —
    a list they cannot read leaves that filter permanently empty."""
    response = await client.get(f"/api/pods/{world.pod.id}/channels", headers=auth(world.ve))

    assert response.status_code == 200
    assert [row["name"] for row in response.json()] == ["Dhan HQ"]


async def test_someone_outside_the_pod_cannot_read_the_list(client, world, channel):
    response = await client.get(f"/api/pods/{world.pod.id}/channels", headers=auth(world.other_ve))

    assert response.status_code == 403


async def test_a_job_can_be_filed_under_its_own_clients_channel(db, client, world, channel):
    response = await client.post(
        "/api/jobs",
        json={
            "title": "Tax hacks for mutual fund investors",
            "pod_id": str(world.pod.id),
            "channel_id": str(channel.id),
        },
        headers=auth(world.tl),
    )

    assert response.status_code == 201
    assert response.json()["channel_id"] == str(channel.id)


async def test_a_job_cannot_be_filed_under_another_clients_channel(db, client, world, channel):
    """The foreign key says "this channel exists". This says "it is yours"."""
    response = await client.post(
        "/api/jobs",
        json={
            "title": "Someone else's video",
            "pod_id": str(world.other_pod.id),
            "channel_id": str(channel.id),
        },
        headers=auth(world.other_tl),
    )

    assert response.status_code == 400
    assert "different client" in response.json()["detail"]


async def test_the_channel_name_rides_along_on_the_job(db, client, world, channel):
    """Resolved server-side like every other name on a job row: `GET /users`
    and the channel list are both scoped, so a browser cannot look it up."""
    job = await make_job(db, pod=world.pod, created_by=world.tl)
    job.channel_id = channel.id
    await db.commit()

    response = await client.get(f"/api/jobs/{job.id}", headers=auth(world.tl))

    assert response.json()["channel_name"] == "Dhan HQ"


async def test_a_tl_files_an_older_job_after_the_fact(db, client, world, channel):
    """Every job that predates the channels table has none, and this is how
    they get one — the reason `channel_id` is nullable rather than backfilled
    from a guess."""
    job = await make_job(db, pod=world.pod, created_by=world.tl)
    await db.commit()
    assert job.channel_id is None

    response = await client.patch(
        f"/api/jobs/{job.id}", json={"channel_id": str(channel.id)}, headers=auth(world.tl)
    )

    assert response.status_code == 200
    assert (await reload(db, job)).channel_id == channel.id


async def test_the_change_is_logged_by_name_not_by_id(db, client, world, channel):
    job = await make_job(db, pod=world.pod, created_by=world.tl)
    await db.commit()

    await client.patch(
        f"/api/jobs/{job.id}", json={"channel_id": str(channel.id)}, headers=auth(world.tl)
    )

    event = (
        await db.execute(
            select(JobEvent).where(JobEvent.job_id == job.id, JobEvent.event_type == "job_updated")
        )
    ).scalars().one()
    assert event.payload["channel"] == {"from": None, "to": "Dhan HQ"}


async def test_a_job_can_be_unfiled_again(db, client, world, channel):
    job = await make_job(db, pod=world.pod, created_by=world.tl)
    job.channel_id = channel.id
    await db.commit()

    response = await client.patch(
        f"/api/jobs/{job.id}", json={"clear_channel": True}, headers=auth(world.tl)
    )

    assert response.status_code == 200
    assert (await reload(db, job)).channel_id is None


async def test_the_board_can_be_filtered_to_one_channel(db, client, world, channel):
    filed = await make_job(db, pod=world.pod, created_by=world.tl, title="On the channel")
    filed.channel_id = channel.id
    await make_job(db, pod=world.pod, created_by=world.tl, title="Not on it")
    await db.commit()

    response = await client.get(
        f"/api/jobs?pod_id={world.pod.id}&channel_id={channel.id}&status=all",
        headers=auth(world.tl),
    )

    assert [row["title"] for row in response.json()["items"]] == ["On the channel"]
    assert response.json()["total"] == 1


async def test_what_still_has_to_be_filed_is_askable(db, client, world, channel):
    filed = await make_job(db, pod=world.pod, created_by=world.tl, title="On the channel")
    filed.channel_id = channel.id
    await make_job(db, pod=world.pod, created_by=world.tl, title="Not on it")
    await db.commit()

    response = await client.get(
        f"/api/jobs?pod_id={world.pod.id}&no_channel=true&status=all", headers=auth(world.tl)
    )

    assert [row["title"] for row in response.json()["items"]] == ["Not on it"]


async def test_the_status_cards_count_the_same_channel_as_the_rows(db, client, world, channel):
    filed = await make_job(db, pod=world.pod, created_by=world.tl)
    filed.channel_id = channel.id
    await make_job(db, pod=world.pod, created_by=world.tl)
    await db.commit()

    response = await client.get(
        f"/api/jobs/stats?pod_id={world.pod.id}&channel_id={channel.id}", headers=auth(world.tl)
    )

    assert response.json()["all"] == 1


async def test_a_retired_channel_keeps_the_work_already_under_it(db, client, world, channel):
    """Archiving is a statement about new work, not a rewrite of old work."""
    job = await make_job(db, pod=world.pod, created_by=world.tl)
    job.channel_id = channel.id
    await db.commit()

    archived = await client.patch(
        f"/api/pods/{world.pod.id}/channels/{channel.id}",
        json={"archived": True},
        headers=auth(world.tl),
    )

    assert archived.status_code == 200
    assert (await reload(db, job)).channel_id == channel.id
    listed = await client.get(f"/api/pods/{world.pod.id}/channels", headers=auth(world.tl))
    assert listed.json() == []


async def test_new_work_cannot_be_filed_under_a_retired_channel(db, client, world, channel):
    await client.patch(
        f"/api/pods/{world.pod.id}/channels/{channel.id}",
        json={"archived": True},
        headers=auth(world.tl),
    )

    response = await client.post(
        "/api/jobs",
        json={
            "title": "New work",
            "pod_id": str(world.pod.id),
            "channel_id": str(channel.id),
        },
        headers=auth(world.tl),
    )

    assert response.status_code == 400
    assert "archived" in response.json()["detail"]


async def test_re_adding_a_retired_name_revives_the_same_row(db, client, world, channel):
    """A second row would split the history of the work already filed under
    the first."""
    await client.patch(
        f"/api/pods/{world.pod.id}/channels/{channel.id}",
        json={"archived": True},
        headers=auth(world.tl),
    )

    response = await create_channel(client, world.pod, world.tl, name="Dhan HQ")

    assert response.status_code == 201
    assert response.json()["id"] == str(channel.id)
    assert response.json()["archived_at"] is None


async def test_the_list_says_how_much_work_is_under_each(db, client, world, channel):
    for _ in range(2):
        job = await make_job(db, pod=world.pod, created_by=world.tl)
        job.channel_id = channel.id
    await db.commit()

    response = await client.get(f"/api/pods/{world.pod.id}/channels", headers=auth(world.tl))

    assert response.json()[0]["job_count"] == 2


async def test_a_batch_paste_files_every_row(db, client, world, channel):
    response = await client.post(
        "/api/jobs/batch",
        json={
            "pod_id": str(world.pod.id),
            "jobs": [
                {"title": "One", "channel_id": str(channel.id)},
                {"title": "Two", "channel_id": str(channel.id)},
            ],
        },
        headers=auth(world.tl),
    )

    assert response.status_code == 201
    assert [row["channel_id"] for row in response.json()] == [str(channel.id)] * 2


async def test_every_channel_across_the_clients_a_lead_can_see(db, client, world, channel):
    """The pipeline table's resting state is *All Clients*, and the per-pod list
    has nothing to answer there — which is how the channel filter came to be
    missing from the one screen a lead spends the day on."""
    await create_channel(client, world.other_pod, world.other_tl, name="Globex Shorts")

    response = await client.get("/api/pods/channels", headers=auth(world.owner))

    assert response.status_code == 200
    assert [(row["pod_name"], row["name"]) for row in response.json()] == [
        ("Acme", "Dhan HQ"),
        ("Globex", "Globex Shorts"),
    ]


async def test_the_cross_client_list_stops_at_the_pods_you_are_in(db, client, world, channel):
    """Same scope as `GET /pods`: a channel list is a list of the clients you
    can see, and nothing about a filter makes that looser."""
    await create_channel(client, world.other_pod, world.other_tl, name="Globex Shorts")

    response = await client.get("/api/pods/channels", headers=auth(world.tl))

    assert [row["name"] for row in response.json()] == ["Dhan HQ"]


async def test_an_editor_reads_the_cross_client_list_too(db, client, world, channel):
    """Their own board filter runs on it."""
    response = await client.get("/api/pods/channels", headers=auth(world.ve))

    assert [row["name"] for row in response.json()] == ["Dhan HQ"]


async def test_the_table_can_be_sorted_by_channel(db, client, world, channel):
    """Sorted on the name, like `pod` — a column that reads "Dhan HQ" has to
    sort as "Dhan HQ" and not by a uuid nobody can see."""
    zed = await db.get(Channel, (await create_channel(client, world.pod, world.tl, name="Zed")).json()["id"])
    first = await make_job(db, pod=world.pod, created_by=world.tl, title="Under Dhan HQ")
    first.channel_id = channel.id
    last = await make_job(db, pod=world.pod, created_by=world.tl, title="Under Zed")
    last.channel_id = zed.id
    await db.commit()

    response = await client.get(
        f"/api/jobs?pod_id={world.pod.id}&status=all&sort_by=channel&sort_dir=asc",
        headers=auth(world.tl),
    )

    assert [row["channel_name"] for row in response.json()["items"]] == ["Dhan HQ", "Zed"]


async def test_a_whole_backlog_is_filed_in_one_move(db, client, world, channel):
    """The reason the route exists: every job older than the channels table has
    none, and a client with three hundred of them is never going to be filed a
    dropdown at a time."""
    jobs = [await make_job(db, pod=world.pod, created_by=world.tl) for _ in range(3)]
    await db.commit()

    response = await client.post(
        "/api/jobs/bulk-channel",
        json={"job_ids": [str(job.id) for job in jobs], "channel_id": str(channel.id)},
        headers=auth(world.tl),
    )

    assert response.status_code == 200
    assert response.json() == {"updated": 3, "unchanged": 0}
    for job in jobs:
        assert (await reload(db, job)).channel_id == channel.id


async def test_filing_in_bulk_is_logged_per_job_by_name(db, client, world, channel):
    job = await make_job(db, pod=world.pod, created_by=world.tl)
    await db.commit()

    await client.post(
        "/api/jobs/bulk-channel",
        json={"job_ids": [str(job.id)], "channel_id": str(channel.id)},
        headers=auth(world.tl),
    )

    event = (
        await db.execute(
            select(JobEvent).where(JobEvent.job_id == job.id, JobEvent.event_type == "job_updated")
        )
    ).scalars().one()
    assert event.payload["channel"] == {"from": None, "to": "Dhan HQ"}


async def test_a_row_already_under_that_channel_gets_no_event(db, client, world, channel):
    """"Updated" is not "selected": an event saying nothing changed is noise in
    the one log that explains how the job got here."""
    job = await make_job(db, pod=world.pod, created_by=world.tl)
    job.channel_id = channel.id
    await db.commit()

    response = await client.post(
        "/api/jobs/bulk-channel",
        json={"job_ids": [str(job.id)], "channel_id": str(channel.id)},
        headers=auth(world.tl),
    )

    assert response.json() == {"updated": 0, "unchanged": 1}
    assert (
        await db.execute(
            select(JobEvent).where(JobEvent.job_id == job.id, JobEvent.event_type == "job_updated")
        )
    ).scalars().all() == []


async def test_a_selection_can_be_unfiled_in_bulk(db, client, world, channel):
    jobs = [await make_job(db, pod=world.pod, created_by=world.tl) for _ in range(2)]
    for job in jobs:
        job.channel_id = channel.id
    await db.commit()

    response = await client.post(
        "/api/jobs/bulk-channel",
        json={"job_ids": [str(job.id) for job in jobs], "channel_id": None},
        headers=auth(world.tl),
    )

    assert response.json()["updated"] == 2
    for job in jobs:
        assert (await reload(db, job)).channel_id is None


async def test_bulk_filing_cannot_reach_into_another_clients_pod(db, client, world, channel):
    """All or nothing, like the batch create: the guard runs over the whole
    selection before a row is written."""
    mine = await make_job(db, pod=world.pod, created_by=world.tl)
    theirs = await make_job(db, pod=world.other_pod, created_by=world.other_tl)
    await db.commit()

    response = await client.post(
        "/api/jobs/bulk-channel",
        json={"job_ids": [str(mine.id), str(theirs.id)], "channel_id": None},
        headers=auth(world.tl),
    )

    assert response.status_code == 403
    assert (await reload(db, mine)).channel_id is None


async def test_an_editor_cannot_file_in_bulk(db, client, world, channel):
    job = await make_job(db, pod=world.pod, created_by=world.tl, editor=world.ve)
    await db.commit()

    response = await client.post(
        "/api/jobs/bulk-channel",
        json={"job_ids": [str(job.id)], "channel_id": str(channel.id)},
        headers=auth(world.ve),
    )

    assert response.status_code == 403
    assert (await reload(db, job)).channel_id is None


async def test_two_clients_at_once_can_only_be_unfiled(db, client, world, channel):
    """A channel belongs to one client, so filing a mixed selection would mean
    guessing which client's channel was meant."""
    mine = await make_job(db, pod=world.pod, created_by=world.tl)
    theirs = await make_job(db, pod=world.other_pod, created_by=world.other_tl)
    await db.commit()

    response = await client.post(
        "/api/jobs/bulk-channel",
        json={"job_ids": [str(mine.id), str(theirs.id)], "channel_id": str(channel.id)},
        headers=auth(world.owner),
    )

    assert response.status_code == 400
    assert "one client" in response.json()["detail"]
    assert (await reload(db, mine)).channel_id is None


async def test_a_scrapped_job_in_the_selection_is_named_not_counted(db, client, world, channel):
    live = await make_job(db, pod=world.pod, created_by=world.tl)
    dead = await make_job(db, pod=world.pod, created_by=world.tl, scrapped_by=world.tl)
    await db.commit()

    response = await client.post(
        "/api/jobs/bulk-channel",
        json={"job_ids": [str(live.id), str(dead.id)], "channel_id": str(channel.id)},
        headers=auth(world.tl),
    )

    assert response.status_code == 400
    assert dead.code in response.json()["detail"]
    assert (await reload(db, live)).channel_id is None


async def test_bulk_filing_refuses_another_clients_channel(db, client, world, channel):
    job = await make_job(db, pod=world.other_pod, created_by=world.other_tl)
    await db.commit()

    response = await client.post(
        "/api/jobs/bulk-channel",
        json={"job_ids": [str(job.id)], "channel_id": str(channel.id)},
        headers=auth(world.other_tl),
    )

    assert response.status_code == 400
    assert "different client" in response.json()["detail"]


async def test_a_job_that_has_vanished_stops_the_whole_selection(db, client, world, channel):
    job = await make_job(db, pod=world.pod, created_by=world.tl)
    await db.commit()

    response = await client.post(
        "/api/jobs/bulk-channel",
        json={
            "job_ids": [str(job.id), "00000000-0000-0000-0000-000000000000"],
            "channel_id": str(channel.id),
        },
        headers=auth(world.tl),
    )

    assert response.status_code == 404
    assert (await reload(db, job)).channel_id is None


async def test_one_bad_channel_lands_none_of_the_batch(db, client, world, channel):
    """Same all-or-nothing rule the editor cap already has: half a paste
    landing is worse than none of it."""
    response = await client.post(
        "/api/jobs/batch",
        json={
            "pod_id": str(world.other_pod.id),
            "jobs": [
                {"title": "One"},
                {"title": "Two", "channel_id": str(channel.id)},
            ],
        },
        headers=auth(world.other_tl),
    )

    assert response.status_code == 400
    listed = await client.get(
        f"/api/jobs?pod_id={world.other_pod.id}&status=all", headers=auth(world.other_tl)
    )
    assert listed.json()["total"] == 0
