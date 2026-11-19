from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_role
from app.db.session import get_db
from app.models.user import User
from app.models.video_type import VideoType
from app.schemas.video_type import VideoTypeCreate, VideoTypeRead, VideoTypeUpdate

router = APIRouter(prefix="/video-types", tags=["video-types"])


@router.get("", response_model=list[VideoTypeRead])
async def list_video_types(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return (await db.execute(select(VideoType).order_by(VideoType.sort_order, VideoType.key))).scalars().all()


@router.post("", response_model=VideoTypeRead, status_code=201)
async def add_video_type(
    payload: VideoTypeCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("owner")),
):
    if await db.get(VideoType, payload.key):
        raise HTTPException(status_code=409, detail="Video type key already exists")
    if await db.scalar(select(VideoType.key).where(func.lower(VideoType.label) == payload.label.lower())):
        raise HTTPException(status_code=409, detail="Video type name already exists")
    last_order = await db.scalar(select(func.max(VideoType.sort_order))) or 0
    video_type = VideoType(**payload.model_dump(), sort_order=last_order + 1)
    db.add(video_type)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Video type key or name already exists") from exc
    await db.refresh(video_type)
    return video_type


@router.patch("/{key}", response_model=VideoTypeRead)
async def update_video_type(
    key: str,
    payload: VideoTypeUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("owner")),
):
    video_type = await db.get(VideoType, key)
    if video_type is None:
        raise HTTPException(status_code=404, detail="Video type not found")
    changes = payload.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise HTTPException(status_code=422, detail="Fields cannot be null")
    if "label" in changes and changes["label"].lower() != video_type.label.lower():
        duplicate = await db.scalar(select(VideoType.key).where(func.lower(VideoType.label) == changes["label"].lower()))
        if duplicate:
            raise HTTPException(status_code=409, detail="Video type name already exists")
    if changes.get("enabled") is False and video_type.enabled:
        await db.execute(select(VideoType.key).order_by(VideoType.key).with_for_update())
        await db.refresh(video_type)
        remaining = await db.scalar(select(func.count()).select_from(VideoType).where(VideoType.enabled.is_(True)))
        if remaining <= 1:
            raise HTTPException(status_code=400, detail="At least one video type must stay enabled")
    for field, value in changes.items():
        setattr(video_type, field, value)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Video type name already exists") from exc
    await db.refresh(video_type)
    return video_type
