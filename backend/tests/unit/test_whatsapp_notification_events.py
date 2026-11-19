"""The requested event list is the only source of WhatsApp job messages."""
from types import SimpleNamespace

import pytest

from app.services.whatsapp import events

pytestmark = pytest.mark.unit


def test_stage_events_follow_first_draft_revision_and_qc_outcomes():
    assert events.event_key("stage_changed", {"stage": "qc1", "from_stage": "editing"}) == "stage_changed:qc1"
    assert events.event_key("stage_changed", {"stage": "qc1", "from_stage": "editing", "round": 0}) == "stage_changed:qc1"
    # A re-cut after a TL send-back arrives from `editing` too; the round marks it.
    assert events.event_key("stage_changed", {"stage": "qc1", "from_stage": "editing", "round": 1}) == "stage_changed:qc1:revisions"
    assert events.event_key("stage_changed", {"stage": "qc1", "from_stage": "revisions"}) == "stage_changed:qc1:revisions"
    assert events.event_key("stage_changed", {"stage": "revisions", "from_stage": "qc2"}) == "stage_changed:revisions:qc2"
    assert events.event_key("stage_changed", {"stage": "revisions", "from_stage": "qc1"}) == "stage_changed:revisions"


def test_only_requested_recipients_get_whatsapp():
    job = SimpleNamespace(qc2_reviewer_id="qc", assigned_editor_id="editor")
    assert events.template_for(key="stage_changed:qc2", job=job, recipient_id="qc") == "video_sent_qc2_v2"
    assert events.template_for(key="stage_changed:qc2", job=job, recipient_id="tl") is None
    assert events.template_for(key="stage_changed:final", job=job, recipient_id="editor") == "qc_approved_v2"
    assert events.template_for(key="stage_changed:final", job=job, recipient_id="tl") is None
    assert events.template_for(key="job_reassigned", job=job, recipient_id="editor") == "video_reassigned_v2"
    assert events.template_for(key="job_reassigned", job=job, recipient_id="old-editor") is None
    assert events.template_for(key="stage_changed:delivered", job=job, recipient_id="editor") == "video_delivered_v2"
    assert events.template_for(key="job_scrapped", job=job, recipient_id="editor") is None
