"""Daily background task that deletes voice notes whose 60-day retention
window has expired — both the database row and the audio file on disk.

Called once at startup, then re-schedules itself every 24 hours via
asyncio.  No external scheduler (cron, celery) required.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete, select

from app.core.config import get_settings
from app.db.session import async_session_factory
from app.models.voice_note import VoiceNote

logger = logging.getLogger(__name__)

_CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60  # once a day


async def _run_cleanup() -> int:
    """Delete expired voice notes.  Returns the number removed."""
    now = datetime.now(timezone.utc)
    settings = get_settings()
    removed = 0

    async with async_session_factory() as db:
        result = await db.execute(
            select(VoiceNote).where(VoiceNote.expires_at <= now)
        )
        expired = result.scalars().all()

        for note in expired:
            path = Path(settings.uploads_dir) / note.audio_filename
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
            removed += 1

        if expired:
            ids = [n.id for n in expired]
            await db.execute(delete(VoiceNote).where(VoiceNote.id.in_(ids)))
            await db.commit()

    return removed


async def cleanup_loop() -> None:
    """Infinite loop: clean up expired notes, then sleep 24 hours."""
    while True:
        try:
            removed = await _run_cleanup()
            if removed:
                logger.info("Voice-note cleanup: removed %d expired note(s)", removed)
        except Exception:
            logger.exception("Voice-note cleanup failed — will retry next cycle")

        await asyncio.sleep(_CLEANUP_INTERVAL_SECONDS)
