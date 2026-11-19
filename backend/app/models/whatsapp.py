"""The four tables the WhatsApp integration owns.

Read them as two pairs. `WhatsAppTemplate` and `WhatsAppSettings` are
*configuration* — what we are allowed to send and to whom. `WhatsAppMessage`
and `WhatsAppWebhookEvent` are *history* — what we actually sent and what Meta
said back.

**Why templates are mirrored at all.** Meta is the authority on whether a
template may be used; this table is a local copy of that answer. The sender
reads the copy, not the API: a send that had to ask Meta "is this approved
yet" would add a network round-trip to every job hand-off, and would fail open
the day Meta is slow. The copy is kept fresh by the status webhook (instant)
and by the hourly reconcile (correct after a missed delivery) — see
docs/13-whatsapp.md.

**Why there is no `whatsapp` row in `notifications`.** `Notification.channel`
has the value and it stays unused. `routers/notifications.py` does not filter
on it, so a second row per event would show every item in everyone's inbox
twice and double the unread count — and a Notification row has nowhere to put
a `wamid`, a delivery status, an error code or the parameters that were
actually interpolated. One in-app notification, one `WhatsAppMessage` pointing
at it.
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Meta's template review states. Stored as a plain string rather than a
# database enum on purpose: this is somebody else's vocabulary and they add to
# it (IN_APPEAL and PAUSED both arrived after the API shipped). A value we have
# never seen should land in the column and show up on the admin page as itself,
# not fail the webhook that carried it.
TEMPLATE_STATUSES = (
    "PENDING",
    "APPROVED",
    "REJECTED",
    "PAUSED",
    "DISABLED",
    "IN_APPEAL",
    "PENDING_DELETION",
    "DELETED",
    "LIMIT_EXCEEDED",
)

# The only status a message may be sent against. PAUSED is Meta throttling a
# template whose quality dropped; sending into it burns the rating further.
SENDABLE_STATUS = "APPROVED"

# Utility is transactional and uncapped. Marketing is capped at roughly two
# messages per person per day *across every business on WhatsApp*, which no
# amount of extra phone numbers works around (error 131049). Every template
# here is a work notification, so every one is submitted as UTILITY — and a
# `category` that has drifted away from `requested_category` is the loudest
# thing on the admin page.
CATEGORY_UTILITY = "UTILITY"

MESSAGE_STATUSES = ("queued", "sent", "delivered", "read", "failed", "skipped")


class WhatsAppTemplate(Base):
    """One template, in one language, as Meta currently sees it."""

    __tablename__ = "whatsapp_templates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Matches a key in `services/whatsapp/registry.py`. A row whose name is not
    # in the registry is a template somebody created in Meta's own UI — shown
    # on the admin page as unmanaged, never sent.
    name: Mapped[str] = mapped_column(String(512), index=True)
    language: Mapped[str] = mapped_column(String(16), default="en")
    meta_template_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="PENDING")
    category: Mapped[str] = mapped_column(String(32), default=CATEGORY_UTILITY)
    # What we asked for. Meta may re-categorise a template after approval and
    # tell us only through a webhook; without this column there is nothing to
    # compare the new value against and the change is invisible.
    requested_category: Mapped[str] = mapped_column(String(32), default=CATEGORY_UTILITY)
    rejected_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    quality_score: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Exactly what was submitted, so the admin page can render the bubble that
    # was approved rather than the one currently in the source tree.
    components: Mapped[dict] = mapped_column(JSONB, default=dict)
    # Hash of the registry definition at submit time. When the code changes and
    # this does not, the approved template and the sender have drifted — which
    # is a 132000 at the next hand-off, and the one failure this integration
    # cannot detect from Meta's side alone.
    registry_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_status_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    @property
    def is_sendable(self) -> bool:
        return self.status == SENDABLE_STATUS

    @property
    def category_drifted(self) -> bool:
        """Meta has moved this template out of the category we asked for."""
        return self.category != self.requested_category


class WhatsAppMessage(Base):
    """One message we handed to Meta, and everything that happened to it.

    Rows are written *before* the API call, not after: a send that raises has
    to leave a trace, and "we tried and the network died" is the case somebody
    is actually looking for when they open the delivery log. `status` starts at
    `queued` and moves forward from the response and then from the status
    webhooks.

    `skipped` is a real outcome, not an absence. A person with no phone number,
    an opted-out account, a template still in review — each of those means a
    notification the app decided not to send, and a decision with a reason on
    the record is worth far more than a missing row nobody can ask about.
    """

    __tablename__ = "whatsapp_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Null for anything the scheduler sends (digests, deadline warnings): those
    # are not somebody's in-app notification, they are a message in their own
    # right.
    notification_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("notifications.id"), nullable=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True
    )
    job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id"), nullable=True, index=True
    )
    event_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    template_name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    template_language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # As dialled, in E.164. Kept on the row rather than read back off the user:
    # people change numbers, and "which number did this actually go to" is the
    # question the log exists to answer.
    to_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Meta's id for the message. Unique, because it is the key every status
    # webhook arrives under and a duplicate would split one message's history
    # across two rows.
    wamid: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    # Why nothing was sent, or why Meta refused it — in English, on the row.
    # The admin page prints this verbatim; see `services/whatsapp/errors.py`.
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    error_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The interpolated parameters. Without these, "why did it tell him the
    # deadline was yesterday" has no answer once the job has moved on.
    params: Mapped[dict] = mapped_column(JSONB, default=dict)
    # The quick-reply nonce minted for this message, consumed by the first tap.
    # A tap replayed by Meta's retry logic finds it gone and does nothing.
    button_nonce: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    button_tapped_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    button_action: Mapped[str | None] = mapped_column(String(32), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class WhatsAppWebhookEvent(Base):
    """Every webhook body Meta sent us, stored before it is understood.

    Two jobs, and the second is the one that matters. It is an audit trail —
    "Meta says it delivered that at 14:02" is only a defensible claim if the
    payload is still here. And `dedupe_key` is what makes processing
    idempotent: Meta retries any delivery it does not get a fast 200 for, and
    without a unique key a retried button tap advances a job's stage twice.
    """

    __tablename__ = "whatsapp_webhook_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Built from whatever identifies the *event* rather than the delivery:
    # wamid + status for a receipt, template id + status for a review result.
    # Unique, so the second copy loses the insert and is never processed.
    dedupe_key: Mapped[str] = mapped_column(String(255), unique=True)
    field: Mapped[str] = mapped_column(String(64), index=True)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class WhatsAppSettings(Base):
    """A single row. The switches an Owner can throw without a deploy.

    A singleton table rather than a column on something else, or a config file:
    the kill switch has to be reachable at 9pm from a phone, and `event_flags`
    and `pilot_user_ids` are what make the documented "ramp a few users first"
    an actual feature instead of an instruction nobody can follow.
    """

    __tablename__ = "whatsapp_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # The kill switch. False stops every send at the door while leaving the
    # in-app notification, the push and the whole pipeline untouched.
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Empty list means everybody. A non-empty list is a pilot: only these
    # accounts receive anything, which is how a new template earns its quality
    # rating without the whole company in the blast radius.
    pilot_user_ids: Mapped[list] = mapped_column(JSONB, default=list)
    # event key -> bool. A missing key means "on": a new event added in code
    # should work on deploy, not wait for somebody to notice a toggle.
    event_flags: Mapped[dict] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
