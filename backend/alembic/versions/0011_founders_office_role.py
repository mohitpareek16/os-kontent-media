"""user_role gains 'fo' — the Founder's Office

An Owner everywhere in the product: every pod, every job, analytics, the bot,
impersonation. Not an Owner in the one place that decides who holds that
reach — it cannot create or administer an Owner or a peer Founder's Office,
so the admin tier stays the Owner's to hand out and to take back. The rules
live in `schemas/user.py::CREATABLE_ROLES` and
`routers/users.py::require_can_administer`; see docs/04-permissions.md.

Revision ID: 0011
Revises: 0010
Create Date: 2026-08-04

"""
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
    # Postgres < 12, and Alembic wraps every migration in one.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'fo'")


def downgrade() -> None:
    # Same shape as 0010: Postgres has no DROP VALUE, and silently reassigning
    # a real person's role is worse than refusing.
    bind = op.get_bind()
    remaining = bind.exec_driver_sql(
        "SELECT count(*) FROM users WHERE role = 'fo'"
    ).scalar()
    if remaining:
        raise RuntimeError(
            f"{remaining} account(s) still have role 'fo' — change their role "
            "before downgrading past 0011."
        )

    op.execute("ALTER TYPE user_role RENAME TO user_role_old")
    op.execute("CREATE TYPE user_role AS ENUM ('owner', 'tl', 'qc', 've', 'hr')")
    op.execute(
        "ALTER TABLE users ALTER COLUMN role TYPE user_role USING role::text::user_role"
    )
    op.execute("DROP TYPE user_role_old")
