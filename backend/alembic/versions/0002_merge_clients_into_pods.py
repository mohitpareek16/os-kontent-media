"""reconcile drifted local schema: merge clients into pods

The `pods`/`jobs` models and 0001_initial.py have described the
"clients merged into pods" schema (docs/03-data-model.md) since this
migration file was first written — but some local dev databases were
bootstrapped from an earlier revision of 0001 that still had a
separate `clients` table, before it was edited in place. Because
alembic tracks revisions by id rather than content, `alembic_version`
already says "0001" on those databases, so `upgrade head` is a no-op
and `pods` is left missing `status`/`billing_currency`/`retainer_volume`/
`onboarded_by` with a dangling legacy `client_id` column instead.

This migration is additive-then-cleanup so it's safe to run against
either a fresh 0001 database (nothing to backfill, columns already
correct, `clients` table absent — every step below is a no-op) or a
drifted one (backfills pods from the matching clients row, then drops
the legacy client_id columns and the clients table).

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-02

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

pod_status = postgresql.ENUM("active", "paused", "churned", name="pod_status", create_type=False)


def _has_column(bind, table: str, column: str) -> bool:
    inspector = sa.inspect(bind)
    return column in {c["name"] for c in inspector.get_columns(table)}


def _has_table(bind, table: str) -> bool:
    return sa.inspect(bind).has_table(table)


def upgrade() -> None:
    bind = op.get_bind()
    pod_status.create(bind, checkfirst=True)

    if not _has_column(bind, "pods", "status"):
        op.add_column("pods", sa.Column("status", pod_status, nullable=True))
    if not _has_column(bind, "pods", "billing_currency"):
        op.add_column("pods", sa.Column("billing_currency", sa.String(8), nullable=True))
    if not _has_column(bind, "pods", "retainer_volume"):
        op.add_column("pods", sa.Column("retainer_volume", sa.Integer(), nullable=True))
    if not _has_column(bind, "pods", "onboarded_by"):
        op.add_column(
            "pods", sa.Column("onboarded_by", postgresql.UUID(as_uuid=True), nullable=True)
        )

    if _has_table(bind, "clients") and _has_column(bind, "pods", "client_id"):
        op.execute(
            """
            UPDATE pods
            SET status = COALESCE(pods.status, clients.status::text::pod_status),
                billing_currency = COALESCE(pods.billing_currency, clients.billing_currency),
                retainer_volume = COALESCE(pods.retainer_volume, clients.retainer_volume),
                onboarded_by = COALESCE(pods.onboarded_by, clients.onboarded_by)
            FROM clients
            WHERE pods.client_id = clients.id
            """
        )

    op.execute("UPDATE pods SET status = 'active' WHERE status IS NULL")
    op.execute("UPDATE pods SET billing_currency = 'INR' WHERE billing_currency IS NULL")
    op.execute("UPDATE pods SET onboarded_by = tl_id WHERE onboarded_by IS NULL")

    op.alter_column("pods", "status", nullable=False, server_default="active")
    op.alter_column("pods", "billing_currency", nullable=False, server_default="INR")
    op.alter_column("pods", "onboarded_by", nullable=False)

    inspector = sa.inspect(bind)
    pod_fks = {fk["name"] for fk in inspector.get_foreign_keys("pods")}
    if "pods_onboarded_by_fkey" not in pod_fks:
        op.create_foreign_key("pods_onboarded_by_fkey", "pods", "users", ["onboarded_by"], ["id"])

    if _has_column(bind, "jobs", "client_id"):
        job_fks = {fk["name"] for fk in inspector.get_foreign_keys("jobs")}
        if "jobs_client_id_fkey" in job_fks:
            op.drop_constraint("jobs_client_id_fkey", "jobs", type_="foreignkey")
        op.drop_column("jobs", "client_id")

    if _has_column(bind, "pods", "client_id"):
        pod_fks = {fk["name"] for fk in inspector.get_foreign_keys("pods")}
        if "pods_client_id_fkey" in pod_fks:
            op.drop_constraint("pods_client_id_fkey", "pods", type_="foreignkey")
        op.drop_column("pods", "client_id")

    if _has_table(bind, "clients"):
        op.drop_table("clients")
    op.execute("DROP TYPE IF EXISTS client_status")


def downgrade() -> None:
    raise NotImplementedError("this migration reconciles a one-off local schema drift; no downgrade path")
