"""Phone normalisation — what it guesses, and what it refuses to.

The refusals matter more than the successes. A number normalised into the
wrong shape is a work message delivered to a stranger; a number left null is a
row on the Numbers tab asking for a human. The second is the correct failure.
"""
from __future__ import annotations

import pytest

from app.services.whatsapp import phone

pytestmark = pytest.mark.unit

CC = "91"


@pytest.mark.parametrize(
    "raw,expected",
    [
        # The shapes actually found in the roster today.
        ("9876543210", "919876543210"),
        ("+91 98765 43210", "919876543210"),
        ("+919876543210", "919876543210"),
        ("091-98765-43210", "919876543210"),
        ("0091 9876543210", "919876543210"),
        ("00919876543210", "919876543210"),
        ("98765 43210", "919876543210"),
        ("(+91) 9876-543210", "919876543210"),
        # Already E.164, and not Indian — left exactly as it is.
        ("+1 415 555 0132", "14155550132"),
        ("+44 20 7946 0958", "442079460958"),
    ],
)
def test_normalises_the_shapes_people_actually_type(raw, expected):
    assert phone.normalise(raw, default_country_code=CC) == expected


@pytest.mark.parametrize(
    "raw",
    [
        None,
        "",
        "   ",
        "not a number",
        "12345",  # too short to be anything, even with a country code
        "1234567890123456",  # past E.164's 15-digit ceiling
        "-",
    ],
)
def test_refuses_to_guess_rather_than_inventing_a_number(raw):
    """None means "a person needs to look at this", which the admin page says
    out loud. Padding or truncating into plausibility would not."""
    assert phone.normalise(raw, default_country_code=CC) is None


def test_normalisation_is_idempotent():
    """The Numbers tab has a re-derive button, and the 0026 backfill has
    already run. Running either twice must not append a second country code."""
    once = phone.normalise("9876543210", default_country_code=CC)
    assert phone.normalise(once, default_country_code=CC) == once


def test_is_valid_accepts_only_bare_digits_in_range():
    assert phone.is_valid("919876543210")
    assert not phone.is_valid("+919876543210")  # the plus is for display only
    assert not phone.is_valid("12345")
    assert not phone.is_valid(None)
    assert not phone.is_valid("")


def test_display_adds_the_plus_back_for_people():
    assert phone.display("919876543210") == "+919876543210"
    assert phone.display(None) is None


def test_a_different_default_country_code_is_one_argument():
    """A hire outside India is a config line, not a code change."""
    assert phone.normalise("4155550132", default_country_code="1") == "14155550132"
