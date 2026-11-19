"""Two deadlines: what the client was promised, and what the team works to

One date column was answering two different questions and could only ever hold
one answer. The date the client was given ("20 September") and the date the
pod actually works to ("17 September", so a revision round has somewhere to
go) are different facts, and until now a TL who wanted the buffer had to type
the earlier date into `jobs.deadline` and lose the real one entirely. Nobody
could then say how much room was left, because the app had never been told.

`jobs.deadline` does not change meaning. It is, and stays, **the team
deadline**: the date on every row, every editor's queue and every QC list, the
date the hand-off gate requires (`services/stage_machine.py::is_briefed`), and
the date `overdue` is counted against. Every query, sort and tint in the app
already points at it and every one of them already meant the team's date.

`jobs.client_deadline` is the new column and the new fact — the promise — and
it is visible to the Owner and to the TL of the job's own pod, nobody else.
That restriction is enforced in the API (`routers/jobs.py`), not here; a column
cannot keep a secret.

**No backfill, on purpose** — the same reasoning as `jobs.channel_id` in 0020.
An existing `deadline` is not evidence of what a client was told. Copying it
across would write thousands of rows of confident fiction into a column whose
whole value is that somebody chose what is in it, and a guessed promise renders
identically to a real one. Every existing job starts with no client deadline,
which reads as the honest "nobody has said yet", and a TL fills one in when it
matters.

Nullable, so this cannot fail on a live table: no default to compute, no
rewrite, no lock beyond the catalogue update.

Revision ID: 0022
Revises: 0021
Create Date: 2026-09-16

"""
import sqlalchemy as sa
from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("client_deadline", sa.Date(), nullable=True))


def downgrade() -> None:
    # The team deadline is the one everything reads, so dropping this takes
    # the promise away and leaves the working date untouched — which is
    # exactly the state every row was in before this migration.
    op.drop_column("jobs", "client_deadline")
