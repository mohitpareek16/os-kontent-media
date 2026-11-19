from sqlalchemy import Boolean, CheckConstraint, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class VideoType(Base):
    __tablename__ = "video_types"
    __table_args__ = (CheckConstraint("qc_points BETWEEN 1 AND 24", name="ck_video_types_qc_points"),)

    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    label: Mapped[str] = mapped_column(String(80), unique=True)
    qc_points: Mapped[int] = mapped_column(Integer)
    enabled: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    sort_order: Mapped[int] = mapped_column(Integer, server_default=text("0"))
