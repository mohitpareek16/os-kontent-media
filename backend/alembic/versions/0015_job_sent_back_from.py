"""jobs.sent_back_from — a fixed cut goes back to whoever asked for the changes

A send-back from QC2 dropped the job into revisions and then, once the editor
had made the changes, sent it forward along the fixed line: editing -> qc1 ->
qc2. So the pod TL re-reviewed a cut against a change list they had never
written, while the reviewer who did write it sat behind them in the queue. The
same is true of a send-back from the final check.

The stage machine could not do better because nothing on the job remembered
where the round came from: `revisions` looks identical whether QC1, QC2 or
Final raised it. This column is that memory — written when the job moves into
revisions, read by `allowed_next_stages` while the editor is working, cleared
when they re-submit.

Nullable, and null is the normal state: a job that has never been sent back
has no sender to return to, and takes the ordinary editing -> qc1 route.

Revision ID: 0015
Revises: 0014
Create Date: 2026-08-06

"""
import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

SEND_BACK_STAGES = ("qc1", "qc2", "final")


def upgrade() -> None:
    send_back_stage = sa.Enum(*SEND_BACK_STAGES, name="job_send_back_stage")
    send_back_stage.create(op.get_bind(), checkfirst=True)
    op.add_column("jobs", sa.Column("sent_back_from", send_back_stage, nullable=True))


def downgrade() -> None:
    op.drop_column("jobs", "sent_back_from")
    sa.Enum(name="job_send_back_stage").drop(op.get_bind(), checkfirst=True)
