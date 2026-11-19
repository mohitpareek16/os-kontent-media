"""user_role gains 'hr' — the people-ops account

HR onboards teammates and reads the roster; it owns no pod, no queue and no
job. It is an account role (`users.role`), not a pod role — `pod_role` is
deliberately left alone, because HR is never a member of a client pod.

Revision ID: 0010
Revises: 0009
Create Date: 2026-08-04

"""
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
    # Postgres < 12, and Alembic wraps every migration in one.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'hr'")


def downgrade() -> None:
    # Postgres has no DROP VALUE, so the type is rebuilt without 'hr'. Any
    # account still holding the role would fail the cast — and silently
    # reassigning a real person's role is worse than refusing, so this stops
    # and says which accounts to change first.
    bind = op.get_bind()
    remaining = bind.exec_driver_sql(
        "SELECT count(*) FROM users WHERE role = 'hr'"
    ).scalar()
    if remaining:
        raise RuntimeError(
            f"{remaining} account(s) still have role 'hr' — change their role "
            "before downgrading past 0010."
        )

    op.execute("ALTER TYPE user_role RENAME TO user_role_old")
    op.execute("CREATE TYPE user_role AS ENUM ('owner', 'tl', 'qc', 've')")
    op.execute(
        "ALTER TABLE users ALTER COLUMN role TYPE user_role USING role::text::user_role"
    )
    op.execute("DROP TYPE user_role_old")
