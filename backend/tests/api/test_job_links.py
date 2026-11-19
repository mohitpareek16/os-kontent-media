"""Raw files in, cuts out — many of each.

`jobs.frame_link` was one column doing two jobs, and the two have different
owners: the client's Drive folder is the TL's to put on the job, the Frame.io
export is the editor's. One column could only hold one of them, so whichever
was written last was what everybody saw — which is how an editor's "paste
your Frame.io link" box came to open pre-filled with the client's raw folder.

The column survives as a pointer to the newest cut, so every row icon and
panel that reads it goes on working. That invariant is most of what is
defended here, along with the split of who may add which kind.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.job_event import JobEvent
from app.models.job_link import JobLink
from tests.factories import auth, make_job, reload

pytestmark = pytest.mark.integration

RAW = "https://drive.google.com/drive/folders/raw-footage"
CUT = "https://f.io/first-cut"


async def add_link(client, job, user, *, kind, url, title=None):
    return await client.post(
        f"/api/jobs/{job.id}/links",
        json={"kind": kind, "url": url, "title": title},
        headers=auth(user),
    )


@pytest.fixture
async def job(db, world):
    """Mid-cut and on Editor One's plate — where both kinds of link exist."""
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="editing", editor=world.ve
    )
    await db.commit()
    return job


async def test_the_tl_adds_the_clients_raw_files(client, world, job):
    response = await add_link(client, job, world.tl, kind="raw", url=RAW, title="A-roll")

    assert response.status_code == 201
    assert response.json()["kind"] == "raw"
    assert response.json()["title"] == "A-roll"


async def test_a_shoot_arrives_as_several_folders(client, world, job):
    """The whole point. One column could hold one link, so the second one was
    pasted into a comment and lost."""
    await add_link(client, job, world.tl, kind="raw", url=f"{RAW}/a", title="A-roll")
    await add_link(client, job, world.tl, kind="raw", url=f"{RAW}/b", title="B-roll")
    await add_link(client, job, world.tl, kind="raw", url=f"{RAW}/gfx", title="Graphics")

    listed = await client.get(f"/api/jobs/{job.id}/links", headers=auth(world.ve))

    assert [row["title"] for row in listed.json()] == ["A-roll", "B-roll", "Graphics"]


async def test_the_editor_cannot_add_raw_files(client, world, job):
    """The client sends footage to the TL. A raw folder arriving from anywhere
    else is how a job comes to point at the wrong shoot."""
    response = await add_link(client, job, world.ve, kind="raw", url=RAW)

    assert response.status_code == 403
    assert "TL" in response.json()["detail"]


async def test_the_editor_adds_their_cuts(client, world, job):
    response = await add_link(client, job, world.ve, kind="video", url=CUT, title="First cut")

    assert response.status_code == 201
    assert response.json()["kind"] == "video"


async def test_the_tl_cannot_submit_a_cut_for_the_editor(client, world, job):
    """Nobody but the editor knows which export is the one to review."""
    response = await add_link(client, job, world.tl, kind="video", url=CUT)

    assert response.status_code == 403
    assert "editor" in response.json()["detail"]


async def test_someone_from_another_pod_cannot_add_anything(client, world, job):
    assert (await add_link(client, job, world.other_tl, kind="raw", url=RAW)).status_code == 403
    assert (await add_link(client, job, world.other_ve, kind="video", url=CUT)).status_code == 403


async def test_frame_link_follows_the_newest_cut(db, client, world, job):
    """The column is a pointer now, not a store. Every row icon, panel and
    bot field still reads it, so it has to keep meaning "the cut"."""
    await add_link(client, job, world.ve, kind="video", url=CUT)
    assert (await reload(db, job)).frame_link == CUT

    await add_link(client, job, world.ve, kind="video", url=f"{CUT}-v2")

    assert (await reload(db, job)).frame_link == f"{CUT}-v2"


