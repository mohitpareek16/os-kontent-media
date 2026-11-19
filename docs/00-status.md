# Build status

Single source of truth for "where are we." Read this first when picking the
project back up in a new session — the other docs explain *why* things are
designed the way they are; this one tracks *what's actually built*.

Last verified: 2026-08-03 — a full security and completeness pass. See
**[The hardening pass](#the-hardening-pass-2026-08-03)** below for everything
found and fixed; it is the most important section in this file, because most
of what it lists had already passed a code review *and* a live end-to-end
verification session. Both were reasoning about what the UI offers. Every one
of the holes was reachable with a valid login and `curl`.

Method that actually worked: drive the API as each role (via Owner
impersonation, so nobody's password had to be reset) and try to do the thing
that should be impossible. Every fix below was re-probed the same way
afterwards and is now covered by a regression test.

The frontend still has not been clicked through end-to-end in a browser by an
automated tool — it type-checks, builds clean, and the containers are running;
see Recommended next steps.

Previously verified: 2026-08-02. Phase 1 was built out to completion that session —
every remaining backend gap and the entire frontend surface — and re-verified
live end-to-end in Docker against the real Postgres database, using the
existing seeded Owner/TL/2×QC/VE accounts (`mukul`/`abhishek`/`farah`+`ishan`/
`aditya`@kontent.media). Every backend endpoint below marked "verified live"
was actually curled against the running stack, not just reasoned through — see
the full lifecycle test in this session's history (create job → every stage
transition including a QC1 send-back and QC2 stickiness → checklist → deliver
→ notifications → capacity/analytics). The one thing **not** verified directly
is the frontend's actual rendered behavior in a browser — no browser-automation
tool was available this session, so that's still a real gap; see Recommended
next steps.

## Two deadlines, alerts that arrive minimised, and an off-switch for HR (2026-09-16)

Three unrelated pieces of feedback, all of them about somebody not being told
something in time. Migrations `0022`, `0023`, `0024` — all additive, no
backfill, nothing that existed changed meaning.

1. **One deadline was doing two jobs.** The date the client was promised and
   the date the team works to are different facts, and the app only knew one.
   A TL who wanted a buffer had to type the earlier date and lose the real one,
   so nobody could answer "how much room do we actually have".

   `Job.deadline` **keeps its meaning** and is now named for it: the **team
   deadline**, what everybody sees, what the hand-off gate requires, what
   overdue counts. `Job.client_deadline` is the new column and the new fact.
   That direction is the whole reason this was a small change — every query,
   sort, tint and AI tool in the app already pointed at `deadline` and already
   meant the team's date.

   The part that had to be got right is that **the client deadline never
   reaches an editor or a QC through any route**, because a buffer that the
   team can read is not a buffer. `services/access.py::
   visible_client_deadline` is the one decision (`leads_pod`: the Owner, or
   `Pod.tl_id == you`), applied to the job payloads, to the **activity feed**
   — a `job_updated` carrying a `client_deadline` key is stripped for
   non-leads, which is the leak that is easy to miss — and to the bot's
   `find_jobs` and `get_job_timeline`. There is deliberately **no filter or
   sort** on the new column: a `client_deadline_from`/`_to` pair lets an
   editor binary-search a date they cannot read.

   `tests/api/test_client_deadline.py` drives all of it as a VE, a QC and a
   TL of another pod, and asserts on the JSON rather than the screen — the
   hardening pass below is emphatic that every hole it found looked fine in
   the UI.

   On screen: the intake wizard has a second date column with its own bulk
   apply and a **Team date −3d** button; the hand-off panel and BriefGate show
   the promise above the box where the working date is chosen, with the buffer
   recomputed as it is typed; the job panel shows "Client 20 Sep · 3 days of
   buffer" to leads and is unchanged for everybody else. Nothing says "fake" —
   an editor who opens the wrong screen once should read something true.

2. **The chime only ever reached somebody already looking at the app.** It is
   raised by a 15-second poll, and Chrome throttles a background tab's timers
   to about once a minute — harder behind a minimised window. So it fired
   reliably in the one situation it was not needed. Polling faster cannot fix
   a throttled timer.

   Web Push now carries it: `push_subscriptions` (one row per browser),
   `services/push.py`, and a service worker at `frontend/public/sw.js` that
   shows an OS notification with no tab open. It hangs off
   `services/notify.py::notify`, which was always the single dispatch point —
   but only *queues* the notification id, because `notify()` runs inside the
   caller's transaction and a push for a move that rolled back is an
   announcement with nothing behind it. A middleware flushes after the
   response, in a fresh session, **by id** — so a rolled-back notification is
   simply not there and nothing is sent. No outbox, no second commit.

   The wording moved to the server (`services/notification_text.py`,
   `NotificationRead.headline`). The frontend module existed precisely so one
   event was not described two ways; a service worker cannot import it, and
   writing the sentences again in Python would have been that drift.

   **A test button** on the inbox page fires an alert at the caller's own
   browsers after five seconds — because the only state worth testing is the
   one you cannot test while pressing a button. It reports how many browsers
   it went to, which is the answer somebody who heard nothing actually needs.

   **What is not possible, stated once so nobody tests it three times:** a web
   page cannot choose the sound Windows plays. `Notification.sound` is not
   implemented in Chrome and a service worker has no audio context. With the
   app open in a tab you get the OS notification *and* our own loud chime,
   even minimised — the service worker postMessages any hidden page, and audio
   is not throttled the way timers are. With every tab closed you get the
   system notification sound alone. Focus assist, denied notification
   permission, and a fully quit Chrome each silence it regardless; the UI says
   so rather than leaving it to be discovered.

   VAPID keys are empty by default and push is simply off without them — the
   endpoints answer 503 with a usable message, the same shape as
   `openrouter_api_key`. **They still have to be generated and put in `.env`
   before any of this does anything in production** (`.env.example` has the
   command).

3. **Only the Owner could switch an account off.** HR onboarded people and
   could not offboard them, so every leaver went through one account. HR now
   holds that switch for exactly the roles HR onboards — **you may deactivate
   only the roles you may create**, which is `CREATABLE_ROLES` again rather
   than a fourth list to keep in sync. It is a dedicated route pair, not HR
   access to `PATCH /users/{id}`: that route also changes roles and lends the
   TL secondary, and handing over one power should be a route rather than a
   field exemption the next schema change quietly widens.

   `user_events` records who did it, to whom, and optionally why — written by
   *every* path including the Owner's `PATCH`, because an audit row that one
   route skips is worth nothing. The directory row says "Deactivated 16 Sep by
   Milan Kumawat".

   The confirm dialog reads `GET /users/{id}/open-work` and says how many
   videos, reviews and pods the person still holds, because **deactivation
   reassigns nothing** — that work stays with an account nobody can log into
   until a TL hands it over. Three integers and no job data: HR reads the
   roster, not the board.

**Not verified end to end.** Written and type-checked; the frontend builds
clean. The backend suite was **not run** in the session that wrote this —
there was no Postgres and no Python environment on the machine — so
`python -m pytest -q` is the first thing to do, along with `alembic upgrade
head` for the three new migrations and `pip install -r requirements.txt` for
`pywebpush`. The push path in particular has never spoken to a real push
service: `_send_one` is stubbed in the tests, so the first real send is the
first real test of the VAPID keys.

## Active vs Intake, QC1's two endings, and notifications you can hear (2026-08-18)

Seven changes from one round of feedback on the live board. No migration —
everything below is either UI, a derived query, or a field on an existing
JSON event payload.

1. **ACTIVE contained INTAKE.** `status=active` meant "anything not
   delivered", so a board with 15 cuts in progress and 43 videos still waiting
   for an editor reported **58 ACTIVE** — the two cards side by side did not
   add up, and unassigned rows sat interleaved with work underway. `active` is
   now `assigned` through `final`; the two tabs are disjoint and sum to
   everything open. `overdue` deliberately still counts intake: a video past
   its deadline that nobody has been given is the most overdue thing there is.
2. **A default sort that knows what a row is.** New `sort_by=pipeline`, and
   the default: group by state (in progress → waiting for an editor →
   delivered → scrapped), then deadline, undated last. Sorting by `created_at`
   put a video pasted in this morning with nobody on it above one due today
   and half cut. Clicking a column header still replaces it outright.
   Follow-ons: the Overview's "in flight" tile now counts what its tab lists
   and is joined by an **Awaiting assignment** tile, pod cards carry an Intake
   column, and the board's Intake lane asks the intake question rather than
   going permanently and silently empty.
3. **QC1 forward is two moves.** ~98% of cuts go forward from QC1, so
   **QC1 approved** and **QC1 comments added** are equals and the send-back is
   a text link. Both move the job to QC2; the difference lands as
   `qc1_outcome` on the `stage_changed` event. It matters because this team
   writes QC comments on Frame.io, which this database never sees — so a
   thorough review and no review at all previously left identical records, and
   the QC1-flag panel could not tell them apart. A pass with no outcome named
   is recorded as `approved`; a pass from *before* the two buttons reports no
   outcome at all rather than being backfilled into a self-report.
4. **Notifications arrive out loud.** A watcher polls the unread inbox every
   15s and raises each new one as a toast that does **not** auto-dismiss, with
   a synthesised two-tone chime (Web Audio, no asset, unlocked on the first
   click anywhere). Crossing a toast off marks it read server-side — otherwise
   the next poll would raise it again, which is a notification you cannot get
   rid of. The first response after a page load is treated as history, so a
   refresh is not an alarm. The wording is shared with the inbox page
   (`lib/notificationText.ts`) so one event cannot be described two ways.
5. **The bell left the profile dropdown** for the header beside it, where its
   unread count is visible without opening anything.
6. **Search answers "everything to do with this".** A job now also matches on
   the names attached to it — pod, channel, editor, TL, QC2 reviewer — and
   carries `matched_on` so a hit whose own text does not contain what you
   typed can explain itself. Channels are a fourth result kind; pod hits carry
   their TL and load, people hits their clients and what is on their plate.
   Every added join is still under the same scope clauses, so the answer
   remains a strict subset of what the caller could already list.
7. **The edit-bay clock is gone** — panel, hook, `GET /jobs/{id}/work-time`,
   `services/work_time.py` and its tests. Not wanted, and a number nobody
   reads is a number nobody checks. Stage hints now lead with the stage's own
   name ("Editing." over "Editor is cutting the video"), since the line under
   them already says who is holding the job.

Two production fixes shipped alongside:

- **`nginx.prod.conf` had no catch-all.** Both server blocks were named
  `ops.kontentmedia.in`, and the first block on a port is also nginx's
  *default* for that port — so `http://<server-ip>` was answered by the
  redirect block and sent to `https://<server-ip>`, which the 443 block then
  served with a certificate issued for the domain. Full-page "Not Secure", a
  URL nobody asked for, and anyone who clicked through was using the app over
  a connection the browser had already been told not to trust. Explicit
  `default_server` blocks now redirect any other host to the real name.
- **A crash was indistinguishable from a refusal.** Starlette answers an
  unhandled exception with a *plain-text* "Internal Server Error"; every
  deliberate rejection in this API is `{"detail": "..."}`, which is what the
  frontend renders. So a 500 fell through to the generic fallback — an editor
  pressing "Mark as edited — send for QC" in production got "Could not move
  the job", which reads as *the server considered this and said no*. There is
  now an `Exception` handler in `app/main.py`: the traceback goes to the log
  with a short reference, and the same reference goes to the browser inside a
  `detail`. **The underlying 500 on `POST /jobs/{id}/advance` is not yet
  fixed** — the full suite passes this exact transition against Postgres, so
  it is environment- or data-specific and needs the traceback from the server.

## QC2 routing counts a day's work, not a job count (2026-08-07)

Migration `0018` moved every screen from `Job.weight` to `Job.video_type` and
deliberately left `weight` behind, saying so in its own docstring: every job
took the default, "which makes the load maths **a job count in disguise** until
the score is rebuilt on something real." This is that rebuild — the design in
[QC2 load model](12-qc2-load-model.md), transcribed. **QC2 only**; QC1 is always
the pod TL and is never auto-assigned.

What it fixes: a part-timer was loaded exactly like a full-timer, a fifth
revision round cost a reviewer as much as a first watch, and a podcast weighed
the same to the router as a 30-second reel.

- **A review is priced by what it is** — short form 1, long form 3, podcast 6,
  with a repeat round at `ceil(base / 2)`, **halved once** (round 5 costs what
  round 2 does). A *different* reviewer picking up a round-2 job pays full
  price: they have not seen the cut, whatever the round counter says, which is
  why the price is stamped on the charge rather than recomputed from `round`.
- **A reviewer has 24 points a day, or 12 part-time** (`User.employment_type`,
  new). The budget is *derived* from the type and never stored per account, so
  changing what a part-time day is worth changes it for everybody at once.
- **The budget is daily, and that is not a WIP cap.** Points are spent against a
  date and finishing a job does not hand them back the same day. That cannot be
  derived from open jobs, so `qc2_charges` (new) is the ledger: one row per
  round, released when the job leaves QC2 in *either* direction, with a partial
  unique index on `job_id WHERE released_at IS NULL` so two assignment paths
  racing cannot bill one review twice. The day rolls over in
  `settings.qc2_day_timezone` — the only clock in this app that is not UTC,
  because a budget is a promise about a *working day* and in UTC it would reset
  at 05:30 IST, before anyone starts.
- **The pool asks whether *this* job fits**, not just whether somebody is under
  a cap: a reviewer with 4 points free cannot take a podcast. Scoring is
  `load ÷ capacity` — a share of their own day, not raw points.
- **`Job.rush` is new**, and it is the one escape hatch: when nobody has room, a
  rush job may be pushed onto the least-loaded reviewer at up to 125% of their
  day. Past that it still holds and alerts the TL. It is not a priority sort and
  it does not lift the part-time podcast cap. The design deferred this for lack
  of an input; the input got built instead.
- **Every assignment path bills.** The auto-router, a lead naming a reviewer by
  hand (`PATCH /jobs/{id}`), and a QC claiming an unrouted job all write a
  charge. A hand-picked reviewer who isn't billed is invisible to every load
  query, so the override would quietly spread to the next three jobs instead of
  costing the one job it was meant to.

**One decision changed from the written design.** docs/12 §6.1 said a sticky
round falls through to the pool when the prior reviewer is deactivated *or*
unavailable; the reason it gave was entirely about the first. `available` means
"don't send me *new* QC work today", and a cut somebody already watched and
wrote the change list for is not new work — falling through would make a
stranger pay full price for a cut nobody has seen and scatter a reviewer's open
revisions the moment they took a day off. Deactivation breaks stickiness;
`available` does not. docs/05's "stickiness is not an optimization, it's the
point" survives.

**Scrap and restore** were not in the design and needed answering: scrapping
releases the charge (the points stay spent for today, stop counting tomorrow —
nobody is going to review a cancelled project, and an open charge would carry
forward for good), and restoring re-bills. Restored the same day, `charge()`
reopens the row the scrap released rather than billing the round twice; the
`round` half of that test is what keeps a same-day send-back-and-return
correctly charged as two pieces of work.

Also updated because they described the old model in prose and would otherwise
have quoted it with full confidence: `services/ai/tools/capacity.py` and
`roster.py` (the latter priced *QC* work on the editor scale — a gap docs/12 §9
did not list), `GET /users/qc-load` and `/users/me/qc-load` (now per-reviewer
capacity with a spent-today / carried-over split, videos by type, and an
explicit `can_take_podcast`), the Users admin row, the add-teammate modal, Team
Capacity's QC tab, and the QC router panel — which now says *why* a job is
unrouted rather than showing a silent list.

- Migration `0019`, with a backfill: every job at QC2 or in Revisions with a
  reviewer gets an open charge dated today, priced off its `video_type` and
  `round`. Without it those reviewers start the day looking empty while holding
  real work. Verified up, down and up again against seeded rows.
- `tests/unit/test_routing.py` was rewritten against the new model — the cases
  worth having are the ones that pin its surprising edges: a cleared job counts
  today but not tomorrow, Monday's open job counts on Tuesday, the halving
  applies once, `load + cost` is the filter, a part-timer at 50% ranks ahead of
  a full-timer at 62%, and sticky falls through on deactivation. Day-boundary
  tests pass `today=` explicitly; `daily_load` and `route_qc2` take the clock as
  a parameter for exactly that reason.
- **707 backend tests pass. Frontend type-checks and builds clean.** Not yet
  clicked through in a browser — same standing gap as everything below.

## The header's search box actually searches (2026-08-06)

It was a button. It navigated to the pipeline table with `?focus=search` and
put the cursor in *that* table's filter box — which searches jobs, by title or
code, inside whatever pod and status tab happened to be selected. So the one
control in permanent chrome, on every screen, could not find a client, could
not find a teammate, and could not find a job outside the current filters.
(Before that it was an `alert()`.)

- **`GET /search?q=`** (`routers/search.py`) answers with jobs, client pods and
  people in one round-trip — six of each, `limit` up to 20. Job hits match on
  code or title, and an **exact code match sorts first**: typing `KM-1042` in
  full means "take me there", and it used to queue behind whatever was created
  most recently.
- **Scoping is not new code.** The three queries live in `services/search.py`
  and compose the clauses the list endpoints already use — `job_scope_clauses`,
  `pod_scope_clauses`, and pod-membership for people, which is the rule
  `GET /pods/{id}/members` applies. A search box is the easiest place in a
  product to publish the whole company by accident; the result is a strict
  subset of what the caller could already reach, and `tests/api/test_search.py`
  asserts that per role rather than trusting it. There is no `require_role` on
  the route on purpose — a VE may search, they just find only their own jobs.
- **The chatbot's `resolve_entity` now calls the same three functions.** It had
  its own copy of the same ilike-plus-scope queries, which is how the bot ends
  up able to name a client the UI insists doesn't exist.
- **`%` and `_` are escaped.** They are LIKE wildcards: unescaped, a stray `%`
  returned the caller's entire visible world, ranked by chance.
- **Scrapped jobs are findable here and nowhere else.** Every queue and count
  filters them out by design, so "what happened to that project we killed" is
  only askable by name; hits carry `scrapped_at` and the row is labelled.
  Deactivated teammates come back for the same reason, marked *Left*.
- **The panel** groups results but arrows through them as one list — ↑↓, ↵ to
  open, esc to close, ⌘/Ctrl+K to focus from any screen, mouse hover and the
  keyboard cursor kept as one selection. A job opens its detail page; a client
  opens that client's pipeline (setting the layout's pod selector, so the table
  can't claim a filter the header contradicts); a **VE** opens the pipeline
  filtered to them, which the toolbar's editor dropdown then names — that
  dropdown is lead-only, which is why the People group is too, and anyone with
  no such destination is left out of it rather than rendered as a dead click.
- **`useDebouncedValue`** replaces the same `setTimeout`/`clearTimeout` effect
  that had been written out inline in five pages.

Verified in a browser this time, headlessly against an isolated seeded
database: as Owner (all three result kinds, keyboard nav, both hand-offs, the
empty state), as a **VE** (only their own jobs, no people) and as a **QC**
(only the job routed to them). No console errors. This is the first frontend
behaviour in this file that has actually been clicked through by a tool rather
than reasoned about.

## Flagging a QC1 that never happened, and finding delivered work (2026-08-06)

Two things, both about work the pipeline could see but nobody could.

**A QC1 that was never done now has a name on it.** A TL passing a cut straight
from QC1 to QC2 without watching it looked identical on the record to a real
review — one `stage_changed` event either way — and the only person who could
tell was the QC2 reviewer, now doing two reviews' work, with nowhere to say so.

- **`GET /jobs/{id}/qc1-pass`** (`services/qc1_review.py`, derived from the
  log, nothing stored) reports the latest pass out of QC1: who cleared it,
  when, how long it had sat there and whether anything was said — counting
  both notes left at QC1 and the note typed into the hand-off itself, which is
  written *after* its own stage-change row and so cannot be caught by a time
  window. Facts, no verdict, no threshold column: a fast quiet pass is usually
  a rubber stamp and occasionally a TL who watched the cut being made.
- **`POST /jobs/{id}/qc1-flag`** takes a mandatory reason (10 chars, same floor
  as a scrap), snapshots *who cleared QC1* onto the job, writes a
  `qc1_flag_raised` event carrying the evidence that was on screen, and tells
  the person it names plus the pod TL — never the reviewer who raised it.
  **The stage and round do not move**; it is a statement about the past.
- **Who:** the QC2 reviewer the job is routed to, plus Owner / FO / HR.
  **Not the pod TL** — QC1 is their own review — and nobody may flag a pass
  they made themselves. `POST /jobs/{id}/qc1-flag/clear` is the reviewer
  withdrawing or an admin dismissing; the TL it names cannot clear it. Both
  events stay on the log after the columns clear.
- **Where it shows up:** an amber row tint (outranking *delivered*, because a
  skipped QC1 on a video that already shipped is the case worth catching) and
  a "QC1 flagged" chip in the pipeline table, a flag on board cards, a banner
  and a "How QC1 went" section in the job panel, a `QC1 FLAGGED` tile on the
  Overview, a `?flagged=1` filter that cuts across every status tab, plus feed
  and inbox lines.
- **Migration 0013** adds the four columns and the "who and why move together"
  check constraint, same shape as the scrap invariant in 0012.

**Delivered work was invisible outside the ALL tab.** Every status tab
excludes it by construction — `active` *means* not delivered, and a delivered
job is never overdue, never Mine and cannot be scrapped — so a shipped video
appeared nowhere on the Overview, and picking **Delivered** in the stage filter
while ACTIVE was selected returned an empty table, which reads as the system
having lost it. Same reason the kanban's Delivered column was permanently
empty. There is now a **`status=delivered`** tab with its own count, a
clickable **DELIVERED** tile on the Overview, and an empty state that says
which tab is hiding the rows instead of "no jobs match these filters".

Not verified live: this environment has no Postgres and no Docker, so
`tests/api/test_qc1_flag.py`, `tests/unit/test_qc1_review.py` and the new
delivered-tab case in `tests/api/test_list_filters.py` have not been executed
here — CI runs them. The app imports clean and the migration chain is
single-headed at 0013; the frontend type-checks and builds clean.

## Handing a job to a different editor (2026-08-06)

A TL could already change the name on a job, and that was the problem: the
swap was silent. The feed said "edited the job · editor someone else → someone
else", so the one question anyone asks afterwards — why did this video change
hands, and whose week did it come out of — had no answer anywhere.

- **`POST /jobs/{id}/reassign`** takes the new editor and a mandatory reason
  (10 chars, same floor as a scrap), writes a `job_reassigned` event carrying
  both editors' ids *and* names, and tells the editor who lost the job, the
  one who gained it and the pod TL — never the person who made the change.
  Pod TL / Owner / FO / HR only (`check_pod_lead`). Delivered and scrapped
  jobs refuse it.
- **The stage does not move.** Handed over at QC2, it is still at QC2 on the
  same round. Only the name changes.
- **The silent paths are closed.** `PATCH /jobs/{id}` and the
  `assigned_editor_id` passenger on `/advance` still make the *first*
  assignment and now refuse a swap — a second route writing that field
  without a reason would make the reason optional in practice.
- **The edit clock splits at the handover.** `services/work_time.py` closes
  the open round and opens a new one credited to the new editor; without it
  the round stays open under the first editor's name and every hour the
  second one spends is billed to the person taken off the job.
- **Where it shows up:** a "Who's on it" section in the job panel (leads
  only, live jobs), the handover and its reason in full in the change-list
  thread, a "Reassigned the job → Ram" line with "Abhishek → Ram · reason" in
  the activity feed, and a row in the inbox for all three recipients.

No schema change, so **no migration** — the whole record is event-log rows.

Not verified live: this environment has no Postgres, no Docker and a broken
backend virtualenv, so `tests/api/test_reassign.py` has not been executed here
— CI runs it. The frontend type-checks and builds clean.

## Scrapped projects, a real "Mine", and per-round edit time (2026-08-06)

Three changes, one theme: the pipeline could not express things that were
actually happening in the business.

1. **"Mine" counted the wrong thing, and for a TL counted nothing at all.**
   It was `assigned_editor_id == me OR qc2_reviewer_id == me`, written out
   twice — once in the row query, once in the count. A TL is neither of those,
   so every TL's Mine tab read **0** no matter how much work sat at QC1 waiting
   on them, and an editor's counted cuts already in QC that they could not
   touch. Replaced with `services/access.py::mine_clauses`: whose *move* is it,
   keyed off `STAGE_OWNER_ROLE`. One definition, used by the list, the count
   and the per-row `is_mine` flag, so the highlighted rows and the number on
   the card cannot disagree. The status tab now also lives in the URL
   (`?status=mine`), so it is linkable and survives a refresh.
2. **Rows say what they are at a glance.** Purple for waiting-on-you, green for
   delivered, muted and struck through for scrapped — one definition in
   `lib/jobRowTone.ts`, used by the table, the board cards and the QC lists.
3. **Projects get cancelled, and there was no way to say so.** The only
   options were leaving the job rotting in a queue forever or marching it to
   "delivered", which is a lie that lands in the first-pass rate. `POST
   /jobs/{id}/scrap` takes a mandatory reason and records who and when;
   `/restore` undoes it. Not a stage — the job keeps the stage it died at.
   Scrapped work is excluded from Active/Overdue/Mine, from every capacity and
   routing calculation, from analytics and from the bot's counts, via one
   `not_scrapped()` clause; it stays in **All** and has its own tab.
4. **Per-round edit time.** `Revisions -> QC1` became `Revisions -> Editing ->
   QC1`, which gives every round a starting gun and not just a finish line;
   `GET /jobs/{id}/work-time` then derives elapsed time per round from the
   event log — no stored counter. Labelled elapsed, not effort, everywhere it
   is shown.

Not verified live: this environment had no Postgres and no Docker, so the
backend suite (including the new `tests/api/test_scrap.py`,
`tests/unit/test_mine_scope.py` and `tests/unit/test_work_time.py`) has not
been executed here — CI runs it. The frontend type-checks and builds clean.
**Migration 0012 must be applied** before the API will start against an
existing database.

## The bot-refusals pass (2026-08-04)

Kontent Bot was answering "I cannot" to reasonable questions from the Owner —
"show me a graph of editor progress", "who is the best editor", "most projects
done editor in dhan pod". Three separate causes, only one of which was about
the model:

1. **No charting capability.** The bot had no way to emit anything but prose,
   so "generate graphs" was a truthful refusal. Fixed with `render_chart`: the
   model describes a chart, the frontend draws it with Recharts. It does not
   generate images — the spec is stored on the message so a chart is as
   auditable as a quoted number. See
   [Charts](11-ai-chatbot.md#charts).
2. **The prompt forbade it.** `BEHAVIOUR` carried a hard "never rank people
   against each other". That rule was written for a *UI surface* and applied
   here to a manager asking a direct question about their own team. Replaced
   with a comparison section that answers and attaches the caveats, plus a
   blunt "try before you decline" — the honest reading of the screenshots is
   that the bot's failure mode was refusing, not over-sharing.
3. **No tool could have answered anyway.** Even without rule 2, nothing
   returned a per-pod editor breakdown; `get_person_performance` takes one
   person at a time. Eight tools added: `list_pods`, `compare_editors`,
   `get_pod_team`, `get_delivery_trend`, `get_intake_trend`,
   `list_brand_assets`, `search_voice_notes`, `render_chart`.

**No permission boundary moved.** Every new tool routes through the same
`services/access.py` clauses and `check_pod_lead` as the REST layer:
`compare_editors` serves exactly who `/pods/{id}/analytics/avg-rounds-by-editor`
already serves, and a TL who merely sits in another TL's pod gets the same 403
here as there. What widened is what can be *asked*, not what can be *seen* —
asserted both ways in `tests/unit/test_ai_breadth_tools.py`.

The documented "no leaderboards" principle was re-stated rather than dropped:
no standing ranked surface, and nothing to the person being measured. The
boundary is written out in [Overview](01-overview.md) and
[Roadmap](08-roadmap.md).

Also raised `AI_MAX_TOOL_ITERATIONS` 6 → 8, since a charted answer spends a
round drawing each chart on top of its lookups and was hitting the cap.

26 new tests (405 → 431).

### First verification against a real model — and a model-choice finding

Run live against the Docker stack with the real key. The tool layer works:
"most projects done editor in dhan pod" resolves the pod, calls
`compare_editors` and answers with real numbers; "chart how many jobs each
client has open" calls `list_pods` → `render_chart` and produces a correct
bar chart (Dhan 7, Test client 2 zero — matching a direct SQL check).

The same three questions were then put to three models. **The result changes
what `OPENROUTER_MODEL` should be set to:**

| Model | Vague question ("who is the best editor") |
|---|---|
| `google/gemini-2.5-flash` (current) | Calls **no tools**. Replies with a menu of metrics and asks which one. |
| `google/gemini-2.5-pro` | Calls `compare_editors` — then **fabricates the answer**. |
| `anthropic/claude-sonnet-4.5` | Calls `compare_editors` and reports what it actually returned. |

`gemini-2.5-pro` invented three editors — "Vikram (93.3% on 15 jobs), Priya
(92.9% on 28 jobs), Rakesh (33 jobs)" — none of whom exist. This database has
**one** editor (Aditya) and 9 jobs total. It made the correct tool call, got
one row back, and wrote a confident roster anyway.

That is exactly the failure this file has warned about since Phase 3 — *"a
fluent wrong answer is the failure mode to watch for, and no test can catch
it"* — observed in the wild. It is also the argument against fixing the
hedging problem by reaching for a bigger model without checking: the upgrade
that made the bot *engage* also made it *lie*, and the answer looked better
than the honest one.

Prompt work moved flash partway (it stopped saying "I cannot generate graphs"
and now offers to help) but did not stop it hedging on vague questions;
two rounds of strengthening, including a blunt directive at the top of the
prompt, did not change that. Specific questions work correctly on flash. The
remaining gap is a model-capability limit, not a prompt bug.

**`OPENROUTER_MODEL` is now `anthropic/claude-sonnet-4.5`.** It is the only
one of the three that both engaged with the question and stayed inside the
data. Verify any candidate the same way — ask something whose answer you know
is *small*, and check it doesn't invent a bigger one.

Switching models immediately exposed a loop bug that had been latent since
Phase 3: **prose written alongside a tool call was thrown away.** Gemini
rarely does that, Claude routinely does, so the same question that answered
fine on one model came back with the text missing on the other — once
entirely empty, under a chart. Fixed in `agent.py::_final_answer`, covered
both directions in `tests/unit/test_ai_agent.py`, and the thread no longer
renders an empty bubble even if it recurs.

### Out of credits is now a first-class UI state

The account ran dry mid-session, which surfaced how badly that failed: a
one-line red "The OpenRouter account is out of credits." A gateway 402 and a
401 now carry a `code` on the error frame, and the thread renders
`BillingNotice` — what broke, that nothing else is affected, and the numbered
steps with the OpenRouter link. Verified against a real 402, not a stub.

`AI_MAX_TOOL_ITERATIONS` was also pinned to `6` in `.env`, silently
overriding the new default of 8; corrected there too.

### A delivered job now has to carry its delivery date (migration `0009`)

Live data exposed the bot answering **2** and **1** to the same question. Both
tools were right: `list_pods` counts rows at `stage='delivered'`, the trend
tools count rows whose `delivered_at` falls in a window and must skip a NULL —
there is no bucket for a dateless delivery. One job (`KM-1001`) had been
delivered before `routers/jobs.py` started stamping that column, and that was
enough to make the two disagree.

Fixed as a migration rather than an UPDATE, so it reaches production the same
way: backfill from the append-only `job_events` log (the true moment the job
moved to delivered, not a guess), then a CHECK constraint so no such row can
exist again. `KM-1001` recovered its real timestamp; both tools now report 2.

The constraint is the point. Application code already set the column — a
constraint is what makes that true of rows the application didn't write.
`tests/factories.py` now produces valid delivered jobs, and the invariant is
asserted two ways: that the counts agree, and that the insert is rejected.

## The server-side lists pass (2026-08-04)

Three things, one of which was visible in a screenshot and two of which were
not.

### The pipeline table rendered every column one place to the left

The table header declared a **Weight** column that had no cell under it — the
weight badge was rendered inside the Job cell instead. Every column from there
rightwards therefore showed the previous column's value: Client Pod showed the
editor, Editor showed the QC reviewer, QC Reviewer showed the round count, and
Rounds showed the row chevron. `colSpan` on the empty state was 8 against 9
headers, which is the same mistake written down twice.

Weight now has its own cell (and its own sort), and every other table in the
app was audited for the same header/cell mismatch — `NewJobWizard` (7/7) and
the voice-notes admin table (5/5) were already aligned.

### Lists were paginated on the server and filtered in the browser

`GET /jobs` already paged and sorted server-side, but nothing else did, and
several screens defeated the pagination by asking for a page big enough to
filter locally — the board and the QC router asked for 1000 rows, the QC queue
for 500, the Overview for 1000. That is not a performance nit: past those
limits the screens were **silently wrong**. A QC queue stopped showing work
past its 500th job without saying so, the router's "UNROUTED NOW" tile really
meant "unrouted among the first thousand active jobs", the pipeline's
"Page 1 / 1" counted a locally-filtered slice, and the unread badge capped at
the notification page size.

Every list endpoint now filters, searches, sorts and pages in SQL and answers
in one envelope (`schemas/common.py::Page`), with counts that a screen shows
outside its rows returned alongside rather than derived from them:

| Endpoint | New filters | Counts returned with the page |
|---|---|---|
| `GET /jobs` | multi-select `stage`/`weight`, `editor_id`, `reviewer_id`, `unassigned`, `unrouted`, deadline range, `no_deadline`; sort by code/round/pod | — |
| `GET /jobs/stats` | the same filter set, so the cards can't count rows the table is hiding | — |
| `GET /jobs/overview` | *(new)* — replaces reducing a 1000-row fetch in the browser | KPI tiles + per-pod cards |
| `GET /users` | `search`, `role`, `status`; sort, page | — |
| `GET /users/stats` | *(new)* | roster totals per role |
| `GET /pods` | `search`, `status`; sort, page | status-tab counts |
| `GET /notifications` | `unread_only`, `event_type`, `search`; page | whole-inbox unread count |
| `POST /notifications/read-all` | *(new)* | — |
| `GET /voice-notes/admin/videos` | `search`, sort, page | video + note totals |

Two smaller things fell out of it. `sort_by` is a whitelist reaching an
`ORDER BY`, and every ordering now carries an `id` tiebreak — a tied sort lets
the database order rows differently per page, which shows one row twice and
hides another. And "Mark all read" was firing one POST per *loaded* row, so it
both hammered the API and left everything past the first page unread.

### An Owner couldn't switch between impersonated accounts

Impersonation hands back a token for the *target*, so an Owner simulating a VE
was, to every subsequent request, a VE — including the two requests
impersonation itself needs. `POST /auth/impersonate` (Owner-only) answered
403, and the "viewing as" picker's `GET /users` (Owner/TL-only) came back
empty exactly when it was needed. The only way to reach a second person was to
stop impersonating, then start again.

The token already carried `impersonated_by`, so the real Owner was knowable
all along. `require_impersonator` resolves that claim and re-checks it against
the database every request, so an Owner who is demoted or deactivated
mid-session loses the power immediately; a plain login token has no such claim
and falls back to the caller, so a TL is still refused. On the client, those
two calls — and only those two — go out through `adminApiClient`, which
authenticates as the stored admin token. A hop stays attributed to the real
Owner rather than to whoever was being simulated when it was minted, and
switching identity now clears the query cache, which it never did: only `me`
was invalidated, so every other cached list was still the previous account's
rows.

## The hardening pass (2026-08-03)

Everything in this section was found by probing the running API as each role
and confirmed fixed by re-probing the same way. Nothing here was found by
reading code alone.

### Permission holes — all reachable with a valid login

| What was possible | Now |
|---|---|
| **Any authenticated user could create jobs in any pod.** `POST /jobs` and `POST /jobs/batch` had no permission check at all — a VE created work in a pod they weren't a member of and got a `201` | Owner or that pod's own TL (`check_pod_lead`) → `403` |
| **Any TL or QC could read any job in the company by id**, plus its full event log. The list endpoint scoped rows correctly; `GET /jobs/{id}` and `/events` only checked the VE case | One rule in `services/access.py`, shared by both read paths → `403` |
| **Anyone could advance any job.** `POST /jobs/{id}/advance` had no check — a VE could clear their own QC1 or walk someone else's job to delivered. The UI hid the buttons | `stage_machine.can_advance()` — role × stage × target × ownership → `403` |
| **Any pod member could upload/replace brand assets** — an editor could rewrite the brief and the do-not list they're judged against | Owner / pod TL only → `403` |
| **A pod could be created with a VE as its `tl_id`**, which handed that VE full pod-lead powers, because `check_pod_lead` only compares that field. Verified: the VE then added a pod member successfully | TL must be a TL or Owner account → `400` |
| **A QC user could be set as a job's `assigned_editor_id`** — the job then vanished from every capacity view, which filters on `role='ve'` | Must be an active VE **and** a member of that job's pod → `400` |
| **A VE could hand their job to a different editor.** `can_advance` gated the stage *move*, but `advance_stage` then applied `assigned_editor_id` for whoever sent it — so a VE making one of their three legal moves could also reassign the job. Found by the regression suite, not by review or by any of the manual probing | Assignment is Owner / pod TL only → `403` |

### Correctness and stability

- **Job codes came from `count(jobs) + 1`.** Three concurrent creates → two `500`s from the unique index; deleting any job made the count go backwards so every later create collided permanently. Now a Postgres sequence (`services/codes.py`, migration `0004`). Re-probed: three simultaneous creates → three `201`s, distinct codes.
- **Enum columns weren't validated.** `weight: "gigantic"` and `pod_role`/`status` equivalents reached Postgres and returned **500**. Now `Literal` in the schema → `422` naming the allowed values.
- **A two-character password was accepted** on account creation, while the reset endpoint demanded eight — the only thing enforcing 8 on new accounts was a `minLength` attribute in the browser. One rule now, server-side.
- **A job could reach QC2 with no reviewer and nobody was told**, then sit invisible. Now the pod TL is notified and it appears in the QC queue's *unrouted* section.
- **A pod with no QC member sent every job into the unrouted pile forever.** Routing now falls back to the wider QC team when a pod has no QC of its own — membership is where the familiarity bonus comes from, not a gate (docs/05). Verified live on a pod with zero QC members.
- **`job_events.created_at` used `now()`** — the transaction start time — so a stage change and its change list tied on the timestamp and the feed returned them in arbitrary order. Now `clock_timestamp()` (migration `0003`).
- **Removing a pod member left their open jobs on their plate**, since editor visibility is by assignment not membership. Now rejected with a count and an instruction to reassign first.
- **An expired token left the app looking signed in** while every request failed — route protection only checked that a token string existed. A `401` now ends the session and lands on login with an explanation.

### Things that simply didn't exist

- **No QC surface at all.** A QC's only nav item led to the owner's overview. There is now a real queue (waiting on me / sent back / still mine elsewhere in the loop / cleared / unrouted) with the availability toggle and the reviewer's own load against the routing cap (`GET /users/me/qc-load` — the team-wide list stays Owner/TL-only, since that one is a cross-person comparison).
- **An unrouted job could never actually be picked up.** docs/05 said it "surfaces on the QC team page" for someone to take, but `qc2_reviewer_id` was only ever written by the auto-router on the way into QC2, and a QC can't advance a job that isn't theirs — so it was stuck forever, and freeing capacity later didn't re-route it. `POST /jobs/{id}/claim-qc2` is that missing verb. Verified live: everyone unavailable → job lands unrouted → TL notified → the pod's QCs see it → one claims it → the other is told who took it → the claimer can now clear it.
- **No availability endpoint.** `User.available` gates `route_qc2` and could only ever be changed with SQL, despite being in the role matrix. Now `PATCH /users/me/availability` (owner/tl/qc).
- **No update or delete anywhere.** `PATCH`/`PUT`/`DELETE` returned 404 on users, pods and jobs. So: a leaver couldn't be switched off, a wrong role couldn't be fixed, a job's title couldn't be corrected, and **a deadline could never be set after creation** — which quietly made the whole "overdue" view meaningless. Now `PATCH /jobs/{id}`, `PATCH /users/{id}`, `PATCH /pods/{id}`, plus `is_active` (migration `0005`) for deactivating a leaver without deleting the history that references them.
- **`Pod.status` had no way in at all** — `PodCreate` didn't accept it and nothing could change it, so the active/paused/churned enum and the badge on every pod card were decorative, and a churned client displayed as "Active" forever.
- **Brand assets could be uploaded and listed but never opened** — no download route, no static mount. Now served through the API so pod membership is re-checked per read, with `version` bumping on re-upload.
- **Notes could only ride along with a stage change**, so a TL with a question at QC1 had to move the job to be heard. Now `POST /jobs/{id}/notes` for anyone who can see the job.
- **Zero tests and no CI gate.** Now a backend suite against a separate `kontent_test` database, and `.github/workflows/ci.yml` running it plus a full frontend build on every PR and push.

## Phase 0 — Planning

- [x] Actors, pipeline, permissions model defined ([01](01-overview.md), [04](04-permissions.md))
- [x] Data model designed ([03](03-data-model.md))
- [x] Frontend/backend conventions documented ([06](06-frontend-rules.md), [07](07-backend-rules.md))
- [x] `docs/` written and kept current

## Phase 1 — Core scaffold — functionally complete; browser click-through still owed

### Infra

- [x] Repo scaffolded: FastAPI + React + Postgres + Docker Compose
- [x] Docker installed and the full stack verified end-to-end on the real dev machine
- [x] Migrations run against real Postgres — all 8 tables created correctly (`clients` was merged into `pods`, see Data model)
- [x] Bootstrap script for the first Owner login (`scripts/create_owner.py`)

### Backend — auth & permissions

- [x] JWT login
- [x] Role-based dependencies (`require_role`, `require_pod_member`) — verified live: a VE login got a real `403` trying to create a pod
- [x] `require_pod_lead(pod_id)` added (`app/core/deps.py`) — Owner bypasses, else must be the pod's own `tl_id`. Stricter than `require_pod_member` for actions the permission matrix scopes to "Owner, TL own pods" specifically: adding/removing pod members, the delivery checklist, and all of `analytics.py` (see below). A plain `check_pod_lead()` function backs it for routes that only learn `pod_id` after loading their resource (e.g. `/jobs/{id}/checklist`).
- [x] `POST /users` — **Owner-only**, creates any role. TLs do not onboard their own editors. Rejects unknown roles and duplicate emails. Verified live: create → login with the new password → self-service change-password → re-login → Owner reset-password → re-login, all confirmed end to end.
- [x] Password reset flow (updated: HR may reset TL/QC/VE/staff passwords; emailed forgot-password added, UI hidden) — `POST /auth/change-password` (self-service, current-password required) and `POST /users/{id}/reset-password` (Owner-only, for a locked-out user). No email/SMS channel exists yet, so this isn't a token-based "forgot password" flow — the Owner relays a new password out-of-band, same trust model account creation already uses. Verified live.

### Backend — pods (client = pod, one entity, no separate `Client` table)

- [x] Create/list pods — `Pod` carries the former `Client` fields directly (`status`, `billing_currency`, `retainer_volume`, `onboarded_by`); `POST /clients` / `Client` model removed, `POST /pods` is now the only onboarding call.
- [x] Create/list pods, add pod member — **permission bug fixed**: `add_pod_member` used to accept `require_pod_member`, which let *any* pod member (including a VE) add members, contradicting the permission matrix. Now uses `require_pod_lead`. Verified live: VE add attempt → `403`, pod's own TL → `201`.
- [x] `GET /pods/{pod_id}/members` — didn't exist; added so the member-management UI (and anything else) can actually list who's in a pod, joined with name/email/certification. Verified live.
- [x] Remove pod member — `DELETE /pods/{pod_id}/members/{user_id}`, same `require_pod_lead` guard, rejects removing the pod's own TL (400 — would orphan `Pod.tl_id`). Verified live, including the VE-403 and remove-the-TL-400 cases.
- [x] Cross-pod capacity view — `GET /users/capacity` (owner/tl only), backed by `cross_pod_capacity()` in `services/routing.py`: weighted open load per VE across **all** their pods (the one deliberate pod-isolation break docs/05 calls for). Verified live.
- [x] Client onboarding as a guided flow — 2-step frontend wizard (pod → optional first brand-asset upload), pure orchestration of `POST /pods` → `POST /pods/{id}/brand-assets`. No new backend route needed for this one.

### Backend — job pipeline

- [x] Create job, list job (role-scoped — VE sees only their own)
- [x] Advance-stage endpoint — verified live end-to-end multiple times this session, including the full `intake → assigned → editing → qc1 → revisions → qc1 → qc2 → revisions → qc1 → qc2 → final → delivered` path. QC2 auto-routing fires and picks a reviewer; stickiness confirmed (same reviewer across repeat QC2 passes within one job).
- [x] **Real gap found and fixed while testing**: there was no way to actually set `Job.assigned_editor_id` anywhere — `JobCreate` and the old `JobStageUpdate` never carried it. Added `assigned_editor_id` to `JobStageUpdate`, settable on any `advance` call. This was blocking the "assigned" stage from meaning anything, and both the notify-recipient logic and the capacity/avg-rounds-by-editor analytics depend on it being set.
- [x] Full stage state-machine validation — new `app/services/stage_machine.py` encodes docs/05 exactly: linear forward path `intake→assigned→editing→qc1→qc2→final→delivered`; `qc1`/`qc2`/`final` may additionally go to `revisions`; `revisions` always goes to `qc1` only (never straight back to whoever sent it there); `delivered` is terminal. `advance_stage` now rejects anything else with 400. Verified live: skip-ahead rejected, `revisions → qc2` rejected, `delivered → anything` rejected, all the valid paths accepted.
- [x] `client_sheet_ok` / `ops_tracker_ok` — new `PATCH /jobs/{id}/checklist` (guarded by `require_pod_lead`) sets either flag; `advance_stage` now requires both true before allowing the `→ delivered` transition (400 otherwise). Verified live: delivery blocked without the checklist, TL ticks both flags, delivery then succeeds.
- [x] `services/notify.py`'s `notify()` is wired into `POST /jobs/{id}/advance` via `notify_stage_change()`, mapping the stage just entered to whoever owns acting on it next (assigned→editor, qc1→TL, qc2→reviewer, revisions→editor, final→TL, delivered→editor). Verified live this session: confirmed the right person received a notification at each transition, and that one user cannot mark another's notification read (404).
- [x] `services/certification.py`'s `refresh_certification()` is called from `advance_stage` on delivery. Verified live (correctly stayed uncertified after 1 delivery; needs 3 clean ones per docs/05).
- [x] `Job.delivered_at` is now set on delivery. Verified live.
- [x] `GET /jobs/{id}/events` (new) — activity feed for one job, same VE-scoping as `list_jobs`. Verified live, including a VE-can-see-own-job / would-be-403-otherwise check. Now joined with the actor's name so the feed can say *who* did each thing.
- [x] **Security hole found and fixed (2026-08-03): `POST /jobs/{id}/advance` had no permission check at all** — only `get_current_user`. Any authenticated user could move any job to any valid next stage: a VE could clear their own QC1, or walk someone else's job to `delivered`. The UI hid the buttons, which docs/04 explicitly says is not the boundary. Now gated by `can_advance()` in `services/stage_machine.py` (role × current stage × target × ownership — see the expanded role notes in [04](04-permissions.md)). Verified live via impersonation: VE `editing → qc2` **403**, VE send-back **403**, a QC who is *not* the routed reviewer **403**, QC `qc2 → delivered` **403**; the legitimate moves (VE's three, QC's two, TL's full path) all **200**, and delivery is still checklist-gated (**400** without both flags).
- [x] Send-back change lists — `note` on the advance payload, recorded as a `changes_raised` (or `note_added`) `JobEvent`. No `Comment` table, per docs/03. Verified live end to end: QC send-back with a change list → the editor reads it on their own job → re-submits with a note → QC2 stickiness held (same reviewer, Farah, across both passes).
- [x] `job_events.created_at` now defaults to `clock_timestamp()`, not `now()` (migration `0003`). `now()` is the *transaction* start time, so a stage change and the note written with it shared one timestamp and the feed returned them in arbitrary order — that's why "Job created" could render after "moved to assigned". Verified live: events written by one request now land ~2ms apart, in order.

### Backend — brand assets

- [x] Upload/list endpoints — verified live this session (actual multipart file upload via curl, confirmed stored and listed back).

### Backend — analytics

- [x] Stage distribution — tested live.
- [x] First-pass rate / avg rounds — tested live.
- [x] Avg QC rounds per editor — `GET /pods/{pod_id}/analytics/avg-rounds-by-editor`. Verified live.
- [x] 3+ round flag — `GET /pods/{pod_id}/analytics/stuck-jobs`. Verified live.
- [x] Cross-pod capacity view — see pods & clients above; also surfaced in the Analytics page.
- [x] **Permission bug found and fixed**: every route in `analytics.py` (including the two pre-existing ones) used `require_pod_member`, which let a QC or VE pull pod-wide "team-level" stats — and the new avg-rounds-by-editor is a literal cross-editor comparison, exactly the leaderboard docs/04 says a VE must never see. All four routes now use `require_pod_lead` (Owner or that pod's own TL only). Verified live: QC/VE now get 403 on all four; TL/Owner still get 200.

### Frontend

- [x] Project scaffolded (Vite/React/TS/Tailwind/React Query) — `npm run build` passes clean, and the Docker image build (`docker compose build web`, same `tsc -b && vite build`) passes clean too.
- [x] Login page.
- [x] Pipeline dashboard — now with a "New job" modal (owner/tl only) and each row linking to a job detail page.
- [x] Client onboarding UI — 2-step wizard (`PodOnboardingPage`), see above.
- [x] Pod creation / member management UI — `PodsPage` + `PodCard`/`MemberList`, add/remove members inline.
- [x] Brand asset library UI — per-pod, grouped by type, upload form.
- [x] Job creation UI — modal on the dashboard.
- [x] Job detail page — `AdvanceStageControl` only offers the stages `lib/stageTransitions.ts` (a mirror of the backend transition table) says are valid from the current stage; `ChecklistToggle` shown at `final`; `ActivityFeed` renders `GET /jobs/{id}/events`.
- [x] **Job inspector side panel (2026-08-03)** — clicking any pipeline row or board card slides in `components/pipeline/JobDetailPanel`: what the video is, which client pod, when it came in, the deadline (as "3 days left" / "Overdue by 2 days", not a bare date), editor / QC reviewer / TL, weight, round count, the working-file link, the QC change list, an 8-stage progress ladder built from the event log, and the activity feed. The full job page renders the identical body (`JobDetailContent`) — one component, two mounts, so they can't drift.
  - The action bar is role-aware and labelled as the action, not the stage: an editor sees **Start editing** then **Mark as edited — send for QC**, and after a send-back **Re-submit fixed cut for QC**; a TL sees the QC1 pass and **Send back with changes**; a QC sees clear-QC2 or send-back. A send-back requires a change list before the button enables. `allowedNextStagesFor()` mirrors the backend's `can_advance()` — the server is still the enforcement.
  - When there's nothing for you to do, the panel says who is holding the job instead of showing dead buttons.
- [x] **Pipeline table rebuilt around real data** — the old "Inspect" link column is gone (the row itself opens the panel). Columns now: job title + code + weight + working-file indicator, stage badge, deadline with its live meaning, client pod, editor, QC reviewer, revision rounds (amber at 1+, red at 3+ — the `stuck_rounds` signal from docs/05). Board cards carry the same. Names come from the API (`JobDetailRead`), not from `GET /users`, which is owner/tl-only — the table used to render "—" in the editor/QC columns for every VE and QC because that call 403'd for them.
- [x] Admin Impersonation API — `POST /api/auth/impersonate/{user_id}` (Owner-only). Generates a valid JWT access token for any target user ID with an `impersonated_by` claim.
- [x] "Viewing as" / Impersonation UI — sidebar user selector for Owners, top Impersonation Active Banner with 1-click "Stop Impersonating" revert toggle (`AppLayout.tsx`, `useAuth.ts`, `auth.ts`).
- [x] Official Kontent Media Branding & Typography — stylized geometric logo (large **K** + stacked **ontent Media**) with Google Fonts **Outfit** & **Plus Jakarta Sans**.
- [x] Electric Purple (`#7F00FF`) design system, dark/light theme switching via a `data-theme` attribute. (An earlier note here claimed a standalone `redesign/` suite — there is no such directory; the design system lives in `frontend/src/index.css` and the components themselves.)
- [x] Analytics/charts UI — stat tiles, stage-distribution bar list (colored to match `StageBadge`), avg-rounds-by-editor, stuck-jobs list (rows open the job panel in place), and cross-pod capacity bar.
- [x] Notifications/activity feed UI — nav bell with unread count, full notifications list, mark-read on click, links back to the job.

#### Built in the hardening pass (2026-08-03)

- [x] **QC queue** (`components/qc/`) — the role's first real surface. Waiting on me / sent back, with the editor / still mine elsewhere in the loop / cleared, plus the unrouted section with a Claim button. Availability toggle and the reviewer's own weighted load against the 8-point routing cap sit at the top, because that's the number that decides whether turning availability off matters. A QC landing on `/` gets this, not the owner's overview.
- [x] **QC auto-router view** for Owner/TL (`?view=qcteam`) — replaces a placeholder card that falsely claimed to be "linked to active backend endpoints". Shows unrouted jobs with the *specific* reason routing gave up (everyone unavailable vs. everyone at the cap), who routing can currently pick from, and the real scoring rule from docs/05.
- [x] **Comments everywhere** — a note field on every stage transition (not only send-backs, which is all the panel offered), plus `POST /jobs/{id}/notes` for commenting without moving the job at all. The change list is now a conversation thread with a compose box, in chronological order, so a send-back and its reply sit together.
- [x] **Timeline attribution** — every stage in the ladder shows who moved it there, not just when. After a send-back, QC1 credits whoever sent it there most recently.
- [x] **Notifications made readable** — each row now says who did what to which job in which pod, with the first line of the note when there is one, grouped by day, with mark-all-read. Every row previously read "Job stage changed" and unknown event types printed raw strings like `changes_raised`.
- [x] **User admin** — inline role change, weekly capacity, deactivate/reactivate behind a confirm step, deactivated accounts greyed rather than hidden, and server error messages surfaced against the row that caused them.
- [x] **Pod editing** — rename, pause/churn/reactivate, retainer, and (Owner-only) hand the pod to another TL. Members show both their account role and their pod role, and the "still has open jobs" removal error is rendered as the useful instruction it is.
- [x] **Brand assets are openable** — every asset has a working download, grouped by title with version history; the upload form only renders for the pod's TL/Owner, and the page reads as a resource for editors rather than an admin screen they're locked out of.
- [x] **Real numbers on the Overview** — overdue and first-pass rate computed from the actual job set (em dash, not a fake 100%, when there are no deliveries yet); the invented "WhatsApp spend ₹1.38" tile, the hardcoded "Assets 3" and the fixed "On track" badge are gone; pod cards actually filter the pipeline when clicked.
- [x] **Honest placeholder card** for WhatsApp instead of a claim that it's
  wired up (the equivalent Frame.io card was later removed outright — Frame.io
  was never Phase 2, it's a permanent manual-link workflow).
- [x] **Error states that say what happened** — a job that 404s or 403s explains which, with a retry; unknown URLs render a real not-found page instead of a blank one; an expired session redirects to login with an explanation instead of silently failing every request.

Two things discovered mid-build and added because the frontend items above needed them to mean anything (not on the original checklist): a notifications list/read API (`app/api/routers/notifications.py` — `notify()` was writing rows nobody could read) and `GET /pods/{pod_id}/members` (nothing could list who's actually in a pod).

## Phase 2 — WhatsApp — built; unverified against real Meta credentials

**Direct Meta Cloud API, no BSP.** The BSP account the old plan waited on was
never bought: going direct means owning the template lifecycle, the webhook
listener and the error taxonomy, and that is what the admin page exists for.
Full documentation: **[13-whatsapp.md](13-whatsapp.md)**.

- [x] `services/whatsapp/` — Graph client, template registry, submit/sync,
      guard-railed sender, webhook processing, scheduler
- [x] `services/dispatch.py` — one queue per request, fanned out to desktop
      push and WhatsApp. `notify()` is still the single dispatch point; the
      queue moved out of `push.py`, which dropped everything when VAPID keys
      were absent
- [x] 13 templates defined in code, submitted and status-checked through the
      app's own admin API — including the category-drift alarm that catches
      Meta re-filing a UTILITY template as MARKETING
- [x] Public webhook with HMAC-SHA256 signature verification, `dedupe_key`
      idempotency, delivery receipts, and quick-reply taps that move a job
      through the same `can_advance` check the HTTP route runs
- [x] Migrations 0025 (four tables) and 0026 (`phone_e164`, `whatsapp_opt_in`,
      `last_inbound_at` on `users`, with a backfill)
- [x] `/admin/whatsapp` — Connection · Templates · Events · Delivery log ·
      Numbers. Owner only
- [x] 103 test functions (more cases once parametrised) across six files:
      registry arity against every template, Meta's structural rules, phone
      normalisation and what it refuses to guess, every send guard rail, the
      scheduler's idempotency, and the webhook phrased as the exploit — an
      unsigned POST cannot move a job, a replayed tap moves it once, a tap from
      the wrong number moves nothing
- [ ] **Not yet run against real Meta credentials.** Everything above is
      exercised with a faked Graph client. Nothing has been submitted to Meta,
      no template has been approved, and no message has reached a phone
- [ ] Messaging ships **switched off** (`whatsapp_settings.enabled = false`).
      Turning it on is a deliberate act on the admin page, not a deploy
- Frame.io is **not** in this phase or any future one — manual link-paste is
  permanent, see [08-roadmap.md](08-roadmap.md#explicitly-out-of-scope-no-current-plan)

## Phase 3 — AI chatbot — built; unverified against a real model

Owner/TL only, read-only, typed query tools rather than generated SQL. Full
design and reasoning: **[11-ai-chatbot.md](11-ai-chatbot.md)**.

- [x] **3a — tool layer + tests.** Six typed tools under `services/ai/tools/`
      (`resolve_entity`, `get_pod_health`, `get_person_performance`,
      `find_jobs`, `get_job_timeline`, `get_team_capacity`), each running as
      the calling user through the existing `services/access.py` and
      `check_pod_lead` — no new scoping logic anywhere in the AI layer. The
      tool list is filtered by role *before* the request leaves the server, so
      a QC is offered nothing; `run_tool` re-checks anyway. Tool schemas are
      generated from their Pydantic arg models so contract and validation
      can't drift.
- [x] **3b — OpenRouter client + agent loop + `POST /api/chat`.** SSE, with a
      hard iteration cap that ends in a no-tools call so the user gets an
      answer instead of an error after six paid round-trips. Whole loop tested
      against a scripted client (`tests/stubs.py`) — no key, no network.
- [x] **3c — chat UI.** `/bot` page plus the floating widget, both mounting one
      `ChatThread`. The widget was a disabled "Preview" mock-up; it's real now.
      Tool activity renders in plain words, refusals render differently from
      empty results, job codes open the existing `JobDetailPanel`.
- [x] **3d — conversation persistence (migration `0007`), per-user rolling
      daily cap, `docs/11-ai-chatbot.md`.**
- [x] **3e — charts, breadth, and the refusal problem (2026-08-04).** Driven
      by screenshots of the real bot refusing three questions in a row. See
      **[The bot-refusals pass](#the-bot-refusals-pass-2026-08-04)** below.

**Superseded 2026-08-04** — a key now exists and the bot has been driven
against three real models; see [the bot-refusals
pass](#the-bot-refusals-pass-2026-08-04) for what that found, including a
hallucination on `gemini-2.5-pro` that no test could have caught. The
paragraph below describes the state before that.

**Not verified against a real model**, and that is the one real gap: there is
no OpenRouter account yet, so `OPENROUTER_API_KEY` is empty. In that state the
API answers 503 with a usable message and the UI says so rather than offering
a box that fails on submit. Everything else is covered by 43 tests against a
scripted model, which is not the same as having watched a real one answer.
First thing to do once a key exists: ask it a question whose answer you
already know, and check the tool chips match the lookups it should have made.

**The charts have now been seen.** Rendered in a headless browser across
light/dark × full-page/384px-widget, every chart type, including an
eight-series worst case. Zero console errors. Two defects found and fixed
that no test would have caught: stacked segments were touching with no
surface gap (so segment boundaries rested on hue alone — the exact thing
that fails for a colorblind reader), and the top of a stack was square
instead of rounded at the data end. `BillingNotice` was checked the same way
in all four contexts.

## Known gaps — deliberately not built

Listed so nobody has to rediscover them by reading code:

- **No frontend tests.** The backend suite covers the rules; the React side is
  covered only by `tsc` and the build. A component test setup (Vitest +
  Testing Library) is the obvious next investment.
- **VE/QC own-trend analytics — cancelled, not pending** (decided 2026-08-03).
  docs/04 used to promise every role their own trend; that row is gone.
  Analytics is Owner/TL only, and so is the Phase 3 chatbot, which reads the
  same numbers. No code changed for this: all four routes in `analytics.py`
  already used `require_pod_lead`, and the nav item was already Owner/TL — the
  docs were describing a surface that had never been built. `GET
  /users/me/qc-load` stays QC-visible; it is current queue state, not a
  performance metric, and the QC queue depends on it.
- **The `Team` entity** (people management: leave, pay, 1:1s) exists as a
  table and a `User.team_id` column with no API and no UI. Deliberate — it is
  never referenced by routing, and nothing needs it yet.
- **Certification is computed but only shown in the pod member list.** docs/05
  says an editor should see it as their own progression; there is no profile
  page to show it on.
- **Forgot-password is built but hidden in the UI** — `POST /auth/forgot-password`
  emails a signed, 30-minute, single-use link (SMTP_* env vars; empty = no mail
  sent) and `POST /auth/reset-password` consumes it. The login-page link and the
  `/forgot-password` route are commented out until the next update. Owner and HR
  can also still reset a password by hand (HR: TL/QC/VE/staff only).
- **No rate limiting on login**, and no audit log for impersonation beyond the
  `impersonated_by` claim in the token and the banner in the UI.

## Recommended next steps, in order

1. **Click through the actual UI in a real browser.** Log in as each of the
   four roles and walk the loop: create a job, start editing, send for QC,
   QC1 pass, QC2 send-back with a change list, re-submit, clear, checklist,
   deliver. Then the admin paths: deactivate a user, churn a pod, upload and
   open a brand asset. Everything underneath is verified via the API and now
   covered by tests; the rendered UI has still not been driven by a human or
   a browser tool end to end.
2. Frontend test setup (Vitest + Testing Library), starting with the pieces
   that encode rules: `stageTransitions`, `deadlineInfo`, the QC queue's
   grouping.
3. **Set up the Meta side and run the WhatsApp rollout.** The code is built
   and tested against a faked Graph client; nothing has reached a real phone.
   The seven manual steps (business verification, WABA, number, app, System
   User token, webhook subscription) and the suggested ramp are in
   [13-whatsapp.md](13-whatsapp.md). Submit the templates *after* the webhook
   is subscribed, so approvals land while you watch. Frame.io stays a manual
   pasted-link workflow permanently — no API integration planned.
4. **Create an OpenRouter account and set `OPENROUTER_API_KEY`.** That is the
   only thing standing between the built Kontent Bot and a working one. Then
   ask it something whose answer you already know and check the tool chips
   match the lookups it should have made — a fluent wrong answer is the
   failure mode to watch for, and no test can catch it.
