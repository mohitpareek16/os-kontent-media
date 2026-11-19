# Pipeline & routing

## Stages

| Stage | Owner | Notes |
|---|---|---|
| Intake | TL | Job created from client brief |
| Assigned | VE | Editor picked; the next move is theirs — start the cut |
| Editing | VE | Editor cuts the video |
| QC1 | TL | First-pass review, done by the pod TL |
| QC2 | QC | Second-pass review, dedicated QC team, auto-routed (see below) |
| Revisions | VE | Editor picks the change list up and re-enters Editing |
| Final check | TL | Last look before delivery |
| Delivered | — | Terminal. Requires both delivery-checklist flags ticked |

The Owner column is a **partition**: every open stage is waiting on exactly
one role, and that is what "Mine" means in the product
(`services/access.py::mine_clauses`, `STAGE_OWNER_ROLE` in
`stage_machine.py`). Mine used to be "a job with my name on it"
(`assigned_editor_id` or `qc2_reviewer_id`), which meant **a TL's Mine tab
counted zero forever** — a TL is neither — while an editor's counted cuts
already sitting in QC that they could not touch. It now asks whose move it is.
Delivered and scrapped jobs are on nobody's plate and are never Mine.

Owner / Founder's Office / HR reach every pod but are rarely anyone's
`Pod.tl_id`, so their Mine is usually empty by construction and the UI drops
the tab for them rather than showing a standing zero.

### The hand-off is an editor *and* a deadline

There is one exception to the Owner column, and it is the only one:
**a job at an editor's stage with no deadline on it is still the TL's move.**
`stage_machine.is_briefed()` is the predicate, `owner_role_for()` applies it,
and `mine_clauses` and the stage buttons both read it.

Assigning is two decisions and the product used to accept one of them. A job
with a name on it and no date landed in the editor's Mine, purple, with a live
**Start editing** button and "No deadline" where the date goes — nothing to
work against, indistinguishable from the job due tomorrow, and invisible to
the overdue count forever. So until both halves are set:

- it is **not** in the editor's Mine and not tinted for them — it is in the
  **TL's**, which is the desk that can fix it;
- the editor's three moves are **refused on the route** (403), not merely
  hidden;
- the job panel says so to both of them, and offers the TL the date field
  (`BriefGate`).

Throughout this document, **"deadline" means the team deadline** —
`Job.deadline`, the date the pod works to and the only one an editor or a QC
is ever shown. The client's own date lives in `Job.client_deadline`, is
usually later, and is visible to the Owner and the pod TL alone
(docs/03, docs/04). Nothing in the pipeline reads it: the gate below, the
overdue count, the row tints and the sort all run on the team's date, which
is the earlier and stricter of the two.

The deadline can ride along on the assigning move — `POST /jobs/{id}/advance`
takes `deadline` (and `client_deadline`) next to `assigned_editor_id`, all
lead-only — so finishing
the hand-off is one action rather than a move plus a remembered PATCH. A job
may still be created or left without a date; it just does not leave the TL.

## The revision loop

A send-back from **QC1, QC2, or Final check** drops the job into
**Revisions**. From there the editor re-enters **Editing** to work through the
change list, and the fixed cut goes back to **whichever desk sent it back** —
a QC2 send-back returns to QC2, a Final-check one to the final check, and a
QC1 one to QC1. There is no fixed cap on rounds; the loop exits only when a
review produces zero change requests.

Which desk that is, is remembered on the job: `Job.sent_back_from`, written
when it enters Revisions and cleared when the editor re-submits
(`stage_machine.resubmit_stage()`). Before it existed the loop always went
back through QC1, which put the **pod TL in front of a change list they never
wrote** — re-reviewing someone else's notes — while the reviewer waiting to
close their own round sat behind them. QC1 is the TL's *first* pass; a second
one on a re-cut is not a review, it is a queue.

