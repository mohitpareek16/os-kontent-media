import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

ASSET_TYPES = ("brief", "sop", "kit", "do_not")


class BrandAsset(Base):
    __tablename__ = "brand_assets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pod_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("pods.id"))
    type: Mapped[str] = mapped_column(Enum(*ASSET_TYPES, name="brand_asset_type"))
    title: Mapped[str] = mapped_column(String(200))
    file_path: Mapped[str] = mapped_column(String(500))
    version: Mapped[int] = mapped_column(Integer, default=1)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
