"""job_events.created_at: clock_timestamp() instead of now()

Postgres' now() is the *transaction* start time, so every event written by
one request — the stage change and the change list that goes with it, or a
batch create's intake + assigned pair — landed on the identical timestamp.
Ordering the activity feed by created_at then returned them in arbitrary
order, which is how "Job created" ended up displayed after "moved to
assigned". clock_timestamp() reads the real clock at insert, so rows written
in one transaction keep the order they were written in.

Existing rows keep their tied timestamps; only new events are affected.

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-03

"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE job_events ALTER COLUMN created_at SET DEFAULT clock_timestamp()")


def downgrade() -> None:
    op.execute("ALTER TABLE job_events ALTER COLUMN created_at SET DEFAULT now()")
