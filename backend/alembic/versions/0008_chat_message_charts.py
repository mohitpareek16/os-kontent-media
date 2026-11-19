"""chat_messages.charts — the graphs an answer drew

Kontent Bot can now render charts, and a chart is a claim about numbers in
exactly the way a quoted figure is. Storing the spec next to `tool_calls`
keeps the pair complete: the tool trace says where the numbers came from, the
chart says what was drawn from them, and reopening a thread shows the graph
that was actually shown rather than one redrawn from data that has moved on.

Backfills to '[]' so every message written before this exists reads as
"drew nothing", which is true.

Revision ID: 0008
Revises: 0007
Create Date: 2026-08-04

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_messages",
        sa.Column(
            "charts",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("chat_messages", "charts")
