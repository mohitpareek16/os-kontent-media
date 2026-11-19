"""A delivered job must carry the date it was delivered

Two tools disagreed about how many jobs a client had delivered. Both were
right: `list_pods` and `get_pod_health` count rows at `stage='delivered'`,
while the trend tools count rows with a `delivered_at` inside the window and
have to skip a NULL — there is no bucket to put a dateless delivery in. Any
row that is delivered without a date makes those two counts differ, and the
bot will quote whichever it asked for. A fluent answer that contradicts the
last fluent answer is worse than either being wrong on its own.

The rows exist because `stage='delivered'` predates the line in
`routers/jobs.py` that stamps `delivered_at`. Nothing can create one now, so
this is a backfill of history plus a constraint that keeps it history.

Recovered from `job_events` rather than guessed: the event log is append-only
and holds the moment the job actually moved to delivered, which is the true
value. `updated_at` is the fallback for any row whose event predates the log,
and `created_at` behind that — both are wrong-but-bounded, and a constraint
cannot be added while a NULL remains.

MAX(), not MIN(): a job can be sent back and re-delivered, and the delivery
date people mean is the last one.

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-04

"""
import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

CONSTRAINT = "ck_jobs_delivered_at_set_when_delivered"


def upgrade() -> None:
    op.execute(
        """
        UPDATE jobs j
        SET delivered_at = COALESCE(
            (
                SELECT MAX(e.created_at)
                FROM job_events e
                WHERE e.job_id = j.id
                  AND e.event_type = 'stage_changed'
                  AND e.payload->>'stage' = 'delivered'
            ),
            j.updated_at,
            j.created_at
        )
        WHERE j.stage = 'delivered' AND j.delivered_at IS NULL
        """
    )

    # NOT VALID would let existing rows slide; the backfill above means there
    # are none, so validate now and find out here rather than in production.
    op.create_check_constraint(
        CONSTRAINT,
        "jobs",
        "stage <> 'delivered' OR delivered_at IS NOT NULL",
    )


def downgrade() -> None:
    # The backfilled timestamps stay. They are recovered facts, not a schema
    # detail, and re-nulling them would throw away the event-log reading for
    # no benefit.
    op.drop_constraint(CONSTRAINT, "jobs", type_="check")
