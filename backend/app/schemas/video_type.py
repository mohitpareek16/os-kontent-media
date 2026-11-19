from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from typing_extensions import Annotated


VideoTypeKey = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{1,31}$")]
VideoTypeLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80)]


class VideoTypeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    label: str
    qc_points: int
    enabled: bool
    sort_order: int


class VideoTypeCreate(BaseModel):
    key: VideoTypeKey
    label: VideoTypeLabel
    qc_points: int = Field(ge=1, le=24)


class VideoTypeUpdate(BaseModel):
    label: VideoTypeLabel | None = None
    qc_points: int | None = Field(default=None, ge=1, le=24)
    enabled: bool | None = None
