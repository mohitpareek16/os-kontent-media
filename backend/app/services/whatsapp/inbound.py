"""What Meta sends us, and what we do about it.

Four kinds of thing arrive on the webhook and they have almost nothing to do
with each other:

1. **Delivery receipts** — sent / delivered / read / failed, keyed by `wamid`.
   Bookkeeping on the delivery log.
2. **Template review results** — APPROVED, REJECTED with a reason, PAUSED.
   This is the "check karega ki hua hai ya nahi" half of template management,
   and it arrives in seconds rather than being polled for.
3. **Category changes** — Meta re-filing a template from UTILITY to MARKETING,
   which silently caps the whole system at about two messages per person per
   day. The single most valuable event on this list.
4. **Inbound messages** — update the contact window only. Replies never
   change a job or add feedback.

**Idempotency is not optional here.** Meta retries any delivery it does not
get a fast 200 for, and it also fans the same event out more than once under
load. Every handler is written to be safe on a second run, and the webhook
route refuses to process an event whose `dedupe_key` is already in the table —
the unique index is the lock, so two workers racing the same retry cannot both
win.

"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.whatsapp import WhatsAppMessage, WhatsAppTemplate
from app.services.whatsapp import templates

logger = logging.getLogger("app.whatsapp")

# The webhook `field` names this application subscribes to. Anything else is
# stored and ignored rather than rejected — Meta adds fields, and a 500 on an
# unrecognised one would make them retry it forever.
FIELD_MESSAGES = "messages"
FIELD_TEMPLATE_STATUS = "message_template_status_update"
FIELD_TEMPLATE_CATEGORY = "message_template_category_update"
FIELD_TEMPLATE_QUALITY = "message_template_quality_update"


def dedupe_keys(field: str, value: dict) -> list[str]:
    """The stable identity of every event inside one webhook `value` block.

    A single POST can carry several statuses and several messages, so this
    returns a list and the caller stores one row per element. The key has to be
    derived from what the event *is*, not from when it arrived: a retry is
    byte-identical, so anything time-based would let it through.
    """
    keys: list[str] = []
    for status in value.get("statuses", []) or []:
        # wamid alone is not enough — one message legitimately produces sent,
        # delivered and read, all carrying the same id.
        keys.append(f"status:{status.get('id')}:{status.get('status')}:{status.get('timestamp')}")
    for message in value.get("messages", []) or []:
        keys.append(f"message:{message.get('id')}")
    if field in (FIELD_TEMPLATE_STATUS, FIELD_TEMPLATE_CATEGORY, FIELD_TEMPLATE_QUALITY):
        keys.append(
            f"{field}:{value.get('message_template_id')}:"
            f"{value.get('event') or value.get('new_category') or value.get('new_quality_score')}"
        )
    if not keys:
        # An event shape this code does not recognise still gets stored once,
        # so the admin page can show that something arrived and was not
        # understood. Sorted so the key is stable across retries.
        keys.append(f"{field}:{sorted(value.items(), key=lambda kv: kv[0])}"[:250])
    return keys


async def process(db: AsyncSession, *, field: str, value: dict) -> None:
    """Apply one webhook `value` block. Must be safe to run twice."""
    if field == FIELD_MESSAGES:
        for status in value.get("statuses", []) or []:
            await _apply_status(db, status)
        for message in value.get("messages", []) or []:
            await _apply_inbound(db, message)
        return
    if field == FIELD_TEMPLATE_STATUS:
        await _apply_template_status(db, value)
        return
    if field == FIELD_TEMPLATE_CATEGORY:
        await _apply_template_category(db, value)
        return
    if field == FIELD_TEMPLATE_QUALITY:
        await _apply_template_quality(db, value)
        return
    logger.info("WhatsApp webhook field %s ignored", field)


# --------------------------------------------------------------------------
# Delivery receipts
# --------------------------------------------------------------------------


async def _apply_status(db: AsyncSession, status: dict) -> None:
    wamid = status.get("id")
    if not wamid:
        return
    row = (
        await db.execute(select(WhatsAppMessage).where(WhatsAppMessage.wamid == wamid))
    ).scalar_one_or_none()
    if row is None:
        # A message this deployment did not send — a test from Meta's console,
        # or a reply. Nothing to update, and not an error.
        return

    state = (status.get("status") or "").lower()
    now = _timestamp(status.get("timestamp"))
    if state == "sent" and row.sent_at is None:
        row.sent_at = now
    elif state == "delivered":
        row.delivered_at = now
    elif state == "read":
        row.read_at = now
    elif state == "failed":
        row.failed_at = now
        errors_list = status.get("errors") or []
        if errors_list:
            first = errors_list[0]
            row.error_code = first.get("code")
            row.reason = (first.get("title") or "Failed")[:255]
            row.error_detail = (first.get("error_data") or {}).get("details") or first.get(
                "message"
            )

    # Statuses can arrive out of order. `read` implies delivered and sent, so
    # the column never walks backwards — a late `sent` after a `read` would
    # otherwise re-label a message the recipient has already opened.
    rank = {"queued": 0, "skipped": 0, "sent": 1, "delivered": 2, "read": 3, "failed": 4}
    if state == "failed" or rank.get(state, 0) > rank.get(row.status, 0):
        row.status = state or row.status


def _timestamp(raw) -> datetime:
    """Meta sends unix seconds as a string. A missing or unparseable one falls
    back to now, which is within a second or two of the truth and infinitely
    better than dropping the receipt."""
    try:
        return datetime.fromtimestamp(int(raw), tz=timezone.utc)
    except (TypeError, ValueError):
        return datetime.now(timezone.utc)


# --------------------------------------------------------------------------
# Template review
# --------------------------------------------------------------------------


async def _template_row(db: AsyncSession, value: dict) -> WhatsAppTemplate | None:
    """Find the mirror row a template event is about.

    By Meta's template id first — it is unambiguous — and by name second, which
    is what arrives when the event predates the row (a template approved before
    this deployment ever synced).
    """
    meta_id = value.get("message_template_id")
    if meta_id:
        row = (
            await db.execute(
                select(WhatsAppTemplate).where(
                    WhatsAppTemplate.meta_template_id == str(meta_id)
                )
            )
        ).scalar_one_or_none()
        if row is not None:
            return row
    name = value.get("message_template_name")
    language = value.get("message_template_language")
    if not name:
        return None
    if language:
        return await templates.get_row(db, name, language)
    return (
        await db.execute(select(WhatsAppTemplate).where(WhatsAppTemplate.name == name).limit(1))
    ).scalar_one_or_none()


async def _apply_template_status(db: AsyncSession, value: dict) -> None:
    row = await _template_row(db, value)
    if row is None:
        return
    event = (value.get("event") or "").upper()
    now = datetime.now(timezone.utc)
    if event:
        row.status = event
    row.last_status_at = now
    if event == "APPROVED":
        row.approved_at = row.approved_at or now
        row.rejected_reason = None
    if event == "REJECTED":
        row.rejected_reason = (value.get("reason") or "No reason given")[:255]


async def _apply_template_category(db: AsyncSession, value: dict) -> None:
    """Meta has re-filed a template. The expensive one.

    `category` moves and `requested_category` does not, which is precisely what
    makes `category_drifted` true and lights the banner on the admin page. A
    UTILITY template reclassified as MARKETING is capped at roughly two
    messages per person per day across every business on WhatsApp — the send
    does not fail, it is simply refused with 131049 after the second one, which
    is why nobody notices without this.
    """
    row = await _template_row(db, value)
    if row is None:
        return
    new_category = value.get("new_category") or value.get("correct_category")
    if new_category:
        row.category = new_category
    row.last_status_at = datetime.now(timezone.utc)
    if row.category_drifted:
        logger.warning(
            "WhatsApp template %s re-categorised by Meta: %s -> %s",
            row.name,
            row.requested_category,
            row.category,
        )


async def _apply_template_quality(db: AsyncSession, value: dict) -> None:
    row = await _template_row(db, value)
    if row is None:
        return
    row.quality_score = value.get("new_quality_score") or row.quality_score
    row.last_status_at = datetime.now(timezone.utc)


# --------------------------------------------------------------------------
# Inbound messages and button taps
# --------------------------------------------------------------------------


async def _apply_inbound(db: AsyncSession, message: dict) -> None:
    """Someone messaged the business number, or tapped a button.

    Either way `last_inbound_at` moves, and that is the important part even
    when nothing else happens: it is what opens Meta's 24-hour service window,
    and every subsequent send on that conversation is free inside it.
    """
    wa_from = message.get("from")
    if not wa_from:
        return
    user = await _user_for_phone(db, wa_from)
    if user is None:
        # A number not on the roster. Nothing to attribute it to, and
        # deliberately nothing created — this endpoint is public.
        logger.info("WhatsApp inbound from unknown number")
        return

    user.last_inbound_at = _timestamp(message.get("timestamp"))

    # WhatsApp is a notification channel only. Even replies to previously
    # approved templates must never move a job or write feedback for it.
    return


async def _user_for_phone(db: AsyncSession, wa_from: str) -> User | None:
    """The one account holding this number, or None.

    **One, or none.** A number on two accounts is refused rather than resolved,
    because the only thing a tap carries is the number it came from: if two
    people share it, a tap cannot be attributed, and guessing would let one of
    them move the other's job. The admin Numbers tab surfaces duplicates for
    exactly this reason.
    """
    digits = "".join(ch for ch in wa_from if ch.isdigit())
    rows = (
        (
            await db.execute(
                select(User).where(User.phone_e164 == digits, User.is_active.is_(True))
            )
        )
        .scalars()
        .all()
    )
    if len(rows) != 1:
        if len(rows) > 1:
            logger.warning("WhatsApp inbound number maps to %s accounts — refusing", len(rows))
        return None
    return rows[0]