async def test_raw_files_never_become_the_review_link(db, client, world, job):
    """The bug, stated as a test: a TL adding B-roll must not replace what QC
    opens to review."""
    await add_link(client, job, world.ve, kind="video", url=CUT)

    await add_link(client, job, world.tl, kind="raw", url=f"{RAW}/b-roll")

    assert (await reload(db, job)).frame_link == CUT


async def test_removing_the_last_cut_empties_the_pointer(db, client, world, job):
    response = await add_link(client, job, world.ve, kind="video", url=CUT)
    link_id = response.json()["id"]

    deleted = await client.delete(f"/api/jobs/{job.id}/links/{link_id}", headers=auth(world.ve))

    assert deleted.status_code == 204
    assert (await reload(db, job)).frame_link is None


async def test_the_tl_can_remove_a_link_they_did_not_add(client, world, job):
    """A wrong link is usually spotted by whoever pasted it, and always
    fixable by the TL."""
    response = await add_link(client, job, world.ve, kind="video", url=CUT)

    deleted = await client.delete(
        f"/api/jobs/{job.id}/links/{response.json()['id']}", headers=auth(world.tl)
    )

    assert deleted.status_code == 204


async def test_an_editor_cannot_delete_the_clients_raw_files(client, world, job):
    response = await add_link(client, job, world.tl, kind="raw", url=RAW)

    deleted = await client.delete(
        f"/api/jobs/{job.id}/links/{response.json()['id']}", headers=auth(world.ve)
    )

    assert deleted.status_code == 403


async def test_the_same_link_twice_is_one_link(client, world, job):
    """An editor re-submitting the same Frame.io link on round three is not
    three links, and the list is read by people."""
    first = await add_link(client, job, world.ve, kind="video", url=CUT)
    second = await add_link(client, job, world.ve, kind="video", url=CUT)

    assert second.json()["id"] == first.json()["id"]
    listed = await client.get(f"/api/jobs/{job.id}/links", headers=auth(world.tl))
    assert len(listed.json()) == 1


async def test_every_link_is_on_the_record(db, client, world, job):
    """A link nobody can trace is the one that turns out to point at the wrong
    client's footage."""
    await add_link(client, job, world.tl, kind="raw", url=RAW, title="A-roll")

    event = (
        await db.execute(
            select(JobEvent).where(JobEvent.job_id == job.id, JobEvent.event_type == "link_added")
        )
    ).scalars().one()
    assert event.actor_id == world.tl.id
    assert event.payload == {"kind": "raw", "title": "A-roll", "url": RAW}


async def test_the_link_typed_into_send_for_qc_becomes_a_cut(db, client, world, job):
    """The editor's own box still works — it just files what they paste
    instead of overwriting the column."""
    response = await client.post(
        f"/api/jobs/{job.id}/advance",
        json={"stage": "qc1", "frame_link": CUT},
        headers=auth(world.ve),
    )

    assert response.status_code == 200
    links = (
        await db.execute(select(JobLink).where(JobLink.job_id == job.id, JobLink.kind == "video"))
    ).scalars().all()
    assert [(link.url, link.title) for link in links] == [(CUT, "First cut")]


async def test_round_two_does_not_overwrite_what_qc_reviewed(db, client, world):
    """The reason cuts are a list. QC sent the job back; the fixed export is a
    different file, and the one they wrote their change list against has to
    still be there."""
    job = await make_job(
        db, pod=world.pod, created_by=world.tl, stage="editing", editor=world.ve, round=1
    )
    await db.commit()
    await client.post(
        f"/api/jobs/{job.id}/advance",
        json={"stage": "qc1", "frame_link": CUT},
        headers=auth(world.ve),
    )
    # Refreshed first: the route moved the job in its own unit of work, and
    # writing over a stale copy of it here silently loses the stage change.
    await db.refresh(job)
    job.stage = "editing"
    job.round = 2
    await db.commit()

    await client.post(
        f"/api/jobs/{job.id}/advance",
        json={"stage": "qc1", "frame_link": f"{CUT}-v2"},
        headers=auth(world.ve),
    )

    listed = await client.get(f"/api/jobs/{job.id}/links", headers=auth(world.tl))
    assert [row["title"] for row in listed.json()] == ["Round 1 cut", "Round 2 cut"]
    assert (await reload(db, job)).frame_link == f"{CUT}-v2"


