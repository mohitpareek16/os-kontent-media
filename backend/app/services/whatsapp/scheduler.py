"""The messages that fire because of a date rather than because of a move.

Stage messages hang off a `JobEvent`. These two reminders fire when the team
deadline approaches or passes, without a new job event.

Started once at application startup and re-scheduled with `asyncio`, exactly
like `services/cleanup_expired_notes.py`. No cron, no celery, no second
process to deploy and forget. The cost is that a deployment running two app
containers runs this twice — see `_should_send_once` for how each sender is
made idempotent against that, which is a cheaper answer than a lock table for
a job whose worst failure is a duplicate message.

The day rolls over in `settings.qc2_day_timezone` (Asia/Kolkata), the same
clock the QC2 budget uses. Deadlines are dates in that working day.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import async_session_factory
from app.models.job import Job
from app.models.pod import Pod
from app.models.user import User
from app.models.whatsapp import WhatsAppMessage
from app.services.notification_text import STAGE_LABELS
from app.services.whatsapp import send, settings_store, templates
from app.services.whatsapp.client import templates_enabled, whatsapp_enabled

logger = logging.getLogger("app.whatsapp")

# Event keys, so each of these can be switched off individually from the admin
# page like any other event.
EVENT_DEADLINE_SOON = "scheduled:deadline_soon"
EVENT_DEADLINE_MISSED = "scheduled:deadline_missed"

DUE_SOON_DAYS = 1


def _today() -> date:
    tz = ZoneInfo(get_settings().qc2_day_timezone)
    return datetime.now(tz).date()


async def run_once(db: AsyncSession) -> dict:
    """One pass. Returns a small summary, which the admin route also uses so
    the button and the loop cannot drift into doing different things."""
    summary = {
        "reconciled": None,
        "deadline_soon": 0,
        "deadline_missed": 0,
    }

    if templates_enabled():
        try:
            summary["reconciled"] = await templates.sync(db)
            # Committed here rather than at the end, and this is load-bearing.
            # `sync` only flushes, and both early returns below happen in the
            # normal course of setting the integration up — messaging is off
            # until somebody switches it on, which is precisely the window
            # where templates are moving from PENDING to APPROVED. Leaving the
            # commit to the bottom meant the reconcile silently discarded every
            # status change for as long as it was most useful.
            await db.commit()
        except Exception:
            # A failed sync must not stop the alerts below. Rolled back first — a
            # session that raised mid-flush cannot be used for the queries
            # underneath it.
            await db.rollback()
            logger.exception("WhatsApp template reconcile failed")

    if not whatsapp_enabled():
        return summary

    row = await settings_store.load(db)
    if not row.enabled:
        # `settings_store.load` creates the row on first read, so even this
        # path has something to save.
        await db.commit()
        return summary

    summary["deadline_soon"] = await send_deadline_warnings(db)
    summary["deadline_missed"] = await send_deadline_missed(db)
    await db.commit()
    return summary


async def _should_send_once(
    db: AsyncSession, *, event_key: str, user_id, job_id, since: datetime
) -> bool:
    """Has this person already been told this, about this job, recently?

    The whole idempotency story for the scheduler, and it is a query rather
    than a lock because the delivery log already records every send. Two app
    containers ticking a minute apart both find the first container's row and
    the second sends nothing. A `skipped` row counts too — a person outside the
    pilot should not be re-evaluated every hour for the rest of the day.
    """
    existing = (
        await db.execute(
            select(func.count())
            .select_from(WhatsAppMessage)
            .where(
                WhatsAppMessage.event_key == event_key,
                WhatsAppMessage.user_id == user_id,
                WhatsAppMessage.job_id == job_id,
                WhatsAppMessage.created_at >= since,
            )
        )
    ).scalar_one()
    return existing == 0


async def send_deadline_warnings(db: AsyncSession) -> int:
    """Remind the assigned editor on the day before or day of the team deadline.

    Only the **team** deadline. `client_deadline` is later, stricter-looking
    and visible to the Owner and pod TL alone (docs/04) — warning an editor
    against it would both leak it and be wrong.
    """
    today = _today()
    horizon = today + timedelta(days=DUE_SOON_DAYS)
    since = datetime.now(timezone.utc) - timedelta(hours=20)

    rows = (
        (
            await db.execute(
                select(Job, Pod)
                .outerjoin(Pod, Pod.id == Job.pod_id)
                .where(
                    Job.deadline.is_not(None),
                    Job.deadline >= today,
                    Job.deadline <= horizon,
                    Job.stage != "delivered",
                    Job.scrapped_at.is_(None),
                )
            )
        )
        .all()
    )

    sent = 0
    for job, pod in rows:
        recipient = await db.get(User, job.assigned_editor_id) if job.assigned_editor_id else None
        if recipient is None:
            continue
        if not await _should_send_once(
            db, event_key=EVENT_DEADLINE_SOON, user_id=recipient.id, job_id=job.id, since=since
        ):
            continue
        await send.send_template(
            db,
            recipient=recipient,
            template_name="deadline_approaching_v2",
            event_key=EVENT_DEADLINE_SOON,
            job=job,
            context={
                "recipient_name": recipient.name or "",
                "job_code": job.code,
                "job_title": job.title,
                "deadline": job.deadline.strftime("%d %b %Y"),
                "stage_label": _stage_label(job),
                "pod_name": pod.name if pod is not None else "—",
                "job_url": f"{get_settings().frontend_base_url.rstrip('/')}/jobs/{job.id}",
            },
        )
        sent += 1
    return sent


async def send_deadline_missed(db: AsyncSession) -> int:
    """Alert the assigned editor once when an unfinished job becomes overdue."""
    today = _today()
    rows = (
        await db.execute(
            select(Job, Pod).outerjoin(Pod, Pod.id == Job.pod_id).where(
                Job.deadline < today,
                Job.stage != "delivered",
                Job.scrapped_at.is_(None),
                Job.assigned_editor_id.is_not(None),
            )
        )
    ).all()
    sent = 0
    for job, pod in rows:
        recipient = await db.get(User, job.assigned_editor_id)
        if recipient is None or not await _should_send_once(
            db, event_key=EVENT_DEADLINE_MISSED,
            user_id=recipient.id, job_id=job.id, since=job.created_at,
        ):
            continue
        tl = await db.get(User, pod.tl_id) if pod and pod.tl_id else None
        await send.send_template(
            db, recipient=recipient, template_name="deadline_missed_v2",
            event_key=EVENT_DEADLINE_MISSED, job=job,
            context={
                "job_title": job.title,
                "pod_name": pod.name if pod else "—",
                "deadline": job.deadline.strftime("%d %b %Y"),
                "stage_label": _stage_label(job),
                "tl_name": tl.name if tl else "your TL",
                "job_url": f"{get_settings().frontend_base_url.rstrip('/')}/jobs/{job.id}",
            },
        )
        sent += 1
    return sent


def _stage_label(job: Job) -> str:
    return STAGE_LABELS.get(job.stage, job.stage)


async def scheduler_loop() -> None:
    """Started at application startup; cancelled at shutdown.

    Never raises out of the loop. An exception here would kill the task
    silently and the first anyone would know is that deadline warnings stopped
    weeks ago — the same failure `cleanup_expired_notes` guards against, and
    for the same reason.
    """
    interval = get_settings().whatsapp_reconcile_interval_seconds
    while True:
        try:
            if templates_enabled() or whatsapp_enabled():
                async with async_session_factory() as db:
                    summary = await run_once(db)
                if any(
                    summary.get(k)
                    for k in ("deadline_soon", "deadline_missed")
                ):
                    logger.info("WhatsApp scheduler: %s", summary)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("WhatsApp scheduler tick failed")
        await asyncio.sleep(interval)
