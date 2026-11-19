"""jobs gains the QC1-skipped flag — the QC2 reviewer's answer to a rubber-stamp

QC1 is the pod TL's first-pass review. Nothing on the record distinguished a
real one from a job waved through in forty seconds with no note on it: both
looked like a `stage_changed` event from qc1 to qc2, and the only person in a
position to notice — the QC2 reviewer, who is now reading a cut nobody checked
— had no way to say so.

Four columns rather than an event alone, for the same reason the scrap columns
exist: the pipeline table, the row tint and the dashboard count all ask "is
this flagged" per row, and that must not be a subquery over `job_events` each
time. The log keeps the story (`qc1_flag_raised` / `qc1_flag_cleared`); these
answer the present tense.

`qc1_flag_tl_id` is who cleared QC1, snapshotted when the flag was raised — the
pod's TL can change afterwards, and the flag is about a person, not a chair.

Revision ID: 0013
Revises: 0012
Create Date: 2026-08-06

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("qc1_flagged_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("jobs", sa.Column("qc1_flagged_by_id", UUID(as_uuid=True), nullable=True))
    op.add_column("jobs", sa.Column("qc1_flag_tl_id", UUID(as_uuid=True), nullable=True))
    op.add_column("jobs", sa.Column("qc1_flag_reason", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_jobs_qc1_flagged_by_id_users", "jobs", "users", ["qc1_flagged_by_id"], ["id"]
    )
    op.create_foreign_key(
        "fk_jobs_qc1_flag_tl_id_users", "jobs", "users", ["qc1_flag_tl_id"], ["id"]
    )
    # Who and why move with the flag or the row is refused — a flag against a
    # colleague with no reason on it is an accusation nobody can answer. Same
    # shape as the scrap invariant in 0012.
    op.create_check_constraint(
        "ck_jobs_qc1_flag_fields_move_together",
        "jobs",
        "(qc1_flagged_at IS NULL) = (qc1_flagged_by_id IS NULL) "
        "AND (qc1_flagged_at IS NULL) = (qc1_flag_reason IS NULL)",
    )
    # Partial: flagged jobs are the small minority, and every query that wants
    # them wants exactly the non-null side.
    op.create_index(
        "ix_jobs_qc1_flagged_at",
        "jobs",
        ["qc1_flagged_at"],
        postgresql_where=sa.text("qc1_flagged_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_jobs_qc1_flagged_at", table_name="jobs")
    op.drop_constraint("ck_jobs_qc1_flag_fields_move_together", "jobs", type_="check")
    op.drop_constraint("fk_jobs_qc1_flag_tl_id_users", "jobs", type_="foreignkey")
    op.drop_constraint("fk_jobs_qc1_flagged_by_id_users", "jobs", type_="foreignkey")
    op.drop_column("jobs", "qc1_flag_reason")
    op.drop_column("jobs", "qc1_flag_tl_id")
    op.drop_column("jobs", "qc1_flagged_by_id")
    op.drop_column("jobs", "qc1_flagged_at")
