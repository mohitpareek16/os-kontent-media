import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import DateTime, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class VoiceNote(Base):
    __tablename__ = "voice_notes"

    id: Mapped[uuid.UUID] = mapped_column(
        default=uuid.uuid4, primary_key=True
    )
    # The full Frame.io URL the note was recorded on — kept verbatim so the
    # admin panel has something real to link to.
    video_url: Mapped[str] = mapped_column(Text, index=True)
    video_title: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # What actually identifies the video, derived from video_url by
    # services/video_identity.py. Frame.io gives the same asset a `/project/…`
    # URL when you are signed in and a `/share/…` one when you are not, so
    # grouping on the raw URL showed one cut as two videos and hid each
    # reviewer's notes from the other.
    video_key: Mapped[str] = mapped_column(Text, index=True)

    timestamp_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    duration_seconds: Mapped[float] = mapped_column(Float, default=0.0)

    # Path relative to UPLOADS_DIR, e.g. "voice-notes/<uuid>.webm"
    audio_filename: Mapped[str] = mapped_column(String(500))

    # Free-text — whoever recorded the note types their name and email into
    # the extension popup once, no login required. Nothing here is verified;
    # it identifies the reviewer to other humans, not to the system.
    recorded_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    recorded_by_email: Mapped[str | None] = mapped_column(String(320), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc) + timedelta(days=60),
    )