**Why revisions goes through Editing rather than straight to the reviewer.**
The move is one click for the editor and it is what puts a *start* on the
record for a revision round: `Revisions -> Editing` is the starting gun,
leaving Editing is the finish line, and without the first the log says only
that a round ended. Both ways into the edit bay are the editor's; there is
only one way out.

A send-back carries a **change list** — the `note` on `POST /jobs/{id}/advance`,
written to the event log as a `changes_raised` `JobEvent` (a note on a forward
move becomes `note_added` instead). This is the hand-off the editor picks the
job back up from, and it is deliberately *not* a `Comment` table: the notes
live on the append-only log, and per-frame QC comments stay wherever the
editor uploaded the cut for review (Frame.io today) — never mirrored here,
see [Data model](03-data-model.md).

A note can also be left **without moving the job** — `POST /jobs/{id}/notes`,
open to anyone who can see the job. A TL with a question at QC1 shouldn't have
to send the job somewhere to be heard, and an editor mid-cut shouldn't have to
finish in order to flag a problem with the brief. Whoever owns the current
stage gets the notification.

`Job.round` increments on every send-back. This number — not "how long has
this job been open" — is the real signal for pipeline health. A job stuck at
round 4 is a briefing problem almost every time, not an editor problem; see
the `stuck_rounds` event in [Future integrations](09-integrations-future.md)
for how this eventually becomes a proactive alert.

## When QC1 didn't happen

QC1 is the pod TL's first-pass review, and nothing on the record told a real
one apart from a cut waved straight through: both are a `stage_changed` event
from qc1 to qc2. The person who finds out is the **QC2 reviewer**, who is now
doing two reviews' work on something nobody checked — and until this existed,
the only thing they could do about it was mention it in a chat nobody logs.

**QC1 forward is two moves, not one.** Roughly 98 cuts in 100 go forward from
QC1, so the panel offers the two ways that happens as equals — **QC1 approved**
and **QC1 comments added** — with the send-back demoted to a text link beside
them. Both land the job on QC2; the difference is recorded as `qc1_outcome` on
the `stage_changed` event.

That difference is the point. This team writes its QC comments on Frame.io, as
voice notes against timestamps, and those comments never enter this database
([Data model](03-data-model.md)) — so a TL who reviewed a cut thoroughly and a
TL who did not look at all leave *identical* records: a fast pass with nothing
attached. `comments_added` is the only trace the review happened, and it is
what stops a real one from reading as a rubber stamp downstream. A move that
names no outcome is recorded as `approved`, which is exactly what the single
button that used to be here meant.

**The evidence comes next.** `GET /jobs/{id}/qc1-pass`
(`services/qc1_review.py`) reports the latest pass out of QC1: who cleared it,
when, how long the job had been sitting there, which of the two buttons they
pressed, and whether anything was said — counting both notes left at QC1 and
the hand-off note typed into the move itself. Derived from the log, never
stored.

It reports **facts and no verdict**. A pass in forty seconds with nothing said
is usually a rubber stamp and occasionally a TL who watched the cut being made
over the editor's shoulder; the system cannot tell those apart, so there is no
threshold column and nothing is refused on one. The panel says "that looks
quick" and a person decides — and it says nothing at all when the pass is
marked `comments_added`, because there the zero is an artefact of where the
team writes things down rather than evidence of anything.

A pass recorded before the two buttons existed reports **no outcome**, not
`approved`. Backfilling a self-report onto thousands of old rows would put
words in people's mouths on a panel that gets read in arguments.

**The flag is manual and it names somebody.** `POST /jobs/{id}/qc1-flag` takes
a mandatory reason, and:

- **Who:** the QC2 reviewer the job is routed to, plus Owner / Founder's
  Office / HR auditing after the fact (`qc1_review.py::may_flag_qc1`).
  Deliberately **not the pod TL** — QC1 is their own review, and a TL raising
  or clearing one is marking their own homework. Not the editor either: they
  have the most to gain from discrediting a review of their own cut, and the
  reviewer sees the same evidence anyway. Nobody can flag a pass they made
  themselves.
