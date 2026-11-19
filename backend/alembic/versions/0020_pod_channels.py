"""Channels inside a client pod

A pod is one client. A channel is one of the places that client publishes —
Dhan HQ, AAD, lwdhan — and until now the only way to tell three of them apart
on a board of forty jobs was to recognise the titles.

Deliberately not a second pod. Everything about the work is shared: the same
TL, the same editors, the same QC reviewers, the same retainer. Splitting Dhan
into three pods to record a destination would split its roster, its capacity
and its first-pass rate along with it, and "how is Dhan doing" would stop
having an answer.

**No backfill, on purpose.** `jobs.channel_id` lands NULL on every row that
already exists, and it is meant to. A channel is something a person chooses;
one inferred from a title would be written in the same column, render in the
same chip and be indistinguishable from a real choice — thousands of rows of
confident fiction. The TL sets them from the job panel as work comes past, and
a blank chip is an honest "nobody has said yet".

Nullable also means this migration cannot fail on a live table: no default to
compute, no rewrite, no lock beyond the catalogue update.

Revision ID: 0020
Revises: 0019
Create Date: 2026-08-10

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "channels",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "pod_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("pods.id"), nullable=False
        ),
        sa.Column("name", sa.String(length=120), nullable=False),
        # Retired rather than deleted: a channel the client stopped publishing
        # to still names the jobs that went to it.
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        # Two "Dhan HQ"s in one pod is a typo, not a second channel. Scoped to
        # the pod — two clients may each have a "Shorts".
        sa.UniqueConstraint("pod_id", "name", name="uq_channels_pod_name"),
    )
    op.create_index("ix_channels_pod_id", "channels", ["pod_id"])

    op.add_column(
        "jobs",
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_jobs_channel_id", "jobs", "channels", ["channel_id"], ["id"]
    )
    # Every list that filters by channel filters by pod first, so the index is
    # on the pair rather than the channel alone.
    op.create_index("ix_jobs_pod_channel", "jobs", ["pod_id", "channel_id"])


def downgrade() -> None:
    op.drop_index("ix_jobs_pod_channel", table_name="jobs")
    op.drop_constraint("fk_jobs_channel_id", "jobs", type_="foreignkey")
    op.drop_column("jobs", "channel_id")
    op.drop_index("ix_channels_pod_id", table_name="channels")
    op.drop_table("channels")
