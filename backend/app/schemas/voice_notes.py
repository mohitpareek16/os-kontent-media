from datetime import datetime

from pydantic import BaseModel

from app.schemas.common import Page


class VoiceNoteCreate(BaseModel):
    video_url: str
    video_title: str | None = None
    timestamp_seconds: float = 0.0
    duration_seconds: float = 0.0
    recorded_by: str | None = None
    recorded_by_email: str | None = None


class VoiceNoteRead(BaseModel):
    id: str
    video_url: str
    video_key: str
    video_title: str | None
    timestamp_seconds: float
    duration_seconds: float
    audio_filename: str
    recorded_by: str | None
    recorded_by_email: str | None
    created_at: datetime
    expires_at: datetime

    model_config = {"from_attributes": True}


class VideoSummary(BaseModel):
    """One row per unique video in the admin listing.

    Identity is `video_key`, not `video_url` — Frame.io gives the same asset a
    different URL depending on whether the reviewer was signed in, and grouping
    on the URL listed one cut twice. `video_url`/`video_title` are taken from
    the most recent note so the Open button still points at a real link."""

    video_key: str
    video_url: str
    video_title: str | None
    note_count: int
    last_note_at: datetime | None


class VideoListResponse(Page[VideoSummary]):
    """One page of the admin video listing, plus the totals the KPI cards
    above it show — computed over every matching video, not over the page,
    so "total voice notes" doesn't change when you turn to page 2."""

    total_notes: int