- **Nothing about the job moves.** Same stage, same round, same reviewer; the
  QC2 review carries on. It is a statement about what already happened, not a
  send-back — see [Data model](03-data-model.md) for why it is not a stage.
- **The person named is told**, along with the pod TL, never the reviewer who
  raised it. A flag someone discovers from a dashboard tint weeks later is an
  accusation made behind their back, and "I did review that one" is worth
  having while anyone still remembers the cut.
- **It shows up everywhere the job does** — amber row tint and an explicit
  "QC1 flagged" chip in the pipeline table and on board cards, a banner at the
  top of the job panel, a `QC1 FLAGGED` tile on the Overview and a filter that
  cuts across every status tab. The tint outranks *delivered*: a skipped QC1
  on a video that has already gone to the client is the case a lead most needs
  to catch, and green is exactly what would hide it.
- **Clearing it is `POST /jobs/{id}/qc1-flag/clear`** — the reviewer who
  raised it withdrawing, or the company-wide tier dismissing it after hearing
  both sides. Not the TL it names, and not the pod TL: a flag the accused can
  delete is not a flag. The job's columns clear; both events stay on the log,
  so "raised and withdrawn an hour later" remains readable, which over a few
  months is the pattern actually worth seeing.

One flag is a bad day. The number worth watching is on the Overview, and it is
a question about the process, not about a video.

## QC2 auto-routing

QC2 is a dedicated team, separate from TLs (who own QC1). Routing balances
load but is sticky on revisits:

- **First QC2 assignment on a job:** pick the lowest-scoring *available*
  reviewer.
- **Every subsequent round on that same job:** stays with the same reviewer.
  They already know the change list; re-routing to whoever's idle means a
  fresh reviewer re-reads everything and often raises new, unrelated notes —
  a 2-round job becomes a 4-round job. Stickiness is not an optimization, it's
  the point.

### What a review costs, and what a reviewer has to spend

The full model, with the reasoning and the fill tables, is
[QC2 load model](12-qc2-load-model.md). This is the working summary.

A review is priced by **what kind of video it is**, because that is what
decides how long watching it takes:

| Content type | First review | Round 2, 3, 4 … |
|---|---|---|
| Short form | 1 | 1 |
| Long form | 3 | 2 |
| Podcast | 6 | 3 |

A repeat round is a change-list check, not a fresh watch, so it costs
`ceil(base / 2)`. **The halving happens once** — round 2 and round 6 cost the
same. A *different* reviewer picking up a round-2 job pays full price: they
have not seen the cut, whatever the round counter says.

A reviewer has **24 points a day full-time, 12 part-time**
(`User.employment_type`; the budget is derived from it and never stored per
account). 24 is eight long-form reviews, which is the figure the pods agreed.

**The budget is daily, and that is not a work-in-progress cap.** Points are
spent against a *date*, and finishing a job does not hand them back the same
day: a full-timer who burns 24 by lunch is done until tomorrow. That cannot be
derived from open jobs, so the spend is written to a ledger — `qc2_charges`,
one row per round, released when the job leaves QC2 in either direction. A
reviewer's load is one query over it: everything dated today, plus anything
still open from an earlier day. The day rolls over in
`settings.qc2_day_timezone` (Asia/Kolkata), which is the one clock in this app
that is not UTC — a budget is a promise about a *working day*.

This replaced a weighted count of open jobs against a single company-wide
8-point cap. Under that rule every job weighed the same to the router (see
migration 0018), a part-timer was loaded exactly like a full-timer, and a fifth
revision round cost a reviewer as much as a first watch.

### Assignment order

1. **Sticky check.** Round 2 or later goes back to the reviewer who raised the
   changes, at the re-review price, **even if it takes them over capacity** — a
   repeat round never re-enters load balancing. Falls through to the pool only
   if that account has been **deactivated**. Marking yourself unavailable does
   not scatter your open revisions: `available` means "don't send me *new* QC
   work today", and a cut you already watched and wrote notes on is not new
   work.
