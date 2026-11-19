"""Notifications that arrive when nobody is looking at the app

The chime works and reaches nobody. It is raised by a 15-second poll in an
open tab, and Chrome throttles background timers to about once a minute —
harder once the window is minimised. So the alert fires reliably in the one
situation it is not needed (you are looking at the screen) and unreliably in
the one it exists for (you are in Premiere and the app is behind it).

Polling faster does not fix a throttled timer. The alert has to come from
outside the page, which is Web Push: the server posts an encrypted payload to
the browser's push service, the service wakes the service worker, and the OS
shows the notification whether or not a tab is open.

One row per browser rather than per person — a desktop and a laptop are two
subscriptions and both should ring. `endpoint` is the push service's URL for
that browser, which is stable across re-registration, so it is the natural
key: unique, and re-subscribing updates the row instead of growing a pile of
dead ones.

Rows here are deleted rather than deactivated, unlike `users`. A revoked
subscription answers 410 forever and has no history worth keeping.

Revision ID: 0024
Revises: 0023
Create Date: 2026-09-16

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        # Text rather than a bounded String: endpoints are long and the push
        # services have changed their shape before. A truncated endpoint is a
        # subscription that fails silently for good.
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.String(length=255), nullable=False),
        sa.Column("auth", sa.String(length=255), nullable=False),
        sa.Column("user_agent", sa.String(length=400), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_push_subscriptions_user_id", "push_subscriptions", ["user_id"])
    # Unique so a browser re-registering updates its own row. Without it every
    # page load would add another copy and every notification would arrive as
    # many times as the tab had been opened.
    op.create_unique_constraint(
        "uq_push_subscriptions_endpoint", "push_subscriptions", ["endpoint"]
    )


def downgrade() -> None:
    # Dropping this unsubscribes everybody. The browsers keep their own
    # subscriptions until the service worker is unregistered, but nothing
    # will push to them — which is the state the app was in before.
    op.drop_constraint("uq_push_subscriptions_endpoint", "push_subscriptions", type_="unique")
    op.drop_index("ix_push_subscriptions_user_id", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
