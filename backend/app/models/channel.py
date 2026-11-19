import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Channel(Base):
    """One destination inside a client pod — "Dhan HQ", "AAD", "lwdhan".

    A pod is one client; a channel is one of the places that client actually
    publishes. Everything about the work is the same — same TL, same editors,
    same QC — so a channel is deliberately *not* a second pod: splitting Dhan
    into three pods would split its roster, its capacity and its first-pass
    rate three ways to answer a question nobody asked, and "how is Dhan doing"
    would stop having an answer.

    Nullable on the job, and left null on every job that existed before this
    table did. A channel nobody has chosen yet is an honest blank; guessing one
    from a title would have written thousands of rows of fiction that read
    exactly like somebody's deliberate choice.
    """

    __tablename__ = "channels"

    __table_args__ = (
        # Two "Dhan HQ"s in one pod is a typo, not a second channel — and it
        # makes the dropdown unusable at exactly the moment somebody is trying
        # to file work correctly. Scoped to the pod: two clients may each have
        # a "Shorts" and they have nothing to do with each other.
        UniqueConstraint("pod_id", "name", name="uq_channels_pod_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pod_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pods.id"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    # Retired, not deleted. A channel the client stopped publishing to still
    # names the work that went to it — deleting the row would either orphan
    # those jobs or, worse, quietly re-file them as "no channel". Archived
    # channels stay on old jobs and drop out of the pickers.
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