2. **Build the pool.** Available today, active account, and
   `current_load + this job's cost ≤ their capacity`. Note this is the incoming
   job's cost, not just "are they under the cap" — a reviewer with 4 points
   free cannot take a podcast. A part-timer holds at most **one podcast a day**
   whatever their points say; that one constraint is not arithmetic.
   **Candidates are the pod's own QC members first**; if a pod has no QC member
   yet, routing falls back to the whole QC team. Pod membership is where the
   familiarity bonus comes from, not a gate — QC2 is a company-wide team.
   Before this fallback existed, a newly onboarded pod sent every job it
   produced straight into the unrouted pile, which reads like a broken pipeline
   rather than "nobody is free".
3. **Empty pool.** A job marked `rush` may be pushed onto the least-loaded
   reviewer at up to **125%** of their day. Past that — and for every job
   without the flag — it holds as unrouted and alerts the TL. Rush moves the
   wall; it does not remove it, and it does not lift the podcast cap.

   The flag is set at intake **or later**, by the pod's TL, from the job panel
   — which is how it actually arrives: the client escalates something already
   in the pipeline. Turning it on for a job that is *already* sitting unrouted
   at QC2 re-runs the routing on the spot (`PATCH /jobs/{id}`), because nothing
   else ever would: routing runs on the move into QC2 and on a manual claim,
   and neither was going to happen again for a job that had already failed to
   place.
4. **Score.**

   ```
   score = load ÷ capacity
         − 0.15  if they've cleared work on this pod before
         − 0.05 × min(days_idle, 3)
   ```

   `load ÷ capacity` is a **fraction**, not a 0–100 percentage: at that scale
   the familiarity bonus would be rounding noise. Scoring on a share of
   somebody's own day rather than on raw points is the entire reason two
   capacities exist — otherwise a part-timer gets loaded like a full-timer.
5. **Assign.** Lowest score wins. The charge is written and `qc2_assigned_v1`
   is recorded, carrying the reviewer, the price, the winning score, and
   whether the budget was knowingly overflowed.

### Four rules not to change without sign-off

- **The sticky check runs before the pool filter.** A repeat round never
  re-enters load balancing.
- **An empty pool holds the job.** It never assigns to the least-bad option and
  never silently overflows — rush is the one exception and it is bounded.
- **Scoring uses share of capacity, not raw points.**
- **A charge is released on pass, not on assignment**, so unfinished reviews go
  on occupying the budget.

### When nobody can take it

If nobody is available or everyone has spent their day, the job stays
**unrouted** and surfaces on the QC team page — it does not vanish or sit
silently in someone's queue. Concretely, an unrouted QC2 job: notifies the
**pod TL** (it used to notify nobody at all, because the recipient resolved to
a null reviewer, and the job then sat invisible until somebody happened to
look); appears in the *Unrouted* section of the QC queue, which every QC in
that pod can see and pick up; and is included in a QC's row scoping for exactly
that reason — see `services/access.py::job_scope_clauses`.

**"Pick up" is a real verb**: `POST /jobs/{id}/claim-qc2` self-assigns the job,
bills the claimer for the round, and writes a `qc2_claimed` event. Without it
this paragraph described something the API could not do — `qc2_reviewer_id` was
only ever written by the auto-router on the way *into* QC2, and a QC cannot
advance a job that isn't already theirs, so an unrouted job was stuck
permanently and freeing capacity later did not re-route it. A TL or Owner can
also assign a reviewer directly via `PATCH /jobs/{id}`; naming somebody by hand
is by definition overriding the budget, so no capacity check is applied — but
the charge is still written, or hand-assigned work would be invisible to every
load query and the router would go on stacking jobs on that person. First claim
wins; the second reviewer is told who took it.

Because the budget is daily, an unrouted job is reachable again tomorrow
morning without anybody doing anything — but routing only runs as a job *enters*
QC2, so one already sitting in the pile still needs picking up by hand.

