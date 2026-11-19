"""Job titles stop being permissions, and permissions can be lent

Three changes, one idea: **what somebody is called and what somebody may do
are different facts, and the product was storing one column for both.**

1. `user_role` gains `staff` — an account with no powers at all. Everybody the
   pipeline has no word for (Graphic Designer, Social Media, Motion) is
   `staff` plus a `role_titles` row, instead of being filed under "VE" so the
   onboarding form would accept them and then turning up in editor pickers.

2. `users.secondary_role` — borrowed powers on top of your own role. Only
   `tl` is legal (`SECONDARY_ROLES`), and it means "a real Team Lead on the
   pods whose `Pod.tl_id` is me". An editor can run two client pods, an HR can
   onboard their own clients and lead them, without either of them being
   given the whole company.

3. Every existing Founder's Office account gets `secondary_role='tl'`. FO used
   to be an Owner everywhere — every pod, every job, analytics, the bot — by
   virtue of the name. It now reaches exactly the pods it has been handed, the
   same as anybody else. HR loses the same reach in the same release and keeps
   only what it is for: the roster and onboarding. Neither role is deleted;
   both stop meaning "everything".

The FO backfill is deliberately generous where the rest of this is strict: an
account that could do everything yesterday should not silently lose its pods
overnight. It gets the lending mechanism instead, and an Owner can take it
back per account.

Revision ID: 0017
Revises: 0016
Create Date: 2026-08-06

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
    # Postgres < 12, and Alembic wraps every migration in one. Same shape as
    # 0010 and 0011.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'staff'")

    op.create_table(
        "role_titles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    # One title, one spelling: "Graphic Designer" and "graphic designer" are
    # the same job, and a roster grouped by title has to agree with itself.
    op.create_index(
        "uq_role_titles_name_lower", "role_titles", [sa.text("lower(name)")], unique=True
    )

    op.add_column(
        "users",
        sa.Column(
            "secondary_role",
            postgresql.ENUM(name="user_role", create_type=False),
            nullable=True,
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "role_title_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("role_titles.id"),
            nullable=True,
        ),
    )

    # The Founder's Office keeps its reach over work it was actually given.
    op.execute("UPDATE users SET secondary_role = 'tl' WHERE role = 'fo'")


def downgrade() -> None:
    op.drop_column("users", "role_title_id")
    op.drop_column("users", "secondary_role")
    op.drop_index("uq_role_titles_name_lower", table_name="role_titles")
    op.drop_table("role_titles")

    # Postgres has no DROP VALUE, and rewriting the enum would mean deciding
    # what a `staff` account becomes — a decision nothing here can make
    # honestly. Same refusal as 0010 and 0011.
    bind = op.get_bind()
    remaining = bind.exec_driver_sql(
        "SELECT count(*) FROM users WHERE role = 'staff'"
    ).scalar()
    if remaining:
        raise RuntimeError(
            f"{remaining} account(s) still have role 'staff' — give them a built-in "
            "role before downgrading past 0017."
        )

    op.execute("ALTER TYPE user_role RENAME TO user_role_old")
    op.execute("CREATE TYPE user_role AS ENUM ('owner', 'tl', 'qc', 've', 'hr', 'fo')")
    op.execute(
        "ALTER TABLE users ALTER COLUMN role TYPE user_role USING role::text::user_role"
    )
    op.execute("DROP TYPE user_role_old")
