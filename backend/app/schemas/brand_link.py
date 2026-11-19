import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, StringConstraints
from typing_extensions import Annotated

LinkCategory = Literal["website", "assets", "reference", "font", "other"]


class BrandLinkCreate(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    url: HttpUrl = Field(max_length=2048)
    category: LinkCategory
    note: str | None = Field(default=None, max_length=1000)


class BrandLinkUpdate(BrandLinkCreate):
    pass


class BrandLinkRemove(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class BrandLinkRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    pod_id: uuid.UUID
    title: str
    url: str
    category: LinkCategory
    created_at: datetime


class BrandKitEventRead(BaseModel):
    id: uuid.UUID
    action: str
    title: str
    before: dict | None
    after: dict | None
    note: str | None
    actor_name: str
    created_at: datetime
