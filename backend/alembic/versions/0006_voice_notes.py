"""voice_notes — timestamped voice notes for Frame.io video review

Chrome extension records audio while reviewing a video on Frame.io,
captures the video timestamp, and uploads both to this server. Notes
expire 60 days after creation and are cleaned up by a daily background
task (services/cleanup_expired_notes.py).

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-03

"""
import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "voice_notes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("video_url", sa.Text(), nullable=False),
        sa.Column("video_title", sa.String(500), nullable=True),
        sa.Column("timestamp_seconds", sa.Float(), nullable=False, server_default="0"),
        sa.Column("duration_seconds", sa.Float(), nullable=False, server_default="0"),
        sa.Column("audio_filename", sa.String(500), nullable=False),
        sa.Column("recorded_by", sa.String(200), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now() + interval '60 days'"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_voice_notes_video_url", "voice_notes", ["video_url"])


def downgrade() -> None:
    op.drop_index("ix_voice_notes_video_url")
    op.drop_table("voice_notes")
