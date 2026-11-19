import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ChannelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ChannelUpdate(BaseModel):
    """Renaming a channel, or retiring one.

    `archived` rather than a DELETE route: a channel that named real work has
    to keep naming it, so retiring one takes it out of the pickers and leaves
    it on the jobs already filed under it."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    archived: bool | None = None


class ChannelRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    pod_id: uuid.UUID
    name: str
    # Which client it belongs to, by name. Left None by the per-pod list — the
    # caller named the pod — and filled in by the cross-pod one, where "Shorts"
    # on its own is not an answer: two clients may each have one, and a picker
    # offering both has to say whose is whose.
    pod_name: str | None = None
    archived_at: datetime | None
    # How many live jobs are filed under it. The number a TL needs before
    # retiring one, and the reason the list endpoint counts rather than
    # leaving the screen to fetch jobs per channel.
    job_count: int = 0
