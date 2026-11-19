import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ChatAsk(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    # Omit to start a new conversation; the reply's `meta` event carries the
    # id that was created.
    conversation_id: uuid.UUID | None = None


class ChatMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: str
    content: str
    tool_calls: list = []
    # Chart specs drawn by this answer, rendered by the frontend. Shape is
    # fixed by services/ai/tools/charts.py, which is where it is validated;
    # re-declaring it here would be two schemas for one contract.
    charts: list = []
    model: str | None = None
    created_at: datetime


class ChatConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime


class ChatConversationDetail(ChatConversationRead):
    messages: list[ChatMessageRead]


class ChatConversationListResponse(BaseModel):
    items: list[ChatConversationRead]
    total: int
    page: int
    page_size: int


class ChatStatusRead(BaseModel):
    """What the UI needs to render an honest state before a key exists —
    a chat box that silently fails is worse than one that says why."""

    enabled: bool
    model: str
    daily_cap: int
    used_today: int
    reason: str | None = None
