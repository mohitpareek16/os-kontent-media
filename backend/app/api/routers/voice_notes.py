"""Voice-note CRUD for the Frame.io Chrome extension and admin panel.

Extension-facing routes (no auth):
    POST   /voice-notes/              upload a voice note
    GET    /voice-notes/              list notes for a video_url
    GET    /voice-notes/{id}/audio    stream the audio file
    DELETE /voice-notes/{id}          delete a single note

Admin routes (Owner JWT required):
    GET    /voice-notes/admin/videos          all videos with note counts
    GET    /voice-notes/admin/videos/{b64}/notes  notes for one video
    DELETE /voice-notes/admin/bulk-delete      delete notes by id list
"""

from __future__ import annotations

import base64
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, Form, status
from fastapi.responses import FileResponse
from sqlalchemy import Text, delete, func, or_, select
from sqlalchemy.dialects.postgresql import ARRAY, aggregate_order_by
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import get_current_user, require_role
from app.db.session import get_db
from app.models.user import ADMIN_ROLES
from app.models.voice_note import VoiceNote
from app.schemas.voice_notes import (
    VideoListResponse,
    VideoSummary,
    VoiceNoteCreate,
    VoiceNoteRead,
)
from app.services.video_identity import canonical_video_key

router = APIRouter(prefix="/voice-notes", tags=["voice-notes"])

VOICE_NOTES_SUBDIR = "voice-notes"


def _voice_notes_dir() -> Path:
    settings = get_settings()
    d = Path(settings.uploads_dir) / VOICE_NOTES_SUBDIR
    d.mkdir(parents=True, exist_ok=True)
    return d


# ── Extension routes (no auth) ─────────────────────────────────────────


