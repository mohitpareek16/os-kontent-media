"""chat_conversations + chat_messages — Kontent Bot history

Phase 3. Conversations are persisted rather than held in the browser so that
there is a record of what was asked of the ops data, and so an answer that
looks wrong can be traced to the tool calls that produced it (`tool_calls`).

`created_at` uses clock_timestamp() for the same reason job_events does: a
question and its answer are written inside one transaction, and now() would
give them an identical timestamp and leave the thread's order to the planner.

Revision ID: 0007
Revises: 0006

Chained after 0006 (voice_notes) rather than beside it: both were written in
the same session and both first claimed 0006, which Alembic rejects as a
duplicate revision id rather than merging.

Create Date: 2026-08-03

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_conversations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_chat_conversations_user_id", "chat_conversations", ["user_id"])

    op.create_table(
        "chat_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "conversation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("chat_conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.Enum("user", "assistant", name="chat_role"), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "tool_calls",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("model", sa.String(length=120), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("clock_timestamp()")
        ),
    )
    op.create_index("ix_chat_messages_conversation_id", "chat_messages", ["conversation_id"])


def downgrade() -> None:
    op.drop_index("ix_chat_messages_conversation_id", table_name="chat_messages")
    op.drop_table("chat_messages")
    op.drop_index("ix_chat_conversations_user_id", table_name="chat_conversations")
    op.drop_table("chat_conversations")
    sa.Enum(name="chat_role").drop(op.get_bind(), checkfirst=True)
