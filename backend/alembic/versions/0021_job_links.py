"""Raw files in, cuts out — many of each, titled

`jobs.frame_link` was one 500-character column doing two jobs. At intake it
held the client's Drive folder; after the edit it held the editor's Frame.io
review link; it could never hold both, and whichever was written last was what
everybody saw. The visible symptom was the editor's "paste your Frame.io link"
box opening pre-filled with the client's raw folder — the field was showing
the value it had, which happened to belong to somebody else's step.

So: two kinds of link, many of each, each with a title.

  raw   — what the client sent. The TL adds these.
  video — the cut. The editor adds these, one per round, so round two does not
          overwrite what QC reviewed in round one.

`jobs.frame_link` stays, as a pointer to the newest **video** link, maintained
by `services/job_links.py`. Every row icon, panel and bot field that reads it
goes on working, and nothing outside that module writes it.

**The backfill, and the one judgement in it.** Every existing `frame_link`
becomes a link row rather than being thrown away. Which kind it becomes is
decided by where the job had got to, because that is the only evidence there
is:

  - at `intake` or `assigned`, no editor has submitted anything, so the link
    can only be the client's raw material. It becomes a raw link, and the
    column is cleared — which is exactly the fix: those editors now open a
    blank box asking for their own link.
  - at `editing` or beyond, the job has been through an editor at least once
    and the column is far more likely to be their cut. It becomes a video
    link, and the column is left alone so nothing that reads it changes
    meaning today.

That is a guess on the second group, and a deliberately conservative one: it
mislabels nothing that anybody is about to type into, and the TL can move a
link to the right list in two clicks. The alternative — dropping the column's
contents into "unclassified" — would have meant every job in flight losing the
link on its face.

`added_by_id` is `jobs.created_by`. It is not always literally who pasted the
link, and there is no record of that anywhere; it is the closest true thing
the row can say about work that predates the table.

Revision ID: 0021
Revises: 0020
Create Date: 2026-08-10

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None

LINK_KIND = postgresql.ENUM("raw", "video", name="job_link_kind", create_type=False)

# Stages at which nobody has submitted a cut yet, so the link on the job can
# only be the client's raw material. Frozen here rather than imported from
# `models/job.py`: a migration must go on meaning the same thing after the
# stage list moves on.
PRE_EDIT_STAGES = "('intake', 'assigned')"


def upgrade() -> None:
    LINK_KIND.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "job_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "job_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", LINK_KIND, nullable=False),
        sa.Column("title", sa.String(length=120), nullable=True),
        sa.Column("url", sa.String(length=1000), nullable=False),
        sa.Column(
            "added_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_job_links_job_id", "job_links", ["job_id"])

    # `created_at` is the job's, not now(): the list is ordered by it, and
    # stamping every backfilled row with the same instant would order them by
    # nothing at all.
    op.execute(
        f"""
        INSERT INTO job_links (id, job_id, kind, title, url, added_by_id, created_at)
        SELECT
            gen_random_uuid(),
            jobs.id,
            CASE WHEN jobs.stage IN {PRE_EDIT_STAGES} THEN 'raw' ELSE 'video' END::job_link_kind,
            CASE WHEN jobs.stage IN {PRE_EDIT_STAGES} THEN 'Raw files' ELSE 'Working cut' END,
            jobs.frame_link,
            jobs.created_by,
            jobs.created_at
        FROM jobs
        WHERE jobs.frame_link IS NOT NULL AND jobs.frame_link <> ''
        """
    )

    # The fix itself: an editor who has not submitted anything opens an empty
    # box. The link is not lost — it is in the raw list above it, where it
    # belongs and where they can actually use it.
    op.execute(
        f"UPDATE jobs SET frame_link = NULL WHERE stage IN {PRE_EDIT_STAGES}"
    )


def downgrade() -> None:
    # Put the raw links back on the column they came from, so a rollback does
    # not leave those jobs with no link on their face. Newest first per job,
    # and only where the column is empty — a job with a cut on it keeps the
    # cut.
    op.execute(
        """
        UPDATE jobs SET frame_link = latest.url
        FROM (
            SELECT DISTINCT ON (job_id) job_id, url
            FROM job_links WHERE kind = 'raw'
            ORDER BY job_id, created_at DESC, id DESC
        ) AS latest
        WHERE jobs.id = latest.job_id AND jobs.frame_link IS NULL
        """
    )
    op.drop_index("ix_job_links_job_id", table_name="job_links")
    op.drop_table("job_links")
    LINK_KIND.drop(op.get_bind(), checkfirst=True)
