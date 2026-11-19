"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-08-02

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

# create_type=False on every enum: types are created/dropped explicitly in
# the loops below, via ENUMS. Without this, SQLAlchemy's own before_create
# hook tries to CREATE TYPE a second time when create_table() first
# encounters the enum column, and errors with DuplicateObjectError.
user_role = postgresql.ENUM("owner", "tl", "qc", "ve", name="user_role", create_type=False)
pod_status = postgresql.ENUM("active", "paused", "churned", name="pod_status", create_type=False)
pod_role = postgresql.ENUM("tl", "qc", "ve", name="pod_role", create_type=False)
brand_asset_type = postgresql.ENUM(
    "brief", "sop", "kit", "do_not", name="brand_asset_type", create_type=False
)
job_stage = postgresql.ENUM(
    "intake", "assigned", "editing", "qc1", "qc2", "revisions", "final", "delivered",
    name="job_stage", create_type=False,
)
job_weight = postgresql.ENUM("light", "standard", "heavy", name="job_weight", create_type=False)
notification_channel = postgresql.ENUM(
    "in_app", "whatsapp", name="notification_channel", create_type=False
)

ENUMS = (
    user_role, pod_status, pod_role, brand_asset_type, job_stage, job_weight, notification_channel,
)


def upgrade() -> None:
    bind = op.get_bind()
    for enum in ENUMS:
        enum.create(bind, checkfirst=True)

    op.create_table(
        "teams",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("lead_id", postgresql.UUID(as_uuid=True), nullable=True),
    )

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("phone", sa.String(32), nullable=True),
        sa.Column("role", user_role, nullable=False),
        sa.Column("team_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("teams.id"), nullable=True),
        sa.Column("capacity_per_week", sa.Integer, nullable=False, server_default="10"),
        sa.Column("available", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_foreign_key("fk_teams_lead_id_users", "teams", "users", ["lead_id"], ["id"])

    op.create_table(
        "pods",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("tl_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", pod_status, nullable=False, server_default="active"),
        sa.Column("billing_currency", sa.String(8), nullable=False, server_default="INR"),
        sa.Column("retainer_volume", sa.Integer, nullable=True),
        sa.Column("onboarded_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "pod_members",
        sa.Column("pod_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("pods.id"), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("pod_role", pod_role, nullable=False),
        sa.Column("certified_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "brand_assets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("pod_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("pods.id"), nullable=False),
        sa.Column("type", brand_asset_type, nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("file_path", sa.String(500), nullable=False),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(32), nullable=False, unique=True),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("pod_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("pods.id"), nullable=False),
        sa.Column("stage", job_stage, nullable=False, server_default="intake"),
        sa.Column("weight", job_weight, nullable=False, server_default="standard"),
        sa.Column("assigned_editor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("qc2_reviewer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("frame_link", sa.String(500), nullable=True),
        sa.Column("round", sa.Integer, nullable=False, server_default="0"),
        sa.Column("deadline", sa.Date, nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("client_sheet_ok", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("ops_tracker_ok", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "job_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("jobs.id"), nullable=False),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("payload", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_job_events_job_id", "job_events", ["job_id"])

    op.create_table(
        "notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("job_events.id"), nullable=False),
        sa.Column("channel", notification_channel, nullable=False, server_default="in_app"),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])


def downgrade() -> None:
    op.drop_table("notifications")
    op.drop_table("job_events")
    op.drop_table("jobs")
    op.drop_table("brand_assets")
    op.drop_table("pod_members")
    op.drop_table("pods")
    op.drop_constraint("fk_teams_lead_id_users", "teams", type_="foreignkey")
    op.drop_table("users")
    op.drop_table("teams")

    bind = op.get_bind()
    for enum in reversed(ENUMS):
        enum.drop(bind, checkfirst=True)
