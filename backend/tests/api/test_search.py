"""/search — the header's global search box.

One endpoint answering "everything to do with this string" — jobs, clients,
their channels and the people on them — and
the thing worth pinning hardest about it: it must return a strict subset of
what the caller could already reach. A search box is the easiest place in a
product to accidentally publish the whole company — every scoping test below
exists for that reason, and they are the same rules `GET /jobs`, `GET /pods`
and `GET /pods/{id}/members` enforce, asserted again here because search
composes them itself rather than going through those routes.
"""
from __future__ import annotations

import pytest

from tests.factories import add_member, auth, make_job, make_pod, make_user

pytestmark = pytest.mark.integration


def ids(payload, key, field="id"):
    return {hit[field] for hit in payload[key]}


# --------------------------------------------------------------------------
# What it finds
# --------------------------------------------------------------------------


async def test_finds_a_job_by_title(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.owner, title="Diwali Reel Cut")
    await db.commit()

    response = await client.get("/api/search?q=diwali", headers=auth(world.owner))

    assert response.status_code == 200
    body = response.json()
    assert ids(body, "jobs") == {str(job.id)}
    hit = body["jobs"][0]
    assert hit["code"] == job.code
    assert hit["pod_name"] == world.pod.name
    assert hit["stage"] == "intake"
    assert hit["scrapped_at"] is None


async def test_finds_a_job_by_code(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.owner, code="KM-9001")
    await make_job(db, pod=world.pod, created_by=world.owner, code="KM-9002")
    await db.commit()

    response = await client.get("/api/search?q=KM-9001", headers=auth(world.owner))

    assert ids(response.json(), "jobs") == {str(job.id)}


async def test_an_exact_code_match_sorts_first(client, db, world):
    """Typing a full code means "take me there" — it must not queue behind
    whatever was created most recently."""
    exact = await make_job(db, pod=world.pod, created_by=world.owner, code="KM-1042")
    # Created later, so `created_at DESC` alone would put it on top.
    await make_job(db, pod=world.pod, created_by=world.owner, code="KM-1042-B")
    await db.commit()

    response = await client.get("/api/search?q=KM-1042", headers=auth(world.owner))

    jobs = response.json()["jobs"]
    assert len(jobs) == 2
    assert jobs[0]["id"] == str(exact.id)


async def test_finds_a_pod_by_name(client, db, world):
    response = await client.get("/api/search?q=acme", headers=auth(world.owner))

    body = response.json()
    assert ids(body, "pods") == {str(world.pod.id)}
    assert body["pods"][0]["status"] == "active"


async def test_finds_a_person_by_name_and_by_email(client, db, world):
    by_name = await client.get("/api/search?q=Editor One", headers=auth(world.owner))
    assert ids(by_name.json(), "people") == {str(world.ve.id)}

    by_email = await client.get(
        f"/api/search?q={world.ve.email}", headers=auth(world.owner)
    )
    assert ids(by_email.json(), "people") == {str(world.ve.id)}


async def test_one_query_returns_all_three_kinds(client, db, world):
    """The point of the endpoint: one round-trip, not three."""
    pod = await make_pod(db, tl=world.tl, name="Nova", onboarded_by=world.owner)
    await add_member(db, pod, world.tl, "tl")
    job = await make_job(db, pod=pod, created_by=world.owner, title="Nova launch film")
    person = await make_user(db, role="ve", name="Nova Sharma")
    await add_member(db, pod, person, "ve")
    await db.commit()

    body = (await client.get("/api/search?q=nova", headers=auth(world.owner))).json()

    assert ids(body, "jobs") == {str(job.id)}
    assert ids(body, "pods") == {str(pod.id)}
    assert ids(body, "people") == {str(person.id)}


