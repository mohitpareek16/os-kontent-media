"""users.is_active — deactivate a leaver without deleting them

There was no way to switch an account off. Deleting the row isn't an option:
every job, event and notification that person ever touched references their
id. `available` already exists but means something different — "don't route
QC work to me today" — so overloading it would silently un-deactivate anyone
who toggled themselves back on.

Login and every authenticated request reject inactive users.

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-03

"""
import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )


def downgrade() -> None:
    op.drop_column("users", "is_active")
