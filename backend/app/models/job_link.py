import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Two kinds, and the difference is who the link is *for* — which is also who
# may add one.
#
#   raw   — the source material the client sent. The TL puts these on the job;
#           an editor opens them to start work.
#   video — the cut. The editor puts these on the job; QC and the TL open them
#           to review it.
#
# One column served both before this table existed (`jobs.frame_link`), and
# the confusion was not theoretical: the editor's "paste your Frame.io link"
# box opened pre-filled with the client's Drive folder, because that is what
# the single column happened to be holding.
LINK_KINDS = ("raw", "video")


class JobLink(Base):
    """One titled link on a job. Several per job, of either kind.

    A video shoot arrives as more than one folder — A-roll here, B-roll there,
    a graphics pack, a voiceover redo the next day — and an edit leaves as more
    than one cut. Both used to be a single 500-character column, so the second
    link of either kind was pasted into a comment and lost."""

    __tablename__ = "job_links"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Cascades: a link is part of the job, not a record about it. Nothing reads
    # these once the job is gone, unlike `job_events`, which is the history.
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(Enum(*LINK_KINDS, name="job_link_kind"))
    # What this one is — "A-roll", "Graphics pack", "Round 2 cut". Optional,
    # because a job with one link of each kind needs no labels, and demanding
    # one is how everything ends up called "link".
    title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    url: Mapped[str] = mapped_column(String(1000))
    added_by_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
