"""Three columns on users: a dialable number, consent, and the 24-hour window

Separate from 0025 because it is a different kind of change — that one creates
the integration's own tables, this one alters a table the whole application
already depends on. They ship together and could have been one revision; kept
apart so that a problem with either can be reverted without taking the other
with it.

**phone_e164 beside phone, not instead of it.** `users.phone` is free text
typed into an admin form, and in practice holds "9876543210", "+91 98765
43210" and "091-98765-43210" — all the same person. Meta accepts exactly one
of those shapes. Normalising in place would be the obvious move and it is the
wrong one: normalisation *guesses* (a bare ten-digit number is assumed Indian,
per `whatsapp_default_country_code`), and when the guess is wrong somebody has
to be able to see what was actually typed in order to fix it. So the guess
lives in its own column, the original stays untouched, and the admin page
shows both with the invalid ones highlighted.

Backfilled here rather than left to a script: the roster already exists, and a
column that is null for everybody until someone remembers to run something is
a feature that silently does nothing on the day it ships. The backfill is
deliberately conservative — see `services/whatsapp/phone.py` — so a number it
cannot confidently normalise is left null and shows up on the Numbers tab as
needing a human, which is the honest answer.

**whatsapp_opt_in defaults to false, for everybody, including on backfill.**
Consent is not implied by a phone number being on file.

**last_inbound_at** is when this person last messaged the business number,
which is what opens Meta's 24-hour service window. It is read by every send
decision, so it is a column rather than something derived from the message
log: "has this person written to us since yesterday" should not be a scan.

Revision ID: 0026
Revises: 0025
Create Date: 2026-09-16

"""
import re

import sqlalchemy as sa
from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None

# Duplicated from `services/whatsapp/phone.py` on purpose. A migration is a
# historical record and must keep doing what it did on the day it ran; if it
# imported the live module, a later change to normalisation would silently
# rewrite what this revision means. The two are allowed to drift — the service
# is the one that matters from here on, and re-saving a user re-derives the
# column through it.
_DEFAULT_CC = "91"


def _normalise(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return None
    if digits.startswith("00"):
        digits = digits[2:]
    # A leading zero is a trunk prefix and never part of an E.164 number.
    while digits.startswith("0") and len(digits) > 10:
        digits = digits[1:]
    if len(digits) == 10:
        digits = _DEFAULT_CC + digits
    if not 8 <= len(digits) <= 15:
        return None
    return digits


def upgrade() -> None:
    op.add_column("users", sa.Column("phone_e164", sa.String(length=20), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "whatsapp_opt_in", sa.Boolean(), nullable=False, server_default="false"
        ),
    )
    op.add_column("users", sa.Column("last_inbound_at", sa.DateTime(timezone=True), nullable=True))

    # Backfill from whatever is already on the roster. Row by row rather than
    # in SQL: the rules are a handful of conditionals about length and leading
    # zeros, and expressing them as a CASE expression would be both unreadable
    # and a second implementation to keep in step with the service.
    connection = op.get_bind()
    rows = connection.execute(
        sa.text("SELECT id, phone FROM users WHERE phone IS NOT NULL AND phone <> ''")
    ).fetchall()
    for user_id, phone in rows:
        normalised = _normalise(phone)
        if normalised is None:
            continue
        connection.execute(
            sa.text("UPDATE users SET phone_e164 = :p WHERE id = :i"),
            {"p": normalised, "i": user_id},
        )


def downgrade() -> None:
    op.drop_column("users", "last_inbound_at")
    op.drop_column("users", "whatsapp_opt_in")
    op.drop_column("users", "phone_e164")
