"""Sending a template, and every reason not to.

The guard rails below run in a fixed order and each one records *why* it
stopped, on a `WhatsAppMessage` row with status `skipped`. That costs a row per
non-send and it is worth it: the question this integration will actually be
asked is "why didn't Farah get the message", and "there is no row" is not an
answer. "Skipped — no phone number on file" is.

**Order matters.** Cheapest and most permanent first: a disabled integration
before a disabled event, an opted-out account before a missing number, a
missing number before a template lookup. The first failing check is the one
reported, so the reported reason should be the most fundamental true one —
telling somebody their template is unapproved when the whole integration is
switched off sends them to the wrong screen.

**The template-approved check is the one that matters most.** Meta review can
take a day; without this check every hand-off in that window is a 132001, all
of them logged as errors, none of them anybody's fault. The mirror is read
rather than the API — see `models/whatsapp.py` for why.
"""
from __future__ import annotations

import logging
import secrets
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.job import Job
from app.models.user import User
from app.models.whatsapp import CATEGORY_UTILITY, SENDABLE_STATUS, WhatsAppMessage, WhatsAppTemplate
from app.services.whatsapp import errors, phone, registry, settings_store
from app.services.whatsapp.client import GraphClient, MetaError, MetaUnreachable, whatsapp_enabled

logger = logging.getLogger("app.whatsapp")