Implementation lives in one place — `app/services/routing.py` — never
duplicated inline in a route handler.

## Certification

An editor is certified on a pod after **3 deliveries at ≤1 QC round** on that
pod. This is:

- **Computed, not maintained** — a query over `Job` history, nobody edits a
  list.
- **Used for routing, not gatekeeping** — certified editors can be pulled for
  urgent capacity on that pod even outside its "standing" members, without
  losing the brand-context benefit that pods exist to protect.
- **Shown to the editor as progression** — visible on their own profile, not
  as a company-wide leaderboard (see [Permissions](04-permissions.md)).

## Cross-pod capacity

An editor can belong to multiple pods, each with a different TL. No single TL
naturally sees an editor's *total* load across pods — this is the one place
pod isolation is deliberately broken: the assignment screen shows a person's
open load across **all** their pods, not just the TL's own, so nobody gets
double-booked by accident.

**Assigning an outsider joins them to the pod** rather than being refused.
Every picker in the product lists every active account of the right role,
company-wide — that is what "load is cross-pod" means — so "not a member of
this job's pod" was a 400 raised against a name the product itself had just
offered, and the TL's only route out of it was a detour to the pod screen to
add the person by hand and then start the assignment over. Choosing someone
for work in a pod *is* the decision to have them on it, so the membership row
follows the assignment:

- `ensure_assignable_editor` — `pod_role='ve'`, written after the role,
  deactivation and capacity checks have passed. Last, so a save that is
  refused leaves nothing behind, including a batch where an early row's join
  must not outlive a later row's rejection.
- `ensure_assignable_reviewer` — `pod_role='qc'`, for a lead naming a QC2
  reviewer by hand. There is no cap to check: naming a reviewer *is* the
  override of the routing score, and an unrouted job is by definition one the
  pod's own reviewers could not take, so the person reached for next is
  usually from outside it.

`certified_at` stays null either way: certification is earned per pod off that
pod's deliveries and is never granted by arrival.

Nothing is taken away by this — membership is additive, an existing row is
left exactly as it is (a TL who also cuts video keeps their `tl` row), people
keep every pod they were already in, and removal is still the deliberate act
it was (`DELETE /pods/{id}/members/{user_id}`, which refuses while they hold
open work there).

Auto-routing is the one thing still scoped to the pod: `route_qc2` scores the
pod's own reviewers, because picking someone automatically is not the same act
as a lead choosing a name. When it finds nobody the job lands unrouted, which
is where a human picks from the full list.

## How much one editor may hold

`User.max_concurrent_jobs` (default 5, set per person on the admin screen) is
a hard work-in-progress limit: how many videos an editor may have on their
plate at once, counted as jobs rather than weighted points. Every job assigned
to them that is neither delivered nor scrapped counts — including cuts sitting
in QC, which can come back as a revision and are therefore still theirs. A
slot frees on **delivery**, and nothing else.

It is enforced in one place, `services/access.py::ensure_assignable_editor`,
which every path into an editor's queue already goes through: creating a job
with an editor, batch-creating a pasted list, assigning at intake, and
reassigning in flight. A batch also counts its own uncommitted rows, so twenty
pasted jobs pointed at one person are twenty against the cap rather than
twenty separate "they have room" answers.

The pickers are built on `free_slots` from `/users/ve-load` and
`/users/editor-capacity`: an editor with none left is **not offered**, rather
than offered and refused on save. Work that finds no free editor stays in
`intake`, which is a legitimate resting state, not a failure.

This replaced `capacity_per_week`, a weighted forecast nothing ever checked —
the number sat on the admin screen while assignment walked straight past it.

## Handing a job to a different editor

Work stalls on the person, not on the job: the editor is off sick, their week
filled up, the cut turns out to be beyond them. `POST /jobs/{id}/reassign`
moves it, and takes a mandatory reason.

- **Who:** the pod's TL, plus Owner / Founder's Office / HR on any pod — the
  same `check_pod_lead` gate as scrapping or delivering. An editor cannot pass
  their own job on, and a QC cannot move it off the person they are reviewing.
