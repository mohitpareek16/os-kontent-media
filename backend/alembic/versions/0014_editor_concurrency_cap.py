"""users.capacity_per_week becomes max_concurrent_jobs — a cap that is enforced

`capacity_per_week` was a weighted forecast: "this editor can absorb ten points
of work in a week". Nothing ever checked it. Assignment, batch creation and
reassignment all wrote `assigned_editor_id` without looking, so the number was
decoration on the admin screen while editors accumulated open jobs without
limit, and the Team Capacity page reported a load nobody was held to.

What the pods actually run on is a work-in-progress limit: how many videos one
editor may hold at once, freed one at a time as each is delivered. That is a
different question from the weekly one and it is answerable per assignment,
which is what makes it enforceable — see
`services/access.py::require_assignable_editor`.

The old column is dropped rather than kept alongside: two capacity numbers on
one account, one enforced and one not, is exactly the ambiguity this is meant
to remove. Existing values are not carried over — 10 weighted points per week
does not translate into a concurrent count, so every account starts at the
default of 5 and the admin adjusts from there.

Revision ID: 0014
Revises: 0013
Create Date: 2026-08-06

"""
import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "max_concurrent_jobs",
            sa.Integer(),
            nullable=False,
            server_default="5",
        ),
    )
    op.drop_column("users", "capacity_per_week")


def downgrade() -> None:
    op.add_column(
        "users",
        sa.Column("capacity_per_week", sa.Integer(), nullable=False, server_default="10"),
    )
    op.drop_column("users", "max_concurrent_jobs")
