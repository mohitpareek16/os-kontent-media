from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.video_type import VideoType


async def enabled_video_type(db: AsyncSession, key: str) -> VideoType:
    video_type = await db.get(VideoType, key)
    if video_type is None or not video_type.enabled:
        raise HTTPException(status_code=422, detail="Video type is unavailable for new work")
    return video_type


async def new_video_type_key(db: AsyncSession, key: str, *, explicit: bool) -> str:
    if not explicit and key == "long_form":
        preferred = await db.get(VideoType, key)
        if preferred is None or not preferred.enabled:
            fallback = await db.scalar(select(VideoType).where(VideoType.enabled.is_(True)).order_by(VideoType.sort_order, VideoType.key).limit(1))
            if fallback is None:
                raise HTTPException(status_code=422, detail="No video types are enabled")
            return fallback.key
    return (await enabled_video_type(db, key)).key


async def qc_points_for(db: AsyncSession, key: str) -> int:
    video_type = await db.get(VideoType, key)
    if video_type is None:
        raise ValueError(f"Unknown stored video type: {key}")
    return video_type.qc_points