- **The stage does not move.** A job handed over at QC2 is still at QC2 on the
  same round; only the name on it changes, because that is the whole truth of
  what happened. It is not a trip back to `assigned`.
- **The reason is the point.** Who has the job was always visible; why it
  changed hands was not, and "editor someone else → someone else" in the feed
  is what a silent swap left behind. So this is the *only* way to change an
  editor who is already on a job — `PATCH /jobs/{id}` and the
  `assigned_editor_id` passenger on `/advance` still make the first
  assignment and now refuse a swap, since a second route writing the same
  field without a reason makes the reason optional in practice.
- **Both editors and the TL are told**, never the person who made the change.
  The one who lost the job needs to stop; the one who gained it has work no
  stage change announced; the TL owns the pod's output and may not have been
  the one who decided.
- **A delivered or scrapped job cannot be reassigned** — the first would
  rewrite who did the work, the second accepts no work at all.
- **The clock splits at the handover** (see below): whatever the first editor
  spent stays theirs.

## Delivery

Requires both `client_sheet_ok` and `ops_tracker_ok` on the job (see
[Data model](03-data-model.md)) — a stopgap for the current dual-tracker habit,
flagged if a delivered job has one ticked and not the other. The real fix is
that this platform becomes the one place status lives; treat these two flags
as temporary, not as a pattern to extend.

## Active vs Intake

Two status tabs, and they are **disjoint**: `intake` is work that has arrived
with nobody on it, `active` is work that has been assigned and is moving —
`assigned` through `final`.

`active` used to mean "anything not delivered", which contained `intake`
whole. A board with 15 cuts in progress and 43 videos still waiting to be
handed out reported **58 active**, the two cards sitting next to each other
did not add up, and unassigned rows were interleaved with work underway in one
undifferentiated list. They are two questions with two different owners —
"how is the work going" and "who takes this next" — and the pipeline table now
answers them separately.

`overdue` is the deliberate exception and still counts intake: a video past
its deadline that nobody has even been given is the most overdue thing on the
board, and dropping it out of the alarm for not being "active" would hide the
case worth shouting about.

**The default sort follows from the same split.** `sort_by=pipeline` groups
rows by what state the work is in — in progress, then waiting for an editor,
then delivered, then scrapped — and sorts by deadline inside each group with
undated rows last. Sorting by creation date put a video pasted in this morning
with nobody on it above one due today and half cut. Clicking a column header
replaces the pipeline order outright rather than layering on top of it.

## Scrapping a project

Work gets cancelled — the client pulls the campaign, the brief dies, the
footage never arrives. `POST /jobs/{id}/scrap` records that with a mandatory
reason; `POST /jobs/{id}/restore` undoes it. Before this existed the only ways
to express it were to leave the job rotting in a queue forever or to march it
to "delivered", which is a lie that lands in the first-pass rate and in the
client's delivered count. Both were happening.

- **Who:** the pod's TL, plus Owner / Founder's Office / HR on any pod — the
  same `check_pod_lead` gate as editing or delivering the job. Cancelling a
  client commitment is not an editor's or a reviewer's call.
- **The job keeps its stage**, and its round count. Scrapped is a separate
  fact, not a ninth stage — see [Data model](03-data-model.md) for why.
- **A delivered job cannot be scrapped.** It has already gone to the client;
  rewriting that is history the client can contradict.
- **It stops counting immediately** — out of Active, Overdue and Mine, out of
  every editor's and reviewer's load, out of routing, certification, the
  analytics and the bot's answers. It stays in **All**, and has its own
  Scrapped tab, because a row that vanishes from every view is a row people
  conclude the system lost.
- **Everyone holding a piece of it is told** — the assigned editor, the QC
  reviewer and the pod TL, never the person who scrapped it. Unlike a stage
  change this has no next owner; the point is that there isn't one, and people
  find out by noticing a job silently vanish otherwise.
