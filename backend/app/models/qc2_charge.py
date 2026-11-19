import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Qc2Charge(Base):
    """One round of QC2 review, priced and spent against a working day.

    QC2 load cannot be derived from open jobs the way editor load is, because
    the budget is *daily*: a reviewer who burns 24 points by lunch is done
    until tomorrow, and clearing a job at noon does not hand the points back.
    An open-jobs query can only ever answer "what is on their plate right
    now", which is a work-in-progress cap — a different rule, and not the one
    the pods agreed (docs/12-qc2-load-model.md §3).

    So the spend is written down. A reviewer's load is one query over this
    table:

        SELECT COALESCE(SUM(points), 0) FROM qc2_charges
        WHERE reviewer_id = :reviewer AND (work_date = :today OR released_at IS NULL)

    Two clauses, each carrying its own half of the rule: everything spent
    today whether or not it is finished, plus anything still open from an
    earlier day, which goes on occupying the budget until it is actually
    reviewed. A row matching both is still one row, so nothing double-counts.
    """

    __tablename__ = "qc2_charges"

    __table_args__ = (
        # The two halves of the load query above.
        Index("ix_qc2_charges_reviewer_work_date", "reviewer_id", "work_date"),
        Index(
            "ix_qc2_charges_reviewer_open",
            "reviewer_id",
            postgresql_where="released_at IS NULL",
        ),
        # One open round per job, enforced by the database rather than by
        # every caller remembering. Two assignment paths racing — the router
        # on a stage move and a lead naming a reviewer by hand — would
        # otherwise bill one review twice, and the second charge would be
        # invisible until somebody wondered why a reviewer was full.
        Index(
            "uq_qc2_charges_open_job",
            "job_id",
            unique=True,
            postgresql_where="released_at IS NULL",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("jobs.id"))
    reviewer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    # The working day this is spent against, in `settings.qc2_day_timezone`
    # (Asia/Kolkata) rather than UTC. Everything else in the app stores UTC
    # and is right to; a budget is different, because it is a promise about a
    # working day — left implicit it would reset at 05:30 IST, before anyone
    # starts.
    work_date: Mapped[date] = mapped_column(Date, index=True)
    # The price, *stamped* — never recomputed from the job's round. A repeat
    # round costs half, but only for the reviewer who already watched the cut:
    # somebody picking up a round-2 job they have never seen pays full price,
    # and the job's `round` column cannot tell those two apart.
    points: Mapped[int] = mapped_column(Integer)
    # Stamped for the same reason the price is. A job's type can be corrected
    # after the fact through `PATCH /jobs/{id}`, and a correction must not
    # rewrite what a reviewer's Tuesday cost them. It is also what the podcast
    # cap and the videos-by-type breakdown are counted from, neither of which
    # should have to join back to `jobs`.
    video_type: Mapped[str] = mapped_column(String(32), ForeignKey("video_types.key"))
    round: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # When this round finished — set the moment the job leaves QC2 in *either*
    # direction, passed to Final or sent back to Revisions, because the
    # reviewer's work for the round is done either way.
    #
    # This is not a refund. The row keeps counting for the rest of the day
    # (`work_date = today`); releasing it only stops it counting *tomorrow*.
    # When the re-cut comes back a new charge is written at the re-review
    # price from the current type catalog, against the day it returns on;
    # completed work never blocks the days between reviews.
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
