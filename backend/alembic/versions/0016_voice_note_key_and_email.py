"""voice_notes gets a canonical video_key, and a reviewer email

Notes were grouped by `video_url`. Frame.io serves the same asset under
`/project/<project>/view/<asset>` to a signed-in reviewer and under
`/share/<share>/view/<asset>` to everyone else, so one cut appeared as two
videos in the admin panel and — worse — neither reviewer could see the other's
notes, which is the entire point of the feature.

`video_key` is derived from the URL by `services/video_identity.py` and is what
everything groups and filters on now. `video_url` stays as the human-facing
link. Deriving it server-side means extension builds already installed keep
working with no update.

`recorded_by_email` joins the existing free-text `recorded_by`: the extension
now asks for a name *and* an email once, then locks both.

The backfill runs the same `canonical_video_key` the application uses rather
than a hand-written SQL regex, so there is one definition of what makes two
URLs the same video and no way for the two to drift.

Revision ID: 0016
Revises: 0015
Create Date: 2026-08-06

"""
import sqlalchemy as sa
from alembic import op

from app.services.video_identity import canonical_video_key

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("voice_notes", sa.Column("video_key", sa.Text(), nullable=True))
    op.add_column(
        "voice_notes", sa.Column("recorded_by_email", sa.String(320), nullable=True)
    )

    # Backfill through the application's own canonicaliser. The table is small
    # (one row per recording, 60-day retention) so reading it whole is fine.
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, video_url FROM voice_notes")).fetchall()
    for row in rows:
        conn.execute(
            sa.text("UPDATE voice_notes SET video_key = :key WHERE id = :id"),
            {"key": canonical_video_key(row.video_url), "id": row.id},
        )

    op.alter_column("voice_notes", "video_key", nullable=False)
    op.create_index("ix_voice_notes_video_key", "voice_notes", ["video_key"])


def downgrade() -> None:
    op.drop_index("ix_voice_notes_video_key")
    op.drop_column("voice_notes", "video_key")
    op.drop_column("voice_notes", "recorded_by_email")
