# Data model

Postgres, one schema. Entities below are the v1 shape — field lists are a
starting point for the first migration, not frozen.

## Entity relationship overview

```
User ──< PodMember >── Pod ──< Job
  │                      │        │
  │                      │        ├──< JobEvent (append-only log)
  │                      │        ├──< JobLink (raw files in, cuts out)
  │                      │        ├──< Notification
  │                      │        │
  └──────────────────────┴────────┴──< Qc2Charge (QC2 points ledger)
  │                      │
  │                      ├──< Channel ──< Job.channel_id
  │                      └──< BrandAsset
  │
  └── Team (lead_id) ─ optional grouping, see note below
```

Client and Pod are **the same entity** — there is no separate `Client` table.
One client is one pod, owned by exactly one TL (`Pod.tl_id`). A pod carries
its client attributes (name, status, billing, retainer volume) directly; see
[Overview](01-overview.md#client-pods) for why this is deliberate and not two
things wearing one name.

## Entities

### User
```
id                uuid pk
name              text
email             text unique
password_hash     text
phone             text nullable        -- needed later for WhatsApp identity
role              enum(owner, tl, qc, ve, hr, fo)
team_id           fk -> Team, nullable  -- people-management grouping, not work routing
max_concurrent_jobs int default 5       -- videos an editor may hold at once; enforced
                                        -- on every assignment path, a slot frees on delivery
employment_type   enum(full_time, part_time) default full_time
                                        -- a QC reviewer's daily points budget is DERIVED
                                        -- from this (24 / 12), never stored per account
available         boolean default true  -- "no new QC work today", read by route_qc2
is_active         boolean default true  -- account switch: a leaver cannot log in
created_at        timestamptz
```

`fo` is the Founder's Office: the Owner's access to every pod, job and
analytic, without the power to create or administer an owner-level account.
`ADMIN_ROLES` in `models/user.py` is the tuple every "may administer accounts"
check reads; `ALL_PODS_ROLES` (the same two plus `hr`) is the one every "sees
and runs all the work" check reads. The handful of places that mean the Owner
*specifically* are listed in [Permissions](04-permissions.md).

`hr` is people-ops: it creates accounts for the roles that do the work, and
holds a Team Lead's powers over the work itself — jobs, stages, delivery,
analytics, the bot — company-wide rather than on "own pods". It is still not
a *pod* role: `PodMember.pod_role` stays `(tl, qc, ve)` and adding an HR
account to a pod is refused, because HR needs no membership row to reach a
pod and a row would file them under a job they don't do. Scope checks read
`ALL_PODS_ROLES` in `models/user.py`; `ADMIN_ROLES` (which HR is *not* in)
stays the tuple that guards accounts and impersonation. See
[Permissions](04-permissions.md).

`employment_type` buys exactly one thing: the QC2 points budget
(`routing.CAPACITY`). It is a two-value enum rather than a number of hours
because the product has one question to ask of it — full day or half — and a
free-text figure would invite a third answer nothing knows how to price. The
budget is derived and never written to a column, so changing what a part-time
day is worth changes it for everybody at once rather than for whoever gets
edited.

**`user_events`** records who switched an account off, and when. It exists
because the off-switch left the admin tier: HR can now deactivate the roles HR
onboards, so `is_active` is a boolean more than one person can flip, and a
boolean remembers nothing about how it got that way.

```
user_events
id          uuid pk
target_id   fk -> User, indexed with created_at desc
actor_id    fk -> User, nullable   -- nullable so a leaver's own actions outlive them
action      enum(deactivated, reactivated)
reason      text nullable          -- optional; a required box collects "left" a hundred times
created_at  timestamptz
```

Two actions only. This is not a general audit log for every field on an
account — a rename does not need a row. Locking somebody out of the company's
tooling does, because that is the change people come back and ask about. Every
path that flips the switch writes one: HR's `POST /users/{id}/deactivate` and
the Owner's `PATCH /users/{id}` both go through
`routers/users.py::set_account_active`.

**`push_subscriptions`** is one row per *browser* that has agreed to be
interrupted — a desktop and a laptop are two, and both should ring.

```
push_subscriptions
id           uuid pk
user_id      fk -> User, indexed
endpoint     text unique      -- the push service's URL for this browser; the natural key
p256dh       varchar(255)     -- the browser's public key
auth         varchar(255)     -- shared secret; the payload is encrypted to these two
user_agent   varchar(400) nullable  -- so "my laptop" is distinguishable from "my phone"
created_at   timestamptz
last_seen_at timestamptz      -- bumped on every re-registration
```

Rows here are **deleted**, not deactivated — the mirror image of `users`. A
revoked subscription answers 410 forever and has no history worth keeping, so
`services/push.py` drops it on the first such answer.

`available` and `is_active` are deliberately separate — a holiday is not an
exit, and overloading one flag for both would silently un-deactivate anyone
who toggled themselves back on. **Users are never deleted**: their id is
referenced by every job, event and notification they ever touched, so a
leaver is deactivated instead. See [Permissions](04-permissions.md#account-lifecycle).

### Team
```
id       uuid pk
name     text
lead_id  fk -> User
```
Exists purely for people-management (leave, pay, 1:1s). Never referenced by
`Job` or routing logic — see [Permissions](04-permissions.md) for why this
stays separate from `Pod`.

### Pod
```
id                uuid pk
name              text            -- e.g. "Dhan" — the client's name
tl_id             fk -> User       -- accountable for output, see permissions doc
status            enum(active, paused, churned)
billing_currency  text
retainer_volume   int nullable   -- expected videos/month, informs capacity planning
onboarded_by      fk -> User
created_at        timestamptz
```
Client and Pod merged into this one table on purpose — don't reintroduce a
separate `Client` entity above it. See [Overview](01-overview.md#client-pods).

### Channel
```
id           uuid pk
pod_id       fk -> Pod
name         text                   -- "Dhan HQ", "AAD", "lwdhan"
archived_at  timestamptz nullable   -- retired: off the pickers, still on old jobs
created_by   fk -> User
created_at   timestamptz
unique (pod_id, name)
```
One of the places a client publishes. A pod is the client; a channel is a
destination inside it, and it is deliberately **not** a second pod — the
roster, the capacity and the first-pass rate all belong to the client, and
splitting Dhan into three pods to record a destination would split all three
with it.

`Job.channel_id` is nullable and stayed NULL on every row that predates
migration 0020. A channel is something a person chooses; one inferred from a
title renders identically to a chosen one, so the backlog is filed by hand
instead — a row at a time from the pipeline table's own Channel column, or a
whole selection at once through `POST /jobs/bulk-channel`, which is the only
practical way to file the few hundred rows that predate the table. Filing by
hand is not the same as filing one at a time. There is no delete, only
`archived_at`.

`GET /pods/channels` is the same list across every client the caller can see,
each row carrying its `pod_name`. It exists because the pipeline table's
resting state is *All Clients*: scoped per pod, the channel filter had nothing
to offer on the one screen a lead spends the day in. Scope is
`pod_scope_clauses` — identical to `GET /pods`.

### PodMember
```
pod_id        fk -> Pod
user_id       fk -> User
pod_role      enum(tl, qc, ve)
certified_at  timestamptz nullable   -- set once cert rule is met, see 05
primary key (pod_id, user_id)
```

### BrandAsset
```
id           uuid pk
pod_id       fk -> Pod
type         enum(brief, sop, kit, do_not)
title        text
file_path    text        -- relative path under /data/uploads, see 02-architecture
version      int default 1
uploaded_by  fk -> User
created_at   timestamptz
```

### Job
```
id                 uuid pk
code               text unique      -- e.g. "KM-1052", from the job_code_seq sequence
title              text
pod_id             fk -> Pod
stage              enum(intake, assigned, editing, qc1, qc2, revisions, final, delivered)
video_type         enum(podcast, long_form, short_form)  -- the format, on every screen
weight             enum(light, standard, heavy)   -- drives EDITOR load; nobody is asked for it
rush               boolean default false  -- lets QC2 routing overflow a full reviewer, see 05
assigned_editor_id fk -> User, nullable
qc2_reviewer_id    fk -> User, nullable            -- sticky once set, see 05
channel_id         fk -> Channel, nullable          -- which of the client's channels
frame_link         text nullable                    -- POINTER to the newest video JobLink,
                                                    -- maintained by services/job_links.py;
                                                    -- nothing else writes it
round              int default 0                     -- increments on every send-back
deadline           date nullable                     -- the TEAM deadline: what everybody sees
client_deadline    date nullable                     -- the PROMISE: Owner + pod TL only, see below
delivered_at       timestamptz nullable
client_sheet_ok    boolean default false             -- delivery checklist, see below
ops_tracker_ok     boolean default false
scrapped_at        timestamptz nullable   -- cancelled before delivery, see below
scrapped_by_id     fk -> User, nullable
scrap_reason       text nullable
qc1_flagged_at     timestamptz nullable   -- QC1 never really happened, see below
qc1_flagged_by_id  fk -> User, nullable    -- the QC2 reviewer who raised it
qc1_flag_tl_id     fk -> User, nullable    -- who cleared QC1, snapshotted
qc1_flag_reason    text nullable
created_by         fk -> User
created_at         timestamptz
updated_at         timestamptz
```

**Two deadlines, because there are two facts.** `deadline` is the **team
deadline** — the date the pod works to, the date on every row, queue and
overdue count, and the date the hand-off gate requires
(`stage_machine.is_briefed`). `client_deadline` is what the client was
actually promised, and it is usually a few days later: a TL who wants a
revision round to have somewhere to go sets the team's date earlier, and the
promise has to survive that or nobody can say how much room is left.

`deadline` did not change meaning when the second column arrived — everything
that reads it already meant the team's date, which is why this was additive.

**`client_deadline` is the Owner's and the pod TL's, and nobody else's.** That
is enforced in the API, not by the column: `services/access.py::
visible_client_deadline` is the one place that decides, and it is applied on
every read path — the job payloads, the activity feed (a `job_updated` event
carrying a `client_deadline` key is stripped for non-leads) and the bot's job
tools. Redaction at the edge rather than hiding in the browser, for the
obvious reason: a payload carrying both dates to an editor's browser has
already told them. See [permissions](04-permissions.md).

Nothing was backfilled. An existing `deadline` is not evidence of what a
client was told, and a guessed promise renders identically to a chosen one —
the same reasoning as `channel_id` (migration 0022).

**Video type is what people say; weight was what they guessed.** `video_type`
(podcast / long form / short form) is on the row a TL fills in, in the table,
in the filters and in the bulk paste. It replaced `weight` on every screen:
weight asked for a difficulty estimate at the moment nobody knew the job yet,
and nothing ever compared the estimate to how long the cut really took.

`weight` is still a column, because **editor** load is counted in it
(`services/routing.py::WEIGHT_POINTS` — light 1, standard 2, heavy 4). No form
asks for it any more, so every new job takes `standard`, which makes editor
load a job count in disguise. That was the holding position migration 0018
wrote down for *both* load models; QC2 has since been rebuilt on `video_type`
and a daily points budget (migration 0019, [QC2 load model](12-qc2-load-model.md)),
and the editor half is still waiting.

The two cannot share a column, which is the reason `video_type` was made a
separate field in the first place: a podcast is quick to cut and slow to
review, so the same job is cheap to an editor and expensive to a reviewer.

`rush` buys exactly one thing, and it is worth being precise about what: when
no reviewer has room for a job, a rush job may be pushed onto the least-loaded
of them at up to 125% of their day rather than holding in the unrouted pile.
It is not a priority sort, it does not jump a queue, and it does not change
what the review costs. A flag that quietly did any of those would be on every
job inside a month.

**Scrapping is not a stage.** A cancelled project keeps the stage it died at,
so "we dropped this at QC2 on round 3" and "we dropped it before anyone
touched it" stay distinguishable — a `scrapped` value in the stage enum would
have erased that, broken the linear FORWARD table in `stage_machine.py`, and
made restoring one impossible. `scrapped_at IS NULL` is therefore the "this
job still counts" predicate, and it lives in exactly one place:
`services/access.py::not_scrapped()`, composed onto every list, count and
capacity query. Do not retype it — the query that forgets it is the one that
reports a cancelled project as in flight.

The three columns are written together or not at all (check constraint,
migration 0012). A scrapped row with no reason is precisely the row nobody can
explain six months later, which is the only reason the feature exists. Work
is refused on a scrapped job — stage moves, edits and the delivery checklist
all 400 — while comments stay open, because the decision is exactly the thing
people carry on discussing.

**A flagged QC1 is not a stage either**, for the same reason: the job carries
on exactly where it was — same stage, same round — because the flag is a
statement about something that already happened to it, not a send-back. The
four columns move together the same way (check constraint, migration 0013), and
`qc1_flag_tl_id` is *who cleared QC1*, snapshotted when the flag was raised: a
pod's TL changes, and the flag is about a person rather than a chair. The
reason it lives on the job at all, rather than only in the log, is that every
list, row tint and dashboard count asks "is this flagged" per row, and that
must not be a subquery over `job_events` each time. See
[Pipeline](05-pipeline-and-routing.md) for what it means and who may raise one.

**How QC1 went is derived, not stored** — `services/qc1_review.py` reads the
`stage_changed` and note events around the qc1 → qc2 move to answer who
cleared it, how long it had been sitting there and whether anything was said.
Facts, no verdict, and no threshold column anywhere: "cleared fast and said
nothing" is usually a rubber stamp and occasionally a TL who watched the cut
being made, and the system cannot tell those apart. A person raises the flag.

**How QC1 was passed is on the event, not on the job.** The `stage_changed`
row for a qc1 → qc2 move carries `qc1_outcome` — `approved` or
`comments_added`. It belongs there rather than in a column because it
describes *that* pass through QC1, and a job on round three has been through
three of them; a column would only ever remember the last. See
[Pipeline](05-pipeline-and-routing.md).

`client_sheet_ok` / `ops_tracker_ok` exist only as a migration bridge from the
current dual-spreadsheet habit — the goal is for the platform itself to *be*
the single source of truth, with any client-facing export generated from it.
Don't build more around these two flags; they're a checklist, not a feature to
extend.

### JobLink
```
id           uuid pk
job_id       fk -> Job on delete cascade
kind         enum(raw, video)
title        text nullable    -- "A-roll", "Graphics pack", "Round 2 cut"
url          text
added_by_id  fk -> User
created_at   timestamptz
```
Two lists on a job, with two different owners: **raw** is what the client sent
and only the pod's TL may add it; **video** is the cut and only the job's
assigned editor may. Either may have several — a shoot arrives as A-roll,
B-roll and a graphics pack, and an edit leaves as one export per round.

This replaced a single `Job.frame_link` column that was doing both jobs and
could only hold one at a time, so whichever was written last was what
everybody saw. The visible symptom: an editor's "paste your Frame.io link" box
opened pre-filled with the client's Drive folder. The column survives as a
pointer to the newest `video` link so every row icon and panel that reads it
goes on working; `services/job_links.py` is the only thing that writes it.

Migration 0021 backfills every existing `frame_link` into a link row — `raw`
for jobs still at intake or assigned (and the column cleared, which is the fix
itself), `video` for anything that has reached the edit bay.

### Qc2Charge

```
id           uuid pk
job_id       fk -> Job
reviewer_id  fk -> User
work_date    date                  -- the working day this is spent against, in
                                   -- settings.qc2_day_timezone (Asia/Kolkata), NOT utc
points       int                   -- the price, STAMPED, never recomputed from `round`
video_type   enum(podcast, long_form, short_form)   -- stamped for the same reason
round        int
created_at   timestamptz
released_at  timestamptz nullable  -- set when the job leaves QC2 in EITHER direction
```

One row per round of QC2 review. The whole model is
[QC2 load model](12-qc2-load-model.md); what matters here is why the table
exists at all.

QC2 load **cannot be derived from open jobs** the way editor load is, because
the budget is *daily*: a reviewer who burns 24 points by lunch is done until
tomorrow, and clearing a job at noon does not hand the points back. An
open-jobs query can only answer "what is on their plate right now", which is a
work-in-progress cap — a different rule. So the spend is written down, and a
reviewer's load is one query over this table: everything dated today, plus
anything still open from an earlier day. A row matching both is still one row.

Three things are worth knowing before touching it:

- **`released_at` is not a refund.** It marks a round finished — set when the
  job passes to Final *or* goes back to Revisions, because the reviewer's work
  for that round is done either way. The row keeps counting for the rest of the
  day it was spent on; releasing only stops it counting tomorrow. When the
  re-cut returns, a **new** charge is written at the re-review price against
  the day it returns on.
- **`points` and `video_type` are stamped, not derived.** A repeat round costs
  half — but only for the reviewer who already watched the cut, and `Job.round`
  cannot tell those two apart. A job's type can also be corrected later through
  `PATCH /jobs/{id}`, and a correction must not rewrite what a reviewer's
  Tuesday cost them.
- **Three indexes, each one a query the router runs**: `(reviewer_id,
  work_date)` and a partial on `reviewer_id WHERE released_at IS NULL` are the
  two halves of the load sum; a **partial unique on `job_id WHERE released_at
  IS NULL`** keeps a job to one open round, so two assignment paths racing
  cannot bill one review twice.

`services/routing.py::charge` and `::release` are the only two functions that
write this table. Nothing else may insert or update a row.

### JobEvent (append-only)
```
id          uuid pk
job_id      fk -> Job
event_type  text       -- see the list below
actor_id    fk -> User
payload     jsonb      -- event-specific detail, free-form on purpose
created_at  timestamptz  -- clock_timestamp(), not now() — see migration 0003
```

Event types currently written:

| `event_type` | Written when | Payload |
|---|---|---|
| `intake` | job created | `{}` |
| `stage_changed` | any stage move | `stage`, `from_stage`, `round` |
| `changes_raised` | a send-back with a change list | `note`, `from_stage`, `stage`, `round` |
| `note_added` | a comment, with or without a stage move | `note`, `stage`, `round` |
| `job_updated` | title/deadline/client deadline/video type/rush/channel/editor edited, including one row of a bulk filing | `{field: {from, to}}` per field — `channel` carries **names**, not ids. A bulk file writes one event per job that actually moved, and none for a job already under that channel |
| `link_added` | a raw file or a cut linked on the job | `kind`, `title`, `url` |
| `link_removed` | a link taken off the job | `kind`, `title`, `url` |
| `job_reassigned` | job handed to a different editor | `reason`, `from_editor_id`, `from_editor_name`, `to_editor_id`, `to_editor_name`, `stage`, `round` |
| `qc2_claimed` | a QC picks up an unrouted QC2 job | `stage`, `round` |
| `job_scrapped` | project cancelled before delivery | `reason`, `stage`, `round` |
| `job_restored` | a scrap undone | `reason` (nullable), `stage`, `round`, `scrapped_at` |
| `qc1_flag_raised` | a reviewer says QC1 never happened | `reason`, `tl_id`, `tl_name`, `cleared_at`, `seconds_at_qc1`, `comments_at_qc1`, `stage`, `round` |
| `qc1_flag_cleared` | the flag withdrawn or dismissed | `reason` (nullable), `tl_id`, `raised_at`, `raised_reason`, `stage`, `round` |

`qc1_flag_raised` carries the evidence that was on screen when the call was
made — the elapsed time and the comment count — rather than leaving them to be
re-derived later. The derivation reads the event log, and a stage move
corrected afterwards would quietly change what the reviewer is on record as
having seen.

`job_reassigned` carries both editors' **names** as well as their ids, which
is the one place a payload deliberately denormalises. The feed is read months
later, when the job has changed hands again and one of the accounts may have
been deactivated and dropped out of every picker; an id the timeline endpoint
would have to join twice to render is an id nobody ever reads. Note also that
the stage does not move on a handover — only the name on the job does — so the
`stage` in the payload is where it happened, not a transition.

`created_at` defaults to `clock_timestamp()` rather than `now()`: `now()` is
the *transaction* start time, so a stage change and the change list written
with it shared one timestamp and the feed returned them in arbitrary order —
which is how "Job created" once rendered *after* "moved to assigned".
This is the backbone of the whole system: analytics, the activity feed, and
the future AI chatbot (Phase 3) all read from this table. Every stage
transition, assignment, and routing decision writes one row here — nothing
overwrites history in place.

### Notification
```
id          uuid pk
user_id     fk -> User
event_id    fk -> JobEvent
channel     enum(in_app, whatsapp)   -- only ever written as 'in_app'; see below
read_at     timestamptz nullable
created_at  timestamptz
```

**`channel` has a second value and nothing writes it.** The plan was one row
per delivery. It is one row per *notification*: `routers/notifications.py`
does not filter on `channel`, so a second row per event would show every item
in the inbox twice and double the unread count — and a Notification has
nowhere to put a `wamid`, a delivery status, an error code or the parameters
that were interpolated. Desktop push and WhatsApp are extra *deliveries* of
this one row, and WhatsApp's own state lives in `whatsapp_messages` below.

### WhatsApp (Phase 2, migrations 0025–0026)

Four tables, and they split cleanly into configuration and history. The full
reasoning is in [WhatsApp notifications](13-whatsapp.md); this is the shape.

```
whatsapp_templates                 -- a mirror of Meta's answer to "may we send this"
id                  uuid pk
name, language      unique together
meta_template_id    text nullable
status              text           -- PENDING/APPROVED/REJECTED/PAUSED/...
category            text           -- what Meta currently says
requested_category  text           -- what we asked for: always UTILITY
rejected_reason     text nullable
quality_score       text nullable  -- GREEN/YELLOW/RED
components          jsonb          -- exactly what was submitted
registry_hash       text nullable  -- fingerprint of the code at submit time
submitted_at / approved_at / last_status_at / last_synced_at

whatsapp_messages                  -- one row per message handed to Meta
id                  uuid pk
notification_id     fk -> Notification, nullable   -- null for scheduled sends
user_id             fk -> User
job_id              fk -> Job, nullable
event_key           text           -- which rule produced it
template_name/language, to_phone
wamid               text unique nullable
status              text           -- queued/sent/delivered/read/failed/skipped
reason, error_code, error_detail
params              jsonb          -- the values actually interpolated
button_nonce        text           -- consumed by the first tap
sent_at / delivered_at / read_at / failed_at / created_at

whatsapp_webhook_events            -- every body Meta sent, before it is understood
dedupe_key          text unique    -- the lock that makes processing idempotent
field, payload, received_at, processed_at, error

whatsapp_settings                  -- one row: the switches, without a deploy
enabled             bool           -- the kill switch, false on arrival
pilot_user_ids      jsonb          -- empty means everybody
event_flags         jsonb          -- absent key means on
```

Three columns worth their own note:

- **`requested_category` beside `category`.** Meta re-files templates after
  approval, and a UTILITY template quietly reclassified as MARKETING is capped
  at roughly two messages per person per day across every business on WhatsApp
  (error 131049). Without both columns there is nothing to compare, and the cap
  is discovered from somebody saying "I never got that one".
- **`registry_hash`.** The one failure Meta's API cannot reveal: when the code
  changes and the approved template does not, from Meta's side nothing is
  wrong, and the next send is refused with 132000.
- **`dedupe_key`.** Meta retries any webhook it does not get a fast 200 for.
  The unique index is the lock — without it, a redelivered quick-reply tap
  advances a job's stage twice.

`status = 'skipped'` is a real outcome rather than an absence: a person with no
number, an opted-out account, a template still in review. A decision with a
reason on the record is worth far more than a missing row nobody can ask about.

`users` gains three columns in 0026 — `phone_e164` (the dialable form, derived
from `phone` and kept beside it because normalisation guesses),
`whatsapp_opt_in`, and `last_inbound_at` (when this person last messaged the
business number, which is what opens Meta's free 24-hour window).

### ChatConversation / ChatMessage (Phase 3)
```
ChatConversation
id          uuid pk
user_id     fk -> User
title       text                 -- first 80 chars of the opening question
created_at  timestamptz
updated_at  timestamptz

ChatMessage
id                uuid pk
conversation_id   fk -> ChatConversation, on delete cascade
role              enum(user, assistant)
content           text
tool_calls        jsonb          -- which lookups produced this answer, and which were refused
model             text nullable
prompt_tokens     int nullable
completion_tokens int nullable
created_at        timestamptz    -- clock_timestamp(), same reason as JobEvent
```

Kontent Bot's history (migration `0007`). A conversation belongs to exactly
one person and is never shared, not even with the Owner. `tool_calls` is the
answer's receipt: when someone reports a number as wrong, it is the only way
to tell a bad query from a bad summary. See
[Kontent Bot](11-ai-chatbot.md).

## Deliberately not modeled yet

- No `QCScoreLog` table — the routing score (see [05](05-pipeline-and-routing.md))
  is computed on demand from `Job` + `PodMember`, not persisted. Persist it
  only if we need to audit *why* a routing decision was made after the fact.
- No `Comment` table — QC comments live wherever the editor uploads the cut
  for review (Frame.io today); this app only stores the pasted link
  (`frame_link`), never mirrors the comments themselves (see
  [Roadmap](08-roadmap.md#explicitly-out-of-scope-no-current-plan) for why
  that's a permanent decision, not a Phase 2 gap).
