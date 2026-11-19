# Future integrations

> **WhatsApp is built.** It shipped as a direct Meta Cloud API integration —
> templates submitted and their status read back through the app's own admin
> page — and the whole of it is documented in
> [WhatsApp notifications](13-whatsapp.md). That page is the current one; what
> follows is the planning spec it was built from, kept because the platform
> constraints it records (the 24-hour window, the Utility/Marketing cap, the
> button-as-cost-lever) are still exactly right, and because the template
> registry below is what the implementation was checked against.
>
> Two things in it are out of date: the template table predates scrap,
> reassign, the QC1 flag and unrouted QC2, and `delivered` moved into a digest
> rather than a message of its own. The current list is in docs/13.

Written before any of it existed, so that Phase 2 would be an implementation
rather than a re-design. It served that purpose; the note above says where the
result is.

Frame.io is deliberately **not** part of this spec — see
[Roadmap](08-roadmap.md#explicitly-out-of-scope-no-current-plan). The editor
edits and uploads the cut to Frame.io themselves, then pastes the share link
into `Job.frame_link` by hand. That stays the permanent workflow; no API
integration is planned.

## WhatsApp Business notifications

### The hard constraint
Business-initiated messages are only free-form within a **24-hour customer
service window**, opened when the recipient messages in. Outside that
window, only pre-approved **templates** can be sent, and Meta review of a new
template can take minutes to 24 hours. Since almost every notification here
is business-initiated ("you've been assigned KM-1052"), the bot fills slots
in pre-approved templates — it does not compose free-form messages. This is
a platform rule, not a design choice.

### Template category
**Utility, never Marketing.** Marketing templates are capped at ~2/user/day
across all businesses combined (error `131049` when blocked) and that limit
cannot be worked around with more phone numbers. Every notification here is
transactional → Utility, uncapped. Getting this classification wrong on
submission silently caps the whole notification system at 2 messages/person/day.

### The cost lever
Meta bills per delivered template message; replies inside the 24-hour service
window are free. **Every template ends in a button** ("Started" / "On it" /
"Picked up") specifically because tapping it opens a free 24-hour window for
every subsequent message on that job. This is the difference between paying
for ~6 messages per video and paying for 1 — design every new template with a
button, not as a dead end.

### Rollout
New templates, and any without a green quality rating yet, are paced for
their first 7 days (limited volume, needs real engagement). Don't cut the
whole team over on day one — ramp a few users first.

### Template registry (design reference — re-verify wording/approval at build time)

| Template | To | Trigger | Buttons |
|---|---|---|---|
| `job_assigned_v1` | Editor | Job assigned | Started / Can't take it |
| `qc1_ready_v1` | TL | Editor marks cut ready | Reviewing now |
| `qc2_assigned_v1` | QC | QC2 routed | Picked up / Reassign me |
| `changes_raised_v1` | Editor | QC requests changes | On it / Need a call |
| `final_check_v1` | TL | QC2 passes | Approve / Send back |
| `deadline_soon_v1` | Editor | Deadline within 24h | On track / Need more time |
| `stuck_rounds_v1` | TL | Job hits round 3 | Looking into it |
| `delivered_v1` | TL | Delivered (digest) | — |
| `daily_digest_v1` | Any | Daily rollup | Open board |

### Event → notification mapping
Drives off the same `JobEvent` log every other feature reads from (see
[Data model](03-data-model.md)) — the WhatsApp sender is a second
`services/notify.py` channel, not a separate pipeline (see
[Backend rules](07-backend-rules.md)).

*As built:* the queue moved out of `services/push.py` into
`services/dispatch.py`, which fans one queued notification id out to both
desktop push and WhatsApp. `notify()` is still the single dispatch point.
`services/whatsapp/events.py` decides whether an event sends and which
template it uses; it deliberately does **not** decide the recipient, which
`notify()` has already worked out.

### Design guardrails carried forward from planning
- **Don't notify on every step.** ~6 messages/video at 300 videos/month is
  1,800 messages hitting 22 people — 80+ pings each. Send immediately only
  for events someone must act on (assigned, changes raised, QC routed, final
  check); roll deliveries/FYIs into a daily digest.
- **A button tap does two jobs at once**: refresh the sender's service window
  *and* advance the job's stage. Map every button payload to an explicit
  state transition — don't treat taps as logging only.
- **`last_inbound_at` on the user record is a first-class write**, not a
  logging side effect — every downstream send checks it to decide
  free-form-reply vs. must-use-template.
- **Keep a non-WhatsApp fallback** for action-critical events. Staff can mute
  or the business number's quality rating can drop, throttling delivery for
  reasons unrelated to this app's code — don't make WhatsApp a single point
  of failure for anything a deadline depends on.
