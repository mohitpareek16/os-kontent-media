"""job codes from a sequence instead of a row count

`_next_code()` built the next code as "KM-{count(jobs) + 1001}". Two jobs
created at the same moment both read the same count and the second one died
on the unique index with a 500 — verified live, two of three concurrent
creates failed. Worse, deleting any job made the count go backwards, so
every subsequent create collided with an existing code permanently.

A sequence hands out each number exactly once, is transactional, and never
looks at what rows currently exist. Starts above the highest code already
issued so nothing collides with history.

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-03

"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Start after the largest numeric suffix already in use (codes look like
    # "KM-1042"); fall back to 1000 on an empty table.
    op.execute(
        """
        DO $$
        DECLARE next_val bigint;
        BEGIN
            SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '\\D', '', 'g'), '')::bigint), 1000) + 1
              INTO next_val FROM jobs;
            EXECUTE format('CREATE SEQUENCE IF NOT EXISTS job_code_seq START WITH %s', next_val);
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP SEQUENCE IF EXISTS job_code_seq")
