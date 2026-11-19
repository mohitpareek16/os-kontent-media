import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class BrandLink(Base):
    __tablename__ = "brand_links"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pod_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("pods.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    url: Mapped[str] = mapped_column(String(2048))
    category: Mapped[str] = mapped_column(String(32))
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