async def test_intake_files_the_clients_links_as_raw(db, client, world):
    """A link at creation can only be the client's material — nobody has cut
    anything yet — so it must not land on the column the editor's cut lives
    on. This is the fix for the pre-filled box, at the source."""
    response = await client.post(
        "/api/jobs",
        json={
            "title": "Tax hacks",
            "pod_id": str(world.pod.id),
            "raw_links": [{"url": RAW, "title": "Shoot folder"}],
        },
        headers=auth(world.tl),
    )

    assert response.status_code == 201
    assert response.json()["frame_link"] is None
    links = (
        await db.execute(select(JobLink).where(JobLink.job_id == response.json()["id"]))
    ).scalars().all()
    assert [(link.kind, link.url) for link in links] == [("raw", RAW)]


async def test_a_frame_link_sent_at_intake_is_treated_as_raw(db, client, world):
    """The wizard's old field, and anything else still sending it. At intake
    it means "here is the footage", whatever it is called."""
    response = await client.post(
        "/api/jobs",
        json={"title": "Tax hacks", "pod_id": str(world.pod.id), "frame_link": RAW},
        headers=auth(world.tl),
    )

    assert response.json()["frame_link"] is None
    links = (
        await db.execute(select(JobLink).where(JobLink.job_id == response.json()["id"]))
    ).scalars().all()
    assert [(link.kind, link.url) for link in links] == [("raw", RAW)]


async def test_a_pasted_batch_files_every_rows_links(db, client, world):
    response = await client.post(
        "/api/jobs/batch",
        json={
            "pod_id": str(world.pod.id),
            "jobs": [
                {"title": "One", "raw_links": [{"url": f"{RAW}/1"}]},
                {"title": "Two", "raw_links": [{"url": f"{RAW}/2"}]},
            ],
        },
        headers=auth(world.tl),
    )

    assert response.status_code == 201
    for row in response.json():
        links = (
            await db.execute(select(JobLink).where(JobLink.job_id == row["id"]))
        ).scalars().all()
        assert [link.kind for link in links] == ["raw"]


async def test_anyone_who_can_see_the_job_can_see_its_links(client, world, job):
    await add_link(client, job, world.tl, kind="raw", url=RAW)

    assert (await client.get(f"/api/jobs/{job.id}/links", headers=auth(world.ve))).status_code == 200
    assert (
        await client.get(f"/api/jobs/{job.id}/links", headers=auth(world.other_ve))
    ).status_code == 403


async def test_a_scrapped_project_takes_no_more_links(db, client, world, job):
    from datetime import datetime, timezone

    job.scrapped_at = datetime.now(timezone.utc)
    job.scrapped_by_id = world.tl.id
    job.scrap_reason = "Client cancelled the whole series"
    await db.commit()

    response = await add_link(client, job, world.tl, kind="raw", url=RAW)

    assert response.status_code == 400


async def test_the_old_way_of_setting_a_link_says_where_it_went(client, world, job):
    """`PATCH /jobs/{id}` could write `frame_link` directly. It is a pointer to
    the newest cut now, so a value set that way would hold until the next link
    was added and then silently revert — refusing and naming the right route is
    the honest answer."""
    response = await client.patch(
        f"/api/jobs/{job.id}", json={"frame_link": CUT}, headers=auth(world.tl)
    )

    assert response.status_code == 400
    assert "/links" in response.json()["detail"]
