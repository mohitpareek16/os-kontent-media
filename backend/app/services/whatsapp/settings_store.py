"""The one row of `whatsapp_settings`, read and written in one place.

The switches an Owner can throw at nine in the evening without a deploy: the
kill switch, the pilot list, and the per-event toggles. Env vars hold the
credentials because those are deployment facts; these are operational
decisions, and an operational decision that needs a release is one nobody
makes in time.

**A missing event flag means on.** `event_flags` stores only what has been
explicitly turned *off*. The alternative — a row listing every event, seeded
by a migration — means a new event added in code stays silent after deploy
until somebody notices a toggle they have never seen, and the silence looks
exactly like a bug.

**An empty pilot list means everybody.** A non-empty one is a ramp: new
templates and numbers without a quality rating are paced by Meta for their
first days, and pointing the whole company at one on day one is how a rating
goes yellow before it has ever been green.
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.whatsapp import WhatsAppSettings


async def load(db: AsyncSession) -> WhatsAppSettings:
    """The settings row, created on first read.

    Created lazily rather than seeded by migration 0025 so that the row's
    defaults live in one place — the model — instead of being half in a
    migration that can never be edited again.
    """
    row = (await db.execute(select(WhatsAppSettings).limit(1))).scalar_one_or_none()
    if row is None:
        row = WhatsAppSettings(enabled=False, pilot_user_ids=[], event_flags={})
        db.add(row)
        await db.flush()
    return row


def event_enabled(settings: WhatsAppSettings, event_key: str) -> bool:
    """Absent means on — see the module docstring."""
    return bool((settings.event_flags or {}).get(event_key, True))


def in_pilot(settings: WhatsAppSettings, user_id: uuid.UUID) -> bool:
    """Empty list means everybody is in scope."""
    pilot = settings.pilot_user_ids or []
    if not pilot:
        return True
    return str(user_id) in {str(entry) for entry in pilot}
