"""What a notification *says*, in one sentence, in one place.

This wording used to live only in the browser
(`frontend/src/lib/notificationText.ts`), which was the right call while the
inbox and the toast were its two readers: they are the same app, and the file
says in its own comment that one event must not be described two ways.

Push notifications add a third reader that cannot import that file — a service
worker woken by the OS with no page behind it, given whatever the server put
in the payload. Writing the same sentences a second time, in a second
language, is exactly the drift the original comment was guarding against. So
the sentence moves here, `NotificationRead.headline` carries it, and the
inbox, the toast and the push notification all read the one string.

The browser keeps the *icon* and the *tone*: those are decisions about how a
row looks, they have no meaning outside a screen, and a CSS class is not a
sentence.

Every headline names the job by its code. A notification that does not say
which video it is about is one somebody has to open to find out, which is the
same as not having sent it.
"""

STAGE_LABELS = {
    "intake": "Intake",
    "assigned": "Assigned",
    "editing": "Editing",
    "qc1": "QC 1",
    "qc2": "QC 2",
    "revisions": "Revisions",
    "final": "Final check",
    "delivered": "Delivered",
}


def brand_headline_for(*, action: str, actor_name: str | None, title: str, pod_name: str) -> str:
    verb = {
        "file_added": "added a file to",
        "file_updated": "updated a file in",
        "link_added": "added a link to",
        "link_updated": "updated a link in",
        "link_removed": "removed a link from",
    }.get(action, "changed")
    return f"{actor_name or 'Someone'} {verb} {pod_name}'s brand kit: {title}"


def headline_for(
    *, event_type: str, job_code: str, actor_name: str | None, stage: str | None
) -> str:
    """One line: who did what, to which video.

    `actor_name` is nullable — the actor may be a deactivated account whose
    join came back empty — so it falls back to "Someone" rather than printing
    a bare verb with nobody in front of it.
    """
    who = actor_name or "Someone"
    stage_label = STAGE_LABELS.get(stage) if stage else None

    if event_type == "intake":
        return f"{who} created {job_code}"
    if event_type == "stage_changed":
        return (
            f"{who} moved {job_code} to {stage_label}"
            if stage_label
            else f"{who} moved {job_code} along"
        )
    if event_type == "changes_raised":
        return f"{who} requested changes on {job_code}"
    if event_type == "note_added":
        return (
            f"{who} commented on {job_code} at {stage_label}"
            if stage_label
            else f"{who} commented on {job_code}"
        )
    if event_type == "job_updated":
        return f"{who} edited the details on {job_code}"
    if event_type == "job_reassigned":
        # Deliberately does not say who it went to: this lands on the editor
        # who lost it, the one who gained it and the TL, and one sentence
        # cannot be right for all three.
        return f"{who} moved {job_code} to a different editor"
    if event_type == "job_scrapped":
        return f"{who} scrapped {job_code} — stop work on it"
    if event_type == "qc1_flag_raised":
        # Says what was claimed, not that it is true. The reason rides on the
        # line below and the answer belongs on the job.
        return f"{who} flagged QC1 on {job_code} as not done"
    if event_type == "qc1_flag_cleared":
        return f"{who} cleared the QC1 flag on {job_code}"
    if event_type == "qc2_assigned_v1":
        return f"{job_code} was routed to you for QC2"
    if event_type == "job_restored":
        return f"{who} restored {job_code}"
    # An event type nobody has written a sentence for yet still names the job
    # and the actor, which is more use than "Job stage changed".
    return f"{who} · {event_type.replace('_', ' ')} on {job_code}"


def body_for(*, job_title: str, pod_name: str, note: str | None) -> str:
    """The second line — which video, for which client, and the first line of
    whatever the person typed.

    First line only: a QC change list can run to a paragraph, and an OS
    notification truncates it mid-word anyway. The full text is on the job.
    """
    trimmed = (note or "").strip().split("\n")[0].strip()
    if trimmed:
        return f"{job_title} · {pod_name} — “{trimmed}”"
    return f"{job_title} · {pod_name}"
