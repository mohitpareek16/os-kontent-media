"""Who switched whose account off

The off-switch is leaving the admin tier. HR onboards people and could not
offboard them, so every leaver went through the one Owner account — and the
fix is `POST /users/{id}/deactivate`, open to HR for exactly the roles HR may
already create (`schemas/user.py::CREATABLE_ROLES`).

That makes `users.is_active` a boolean more than one person can flip, and a
boolean remembers nothing about how it got that way. This table is the record:
who did it, to whom, when, and optionally why.

Two actions only, `deactivated` and `reactivated`. This is not a general audit
log for every field on an account — a rename does not need a row. Locking
somebody out of the company's tooling does, because that is the change people
come back and ask about.

Revision ID: 0023
Revises: 0022
Create Date: 2026-09-16

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None

USER_EVENT_ACTION = postgresql.ENUM(
    "deactivated", "reactivated", name="user_event_action", create_type=False
)


def upgrade() -> None:
    USER_EVENT_ACTION.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "user_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "target_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        # Nullable: the actor may themselves be deactivated later, and their
        # own record of what they did has to outlive that.
        sa.Column(
            "actor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column("action", USER_EVENT_ACTION, nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
    )
    # The only read this table has: the latest row for one person, once per
    # row of the directory.
    op.create_index(
        "ix_user_events_target_id_created_at",
        "user_events",
        ["target_id", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    # Nothing reads `is_active` through this table, so dropping it loses the
    # history and changes no account's state.
    op.drop_index("ix_user_events_target_id_created_at", table_name="user_events")
    op.drop_table("user_events")
    USER_EVENT_ACTION.drop(op.get_bind(), checkfirst=True)
