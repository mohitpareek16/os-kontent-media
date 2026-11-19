# WhatsApp notifications

WhatsApp is a notification channel for Kontent OS. All stage changes, review
feedback, deadlines, files, timestamps and accountability stay in Kontent OS.
The webhook records delivery receipts and inbound contact time, but incoming
messages and button taps never change a job.

## Messages sent

Only the following eleven Utility templates are registered. They have no buttons.
The names use `_v2` so previously approved interactive templates cannot be
mistaken for the new copy.

| Trigger | Template | Recipient |
|---|---|---|
| Job enters Assigned with editor and team deadline | `video_assigned_v2` | Editor |
| Editor sends first draft to QC 1 | `first_draft_ready_v2` | Pod TL |
| TL moves job to QC 2, or a reviewer is later assigned | `video_sent_qc2_v2` | QC 2 reviewer |
| QC 2 approves and moves job to Final | `qc_approved_v2` | Editor |
| QC 2 sends job back with changes | `qc_changes_v2` | Editor |
| QC 2 approves or sends back (either outcome) | `qc2_completed_tl_v2` | Pod TL |
| Editor resubmits a revision to QC 1 | `final_draft_ready_v2` | Pod TL |
| TL marks job Delivered | `video_delivered_v2` | Editor |
| Team deadline is today or tomorrow, job incomplete | `deadline_approaching_v2` | Editor |
| Team deadline has passed, job incomplete | `deadline_missed_v2` | Editor |
| Job is reassigned | `video_reassigned_v2` | New editor |

The actual pipeline sends a revision back through QC 1 and QC 2 before Final
and Delivered. The final-draft message therefore asks the TL to review the
revised cut and complete those checks; it does not imply that delivery can
skip them. QC 2 approval still gives the TL an in-app final-review notification.

Deadline messages use the **team** deadline, never the restricted client
promise date. The hourly scheduler sends approaching reminders at most once in
a 20-hour window and a missed-deadline alert once per editor and job. Delivered and
scrapped jobs are excluded. The job link uses `FRONTEND_BASE_URL` and opens
`/jobs/{id}`.

Other job events and older scheduled digests, stuck-round alerts and unrouted
QC 2 reminders remain in-app only. Existing in-app and desktop push
notifications continue independently of WhatsApp.

## Delivery and setup

`services/notify.py` creates the in-app notification. After the transaction
commits, `services/dispatch.py` fans it out to push and
`services/whatsapp/fanout.py`. The scheduler handles the two date-driven
messages. A WhatsApp failure never rolls back a job change.

Template definitions and parameter order live in
`services/whatsapp/registry.py`. The Owner submits the ten templates in
**Admin → WhatsApp Setup**. Meta must approve them before they can send. Every
template is submitted as `UTILITY`; if Meta reports another category, the
sender skips it and records why in the delivery log. Staff also need a valid
phone number and WhatsApp opt-in, and the integration must be enabled in admin
settings. A fresh deployment starts with messaging disabled.

The old template definitions are no longer registered or sent. Previously
approved old templates may still exist in Meta. Delete those through the
Templates tab once the Meta account is connected; this workspace has no Meta
credentials, so source-code changes cannot remove them from the account.