@router.post("/", response_model=VoiceNoteRead, status_code=status.HTTP_201_CREATED)
async def upload_voice_note(
    audio: UploadFile,
    video_url: str = Form(...),
    video_title: str | None = Form(None),
    timestamp_seconds: float = Form(0.0),
    duration_seconds: float = Form(0.0),
    recorded_by: str | None = Form(None),
    recorded_by_email: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """Accept a multipart upload: the audio file + metadata as form fields."""
    note_id = uuid.uuid4()
    ext = _safe_ext(audio.filename or "note.webm")
    filename = f"{note_id}{ext}"

    dest = _voice_notes_dir() / filename
    content = await audio.read()
    dest.write_bytes(content)

    note = VoiceNote(
        id=note_id,
        video_url=video_url.strip(),
        # Derived here, never taken from the client: an extension that has not
        # been updated still files its notes under the right video, and no
        # caller gets to choose whose notes it lands next to.
        video_key=canonical_video_key(video_url),
        video_title=video_title.strip() if video_title else None,
        timestamp_seconds=timestamp_seconds,
        duration_seconds=duration_seconds,
        audio_filename=f"{VOICE_NOTES_SUBDIR}/{filename}",
        recorded_by=recorded_by.strip() if recorded_by else None,
        recorded_by_email=recorded_by_email.strip() if recorded_by_email else None,
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)
    return _to_read(note)


@router.get("/", response_model=list[VoiceNoteRead])
async def list_notes_for_video(
    video_url: str,
    db: AsyncSession = Depends(get_db),
):
    """Return all voice notes for a given Frame.io video URL, sorted by
    timestamp so the extension can render them in video order.

    Matched on the canonical key rather than the URL string, so a reviewer on
    a `/share/…` link sees the notes left by someone on the `/project/…` link
    for the same asset."""
    result = await db.execute(
        select(VoiceNote)
        .where(VoiceNote.video_key == canonical_video_key(video_url))
        .order_by(VoiceNote.timestamp_seconds)
    )
    return [_to_read(n) for n in result.scalars().all()]


@router.get("/{note_id}/audio")
async def stream_audio(
    note_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Return the audio file for playback."""
    note = await db.get(VoiceNote, note_id)
    if note is None:
        raise HTTPException(status_code=404, detail="Voice note not found")

    settings = get_settings()
    path = Path(settings.uploads_dir) / note.audio_filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio file missing from disk")

    return FileResponse(
        path,
        media_type="audio/webm",
        filename=path.name,
    )


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(
    note_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    note = await db.get(VoiceNote, note_id)
    if note is None:
        raise HTTPException(status_code=404, detail="Voice note not found")

    _remove_file(note.audio_filename)
    await db.delete(note)
    await db.commit()


# ── Admin routes (Owner-only) ──────────────────────────────────────────


def _newest(column) -> object:
    """The value of `column` on the group's most recent note.

    A group spans several URLs for one asset, so `max()` would pick
    alphabetically — showing whichever link sorts highest rather than the one
    someone last reviewed on.
    """
    return func.array_agg(
        aggregate_order_by(column, VoiceNote.created_at.desc()),
        type_=ARRAY(Text),
    )[1]


VIDEO_SORT_FIELDS = {
    "last_note_at": func.max(VoiceNote.created_at),
    "note_count": func.count(),
    "video_title": _newest(VoiceNote.video_title),
    "video_url": _newest(VoiceNote.video_url),
}


@router.get("/admin/videos", response_model=VideoListResponse)
async def admin_list_videos(
    search: str | None = None,
    sort_by: str = "last_note_at",
    sort_dir: str = "desc",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    _user=Depends(require_role(*ADMIN_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """One page of the videos that have voice notes, each with its note count
    and most recent note.

    Search and paging are SQL, not a client-side filter over every video ever
    recorded against: the admin page pulled the entire table and filtered it
    in the browser, which gets slower every day the extension is used. The
    KPI totals are counted over all matching videos so they don't shrink when
    you turn the page."""
    if sort_by not in VIDEO_SORT_FIELDS:
        raise HTTPException(status_code=422, detail=f"Cannot sort by '{sort_by}'")

    clauses: list = []
    if search:
        term = f"%{search.strip()}%"
        clauses.append(or_(VoiceNote.video_url.ilike(term), VoiceNote.video_title.ilike(term)))

    # One row per video, so the totals count videos and notes — a plain
    # COUNT(*) over the notes table would report the wrong thing for both.
    grouped = (
        select(VoiceNote.video_key).where(*clauses).group_by(VoiceNote.video_key).subquery()
    )
    total = (await db.execute(select(func.count()).select_from(grouped))).scalar_one()
    total_notes = (
        await db.execute(select(func.count()).select_from(VoiceNote).where(*clauses))
    ).scalar_one()

    sort_col = VIDEO_SORT_FIELDS[sort_by]
    ordering = sort_col.desc() if sort_dir == "desc" else sort_col.asc()
    result = await db.execute(
        select(
            VoiceNote.video_key,
            _newest(VoiceNote.video_url).label("video_url"),
            _newest(VoiceNote.video_title).label("video_title"),
            func.count().label("note_count"),
            func.max(VoiceNote.created_at).label("last_note_at"),
        )
        .where(*clauses)
        .group_by(VoiceNote.video_key)
        .order_by(ordering, VoiceNote.video_key)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return VideoListResponse(
        items=[
            VideoSummary(
                video_key=row.video_key,
                video_url=row.video_url,
                video_title=row.video_title,
                note_count=row.note_count,
                last_note_at=row.last_note_at,
            )
            for row in result.all()
        ],
        total=total,
        page=page,
        page_size=page_size,
        total_notes=total_notes,
    )


@router.get("/admin/videos/{video_key_b64}/notes", response_model=list[VoiceNoteRead])
async def admin_list_video_notes(
    video_key_b64: str,
    _user=Depends(require_role(*ADMIN_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """Return all notes for a specific video. The key is base64-encoded in
    the path so its slashes and colons don't break routing."""
    try:
        video_key = base64.urlsafe_b64decode(_pad_b64(video_key_b64)).decode()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64-encoded key")

    result = await db.execute(
        select(VoiceNote)
        .where(VoiceNote.video_key == video_key)
        .order_by(VoiceNote.timestamp_seconds)
    )
    return [_to_read(n) for n in result.scalars().all()]


@router.delete("/admin/bulk-delete", status_code=status.HTTP_204_NO_CONTENT)
async def admin_bulk_delete(
    note_ids: list[str],
    _user=Depends(require_role(*ADMIN_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple voice notes by ID (admin panel bulk action)."""
    parsed = []
    for nid in note_ids:
        try:
            parsed.append(uuid.UUID(nid))
        except ValueError:
            continue

    if not parsed:
        return

    # Fetch the rows so we can remove their files too.
    result = await db.execute(
        select(VoiceNote).where(VoiceNote.id.in_(parsed))
    )
    notes = result.scalars().all()
    for note in notes:
        _remove_file(note.audio_filename)

    await db.execute(delete(VoiceNote).where(VoiceNote.id.in_(parsed)))
    await db.commit()


# ── Helpers ─────────────────────────────────────────────────────────────


def _pad_b64(value: str) -> str:
    """Restore the `=` padding the browser's encoder strips.

    The frontend builds these with `btoa(...).replace(/=+$/, "")`, and Python
    rejects unpadded base64 — so this only ever worked when the key's length
    happened to be a multiple of 3.
    """
    return value + "=" * (-len(value) % 4)


def _safe_ext(filename: str) -> str:
    _, ext = os.path.splitext(filename)
    return ext if ext in {".webm", ".ogg", ".mp3", ".wav", ".m4a"} else ".webm"


def _remove_file(audio_filename: str) -> None:
    settings = get_settings()
    path = Path(settings.uploads_dir) / audio_filename
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass  # best-effort — the DB row is the source of truth


def _to_read(note: VoiceNote) -> VoiceNoteRead:
    return VoiceNoteRead(
        id=str(note.id),
        video_url=note.video_url,
        video_key=note.video_key,
        video_title=note.video_title,
        timestamp_seconds=note.timestamp_seconds,
        duration_seconds=note.duration_seconds,
        audio_filename=note.audio_filename,
        recorded_by=note.recorded_by,
        recorded_by_email=note.recorded_by_email,
        created_at=note.created_at,
        expires_at=note.expires_at,
    )
