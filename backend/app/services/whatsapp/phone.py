"""Turning what somebody typed into a number Meta will dial.

The Graph API wants E.164 without the leading plus: `919876543210`. The admin
form contains, today, all of these for the same person:

    9876543210        +91 98765 43210        091-98765-43210
    +919876543210     0091 9876543210        98765 43210

**This guesses, and it is careful about where.** A bare ten-digit number is
assumed to be `whatsapp_default_country_code` — that is a real assumption and
it is wrong for anyone hired outside India. It is made anyway because the
alternative is that every existing roster row fails validation on the day this
ships, and because the guess is *visible*: the original text stays in
`users.phone`, the guess lands in `users.phone_e164`, and the Numbers tab shows
both side by side.

**What it refuses to guess.** Anything under 8 or over 15 digits comes back
None rather than being padded, truncated or prefixed into plausibility. None
means "a person needs to look at this", which the admin page says out loud. A
number silently normalised into the wrong shape is worse than a blank one: the
blank is a task, the wrong one is a message delivered to a stranger.

E.164's maximum is 15 digits including the country code; 8 is the shortest
national number in use anywhere with a country code attached. Neither bound is
a real validation of whether the number exists — only Meta can answer that, and
it does, with error 131026 on the first send.
"""
from __future__ import annotations

import re

from app.core.config import get_settings

# The longest a full E.164 number may be, country code included. Meta rejects
# anything past it outright.
MAX_E164_DIGITS = 15
MIN_E164_DIGITS = 8
# A national number this long has its country code in front of it already —
# used to tell "0" as a trunk prefix apart from "0" as the start of the number.
NATIONAL_LENGTH = 10


def normalise(raw: str | None, *, default_country_code: str | None = None) -> str | None:
    """Best-effort E.164-without-plus, or None when it would be a guess too far.

    `default_country_code` is injectable so the backfill and the tests do not
    have to reach through application settings, and so a deployment outside
    India is one config line rather than a code change.
    """
    if not raw:
        return None
    cc = default_country_code or get_settings().whatsapp_default_country_code

    digits = re.sub(r"\D", "", raw)
    if not digits:
        return None

    # "00" is the international access prefix in most of the world — the
    # written form of the plus that the punctuation strip just removed.
    if digits.startswith("00"):
        digits = digits[2:]

    # A leading zero is a trunk prefix: it is for dialling inside a country and
    # has no place in an international number. No E.164 number begins with one
    # and no country code does either, so stripping it is always right — the
    # only question is how many there are, and both shapes in the roster occur:
    # "09876543210" (trunk + national) and "0919876543210" (trunk + country
    # code + national). The guard keeps this from eating a short number whole.
    while digits.startswith("0") and len(digits) > NATIONAL_LENGTH:
        digits = digits[1:]

    if len(digits) == NATIONAL_LENGTH:
        # A national number with no country code in front of it.
        digits = f"{cc}{digits}"

    if not MIN_E164_DIGITS <= len(digits) <= MAX_E164_DIGITS:
        return None
    return digits


def is_valid(value: str | None) -> bool:
    """Whether a stored `phone_e164` is dialable as it stands.

    Separate from `normalise` because the two answer different questions: this
    validates a value already in the column, which may have been written by an
    older version of the rules or by the 0026 backfill.
    """
    if not value:
        return False
    return bool(re.fullmatch(rf"\d{{{MIN_E164_DIGITS},{MAX_E164_DIGITS}}}", value))


def display(value: str | None) -> str | None:
    """The stored digits with a plus on the front, for reading rather than
    dialling. Meta wants the bare digits; a person wants +919876543210."""
    return f"+{value}" if value else None
