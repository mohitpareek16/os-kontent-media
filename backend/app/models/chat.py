"""Kontent Bot conversation history.

Persisted rather than kept in the browser for two reasons that outlive the
convenience of a reload-proof thread:

- **Audit.** Who asked what of the ops data is worth being able to answer,
  and there is no other record of it.
- **Debugging.** `tool_calls` stores which lookups produced an answer. When
  someone says "the bot told me Dhan delivered 12 last month and that's
  wrong", the trace is the only way to tell a bad query from a bad summary.

Same instinct as `JobEvent`: write what happened, don't reconstruct it later.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

CHAT_ROLES = ("user", "assistant")


class ChatConversation(Base):
    __tablename__ = "chat_conversations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(Enum(*CHAT_ROLES, name="chat_role"))
    content: Mapped[str] = mapped_column(Text)
    # Which tools ran and whether each was refused — the answer's receipt.
    tool_calls: Mapped[list] = mapped_column(JSONB, default=list)
    # Chart specs the answer drew. Stored rather than regenerated because a
    # chart is a claim about numbers: reopening a thread must show the graph
    # that was actually shown, not one redrawn from data that has since moved.
    charts: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # clock_timestamp(), same as job_events: a question and its answer are
    # written in one transaction and would otherwise tie on now(), leaving
    # the thread's order down to whatever the planner felt like.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
