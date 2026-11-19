import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, Body
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import check_pod_lead, get_current_user, require_pod_member
from app.db.session import get_db
from app.models.brand_asset import BrandAsset
from app.models.brand_link import BrandLink
from app.models.brand_kit_event import BrandKitEvent
from app.models.user import ALL_PODS_ROLES, User, has_role
from app.schemas.brand_asset import BrandAssetRead
from app.schemas.brand_link import BrandKitEventRead, BrandLinkCreate, BrandLinkRead, BrandLinkRemove, BrandLinkUpdate
from app.services.access import is_pod_member
from app.services.storage import save_upload
from app.services.brand_kit import record_brand_change

router = APIRouter(prefix="/pods/{pod_id}/brand-assets", tags=["brand-assets"])

# Validated here rather than at the database, where an unknown value came
# back as a 500 instead of a 422.
AssetType = Literal["brief", "sop", "kit", "do_not"]

# 25 MB. Briefs, SOPs and brand kits are documents; anything bigger is a
# video, which belongs in Frame.io rather than this app's uploads volume.
MAX_UPLOAD_BYTES = 25 * 1024 * 1024


@router.get("", response_model=list[BrandAssetRead])
async def list_brand_assets(
    pod_id: uuid.UUID,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_pod_member),
):
    """Read access is scoped to pod membership, not per-job assignment —
    withholding brand context from the person executing it is how QC
    rounds happen. See docs/04-permissions.md."""
    result = await db.execute(
        select(BrandAsset)
        .where(BrandAsset.pod_id == pod_id)
        .order_by(BrandAsset.type, BrandAsset.title, BrandAsset.version.desc())
        .offset(offset)
        .limit(limit)
    )
    return result.scalars().all()


