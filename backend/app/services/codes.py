"""Job reference codes (KM-1042).

Previously derived from `count(jobs) + 1001`, which is wrong in two ways:
concurrent creates read the same count and the loser died on the unique
index with a 500, and deleting any job made the count go backwards so every
later create collided with an existing code forever.

A Postgres sequence hands out each number exactly once and never consults
the current rows. See migration 0004.
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

CODE_PREFIX = "KM"


async def next_job_code(db: AsyncSession) -> str:
    value = (await db.execute(text("SELECT nextval('job_code_seq')"))).scalar_one()
    return f"{CODE_PREFIX}-{value}"