class Skip(Exception):
    """A deliberate non-send, with the sentence that goes on the record."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


async def send_template(
    db: AsyncSession,
    *,
    recipient: User,
    template_name: str,
    context: dict,
    event_key: str,
    job: Job | None = None,
    notification_id: uuid.UUID | None = None,
) -> WhatsAppMessage:
    """Run the guard rails, then send. Always returns a row; never raises.

    Never raising is a contract, not laziness. This runs in the background task
    that fires after the response has gone out — the same place
    `services/push.py` sends from — and an exception escaping a background task
    takes the worker down with it. A message that did not arrive is a worse
    day; a crashed worker is an outage.
    """
    message = WhatsAppMessage(
        notification_id=notification_id,
        user_id=recipient.id,
        job_id=job.id if job is not None else None,
        event_key=event_key,
        template_name=template_name,
        status="queued",
        params={},
    )
    db.add(message)

    try:
        spec = await _check_and_prepare(
            db, recipient=recipient, template_name=template_name, event_key=event_key
        )
        params = spec.params(context)
        message.template_language = spec.language
        message.to_phone = recipient.phone_e164
        message.params = {"body": params}
        nonce = secrets.token_hex(8) if spec.buttons else None
        message.button_nonce = nonce
        await _dispatch(message, spec=spec, params=params, to=recipient.phone_e164, nonce=nonce)
    except Skip as skip:
        message.status = "skipped"
        message.reason = skip.reason[:255]
    except (MetaError, MetaUnreachable) as exc:
        code, label, sentence = errors.explain(exc)
        message.status = "failed"
        message.error_code = code
        message.reason = label[:255]
        message.error_detail = sentence
        message.failed_at = datetime.now(timezone.utc)
        logger.warning(
            "WhatsApp send failed for %s (%s): %s", template_name, code, sentence
        )
    except Exception as exc:  # noqa: BLE001 — see the docstring
        message.status = "failed"
        message.reason = "Unexpected error"
        message.error_detail = f"{exc.__class__.__name__}: {exc}"
        message.failed_at = datetime.now(timezone.utc)
        logger.exception("WhatsApp send raised for %s", template_name)

    await db.flush()
    return message


async def _check_and_prepare(
    db: AsyncSession, *, recipient: User, template_name: str, event_key: str
) -> registry.TemplateSpec:
    """Every reason not to send, cheapest and most fundamental first."""
    if not whatsapp_enabled():
        raise Skip("WhatsApp is not configured on this deployment")

    row = await settings_store.load(db)
    if not row.enabled:
        raise Skip("WhatsApp messaging is switched off in admin settings")
    if not settings_store.event_enabled(row, event_key):
        raise Skip(f"The '{event_key}' event is switched off in admin settings")
    if not settings_store.in_pilot(row, recipient.id):
        raise Skip("This account is outside the current pilot group")

    if not recipient.is_active:
        raise Skip("The account has been deactivated")
    if not recipient.whatsapp_opt_in:
        raise Skip("This person has not opted in to WhatsApp notifications")
    if not phone.is_valid(recipient.phone_e164):
        raise Skip("No usable phone number on file — see the Numbers tab")

    spec = registry.get(template_name)
    if spec is None:
        # A template name in the event map with no definition behind it. A
        # programming error, caught by a unit test, but not worth a crash in a
        # background task if one ever slips through.
        raise Skip(f"No template definition named '{template_name}'")

    mirror = (
        await db.execute(
            select(WhatsAppTemplate).where(
                WhatsAppTemplate.name == template_name,
                WhatsAppTemplate.language == spec.language,
            )
        )
    ).scalar_one_or_none()
    if mirror is None:
        raise Skip(f"'{template_name}' has never been submitted to Meta")
    if mirror.status != SENDABLE_STATUS:
        raise Skip(f"'{template_name}' is {mirror.status} at Meta, not approved")
    if mirror.category != CATEGORY_UTILITY or mirror.requested_category != CATEGORY_UTILITY:
        raise Skip(f"'{template_name}' is not approved as a Utility template")
    return spec


async def _dispatch(
    message: WhatsAppMessage,
    *,
    spec: registry.TemplateSpec,
    params: list[str],
    to: str,
    nonce: str | None,
) -> None:
    """The actual Graph call, and what comes back."""
    settings = get_settings()
    body = build_send_payload(spec=spec, params=params, to=to, nonce=nonce, job_id=message.job_id)
    client = GraphClient()
    result = await client.post(f"{settings.whatsapp_phone_number_id}/messages", body)
    wamid = (result.get("messages") or [{}])[0].get("id")
    message.wamid = wamid
    message.status = "sent"
    message.sent_at = datetime.now(timezone.utc)


def build_send_payload(
    *,
    spec: registry.TemplateSpec,
    params: list[str],
    to: str,
    nonce: str | None,
    job_id: uuid.UUID | None,
) -> dict:
    """The message body Meta is handed. Split out so it can be asserted on in
    tests without a network, and read without wading through error handling.

    **The button payload is set here, and that is not optional.** A quick-reply
    button sent without a `payload` parameter comes back in the webhook
    carrying its own *button text* instead — so "Started" and "On it" would be
    indistinguishable from each other and from anything a person happened to
    type. The payload is `ACTION:job:nonce`, which is what makes a tap
    attributable to one message and consumable exactly once.
    """
    components: list[dict] = []
    if params:
        components.append(
            {
                "type": "body",
                "parameters": [{"type": "text", "text": value} for value in params],
            }
        )
    for index, button in enumerate(spec.buttons):
        components.append(
            {
                "type": "button",
                "sub_type": "quick_reply",
                "index": str(index),
                "parameters": [
                    {
                        "type": "payload",
                        "payload": encode_payload(button.action, job_id, nonce),
                    }
                ],
            }
        )
    return {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to,
        "type": "template",
        "template": {
            "name": spec.name,
            "language": {"code": spec.language},
            "components": components,
        },
    }


# Meta caps a quick-reply developer payload at 128 characters. `ACTION` is at
# most 7, a hex uuid is 32, a nonce is 16, plus two separators — 57 at the
# widest, which leaves room without needing to be clever about it.
PAYLOAD_SEPARATOR = ":"


def encode_payload(action: str, job_id: uuid.UUID | None, nonce: str | None) -> str:
    return PAYLOAD_SEPARATOR.join(
        [action, job_id.hex if job_id else "", nonce or ""]
    )


def decode_payload(raw: str) -> tuple[str, str | None, str | None]:
    """(action, job hex, nonce) from a button payload.

    Tolerant on purpose: this parses a string that arrived from the internet.
    A payload with too few parts, or one that is a button's own text because it
    was sent without a payload by some older code path, comes back as an action
    with no job and no nonce — which `inbound.py` then refuses, rather than
    raising inside the webhook handler.
    """
    parts = (raw or "").split(PAYLOAD_SEPARATOR)
    action = parts[0] if parts else ""
    job_hex = parts[1] if len(parts) > 1 and parts[1] else None
    nonce = parts[2] if len(parts) > 2 and parts[2] else None
    return action, job_hex, nonce
