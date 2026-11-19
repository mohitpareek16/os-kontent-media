"""Meta's error codes, in English, for people who did not write this.

The delivery log is read by whoever is on the receiving end of "the editor
never got the message". `(#131047) Re-engagement message` is not an answer to
that; "outside the 24-hour window — an approved template was required" is.

Every sentence here says what happened and, where there is one, what to do.
None of them apologise, and none of them guess: a code that is not in the table
is printed as itself with whatever Meta's own description was, which is more
use than a friendly sentence about the wrong thing.

Codes are grouped by who has to act, because that is the first question:
*we* have a bug, *the recipient's* number is wrong, or *the account* is in
trouble. Re-verify these against Meta's current error reference at build time;
they add and retire codes, and this table is a convenience, not a contract.
"""
from __future__ import annotations

from app.services.whatsapp.client import MetaError, MetaUnreachable

# code -> (short label for a filter chip, sentence for a human)
ERROR_MEANINGS: dict[int, tuple[str, str]] = {
    # --- the recipient, or their number ---
    131026: (
        "Not on WhatsApp",
        "That number is not reachable on WhatsApp. Check it on the Numbers tab.",
    ),
    131047: (
        "Window closed",
        "Outside the 24-hour window, so an approved template was required. "
        "Seeing this means a free-form send was attempted — that is a bug, not a setting.",
    ),
    131051: ("Unsupported type", "That message type is not supported for this recipient."),
    # --- the template, or how we filled it ---
    132000: (
        "Parameter mismatch",
        "The template expects a different number of parameters than we sent. "
        "The approved template and the code have drifted — resubmit it from the Templates tab.",
    ),
    132001: (
        "No such template",
        "Meta has no approved template by that name in that language. "
        "Submit it, or wait for review to finish.",
    ),
    132005: (
        "Text too long",
        "The filled-in template exceeded WhatsApp's length limit. Shorten a parameter.",
    ),
    132007: (
        "Format violation",
        "The template content broke a formatting rule — usually a parameter with a newline "
        "or four spaces in it.",
    ),
    132012: (
        "Format mismatch",
        "A parameter did not match the format the template was approved with.",
    ),
    132015: ("Template paused", "Meta has paused this template because its quality dropped."),
    132016: ("Template disabled", "Meta has disabled this template permanently."),
    # --- the account ---
    131049: (
        "Marketing cap",
        "Blocked by the per-user Marketing limit (about 2 a day across all businesses). "
        "This template is categorised as MARKETING, not UTILITY — see the banner on Templates.",
    ),
    131031: ("Account locked", "The WhatsApp Business account has been locked or restricted."),
    130429: ("Rate limited", "Too many messages too quickly. Meta is throttling the number."),
    131048: ("Quality throttle", "Sending is restricted because the number's quality rating fell."),
    80007: ("Rate limited", "The Graph API rate limit was hit."),
    # --- us ---
    190: ("Token expired", "The access token is invalid or expired. Generate a new System User token."),
    200: ("Permission denied", "The token lacks a permission this call needs."),
    100: ("Invalid request", "Meta rejected a parameter. The detail below has the specifics."),
    368: ("Temporarily blocked", "The account is temporarily blocked for a policy violation."),
}

# Codes where retrying the identical send could plausibly succeed later.
# Everything else needs something changed first, and a retry is just a second
# identical failure with a later timestamp on it.
TRANSIENT_CODES = frozenset({130429, 80007, 131048, 500, 1, 2})


def label_for(code: int | None) -> str:
    if code is None:
        return "Failed"
    known = ERROR_MEANINGS.get(code)
    return known[0] if known else f"Error {code}"


def explain(error: Exception) -> tuple[int | None, str, str]:
    """(code, short label, sentence) for anything the sender can raise.

    Returns the triple rather than a formatted string so the delivery log can
    put the label in a chip and the sentence in the row beneath it, and so a
    filter can be built on the code without re-parsing prose.
    """
    if isinstance(error, MetaUnreachable):
        return (
            None,
            "Unreachable",
            "We could not reach Meta at all — network, DNS or timeout. Nothing was refused; "
            "the message simply did not get out.",
        )
    if isinstance(error, MetaError):
        known = ERROR_MEANINGS.get(error.code) if error.code is not None else None
        if known:
            label, sentence = known
            # Meta's own detail is appended when it adds anything: their
            # messages are sometimes specific in a way a static table cannot be.
            if error.detail and error.detail not in sentence:
                sentence = f"{sentence} Meta said: {error.detail}"
            return error.code, label, sentence
        return (
            error.code,
            label_for(error.code),
            error.detail or error.title or "Meta refused the message without saying why.",
        )
    return None, "Failed", str(error) or error.__class__.__name__


def is_transient(error: Exception) -> bool:
    if isinstance(error, MetaUnreachable):
        return True
    if isinstance(error, MetaError):
        return error.code in TRANSIENT_CODES
    return False
