"""jobs gains the scrapped columns — a project killed before delivery

Scrapping is not a stage. A scrapped job keeps the stage it died at, because
"we dropped this at QC2 after three rounds" and "we dropped this before anyone
touched it" are different facts and only the stage remembers which. Putting
`scrapped` in the stage enum would have erased that, broken the state machine's
linear FORWARD table, and made a restore impossible.

The three columns move together or not at all: a scrapped row without a reason
is exactly the row nobody can explain six months later, which is the whole
point of the feature. Same shape as the delivered_at invariant in 0009.

Revision ID: 0012
Revises: 0011
Create Date: 2026-08-06

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("scrapped_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("jobs", sa.Column("scrapped_by_id", UUID(as_uuid=True), nullable=True))
    op.add_column("jobs", sa.Column("scrap_reason", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_jobs_scrapped_by_id_users", "jobs", "users", ["scrapped_by_id"], ["id"]
    )
    op.create_check_constraint(
        "ck_jobs_scrap_fields_move_together",
        "jobs",
        "(scrapped_at IS NULL) = (scrapped_by_id IS NULL) "
        "AND (scrapped_at IS NULL) = (scrap_reason IS NULL)",
    )
    # Partial: every list and count in the product filters on
    # `scrapped_at IS NULL`, and scrapped rows are the small minority.
    op.create_index(
        "ix_jobs_scrapped_at",
        "jobs",
        ["scrapped_at"],
        postgresql_where=sa.text("scrapped_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_jobs_scrapped_at", table_name="jobs")
    op.drop_constraint("ck_jobs_scrap_fields_move_together", "jobs", type_="check")
    op.drop_constraint("fk_jobs_scrapped_by_id_users", "jobs", type_="foreignkey")
    op.drop_column("jobs", "scrap_reason")
    op.drop_column("jobs", "scrapped_by_id")
    op.drop_column("jobs", "scrapped_at")
