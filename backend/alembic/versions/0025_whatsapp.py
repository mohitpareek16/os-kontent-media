"""WhatsApp Cloud API: the integration's own four tables

Phase 2 of docs/09-integrations-future.md, specified in full in
docs/13-whatsapp.md. Direct Meta Cloud API — no BSP in the middle — which
means this application owns the template lifecycle, the webhook listener and
the error taxonomy itself. These tables are where that ownership lives.

**whatsapp_templates** is a mirror of Meta's answer to "may we send this".
The sender reads the mirror rather than the API: asking Meta on every job
hand-off would put a network round-trip in front of every stage change, and
would fail open on the day Meta is slow. The status webhook keeps the mirror
fast and the hourly reconcile keeps it true.

`requested_category` next to `category` is the one column that pays for
itself. Meta re-categorises templates after approval, and a UTILITY template
quietly reclassified as MARKETING is capped at roughly two messages per person
per day across every business on WhatsApp — error 131049, unworkaroundable
with more phone numbers. Without both columns there is nothing to compare and
the cap is discovered from an editor saying "I never got that one".

**whatsapp_messages** is the delivery log, one row per message handed to Meta.
Written *before* the API call so a send that raises still leaves a trace.

**whatsapp_webhook_events** exists for `dedupe_key`. Meta retries any delivery
it does not get a fast 200 for; without a unique key on the event, a retried
quick-reply tap advances a job's stage twice.

**whatsapp_settings** is a single row: the kill switch, the pilot list and the
per-event toggles. A deploy is not an acceptable way to stop messages going
out at nine in the evening.

Revision ID: 0025
Revises: 0024
Create Date: 2026-09-16

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "whatsapp_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(length=512), nullable=False),
        sa.Column("language", sa.String(length=16), nullable=False, server_default="en"),
        sa.Column("meta_template_id", sa.String(length=64), nullable=True),
        # Meta's vocabulary, stored as text rather than as a database enum:
        # they have added values to it since the API shipped (PAUSED, IN_APPEAL)
        # and a status we have never seen must land in the column rather than
        # break the webhook carrying it.
        sa.Column("status", sa.String(length=32), nullable=False, server_default="PENDING"),
        sa.Column("category", sa.String(length=32), nullable=False, server_default="UTILITY"),
        sa.Column(
            "requested_category", sa.String(length=32), nullable=False, server_default="UTILITY"
        ),
        sa.Column("rejected_reason", sa.String(length=255), nullable=True),
        sa.Column("quality_score", sa.String(length=32), nullable=True),
        sa.Column(
            "components", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        # Hash of the code-side definition at submit time. When the registry
        # changes and this does not, the approved template and the sender have
        # drifted — a 132000 at the next hand-off, and the only failure in this
        # integration that Meta's own API cannot reveal.
        sa.Column("registry_hash", sa.String(length=64), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
    )
    op.create_index("ix_whatsapp_templates_name", "whatsapp_templates", ["name"])
    # A template is identified by name *and* language — the same name in Hindi
    # is a different template with its own review and its own status.
    op.create_unique_constraint(
        "uq_whatsapp_templates_name_language", "whatsapp_templates", ["name", "language"]
    )

    op.create_table(
        "whatsapp_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        # Null for anything the scheduler sends. A deadline warning is a
        # message in its own right, not the second delivery of somebody's
        # in-app notification.
        sa.Column(
            "notification_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("notifications.id"),
            nullable=True,
        ),
        sa.Column(
            "user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column(
            "job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("jobs.id"), nullable=True
        ),
        sa.Column("event_key", sa.String(length=64), nullable=True),
        sa.Column("template_name", sa.String(length=512), nullable=True),
        sa.Column("template_language", sa.String(length=16), nullable=True),
        sa.Column("to_phone", sa.String(length=20), nullable=True),
        sa.Column("wamid", sa.String(length=128), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="queued"),
        sa.Column("reason", sa.String(length=255), nullable=True),
        sa.Column("error_code", sa.Integer(), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column(
            "params", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column("button_nonce", sa.String(length=32), nullable=True),
        sa.Column("button_tapped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("button_action", sa.String(length=32), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
    )
    op.create_index("ix_whatsapp_messages_user_id", "whatsapp_messages", ["user_id"])
    op.create_index("ix_whatsapp_messages_job_id", "whatsapp_messages", ["job_id"])
    op.create_index("ix_whatsapp_messages_status", "whatsapp_messages", ["status"])
    op.create_index("ix_whatsapp_messages_event_key", "whatsapp_messages", ["event_key"])
    op.create_index("ix_whatsapp_messages_created_at", "whatsapp_messages", ["created_at"])
    op.create_index("ix_whatsapp_messages_button_nonce", "whatsapp_messages", ["button_nonce"])
    # Every delivery receipt arrives keyed by wamid. Two rows carrying the same
    # one would split a single message's history in half.
    op.create_unique_constraint("uq_whatsapp_messages_wamid", "whatsapp_messages", ["wamid"])

    op.create_table(
        "whatsapp_webhook_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("dedupe_key", sa.String(length=255), nullable=False),
        sa.Column("field", sa.String(length=64), nullable=False),
        sa.Column(
            "payload", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
    )
    # The whole point of the table. The insert is the lock: a retried webhook
    # loses it and is never processed a second time.
    op.create_unique_constraint(
        "uq_whatsapp_webhook_events_dedupe_key", "whatsapp_webhook_events", ["dedupe_key"]
    )
    op.create_index("ix_whatsapp_webhook_events_field", "whatsapp_webhook_events", ["field"])
    op.create_index(
        "ix_whatsapp_webhook_events_received_at", "whatsapp_webhook_events", ["received_at"]
    )

    op.create_table(
        "whatsapp_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        # Off on arrival. A migration that turned messaging on for the whole
        # company the moment it ran would be a deploy nobody could take back.
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "pilot_user_ids",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "event_flags", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("whatsapp_settings")
    op.drop_index("ix_whatsapp_webhook_events_received_at", table_name="whatsapp_webhook_events")
    op.drop_index("ix_whatsapp_webhook_events_field", table_name="whatsapp_webhook_events")
    op.drop_constraint(
        "uq_whatsapp_webhook_events_dedupe_key", "whatsapp_webhook_events", type_="unique"
    )
    op.drop_table("whatsapp_webhook_events")
    op.drop_constraint("uq_whatsapp_messages_wamid", "whatsapp_messages", type_="unique")
    op.drop_index("ix_whatsapp_messages_button_nonce", table_name="whatsapp_messages")
    op.drop_index("ix_whatsapp_messages_created_at", table_name="whatsapp_messages")
    op.drop_index("ix_whatsapp_messages_event_key", table_name="whatsapp_messages")
    op.drop_index("ix_whatsapp_messages_status", table_name="whatsapp_messages")
    op.drop_index("ix_whatsapp_messages_job_id", table_name="whatsapp_messages")
    op.drop_index("ix_whatsapp_messages_user_id", table_name="whatsapp_messages")
    op.drop_table("whatsapp_messages")
    op.drop_constraint(
        "uq_whatsapp_templates_name_language", "whatsapp_templates", type_="unique"
    )
    op.drop_index("ix_whatsapp_templates_name", table_name="whatsapp_templates")
    op.drop_table("whatsapp_templates")