@router.post("", response_model=BrandAssetRead, status_code=201)
async def upload_brand_asset(
    pod_id: uuid.UUID,
    type: AssetType,
    title: str,
    file: UploadFile,
    note: str | None = Query(default=None, max_length=1000),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Owner or the pod's own TL only.

    This accepted any pod member, which meant an editor could rewrite the
    brief and the do-not list they are judged against. docs/04 gives VEs
    read access to brand context and edit rights to nobody below TL.

    Re-uploading under an existing title bumps `version` instead of leaving
    two rows that look like duplicates.
    """
    await check_pod_lead(db, pod_id, user)

    if file.size is None:
        too_large = len(await file.read(MAX_UPLOAD_BYTES + 1)) > MAX_UPLOAD_BYTES
        await file.seek(0)
    else:
        too_large = file.size > MAX_UPLOAD_BYTES
    if too_large:
        raise HTTPException(
            status_code=413,
            detail=f"File too large — limit is {MAX_UPLOAD_BYTES // (1024 * 1024)}MB",
        )

    title = title.strip()
    if not title or len(title) > 200:
        raise HTTPException(status_code=422, detail="Title must be 1–200 characters")
    latest = await db.execute(
        select(func.max(BrandAsset.version)).where(
            BrandAsset.pod_id == pod_id, BrandAsset.type == type, BrandAsset.title == title
        )
    )
    version = (latest.scalar() or 0) + 1

    file_path = await save_upload(pod_id=pod_id, asset_type=type, upload=file)
    asset = BrandAsset(
        pod_id=pod_id,
        type=type,
        title=title,
        file_path=file_path,
        version=version,
        uploaded_by=user.id,
    )
    db.add(asset)
    await record_brand_change(
        db, pod_id=pod_id, actor_id=user.id,
        action="file_updated" if version > 1 else "file_added", title=title,
        before={"version": version - 1} if version > 1 else None,
        after={"version": version, "filename": file.filename or "file"}, note=note,
    )
    await db.commit()
    await db.refresh(asset)
    return asset


@router.get("/links", response_model=list[BrandLinkRead])
async def list_brand_links(
    pod_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_pod_member),
):
    return (await db.execute(
        select(BrandLink).where(BrandLink.pod_id == pod_id).order_by(BrandLink.created_at.desc(), BrandLink.id)
    )).scalars().all()


@router.post("/links", response_model=BrandLinkRead, status_code=201)
async def add_brand_link(
    pod_id: uuid.UUID,
    payload: BrandLinkCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await check_pod_lead(db, pod_id, user)
    link = BrandLink(pod_id=pod_id, title=payload.title, url=str(payload.url), category=payload.category, created_by=user.id)
    db.add(link)
    await db.flush()
    await record_brand_change(
        db, pod_id=pod_id, actor_id=user.id, action="link_added", title=link.title,
        after={"url": link.url, "category": link.category}, note=payload.note,
    )
    await db.commit()
    await db.refresh(link)
    return link


@router.put("/links/{link_id}", response_model=BrandLinkRead)
async def update_brand_link(
    pod_id: uuid.UUID,
    link_id: uuid.UUID,
    payload: BrandLinkUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await check_pod_lead(db, pod_id, user)
    link = await db.get(BrandLink, link_id)
    if link is None or link.pod_id != pod_id:
        raise HTTPException(status_code=404, detail="Link not found")
    before = {"title": link.title, "url": link.url, "category": link.category}
    link.title, link.url, link.category = payload.title, str(payload.url), payload.category
    after = {"title": link.title, "url": link.url, "category": link.category}
    if before != after or payload.note:
        await record_brand_change(
            db, pod_id=pod_id, actor_id=user.id, action="link_updated", title=link.title,
            before=before, after=after, note=payload.note,
        )
    await db.commit()
    await db.refresh(link)
    return link


@router.delete("/links/{link_id}", status_code=204)
async def remove_brand_link(
    pod_id: uuid.UUID,
    link_id: uuid.UUID,
    payload: BrandLinkRemove | None = Body(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await check_pod_lead(db, pod_id, user)
    link = await db.get(BrandLink, link_id)
    if link is None or link.pod_id != pod_id:
        raise HTTPException(status_code=404, detail="Link not found")
    await record_brand_change(
        db, pod_id=pod_id, actor_id=user.id, action="link_removed", title=link.title,
        before={"url": link.url, "category": link.category}, note=payload.note if payload else None,
    )
    await db.delete(link)
    await db.commit()


@router.get("/history", response_model=list[BrandKitEventRead])
async def brand_kit_history(
    pod_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_pod_member),
):
    rows = (await db.execute(
        select(BrandKitEvent, User.name)
        .join(User, User.id == BrandKitEvent.actor_id)
        .where(BrandKitEvent.pod_id == pod_id)
        .order_by(BrandKitEvent.created_at.desc(), BrandKitEvent.id.desc())
        .offset(offset).limit(limit)
    )).all()
    return [BrandKitEventRead(
        id=event.id, action=event.action, title=event.title, before=event.before,
        after=event.after, note=event.note, actor_name=name, created_at=event.created_at,
    ) for event, name in rows]


@router.get("/{asset_id}/download")
async def download_brand_asset(
    pod_id: uuid.UUID,
    asset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Serve the actual file.

    Upload worked and listing worked, but nothing could ever *open* an
    asset — no download route and no static mount, so the brand kit was a
    list of filenames. Served through the API rather than a static mount so
    pod membership is checked on every read.
    """
    asset = await db.get(BrandAsset, asset_id)
    if asset is None or asset.pod_id != pod_id:
        raise HTTPException(status_code=404, detail="Asset not found")
    if not has_role(user, *ALL_PODS_ROLES) and not await is_pod_member(
        db, pod_id=pod_id, user_id=user.id
    ):
        raise HTTPException(status_code=403, detail="Not a member of this pod")

    root = Path(get_settings().uploads_dir).resolve()
    path = (root / asset.file_path).resolve()
    # Stored paths are app-generated, but resolve and re-check anyway: one
    # bad row must never be able to read outside the uploads directory.
    if root not in path.parents or not path.is_file():
        raise HTTPException(status_code=404, detail="File missing from storage")

    # save_upload() prefixes a uuid to keep filenames unique on disk; hand
    # the human the name they uploaded.
    return FileResponse(path, filename=path.name.split("_", 1)[-1])
