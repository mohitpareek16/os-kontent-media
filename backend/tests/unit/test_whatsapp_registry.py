"""The template registry's own rules, checked against every template in it.

These are cheap tests guarding an expensive failure. A template whose examples
do not match its parameter count is rejected by Meta at submission; one whose
`params()` returns a different number than its body expects is accepted, sits
approved for days, and then fails with error 132000 on a real hand-off. The
second is the one worth catching here, because nothing downstream can.
"""
from __future__ import annotations

import pytest

from app.services.whatsapp import registry
from app.services.whatsapp.registry import TemplateInvalid, TemplateSpec

pytestmark = pytest.mark.unit


def _context() -> dict:
    """Every key any template's `params()` reads.

    Deliberately a single dict rather than one per template: a template that
    reaches for a key nobody supplies should fail here, at the point the key
    was added, not in a background send where the KeyError is swallowed.
    """
    return {
        "recipient_name": "Farah Q",
        "actor_name": "Rahul",
        "job_code": "KM-1052",
        "job_title": "Diwali campaign teaser",
        "pod_name": "Dhan",
        "video_type": "Short form",
        "deadline": "24 Sep",
        "round": 2,
        "stage_label": "Editing",
        "from_stage_label": "QC 2",
        "note": "Colour grade is too warm",
        "points": 3,
        "editor_name": "Farah",
        "open_count": "4 jobs",
        "overdue_count": 1,
        "due_soon_count": 2,
        "next_job": "KM-1052 — Diwali campaign teaser",
        "job_url": "https://kontent.media/jobs/example",
        "tl_name": "Rahul",
    }


def test_every_template_passes_metas_structural_rules():
    for spec in registry.all_specs():
        registry.validate(spec)


@pytest.mark.parametrize("spec", registry.all_specs(), ids=lambda s: s.name)
def test_params_returns_exactly_what_the_body_expects(spec):
    """The 132000 guard.

    Meta counts `{{n}}` in the approved body; the sender supplies whatever
    `params()` returns. When those disagree the message is refused — days
    later, in production, on somebody's job.
    """
    values = spec.params(_context())
    assert len(values) == spec.param_count(), (
        f"{spec.name} body has {spec.param_count()} parameters but params() "
        f"returned {len(values)}"
    )


@pytest.mark.parametrize("spec", registry.all_specs(), ids=lambda s: s.name)
def test_no_parameter_is_ever_empty_or_multiline(spec):
    """Meta rejects an empty parameter, and one containing a newline or four
    consecutive spaces (error 132007) — at *send* time, not at submission."""
    for value in spec.params(_context()):
        assert value, f"{spec.name} produced an empty parameter"
        assert "\n" not in value
        assert "    " not in value


@pytest.mark.parametrize("spec", registry.all_specs(), ids=lambda s: s.name)
def test_every_template_is_utility_and_has_no_button(spec):
    assert spec.category == "UTILITY"
    assert not spec.buttons


def test_only_requested_notification_templates_are_registered():
    assert {spec.name for spec in registry.all_specs()} == {
        "video_assigned_v2", "first_draft_ready_v2", "video_sent_qc2_v2",
        "qc_approved_v2", "qc_changes_v2", "final_draft_ready_v2",
        "video_delivered_v2", "deadline_approaching_v2",
        "deadline_missed_v2", "video_reassigned_v2",
    }


def test_params_survive_a_blank_recipient_name():
    """A deactivated account joins in as a null name. The greeting must not
    raise inside a background send, where the exception would be swallowed and
    the message simply lost."""
    context = {**_context(), "recipient_name": ""}
    for spec in registry.all_specs():
        values = spec.params(context)
        assert len(values) == spec.param_count()


def test_hash_changes_when_the_body_changes():
    """`registry_hash` is the drift signal. If a reworded body hashed the same,
    the Templates tab would show no drift for a template that can no longer be
    filled correctly."""
    spec = registry.get("video_assigned_v2")
    reworded = TemplateSpec(
        name=spec.name,
        header=spec.header,
        body=spec.body + " Thanks.",
        examples=spec.examples,
        buttons=spec.buttons,
        params=spec.params,
    )
    assert spec.hash() != reworded.hash()


def test_hash_ignores_things_meta_never_sees():
    """`purpose` and `recipient` are ours. A comment edit must not light up a
    warning whose only meaning is "resubmit to Meta"."""
    spec = registry.get("video_assigned_v2")
    annotated = TemplateSpec(
        name=spec.name,
        header=spec.header,
        body=spec.body,
        examples=spec.examples,
        buttons=spec.buttons,
        recipient=spec.recipient,
        purpose="Something else entirely",
        params=spec.params,
    )
    assert spec.hash() == annotated.hash()


# --------------------------------------------------------------------------
# validate() itself
# --------------------------------------------------------------------------


def _spec(**overrides) -> TemplateSpec:
    base = {
        "name": "t",
        "body": "Hi {{1}}, your job {{2}} is ready.",
        "examples": ["Farah", "KM-1"],
        "buttons": (),
    }
    return TemplateSpec(**{**base, **overrides})


def test_validate_rejects_missing_examples():
    with pytest.raises(TemplateInvalid, match="sample values"):
        registry.validate(_spec(examples=["Farah"]))


def test_validate_rejects_a_body_ending_in_a_parameter():
    with pytest.raises(TemplateInvalid, match="begin or end"):
        registry.validate(_spec(body="Your job is {{1}}", examples=["KM-1"]))


def test_validate_rejects_a_body_starting_with_a_parameter():
    with pytest.raises(TemplateInvalid, match="begin or end"):
        registry.validate(_spec(body="{{1}} is ready now", examples=["KM-1"]))


def test_validate_rejects_adjacent_parameters():
    with pytest.raises(TemplateInvalid, match="adjacent"):
        registry.validate(_spec(body="Job {{1}}{{2}} is ready", examples=["A", "B"]))


def test_validate_rejects_gappy_numbering():
    with pytest.raises(TemplateInvalid, match="numbered"):
        registry.validate(_spec(body="Hi {{1}}, job {{3}} is ready", examples=["A", "B"]))


def test_validate_accepts_a_template_with_no_button():
    registry.validate(_spec(buttons=()))


def test_validate_rejects_a_button():
    with pytest.raises(TemplateInvalid, match="must not have buttons"):
        registry.validate(_spec(buttons=(registry.Button("Start", "START"),)))


def test_clean_param_flattens_whitespace_and_never_returns_empty():
    assert registry.clean_param("a\nb") == "a b"
    assert registry.clean_param("a    b") == "a b"
    assert registry.clean_param("") == "—"
    assert registry.clean_param(None) == "—"


def test_components_carry_the_example_block_meta_requires():
    spec = registry.get("video_assigned_v2")
    body = next(c for c in spec.components() if c["type"] == "BODY")
    assert body["example"]["body_text"] == [list(spec.examples)]
