"""QC2 routing stops counting jobs and starts counting a day's work

Migration 0018 moved every screen from `weight` to `video_type` and said, in
its own docstring, what it was leaving behind: "Every job now takes the default
(`standard`), which makes the load maths a job count in disguise until the
score is rebuilt on something real. That is a deliberate holding position."

This is that rebuild — the schema half of docs/12-qc2-load-model.md.

Four things arrive together because none of them is useful alone:

1. **`users.employment_type`** — full_time or part_time. The points budget is
   derived from it (24 / 12) and never stored per account, so changing what a
   part-time day is worth changes it for everybody at once.

2. **`qc2_charges`** — the ledger. A QC2 budget is *daily*: points are spent
   against a date and finishing a job does not hand them back the same day.
   That cannot be derived from open jobs the way editor load is — a job
   cleared at noon must still count against the afternoon — so the spend is
   written down. Three indexes, each one a query the router actually runs: the
   day's sum, the still-open sum, and a partial unique on `job_id` that keeps
   a job to one open round so two assignment paths racing cannot bill one
   review twice.

3. **`jobs.rush`** — the one input the model had no source for. A budget that
   can never be exceeded means an urgent job waits behind a full queue with
   nothing anybody can do about it, so §6 of the design has always had an
   overflow branch; it just had no flag to fire on. This is that flag, and it
   buys only the overflow — not a priority sort, not a place in a queue.

4. **A backfill**, which is the part that would hurt to skip. Every job sitting
   at QC2 or in Revisions with a reviewer on it is real work somebody is
   holding right now. Without an opening charge those reviewers start the day
   looking empty and the router hands them a fresh podcast on top of the one
   they are already watching.

Charges are dated in Asia/Kolkata rather than UTC, here and in the app. A
budget is a promise about a *working day*; left in UTC it would roll over at
05:30 IST — before anyone starts, so it would mostly have worked, which is the
worst kind of accident to leave in a schedule.

`weight` survives this migration too. It is what *editor* load is counted in
(`WEIGHT_POINTS`), which is a different question with different answers — a
podcast is quick to edit and slow to review — and the two cannot share a
column.

Revision ID: 0019
Revises: 0018
Create Date: 2026-08-07

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None

EMPLOYMENT_TYPE = postgresql.ENUM(
    "full_time", "part_time", name="user_employment_type", create_type=False
)
VIDEO_TYPE = postgresql.ENUM(
    "podcast", "long_form", "short_form", name="job_video_type", create_type=False
)

# The price list from docs/12 §1, as SQL, for the backfill only. The app reads
# it from `services/routing.py::QC2_WEIGHT`; this is the one place it is
# duplicated, and it is frozen here on purpose — a migration must keep meaning
# the same thing after the constants move on.
BACKFILL_POINTS = """
    CASE
        WHEN jobs.video_type = 'podcast'   THEN CASE WHEN jobs.round > 0 THEN 3 ELSE 6 END
        WHEN jobs.video_type = 'long_form' THEN CASE WHEN jobs.round > 0 THEN 2 ELSE 3 END
        ELSE 1
    END
"""


def upgrade() -> None:
    EMPLOYMENT_TYPE.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "users",
        sa.Column(
            "employment_type",
            EMPLOYMENT_TYPE,
            nullable=False,
            server_default="full_time",
        ),
    )

    op.add_column(
        "jobs",
        sa.Column("rush", sa.Boolean(), nullable=False, server_default="false"),
    )

    op.create_table(
        "qc2_charges",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("jobs.id"), nullable=False
        ),
        sa.Column(
            "reviewer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("points", sa.Integer(), nullable=False),
        sa.Column("video_type", VIDEO_TYPE, nullable=False),
        sa.Column("round", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_qc2_charges_work_date", "qc2_charges", ["work_date"])
    op.create_index(
        "ix_qc2_charges_reviewer_work_date", "qc2_charges", ["reviewer_id", "work_date"]
    )
    op.create_index(
        "ix_qc2_charges_reviewer_open",
        "qc2_charges",
        ["reviewer_id"],
        postgresql_where=sa.text("released_at IS NULL"),
    )
    op.create_index(
        "uq_qc2_charges_open_job",
        "qc2_charges",
        ["job_id"],
        unique=True,
        postgresql_where=sa.text("released_at IS NULL"),
    )

    # Everything a reviewer is holding right now becomes an open charge dated
    # today. Scrapped projects are nobody's load and are left out, the same
    # exclusion every other capacity query makes
    # (`services/access.py::not_scrapped`).
    op.execute(
        f"""
        INSERT INTO qc2_charges
            (id, job_id, reviewer_id, work_date, points, video_type, round, created_at)
        SELECT
            gen_random_uuid(),
            jobs.id,
            jobs.qc2_reviewer_id,
            (now() AT TIME ZONE 'Asia/Kolkata')::date,
            {BACKFILL_POINTS},
            jobs.video_type,
            jobs.round,
            now()
        FROM jobs
        WHERE jobs.qc2_reviewer_id IS NOT NULL
          AND jobs.stage IN ('qc2', 'revisions')
          AND jobs.scrapped_at IS NULL
        """
    )


def downgrade() -> None:
    op.drop_table("qc2_charges")
    op.drop_column("jobs", "rush")
    op.drop_column("users", "employment_type")
    EMPLOYMENT_TYPE.drop(op.get_bind(), checkfirst=True)
