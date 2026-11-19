import uuid

from pydantic import BaseModel, ConfigDict


class BrandAssetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    pod_id: uuid.UUID
    type: str
    title: str
    file_path: str
    version: int
