import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

STAGES = ("intake", "assigned", "editing", "qc1", "qc2", "revisions", "final", "delivered")
# What kind of video this is. Not a size or a difficulty — those were what
# `weight` tried to be and nobody kept it honest — but the format, which the
# brief already says and everyone already argues in.

WEIGHTS = ("light", "standard", "heavy")
# The desks that can send a cut back for changes — mirrors
# `services/stage_machine.py::SEND_BACK_ELIGIBLE`, which is the rule; this is
# the column's domain.
SEND_BACK_STAGES = ("qc1", "qc2", "final")


class Job(Base):
    __tablename__ = "jobs"

    __table_args__ = (
        # A delivered job carries the date it was delivered, always. Counting
        # by stage and counting by date are both legitimate — "how many has
        # this client delivered" vs "how many in July" — and they only agree
        # if every delivered row has a date. Without this the two answers
        # drift apart silently and the bot quotes whichever it happened to
        # ask for (migration 0009).
        CheckConstraint(
            "stage <> 'delivered' OR delivered_at IS NOT NULL",
            name="ck_jobs_delivered_at_set_when_delivered",
        ),
        # A scrapped job carries who killed it and why, always. The three
        # columns are one fact written together — a scrapped row with no
        # reason is precisely the row nobody can explain later, which is the
        # only reason the feature exists (migration 0012).
        CheckConstraint(
            "(scrapped_at IS NULL) = (scrapped_by_id IS NULL) "
            "AND (scrapped_at IS NULL) = (scrap_reason IS NULL)",
            name="ck_jobs_scrap_fields_move_together",
        ),
        # A QC1 flag carries who raised it and why, always — same shape and
        # the same reason as the scrap columns above. A flag against a
        # colleague with no reason attached is an accusation nobody can
        # answer (migration 0013).
        CheckConstraint(
            "(qc1_flagged_at IS NULL) = (qc1_flagged_by_id IS NULL) "
            "AND (qc1_flagged_at IS NULL) = (qc1_flag_reason IS NULL)",
            name="ck_jobs_qc1_flag_fields_move_together",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(300))
    pod_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("pods.id"))
    # Which of the client's channels this video is for — "Dhan HQ" against
    # "AAD". Nullable, and null on every job that predates the table: a
    # channel is a thing somebody chooses, and a guessed one is indistinguish-
    # able on screen from a chosen one. Must belong to this job's pod, which
    # `services/access.py::ensure_channel_in_pod` is what enforces — a foreign
    # key alone would happily accept another client's channel.
    channel_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("channels.id"), nullable=True
    )
    stage: Mapped[str] = mapped_column(Enum(*STAGES, name="job_stage"), default="intake")
    # What kind of video this is — the thing a TL actually knows when the
    # brief lands, and the thing an editor wants to see on a row. It replaced
    # `weight` on every screen.
    video_type: Mapped[str] = mapped_column(
        String(32), ForeignKey("video_types.key"), default="long_form", server_default="long_form"
    )
    # Still here, still what QC routing and editor load are counted in
    # (`services/routing.py::WEIGHT_POINTS`), and no longer asked for or shown
    # anywhere: every job takes the default. Kept rather than dropped because
    # the routing maths is real and a column of NULLs would break it — see
    # migration 0018 for the whole reasoning.
    weight: Mapped[str] = mapped_column(Enum(*WEIGHTS, name="job_weight"), default="standard")
    assigned_editor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    qc2_reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    # Which desk sent this job back, so the fixed cut returns to that same
    # desk instead of walking the whole line again. A QC2 send-back used to
    # come back through QC1 — the TL re-reviewing changes they never asked
    # for, while the reviewer who actually wrote the change list waited behind
    # them. Set when the job moves into revisions, cleared when the editor
    # re-submits (`allowed_next_stages` reads it in the meantime).
    sent_back_from: Mapped[str | None] = mapped_column(
        Enum(*SEND_BACK_STAGES, name="job_send_back_stage"), nullable=True
    )
    # "This one cannot wait for somebody to free up." It buys exactly one
    # thing and it is worth being precise about what: when no reviewer has
    # room for a job, a rush job may be pushed onto the least-loaded of them at
    # up to 125% of their day (`routing.RUSH_OVERFLOW`), instead of holding in
    # the unrouted pile until somebody clears space.
    #
    # It is not a priority sort, it does not jump a queue, and it does not
    # change what the review costs. A flag that quietly did any of those would
    # be on every job inside a month.
    rush: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    frame_link: Mapped[str | None] = mapped_column(String(500), nullable=True)
    round: Mapped[int] = mapped_column(Integer, default=0)
    # **The team deadline** — the date everybody sees and works to. Every
    # row, queue, overdue count, row tint and sort in the app reads this one,
    # and the hand-off gate requires it (`services/stage_machine.py`).
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    # **The client deadline** — what the client was actually promised, which
    # is usually a few days later than the date the pod works to. Two columns
    # rather than one because they are two different facts: a TL who wants a
    # revision round to have somewhere to go sets the team deadline earlier,
    # and the promise has to survive that or nobody can say how much room is
    # left.
    #
    # Visible to the Owner, and to the TL of this job's own pod. To nobody
    # else — not in a payload, not in the activity feed, not through the bot.
    # The column cannot enforce that; `api/routers/jobs.py::visible_client_
    # deadline` is the one place that decides, and docs/04-permissions.md is
    # the rule it implements.
    #
    # Null on every job that predates it and on every job nobody has told the
    # promise to. Deliberately not backfilled from `deadline` — see migration
    # 0022 for why a guessed promise is worse than none.
    client_deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Scrapped: the client or the pod killed the project before delivery.
    # Deliberately *not* a stage — the job keeps the stage it died at, so
    # "dropped at QC2 on round 3" stays readable, and it can be restored.
    # `scrapped_at IS NULL` is the "this job still counts" predicate every
    # list, count and capacity query filters on — see
    # `services/access.py::not_scrapped`.
    scrapped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scrapped_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    scrap_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # QC1 was never really done: the TL passed the cut straight through to
    # QC2 without reviewing it, and the QC2 reviewer — the first person who
    # can tell — says so on the record.
    #
    # Stored on the job rather than left in the event log alone, for the same
    # reason the scrap reason is: every list, row tint and dashboard count
    # that has to say "this one was flagged" would otherwise need a subquery
    # over `job_events` per row. The log still holds the full story
    # (`qc1_flag_raised` / `qc1_flag_cleared`); these columns answer the
    # present-tense question "is this flagged right now".
    #
    # `qc1_flag_tl_id` is *who cleared QC1*, snapshotted at flag time — not
    # re-derived from the pod's current TL, which changes, and not the same
    # person as `qc1_flagged_by_id`, who is the reviewer that raised it.
    qc1_flagged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    qc1_flagged_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    qc1_flag_tl_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    qc1_flag_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_sheet_ok: Mapped[bool] = mapped_column(Boolean, default=False)
    ops_tracker_ok: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
