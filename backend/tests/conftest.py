"""Test harness.

Integration tests run the real request path (httpx ASGITransport -> FastAPI ->
SQLAlchemy) against a real Postgres database, per docs/07-backend-rules.md:
"Routers get integration tests against a test database, not mocked
dependencies". Nothing here mocks a dependency except `get_db`, which is
re-pointed at the throwaway `kontent_test` database.

The models use Postgres-only types (UUID, JSONB) and job codes come from a
Postgres sequence created by migration 0004, so SQLite is not an option.
Schema is built by running the real Alembic migrations, so the tests exercise
the same schema production gets.
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]

PG_HOST = os.environ.get("TEST_PG_HOST", "localhost")
PG_PORT = int(os.environ.get("TEST_PG_PORT", "5432"))
PG_USER = os.environ.get("TEST_PG_USER", "kontent")
PG_PASSWORD = os.environ.get("TEST_PG_PASSWORD", "kontent")
TEST_DB_NAME = os.environ.get("TEST_DB_NAME", "kontent_test")

# Hard stop: this suite drops and recreates its database on every run. It must
# never be pointed at the owner's real `kontent` database.
if not TEST_DB_NAME.endswith("_test"):
    raise RuntimeError(
        f"refusing to run: TEST_DB_NAME={TEST_DB_NAME!r} does not end in '_test'"
    )

TEST_DATABASE_URL = (
    f"postgresql+asyncpg://{PG_USER}:{PG_PASSWORD}@{PG_HOST}:{PG_PORT}/{TEST_DB_NAME}"
)

# Set before anything under app.* is imported: app/db/session.py builds its
# engine at import time out of these settings, and Settings is lru_cached.
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["JWT_SECRET"] = "test-secret"
os.environ["UPLOADS_DIR"] = os.environ.get(
    "TEST_UPLOADS_DIR"
) or tempfile.mkdtemp(prefix="kontent-test-uploads-")

from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402

from tests.factories import World, add_member, make_pod, make_user  # noqa: E402

# Every table the migrations create, child-first. alembic_version is left
# alone so the schema isn't rebuilt between tests.
TRUNCATE_SQL = (
    "TRUNCATE whatsapp_messages, whatsapp_webhook_events, whatsapp_templates, "
    "whatsapp_settings, chat_messages, chat_conversations, notifications, job_events, "
    "qc2_charges, jobs, brand_assets, brand_links, brand_kit_events, voice_notes, pod_members, pods, users, teams "
    "RESTART IDENTITY CASCADE"
)


def _run_off_loop(coro):
    """Run a coroutine in a private thread + loop.

    Session bootstrap happens from synchronous fixtures; doing it with
    asyncio.run() directly would collide with pytest-asyncio's session loop.
    """
    box: dict = {}

    def runner():
        try:
            box["value"] = asyncio.run(coro)
        except BaseException as exc:  # noqa: BLE001 - re-raised on the main thread
            box["error"] = exc

    thread = threading.Thread(target=runner)
    thread.start()
    thread.join()
    if "error" in box:
        raise box["error"]
    return box.get("value")


async def _recreate_test_database() -> None:
    import asyncpg

    conn = await asyncpg.connect(
        host=PG_HOST, port=PG_PORT, user=PG_USER, password=PG_PASSWORD, database="postgres"
    )
    try:
        await conn.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = $1 AND pid <> pg_backend_pid()",
            TEST_DB_NAME,
        )
        await conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB_NAME}"')
        await conn.execute(f'CREATE DATABASE "{TEST_DB_NAME}"')
    finally:
        await conn.close()


@pytest.fixture(scope="session")
def _database():
    """Fresh database + real Alembic migrations, once per run."""
    _run_off_loop(_recreate_test_database())

    env = {**os.environ, "DATABASE_URL": TEST_DATABASE_URL}
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"alembic upgrade head failed:\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    yield TEST_DATABASE_URL


@pytest.fixture(scope="session")
async def engine(_database):
    eng = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    yield eng
    await eng.dispose()


@pytest.fixture(scope="session")
def session_factory(engine):
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest.fixture(autouse=True)
async def clean_tables(engine):
    """Every test starts from an empty database and builds its own fixtures —
    nothing here assumes seed data exists."""
    async with engine.begin() as conn:
        await conn.execute(text(TRUNCATE_SQL))
        await conn.execute(text("DELETE FROM video_types WHERE key NOT IN ('podcast','long_form','short_form')"))
        await conn.execute(text("UPDATE video_types SET enabled = true, label = CASE key WHEN 'podcast' THEN 'Podcast' WHEN 'long_form' THEN 'Long form' ELSE 'Short form' END, qc_points = CASE key WHEN 'podcast' THEN 6 WHEN 'long_form' THEN 3 ELSE 1 END"))
    yield


@pytest.fixture
async def db(session_factory, clean_tables):
    """Session the *test* uses to arrange data and assert on it.

    Deliberately separate from the session the app gets: a request that fails
    half-way must not leave its partial mutations sitting in the fixture's
    identity map.
    """
    async with session_factory() as session:
        yield session


@pytest.fixture
async def client(session_factory, clean_tables):
    """The app under test, with a per-request session on the test database —
    the same lifecycle production's get_db has."""

    async def _override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as http:
        yield http
    app.dependency_overrides.clear()


@pytest.fixture
async def world(db) -> World:
    """Two pods with a full cast each, so 'my pod' vs 'someone else's pod' is
    always expressible without a test hand-rolling six users first.

    pod:       tl (TL) + ve, ve2 (VE), qc (QC)
    other_pod: other_tl (TL) + other_ve (VE), other_qc (QC)
    """
    owner = await make_user(db, role="owner", name="Owner")
    tl = await make_user(db, role="tl", name="Pod TL")
    other_tl = await make_user(db, role="tl", name="Other TL")
    ve = await make_user(db, role="ve", name="Editor One")
    ve2 = await make_user(db, role="ve", name="Editor Two")
    other_ve = await make_user(db, role="ve", name="Other Editor")
    qc = await make_user(db, role="qc", name="Reviewer One")
    other_qc = await make_user(db, role="qc", name="Other Reviewer")

    pod = await make_pod(db, tl=tl, name="Acme", onboarded_by=owner)
    other_pod = await make_pod(db, tl=other_tl, name="Globex", onboarded_by=owner)

    await add_member(db, pod, tl, "tl")
    await add_member(db, pod, ve, "ve")
    await add_member(db, pod, ve2, "ve")
    await add_member(db, pod, qc, "qc")

    await add_member(db, other_pod, other_tl, "tl")
    await add_member(db, other_pod, other_ve, "ve")
    await add_member(db, other_pod, other_qc, "qc")

    await db.commit()
    return World(
        owner=owner,
        tl=tl,
        other_tl=other_tl,
        ve=ve,
        ve2=ve2,
        other_ve=other_ve,
        qc=qc,
        other_qc=other_qc,
        pod=pod,
        other_pod=other_pod,
    )
