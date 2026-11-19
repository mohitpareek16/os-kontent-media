import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import Page

# Validated here, not at the database — an unknown value used to reach
# Postgres' enum and come back as a 500 instead of a 422.
PodStatus = Literal["active", "paused", "churned"]
PodRole = Literal["tl", "qc", "ve"]


class PodCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    tl_id: uuid.UUID
    # Was missing entirely: a pod could only ever be created "active", and
    # nothing could change it afterwards, so a paused or churned client still
    # rendered as active forever.
    status: PodStatus = "active"
    billing_currency: str = "INR"
    retainer_volume: int | None = Field(default=None, ge=0)


class PodUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    status: PodStatus | None = None
    billing_currency: str | None = None
    retainer_volume: int | None = Field(default=None, ge=0)
    # Handing the pod to a different TL — Owner-only in the route, see
    # docs/04-permissions.md.
    tl_id: uuid.UUID | None = None


class PodRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    tl_id: uuid.UUID
    status: str
    billing_currency: str
    retainer_volume: int | None


class PodStatusCounts(BaseModel):
    """What the status tabs on the pods page count. Scoped and searched the
    same way the list is, so the tab numbers and the cards under them agree."""

    all: int
    active: int
    paused: int
    churned: int


class PodListResponse(Page[PodRead]):
    counts: PodStatusCounts


class PodMemberCreate(BaseModel):
    user_id: uuid.UUID
    pod_role: PodRole


class PodMemberRead(BaseModel):
    user_id: uuid.UUID
    name: str
    email: str
    role: str
    pod_role: str
    certified_at: datetime | None
