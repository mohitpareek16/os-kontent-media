"""services/codes.py::next_job_code — regression tests for the two ways
`count(jobs) + 1001` was wrong (migration 0004):

  * two concurrent creates read the same count, and the loser died on the
    unique index with a 500;
  * deleting any job made the count go backwards, so every later create
    collided with an existing code forever.

A Postgres sequence hands each number out exactly once and never looks at
what rows exist.
"""
from __future__ import annotations

import asyncio
import re

import pytest
from sqlalchemy import delete, select, text

from app.models.job import Job
from app.services.codes import CODE_PREFIX, next_job_code
from tests.factories import add_member, auth, make_job, make_pod, make_user

pytestmark = pytest.mark.unit


async def test_code_shape_and_monotonicity(db):
    codes = [await next_job_code(db) for _ in range(5)]

    assert all(re.fullmatch(rf"{CODE_PREFIX}-\d+", code) for code in codes)
    numbers = [int(code.split("-")[1]) for code in codes]
    assert numbers == sorted(numbers)
    assert len(set(codes)) == 5


async def test_the_code_comes_from_a_sequence_not_a_row_count(db):
    """If it were count-derived, an empty jobs table would restart at 1001."""
    first = await next_job_code(db)
    await db.execute(delete(Job))
    await db.commit()
    second = await next_job_code(db)

    assert second != first
    assert int(second.split("-")[1]) > int(first.split("-")[1])
    # And the sequence is a real Postgres sequence, not a Python counter.
    assert (
        await db.execute(text("SELECT to_regclass('job_code_seq')"))
    ).scalar_one() is not None


async def test_concurrent_callers_never_collide(db, session_factory):
    """Ten callers on ten separate connections, all at once."""

    async def grab():
        async with session_factory() as session:
            return await next_job_code(session)

    codes = await asyncio.gather(*(grab() for _ in range(10)))
    assert len(set(codes)) == 10


async def test_deleting_a_job_does_not_make_later_codes_collide(db):
    """The exact failure that made this permanent: delete a job, and a
    count-based code lands on one that already exists."""
    tl = await make_user(db, role="tl")
    pod = await make_pod(db, tl=tl)
    jobs = []
    for _ in range(3):
        jobs.append(
            await make_job(db, pod=pod, created_by=tl, code=await next_job_code(db))
        )
    await db.commit()
    existing = {job.code for job in jobs}

    await db.delete(jobs[1])
    await db.commit()

    reused = await make_job(db, pod=pod, created_by=tl, code=await next_job_code(db))
    await db.commit()
    assert reused.code not in existing


async def test_concurrent_job_creates_through_the_api_all_succeed(db, client):
    """Two of three concurrent creates used to fail with a 500 — see the
    migration 0004 docstring."""
    owner = await make_user(db, role="owner")
    tl = await make_user(db, role="tl")
    pod = await make_pod(db, tl=tl, onboarded_by=owner)
    await add_member(db, pod, tl, "tl")
    await db.commit()

    responses = await asyncio.gather(
        *(
            client.post(
                "/api/jobs",
                json={"title": f"Concurrent {i}", "pod_id": str(pod.id)},
                headers=auth(tl),
            )
            for i in range(5)
        )
    )

    assert [r.status_code for r in responses] == [201] * 5
    codes = [r.json()["code"] for r in responses]
    assert len(set(codes)) == 5

    stored = (await db.execute(select(Job.code).where(Job.pod_id == pod.id))).scalars().all()
    assert sorted(stored) == sorted(codes)
