import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class JobEvent(Base):
    """Append-only. Backbone for analytics, the activity feed, and the
    future AI chatbot (Phase 3) — see docs/08-roadmap.md."""

    __tablename__ = "job_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("jobs.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(64))
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    # clock_timestamp(), not now(): now() is the transaction start time, so
    # two events written by the same request would tie and the feed could
    # show them out of order — see migration 0003.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("clock_timestamp()")
    )
