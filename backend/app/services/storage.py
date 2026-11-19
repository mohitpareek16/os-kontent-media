import uuid
from pathlib import Path

from fastapi import UploadFile

from app.core.config import get_settings


async def save_upload(*, pod_id: uuid.UUID, asset_type: str, upload: UploadFile) -> str:
    """Plain disk storage for v1. Every caller stores/reads paths as
    'pod_id/asset_type/filename' relative to UPLOADS_DIR — never a full
    filesystem path outside this module, so swapping to S3/MinIO/R2 later
    is a change to this one file. See docs/02-architecture.md."""
    settings = get_settings()
    relative_dir = Path(str(pod_id)) / asset_type
    target_dir = Path(settings.uploads_dir) / relative_dir
    target_dir.mkdir(parents=True, exist_ok=True)

    original_name = (upload.filename or "file").replace("\\", "/").split("/")[-1] or "file"
    filename = f"{uuid.uuid4().hex}_{original_name}"
    target_path = target_dir / filename
    contents = await upload.read()
    target_path.write_bytes(contents)

    return str(relative_dir / filename)
