"""Prevent duplicate login emails regardless of letter case or padding."""
from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE UNIQUE INDEX uq_users_email_case_insensitive ON users (lower(trim(email)))"
    )


def downgrade() -> None:
    op.drop_index("uq_users_email_case_insensitive", table_name="users")