async def test_a_scrapped_job_is_still_findable_and_labelled(client, db, world):
    """Every queue and count in the product hides scrapped work. Search must
    not: "what happened to that project we killed" is only askable by name."""
    job = await make_job(
        db,
        pod=world.pod,
        created_by=world.owner,
        title="Cancelled Campaign",
        scrapped_by=world.owner,
        scrap_reason="client paused",
    )
    await db.commit()

    body = (await client.get("/api/search?q=cancelled", headers=auth(world.owner))).json()

    assert ids(body, "jobs") == {str(job.id)}
    assert body["jobs"][0]["scrapped_at"] is not None


async def test_no_match_is_an_empty_result_not_an_error(client, db, world):
    response = await client.get("/api/search?q=zzzznothing", headers=auth(world.owner))

    assert response.status_code == 200
    assert response.json() == {
        "query": "zzzznothing",
        "jobs": [],
        "pods": [],
        "channels": [],
        "people": [],
    }


# --------------------------------------------------------------------------
# Scoping — a search must never widen what a role can reach
# --------------------------------------------------------------------------


async def test_a_ve_finds_only_their_own_jobs(client, db, world):
    mine = await make_job(
        db, pod=world.pod, created_by=world.owner, title="Brand Film", editor=world.ve
    )
    await make_job(
        db, pod=world.pod, created_by=world.owner, title="Brand Film", editor=world.ve2
    )
    await db.commit()

    body = (await client.get("/api/search?q=brand film", headers=auth(world.ve))).json()

    assert ids(body, "jobs") == {str(mine.id)}


async def test_a_tl_does_not_find_another_pods_job_or_pod(client, db, world):
    await make_job(db, pod=world.other_pod, created_by=world.owner, title="Globex Teaser")
    await db.commit()

    body = (await client.get("/api/search?q=globex", headers=auth(world.tl))).json()

    assert body["jobs"] == []
    assert body["pods"] == []


async def test_a_tl_does_not_find_a_person_from_a_pod_they_are_not_in(client, db, world):
    """People are visible through a shared pod, the same rule
    `GET /pods/{id}/members` applies. `GET /users` is admin-only and search
    must not become a way around it."""
    body = (await client.get("/api/search?q=Other Editor", headers=auth(world.tl))).json()
    assert body["people"] == []

    own = (await client.get("/api/search?q=Editor One", headers=auth(world.tl))).json()
    assert ids(own, "people") == {str(world.ve.id)}


async def test_a_qc_finds_only_jobs_in_their_queue(client, db, world):
    """The QC scope is in-queue only: routed to them, plus unrouted QC2 work
    in their own pods (docs/05). An editing job is neither."""
    routed = await make_job(
        db,
        pod=world.pod,
        created_by=world.owner,
        title="Recipe Series",
        stage="qc2",
        reviewer=world.qc,
    )
    await make_job(
        db, pod=world.pod, created_by=world.owner, title="Recipe Series", stage="editing"
    )
    await db.commit()

    body = (await client.get("/api/search?q=recipe", headers=auth(world.qc))).json()

    assert ids(body, "jobs") == {str(routed.id)}


async def test_a_deactivated_teammate_is_found_and_marked(client, db, world):
    """You search for a leaver precisely when reading old work — hiding them
    turns their name into "no such person"."""
    leaver = await make_user(db, role="ve", name="Departed Editor", is_active=False)
    await add_member(db, world.pod, leaver, "ve")
    await db.commit()

    body = (await client.get("/api/search?q=Departed", headers=auth(world.tl))).json()

    assert ids(body, "people") == {str(leaver.id)}
    assert body["people"][0]["is_active"] is False


async def test_search_requires_a_session(client, db, world):
    assert (await client.get("/api/search?q=acme")).status_code == 401


# --------------------------------------------------------------------------
# The query string itself
# --------------------------------------------------------------------------


