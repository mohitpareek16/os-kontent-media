"""Map the requested Kontent OS events to notification-only WhatsApp templates.

In-app notifications choose recipients. This module only chooses which of those
recipients gets the specified WhatsApp message and fills its parameters.
"""
from __future__ import annotations

from app.core.config import get_settings
from app.models.job import Job
from app.models.pod import Pod
from app.models.user import User
from app.services.notification_text import STAGE_LABELS

# event key -> template name.
#
# For `stage_changed` the key is `stage_changed:<stage the job entered>`,
# because one event type covers seven different messages and the stage is what
# tells them apart. Everything else is its own event type.
EVENT_TEMPLATES: dict[str, str] = {
    "stage_changed:assigned": "video_assigned_v2",
    "stage_changed:qc1": "first_draft_ready_v2",
    "stage_changed:qc1:revisions": "final_draft_ready_v2",
    "stage_changed:qc2": "video_sent_qc2_v2",
    "qc2_assigned_v1": "video_sent_qc2_v2",
    "stage_changed:revisions:qc2": "qc_changes_v2",
    "stage_changed:final": "qc_approved_v2",
    "stage_changed:delivered": "video_delivered_v2",
    "job_reassigned": "video_reassigned_v2",
}


def event_key(event_type: str, payload: dict) -> str:
    """The lookup key for an event, collapsing stage into the type where the
    stage is what decides the message."""
    if event_type == "stage_changed":
        stage = (payload or {}).get("stage")
        source = (payload or {}).get("from_stage")
        # A re-cut reaches QC1 from `editing`, the same move as a first draft —
        # revisions always goes back through the edit bay (stage_machine). The
        # round is what tells them apart: it only rises on a send-back.
        # `from_stage == "revisions"` is kept for events logged before that.
        if stage == "qc1" and (source == "revisions" or (payload or {}).get("round", 0) > 0):
            return "stage_changed:qc1:revisions"
        if stage == "revisions" and source == "qc2":
            return "stage_changed:revisions:qc2"
        return f"stage_changed:{stage}"
    return event_type


def template_for(*, key: str, job: Job, recipient_id, payload: dict | None = None) -> str | None:
    """The template this event sends, or None when it sends nothing.

    Recipient filters keep the WhatsApp audience aligned with the requested
    message, while in-app notifications still reach everyone responsible.
    """
    if key == "stage_changed:qc2" and job.qc2_reviewer_id != recipient_id:
        return None
    # QC 2 finished either way: the editor gets their own message, the TL
    # (the only other recipient of these two events) gets the outcome.
    if key in ("stage_changed:final", "stage_changed:revisions:qc2") and recipient_id != job.assigned_editor_id:
        return "qc2_completed_tl_v2"
    new_editor_id = (payload or {}).get("to_editor_id")
    if key == "job_reassigned" and str(recipient_id) != str(new_editor_id or job.assigned_editor_id):
        return None
    return EVENT_TEMPLATES.get(key)


def build_context(
    *,
    job: Job,
    pod: Pod | None,
    recipient: User,
    actor_name: str | None,
    payload: dict,
    video_type_label: str,
    deadline_label: str,
) -> dict:
    """Everything a template's `params()` may ask for, in one flat dict.

    Flat and pre-formatted rather than the ORM objects themselves: `params()`
    runs inside the background send, where a lazy relationship load is a
    `MissingGreenlet` rather than a slow query, and a template that reached
    through `job.pod.name` would fail only in production and only sometimes.
    """
    note = (payload or {}).get("note") or (payload or {}).get("reason")
    from_stage = (payload or {}).get("from_stage")
    stage = (payload or {}).get("stage") or job.stage
    return {
        "recipient_name": recipient.name or "",
        "actor_name": actor_name or "Someone",
        "job_code": job.code,
        "job_title": job.title,
        "pod_name": pod.name if pod is not None else "—",
        "video_type": video_type_label,
        "deadline": deadline_label,
        "round": (payload or {}).get("round", job.round),
        "stage_label": STAGE_LABELS.get(stage, stage),
        "from_stage_label": STAGE_LABELS.get(from_stage, from_stage or "review"),
        "note": note,
        "points": (payload or {}).get("points"),
        "editor_name": None,
        "job_url": f"{get_settings().frontend_base_url.rstrip('/')}/jobs/{job.id}",
        "tl_name": (payload or {}).get("tl_name") or "your TL",
        "qc2_result": (
            "Approved, ready for your final review"
            if stage == "final"
            else "Changes requested, sent back to the editor"
        ),
    }
