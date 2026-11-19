"""Jobs get a video type, and weight stops being a question anybody is asked

`weight` (light / standard / heavy) asked the TL to estimate difficulty at the
moment they knew least about the job, and nothing ever checked the estimate
against how long the cut actually took. What everybody *does* know when a
brief lands is what kind of video it is — a podcast, a long-form, a short —
and that is the word the team already argues in.

So `video_type` takes weight's place on every screen: the pipeline table's
column, the filters, the bulk paste, the job panel.

`weight` is not dropped. It is what QC2 routing and editor load are counted in
(`services/routing.py::WEIGHT_POINTS` — light 1, standard 2, heavy 4), and
those are live numbers on live queues; removing the column would mean
rewriting the routing score in the same release that changes an unrelated bit
of UI. Every job now takes the default (`standard`), which makes the load
maths a job count in disguise until the score is rebuilt on something real.
That is a deliberate holding position, written down here rather than left for
somebody to discover in six months.

Existing rows are backfilled to `long_form`, which is what the overwhelming
majority of the back catalogue is; the alternative — nullable, meaning
"nobody said" — would put an empty column on every historical row and no
report would be able to group by it.

Revision ID: 0018
Revises: 0017
Create Date: 2026-08-07

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None

VIDEO_TYPE = postgresql.ENUM(
    "podcast", "long_form", "short_form", name="job_video_type", create_type=False
)


def upgrade() -> None:
    VIDEO_TYPE.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "jobs",
        sa.Column(
            "video_type", VIDEO_TYPE, nullable=False, server_default="long_form"
        ),
    )


def downgrade() -> None:
    op.drop_column("jobs", "video_type")
    VIDEO_TYPE.drop(op.get_bind(), checkfirst=True)