async def test_a_wildcard_in_the_query_is_matched_literally(client, db, world):
    """`%` and `_` are LIKE wildcards. Unescaped, `%` returns the caller's
    entire visible world — a search box that answers everything to a
    stray keystroke."""
    await make_job(db, pod=world.pod, created_by=world.owner, title="Nothing special")
    literal = await make_job(db, pod=world.pod, created_by=world.owner, title="100% Organic")
    await db.commit()

    body = (await client.get("/api/search?q=%25", headers=auth(world.owner))).json()

    assert ids(body, "jobs") == {str(literal.id)}
    assert body["pods"] == []


async def test_an_underscore_is_matched_literally(client, db, world):
    await make_pod(db, tl=world.tl, name="Ab", onboarded_by=world.owner)
    underscored = await make_pod(db, tl=world.tl, name="A_B", onboarded_by=world.owner)
    await db.commit()

    body = (await client.get("/api/search?q=A_B", headers=auth(world.owner))).json()

    assert ids(body, "pods") == {str(underscored.id)}


async def test_a_whitespace_only_query_returns_nothing_rather_than_422(client, db, world):
    """What the box holds for one keystroke while someone clears it."""
    response = await client.get("/api/search?q=%20", headers=auth(world.owner))

    assert response.status_code == 200
    body = response.json()
    assert (body["jobs"], body["pods"], body["channels"], body["people"]) == ([], [], [], [])


async def test_an_empty_query_is_rejected(client, db, world):
    assert (await client.get("/api/search?q=", headers=auth(world.owner))).status_code == 422


async def test_the_limit_caps_each_kind(client, db, world):
    for _ in range(5):
        await make_job(db, pod=world.pod, created_by=world.owner, title="Weekly Podcast")
    await db.commit()

    body = (await client.get("/api/search?q=podcast&limit=2", headers=auth(world.owner))).json()

    assert len(body["jobs"]) == 2


# --------------------------------------------------------------------------
# "Everything to do with this thing"
#
# Typing a client's name used to find the pod row and nothing else — none of
# that client's videos, unless the word happened to be in the title too. That
# is not how anybody searches, and it is the half of the box that made it feel
# broken: you type "dhan", you mean *Dhan*, and you get one row back.
# --------------------------------------------------------------------------


async def test_a_client_name_finds_that_clients_work(client, db, world):
    job = await make_job(db, pod=world.pod, created_by=world.owner, title="Quarterly results")
    await db.commit()

    body = (await client.get("/api/search?q=acme", headers=auth(world.owner))).json()

    assert str(job.id) in ids(body, "jobs")
    hit = next(h for h in body["jobs"] if h["id"] == str(job.id))
    # The row has to explain itself: nothing in "Quarterly results" says Acme,
    # and a hit whose text does not contain what you typed reads as a bug.
    assert hit["matched_on"] == "pod"


async def test_an_editors_name_finds_the_work_on_their_plate(client, db, world):
    theirs = await make_job(
        db, pod=world.pod, created_by=world.owner, stage="editing", editor=world.ve
    )
    await make_job(db, pod=world.pod, created_by=world.owner, stage="editing", editor=world.ve2)
    await db.commit()

    body = (await client.get("/api/search?q=Editor One", headers=auth(world.owner))).json()

    assert ids(body, "jobs") == {str(theirs.id)}
    assert body["jobs"][0]["matched_on"] == "editor"
    assert body["jobs"][0]["editor_name"] == world.ve.name


async def test_a_jobs_own_text_outranks_a_match_through_a_relation(client, db, world):
    """Both are true of an Acme job called "Acme launch". The one whose own
    title says it is the one people expect at the top."""
    by_title = await make_job(db, pod=world.pod, created_by=world.owner, title="Acme launch")
    await make_job(db, pod=world.pod, created_by=world.owner, title="Nothing relevant")
    await db.commit()

    body = (await client.get("/api/search?q=acme", headers=auth(world.owner))).json()

    assert body["jobs"][0]["id"] == str(by_title.id)
    assert body["jobs"][0]["matched_on"] == "job"


