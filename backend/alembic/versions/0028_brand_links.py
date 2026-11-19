"""Store titled brand kit links per pod."""

import json
import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "brand_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("pod_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("pods.id"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("url", sa.String(2048), nullable=False),
        sa.Column("category", sa.String(32), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_brand_links_pod_id", "brand_links", ["pod_id"])
    op.create_table(
        "brand_kit_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("pod_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("pods.id"), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("before", postgresql.JSONB(), nullable=True),
        sa.Column("after", postgresql.JSONB(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_brand_kit_events_pod_id", "brand_kit_events", ["pod_id"])
    # Existing uploads already have versions and actors; carry that history forward.
    connection = op.get_bind()
    assets = connection.execute(sa.text(
        "SELECT pod_id, uploaded_by, title, version, file_path, created_at "
        "FROM brand_assets ORDER BY created_at, version"
    )).all()
    for pod_id, actor_id, title, version, file_path, created_at in assets:
        connection.execute(sa.text(
            "INSERT INTO brand_kit_events (id, pod_id, actor_id, action, title, before, after, created_at) "
            "VALUES (:id, :pod_id, :actor_id, :action, :title, CAST(:before AS jsonb), CAST(:after AS jsonb), :created_at)"
        ), {
            "id": uuid.uuid4(), "pod_id": pod_id, "actor_id": actor_id,
            "action": "file_updated" if version > 1 else "file_added", "title": title,
            "before": json.dumps({"version": version - 1}) if version > 1 else None,
            "after": json.dumps({"version": version, "filename": file_path.split("/")[-1].split("_", 1)[-1]}),
            "created_at": created_at,
        })
    op.alter_column("notifications", "event_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)
    op.add_column("notifications", sa.Column("brand_event_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("brand_kit_events.id"), nullable=True))
    op.create_check_constraint("ck_notifications_one_event", "notifications", "(event_id IS NOT NULL) <> (brand_event_id IS NOT NULL)")


def downgrade() -> None:
    op.drop_constraint("ck_notifications_one_event", "notifications", type_="check")
    op.drop_column("notifications", "brand_event_id")
    op.alter_column("notifications", "event_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False)
    op.drop_index("ix_brand_kit_events_pod_id", table_name="brand_kit_events")
    op.drop_table("brand_kit_events")
    op.drop_index("ix_brand_links_pod_id", table_name="brand_links")
    op.drop_table("brand_links")
