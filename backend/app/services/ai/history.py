"""Conversation storage and the spend cap.

Kept out of the router so the rule about how much history the model sees —
and how much a person may ask in a day — is defined once and testable
without HTTP, per docs/07-backend-rules.md.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import ChatConversation, ChatMessage
from app.models.user import User

# How many prior turns go back to the model. Long threads are mostly
# pleasantries; the numbers get looked up fresh each time anyway.
HISTORY_TURNS = 20
TITLE_LENGTH = 80


async def get_owned_conversation(
    db: AsyncSession, *, conversation_id: uuid.UUID, user: User
) -> ChatConversation:
    """A conversation belongs to exactly one person and is never shared —
    not even with the Owner. Anything else is a 404, not a 403: whether a
    conversation id exists is itself not the caller's business."""
    conversation = await db.get(ChatConversation, conversation_id)
    if conversation is None or conversation.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return conversation


async def start_conversation(db: AsyncSession, *, user: User, first_message: str) -> ChatConversation:
    title = first_message.strip().replace("\n", " ")[:TITLE_LENGTH] or "New conversation"
    conversation = ChatConversation(user_id=user.id, title=title)
    db.add(conversation)
    await db.flush()
    return conversation


async def load_history(db: AsyncSession, *, conversation_id: uuid.UUID) -> list[dict]:
    """Prior user/assistant turns, oldest first.

    Tool traffic from older turns is deliberately not replayed: it would grow
    the context on every message with numbers the model can look up again,
    and stale figures presented as current are worse than a second query.
    """
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.conversation_id == conversation_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(HISTORY_TURNS)
    )
    rows = list(result.scalars().all())
    rows.reverse()
    return [{"role": row.role, "content": row.content} for row in rows]


async def messages_used_today(db: AsyncSession, *, user: User) -> int:
    since = datetime.now(timezone.utc) - timedelta(days=1)
    result = await db.execute(
        select(func.count(ChatMessage.id))
        .join(ChatConversation, ChatConversation.id == ChatMessage.conversation_id)
        .where(
            ChatConversation.user_id == user.id,
            ChatMessage.role == "user",
            ChatMessage.created_at >= since,
        )
    )
    return result.scalar_one()


async def enforce_daily_cap(db: AsyncSession, *, user: User, cap: int) -> None:
    if cap <= 0:
        return
    used = await messages_used_today(db, user=user)
    if used >= cap:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Daily limit of {cap} questions reached. This resets on a rolling "
                "24-hour basis."
            ),
        )


async def record_exchange(
    db: AsyncSession,
    *,
    conversation: ChatConversation,
    question: str,
    answer: str,
    tool_calls: list[dict],
    charts: list[dict] | None = None,
    model: str | None,
    usage: dict,
) -> ChatMessage:
    """Question and answer written together, so a thread can never end up
    holding a question with no reply or a reply with no question."""
    db.add(ChatMessage(conversation_id=conversation.id, role="user", content=question))
    assistant = ChatMessage(
        conversation_id=conversation.id,
        role="assistant",
        content=answer,
        tool_calls=tool_calls,
        charts=charts or [],
        model=model,
        prompt_tokens=usage.get("prompt_tokens"),
        completion_tokens=usage.get("completion_tokens"),
    )
    db.add(assistant)
    conversation.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return assistant