async def test_channels_are_their_own_kind_of_result(client, db, world):
    """A channel is where the work actually goes, and the pipeline table can
    filter by one — so it is usually the row somebody wanted."""
    from app.models.channel import Channel

    channel = Channel(pod_id=world.pod.id, name="Acme HQ", created_by=world.tl.id)
    db.add(channel)
    await db.flush()
    await make_job(db, pod=world.pod, created_by=world.owner, title="Filed one")
    await db.commit()

    # Found by its own name...
    by_name = (await client.get("/api/search?q=Acme HQ", headers=auth(world.owner))).json()
    assert ids(by_name, "channels") == {str(channel.id)}
    assert by_name["channels"][0]["pod_name"] == world.pod.name

    # ...and by its client's, which is what makes "acme" answer with Acme's
    # channels rather than only ones with "acme" in their own name.
    by_client = (await client.get("/api/search?q=acme", headers=auth(world.owner))).json()
    assert str(channel.id) in ids(by_client, "channels")


async def test_a_channel_result_is_scoped_like_every_other_read(client, db, world):
    """The new joins must only *find* rows the caller could already list.
    A search box is the easiest place in a product to publish the whole
    company by accident."""
    from app.models.channel import Channel

    other = Channel(pod_id=world.other_pod.id, name="Globex Shorts", created_by=world.other_tl.id)
    db.add(other)
    await db.commit()

    body = (await client.get("/api/search?q=globex", headers=auth(world.tl))).json()
    assert body["channels"] == []
    assert body["pods"] == []


async def test_a_person_hit_says_which_clients_and_how_much_is_on_them(client, db, world):
    await make_job(db, pod=world.pod, created_by=world.owner, stage="editing", editor=world.ve)
    await make_job(db, pod=world.pod, created_by=world.owner, stage="delivered", editor=world.ve)
    await db.commit()

    body = (await client.get("/api/search?q=Editor One", headers=auth(world.owner))).json()

    hit = next(h for h in body["people"] if h["id"] == str(world.ve.id))
    assert hit["pods"] == [world.pod.name]
    # Live work only — "Editor One has 47 jobs" counts three years of history
    # and answers nothing.
    assert hit["open_jobs"] == 1


async def test_a_pod_hit_carries_its_lead_and_its_load(client, db, world):
    await make_job(db, pod=world.pod, created_by=world.owner, stage="editing", editor=world.ve)
    await db.commit()

    body = (await client.get("/api/search?q=acme", headers=auth(world.owner))).json()

    hit = next(h for h in body["pods"] if h["id"] == str(world.pod.id))
    assert hit["tl_name"] == world.tl.name
    assert hit["open_jobs"] == 1


async def test_the_extra_joins_do_not_widen_what_a_ve_can_see(client, db, world):
    """A VE sees their own jobs. Matching on a pod name must not hand them
    their colleagues' work in the same pod."""
    mine = await make_job(
        db, pod=world.pod, created_by=world.owner, stage="editing", editor=world.ve
    )
    await make_job(db, pod=world.pod, created_by=world.owner, stage="editing", editor=world.ve2)
    await db.commit()

    body = (await client.get("/api/search?q=acme", headers=auth(world.ve))).json()
    assert ids(body, "jobs") == {str(mine.id)}


async def test_a_person_hits_pod_list_is_scoped_to_the_searcher(client, db, world):
    """The clients named on a person's row are the ones *you* can see, not all
    of theirs. Otherwise the row leaks the client list of a pod you have no
    access to — through a field added to make the dropdown friendlier, which
    is exactly how a search box publishes the company by accident."""
    await add_member(db, world.other_pod, world.ve, "ve")
    await db.commit()

    as_owner = (await client.get("/api/search?q=Editor One", headers=auth(world.owner))).json()
    assert sorted(as_owner["people"][0]["pods"]) == [world.pod.name, world.other_pod.name]

    as_tl = (await client.get("/api/search?q=Editor One", headers=auth(world.tl))).json()
    assert as_tl["people"][0]["pods"] == [world.pod.name]
