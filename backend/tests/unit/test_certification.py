"""services/certification.py — 3 deliveries at <=1 QC round on a pod.

docs/05: computed, never maintained by hand. Nobody sets
PodMember.certified_at directly, so the only thing worth testing is the
threshold and what does and doesn't count towards it.
"""
from __future__ import annotations

import pytest

from app.services.certification import (
    CERT_MAX_ROUNDS,
    CERT_THRESHOLD_DELIVERIES,
    is_certified,
    refresh_certification,
)
from tests.factories import add_member, make_job, make_pod, make_user

pytestmark = pytest.mark.unit


def test_documented_thresholds():
    assert CERT_THRESHOLD_DELIVERIES == 3
    assert CERT_MAX_ROUNDS == 1


async def _editor_on_pod(db):
    tl = await make_user(db, role="tl")
    editor = await make_user(db, role="ve")
    pod = await make_pod(db, tl=tl)
    await add_member(db, pod, tl, "tl")
    member = await add_member(db, pod, editor, "ve")
    return tl, editor, pod, member


async def test_three_clean_deliveries_certify(db):
    tl, editor, pod, _ = await _editor_on_pod(db)
    for rounds in (0, 1, 0):
        await make_job(db, pod=pod, created_by=tl, stage="delivered", editor=editor, round=rounds)
    await db.commit()

    assert await is_certified(db, user_id=editor.id, pod_id=pod.id) is True


async def test_two_clean_deliveries_do_not_certify(db):
    tl, editor, pod, _ = await _editor_on_pod(db)
    for rounds in (0, 1):
        await make_job(db, pod=pod, created_by=tl, stage="delivered", editor=editor, round=rounds)
    await db.commit()

    assert await is_certified(db, user_id=editor.id, pod_id=pod.id) is False


async def test_a_two_round_delivery_does_not_count(db):
    """Two clean deliveries plus a 2-round one is still two."""
    tl, editor, pod, _ = await _editor_on_pod(db)
    for rounds in (0, 1, 2):
        await make_job(db, pod=pod, created_by=tl, stage="delivered", editor=editor, round=rounds)
    await db.commit()

    assert await is_certified(db, user_id=editor.id, pod_id=pod.id) is False


async def test_undelivered_jobs_do_not_count(db):
    tl, editor, pod, _ = await _editor_on_pod(db)
    await make_job(db, pod=pod, created_by=tl, stage="delivered", editor=editor, round=0)
    await make_job(db, pod=pod, created_by=tl, stage="final", editor=editor, round=0)
    await make_job(db, pod=pod, created_by=tl, stage="qc2", editor=editor, round=1)
    await db.commit()

    assert await is_certified(db, user_id=editor.id, pod_id=pod.id) is False


async def test_certification_is_per_pod(db):
    """Three clean deliveries spread across two pods certify on neither."""
    tl, editor, pod, _ = await _editor_on_pod(db)
    other_pod = await make_pod(db, tl=tl, name="Other")
    await add_member(db, other_pod, editor, "ve")
    await make_job(db, pod=pod, created_by=tl, stage="delivered", editor=editor, round=0)
    await make_job(db, pod=pod, created_by=tl, stage="delivered", editor=editor, round=0)
    await make_job(db, pod=other_pod, created_by=tl, stage="delivered", editor=editor, round=0)
    await db.commit()

    assert await is_certified(db, user_id=editor.id, pod_id=pod.id) is False
    assert await is_certified(db, user_id=editor.id, pod_id=other_pod.id) is False


async def test_another_editors_deliveries_do_not_count(db):
    tl, editor, pod, _ = await _editor_on_pod(db)
    someone_else = await make_user(db, role="ve")
    await add_member(db, pod, someone_else, "ve")
    for _ in range(3):
        await make_job(db, pod=pod, created_by=tl, stage="delivered", editor=someone_else, round=0)
    await db.commit()

    assert await is_certified(db, user_id=editor.id, pod_id=pod.id) is False


async def test_refresh_certification_stamps_the_membership_row(db):
    tl, editor, pod, member = await _editor_on_pod(db)
    for _ in range(3):
        await make_job(db, pod=pod, created_by=tl, stage="delivered", editor=editor, round=1)
    await db.commit()

    await refresh_certification(db, user_id=editor.id, pod_id=pod.id)
    await db.commit()
    await db.refresh(member)
    assert member.certified_at is not None


async def test_refresh_certification_does_nothing_below_the_threshold(db):
    tl, editor, pod, member = await _editor_on_pod(db)
    for _ in range(2):
        await make_job(db, pod=pod, created_by=tl, stage="delivered", editor=editor, round=0)
    await db.commit()

    await refresh_certification(db, user_id=editor.id, pod_id=pod.id)
    await db.commit()
    await db.refresh(member)
    assert member.certified_at is None


async def test_refresh_certification_keeps_the_original_date(db):
    """Certification is a milestone, not a rolling flag — a later delivery
    must not restamp the date."""
    tl, editor, pod, member = await _editor_on_pod(db)
    for _ in range(3):
        await make_job(db, pod=pod, created_by=tl, stage="delivered", editor=editor, round=0)
    await db.commit()

    await refresh_certification(db, user_id=editor.id, pod_id=pod.id)
    await db.commit()
    await db.refresh(member)
    first_stamp = member.certified_at

    await make_job(db, pod=pod, created_by=tl, stage="delivered", editor=editor, round=0)
    await db.commit()
    await refresh_certification(db, user_id=editor.id, pod_id=pod.id)
    await db.commit()
    await db.refresh(member)
    assert member.certified_at == first_stamp


async def test_refresh_certification_ignores_a_non_member(db):
    """An editor pulled in for capacity without a membership row: no row to
    stamp, and nothing blows up."""
    tl, editor, pod, _ = await _editor_on_pod(db)
    outsider = await make_user(db, role="ve")
    for _ in range(3):
        await make_job(db, pod=pod, created_by=tl, stage="delivered", editor=outsider, round=0)
    await db.commit()

    await refresh_certification(db, user_id=outsider.id, pod_id=pod.id)
    await db.commit()
