import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

POD_ROLES = ("tl", "qc", "ve")


class PodMember(Base):
    __tablename__ = "pod_members"

    pod_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("pods.id"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    pod_role: Mapped[str] = mapped_column(Enum(*POD_ROLES, name="pod_role"))
    certified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
