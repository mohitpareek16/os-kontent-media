"""services/access.py::mine_clauses — "what is waiting on me right now".

The rule this replaces was `assigned_editor_id == me OR qc2_reviewer_id == me`,
and a TL is neither of those, so **every TL's Mine tab counted zero forever**
however much work was sitting at QC1 with them. The regression that matters
most here is therefore the TL one; the rest guard the other half of the fix,
which is that "mine" means the ball is in your court, not that your name is
written on the job somewhere.
"""
from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select

from app.models.job import Job
from app.services.access import mine_clauses
from tests.factories import add_member, make_job, make_pod, make_user

pytestmark = pytest.mark.unit

# Every job in the scene is properly handed over unless the test is about the
# hand-off itself: an editor and a date (`stage_machine.is_briefed`).
DEADLINE = date(2030, 1, 1)


async def _mine_ids(db, user):
    rows = await db.execute(select(Job.id).where(*mine_clauses(user)))
    return set(rows.scalars().all())


@pytest.fixture
async def scene(db):
    """One pod, one job parked at every stage, plus the two jobs that must
    never be anyone's: a delivered one and a scrapped one."""
    owner = await make_user(db, role="owner")
    hr = await make_user(db, role="hr")
    tl = await make_user(db, role="tl")
    ve = await make_user(db, role="ve")
    qc = await make_user(db, role="qc")

    pod = await make_pod(db, tl=tl, onboarded_by=owner)
    for user, pod_role in ((tl, "tl"), (ve, "ve"), (qc, "qc")):
        await add_member(db, pod, user, pod_role)

    stages = ("intake", "assigned", "editing", "qc1", "qc2", "revisions", "final")
    jobs = {
        stage: await make_job(
            db, pod=pod, created_by=tl, stage=stage, editor=ve, reviewer=qc, deadline=DEADLINE
        )
        for stage in stages
    }
    # The half-handed-over job: an editor's name on it, no date. Whose it is
    # is the whole question `is_briefed` answers.
    jobs["no_deadline"] = await make_job(
        db, pod=pod, created_by=tl, stage="assigned", editor=ve, reviewer=qc, deadline=None
    )
    jobs["delivered"] = await make_job(
        db, pod=pod, created_by=tl, stage="delivered", editor=ve, reviewer=qc, deadline=DEADLINE
    )
    jobs["scrapped_editing"] = await make_job(
        db,
        pod=pod,
        created_by=tl,
        stage="editing",
        editor=ve,
        reviewer=qc,
        deadline=DEADLINE,
        scrapped_by=tl,
    )
    jobs["scrapped_qc1"] = await make_job(
        db, pod=pod, created_by=tl, stage="qc1", editor=ve, reviewer=qc, scrapped_by=tl
    )
    await db.commit()
    return {"owner": owner, "hr": hr, "tl": tl, "ve": ve, "qc": qc, "pod": pod, "jobs": jobs}


async def test_tl_sees_the_stages_the_ball_is_in_their_court_for(db, scene):
    """The headline regression: a TL's Mine used to be permanently empty."""
    jobs = scene["jobs"]
    assert await _mine_ids(db, scene["tl"]) == {
        jobs["intake"].id,
        jobs["qc1"].id,
        jobs["final"].id,
        # An editor's stage, but the hand-off was never finished, so it is
        # still the TL's move — see the un-briefed tests below.
        jobs["no_deadline"].id,
    }


async def test_editor_sees_only_stages_they_can_act_on(db, scene):
    """Assigned, editing and revisions — not the cut they already sent to QC,
    which still carries their id and is no longer their move."""
    jobs = scene["jobs"]
    assert await _mine_ids(db, scene["ve"]) == {
        jobs["assigned"].id,
        jobs["editing"].id,
        jobs["revisions"].id,
    }


async def test_a_job_with_no_deadline_never_reaches_the_editor(db, scene):
    """The hand-off is an editor *and* a date. Until both are set the job is
    not the editor's move — it used to land in their Mine, purple and with a
    live Start editing button, reading "No deadline" where the date goes."""
    no_deadline = scene["jobs"]["no_deadline"].id
    assert no_deadline not in await _mine_ids(db, scene["ve"])
    assert no_deadline in await _mine_ids(db, scene["tl"])


async def test_an_editorless_job_at_an_editor_stage_is_the_tls(db, scene):
    """The other half missing. Only reachable by an admin override today, but
    it is the same gap and it belongs to the same person."""
    job = await make_job(
        db, pod=scene["pod"], created_by=scene["tl"], stage="editing", deadline=DEADLINE
    )
    await db.commit()
    assert job.id in await _mine_ids(db, scene["tl"])
    assert job.id not in await _mine_ids(db, scene["ve"])


async def test_reviewer_sees_only_jobs_sitting_at_qc2(db, scene):
    jobs = scene["jobs"]
    assert await _mine_ids(db, scene["qc"]) == {jobs["qc2"].id}


async def test_delivered_work_is_nobody_s(db, scene):
    delivered = scene["jobs"]["delivered"].id
    for role in ("tl", "ve", "qc", "owner", "hr"):
        assert delivered not in await _mine_ids(db, scene[role])


async def test_scrapped_work_is_nobody_s(db, scene):
    """A scrapped job at QC1 would otherwise land in the pod TL's Mine and ask
    them to review work that was cancelled."""
    jobs = scene["jobs"]
    dead = {jobs["scrapped_editing"].id, jobs["scrapped_qc1"].id}
    for role in ("tl", "ve", "qc", "owner", "hr"):
        assert not (dead & await _mine_ids(db, scene[role]))


@pytest.mark.parametrize("role", ["owner", "hr"])
async def test_company_wide_tier_is_scoped_to_pods_they_actually_lead(db, scene, role):
    """Owner / FO / HR reach every pod, but Mine is "waiting on *me*", and
    they are not this pod's TL. Empty here is the correct answer — which is
    why the UI drops the tab for them rather than showing a standing zero."""
    assert await _mine_ids(db, scene[role]) == set()


async def test_an_owner_who_leads_a_pod_does_get_that_pod_s_work(db, scene):
    """The other half of the same rule: reach is company-wide, but Mine keys
    off `Pod.tl_id`, so an admin who really runs a pod is not left out."""
    owner = scene["owner"]
    pod = await make_pod(db, tl=owner, name="Owner's own", onboarded_by=owner)
    await add_member(db, pod, owner, "tl")
    job = await make_job(db, pod=pod, created_by=owner, stage="qc1")
    await db.commit()

    assert await _mine_ids(db, owner) == {job.id}
