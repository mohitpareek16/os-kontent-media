"""Move video formats and future QC prices into an owner-managed catalog."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "video_types",
        sa.Column("key", sa.String(32), primary_key=True),
        sa.Column("label", sa.String(80), nullable=False, unique=True),
        sa.Column("qc_points", sa.Integer, nullable=False),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.CheckConstraint("qc_points BETWEEN 1 AND 24", name="ck_video_types_qc_points"),
    )
    op.create_index("uq_video_types_label_ci", "video_types", [sa.text("lower(label)")], unique=True)
    op.bulk_insert(sa.table(
        "video_types", sa.column("key"), sa.column("label"),
        sa.column("qc_points"), sa.column("enabled"), sa.column("sort_order"),
    ), [
        {"key": "podcast", "label": "Podcast", "qc_points": 6, "enabled": True, "sort_order": 0},
        {"key": "long_form", "label": "Long form", "qc_points": 3, "enabled": True, "sort_order": 1},
        {"key": "short_form", "label": "Short form", "qc_points": 1, "enabled": True, "sort_order": 2},
    ])
    op.execute("ALTER TABLE jobs ALTER COLUMN video_type DROP DEFAULT")
    op.execute("ALTER TABLE jobs ALTER COLUMN video_type TYPE varchar(32) USING video_type::text")
    op.execute("ALTER TABLE jobs ALTER COLUMN video_type SET DEFAULT 'long_form'")
    op.execute("ALTER TABLE qc2_charges ALTER COLUMN video_type TYPE varchar(32) USING video_type::text")
    op.create_foreign_key("fk_jobs_video_type", "jobs", "video_types", ["video_type"], ["key"])
    op.create_foreign_key("fk_qc2_charges_video_type", "qc2_charges", "video_types", ["video_type"], ["key"])
    op.execute("DROP TYPE job_video_type")


def downgrade() -> None:
    bind = op.get_bind()
    custom_count = bind.execute(sa.text(
        "SELECT COUNT(*) FROM video_types WHERE key NOT IN ('podcast','long_form','short_form')"
    )).scalar_one()
    if custom_count:
        raise RuntimeError("Cannot downgrade while custom video types exist")
    op.drop_constraint("fk_qc2_charges_video_type", "qc2_charges", type_="foreignkey")
    op.drop_constraint("fk_jobs_video_type", "jobs", type_="foreignkey")
    enum = postgresql.ENUM("podcast", "long_form", "short_form", name="job_video_type")
    enum.create(bind)
    op.execute("ALTER TABLE jobs ALTER COLUMN video_type DROP DEFAULT")
    op.execute("ALTER TABLE jobs ALTER COLUMN video_type TYPE job_video_type USING video_type::job_video_type")
    op.execute("ALTER TABLE jobs ALTER COLUMN video_type SET DEFAULT 'long_form'")
    op.execute("ALTER TABLE qc2_charges ALTER COLUMN video_type TYPE job_video_type USING video_type::job_video_type")
    op.drop_table("video_types")
