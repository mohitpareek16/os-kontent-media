import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

POD_STATUSES = ("active", "paused", "churned")


class Pod(Base):
    """A TL-owned workspace for one client — client and pod are the same
    entity, not a client-owned parent with pods under it.
    See docs/01-overview.md."""

    __tablename__ = "pods"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120))
    tl_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(Enum(*POD_STATUSES, name="pod_status"), default="active")
    billing_currency: Mapped[str] = mapped_column(String(8), default="INR")
    retainer_volume: Mapped[int | None] = mapped_column(Integer, nullable=True)
    onboarded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
