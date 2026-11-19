# QC2 load model & auto-assignment

**Update (migration `0029`):** The fixed `QC2_WEIGHT` prices below describe the
original model. The owner now manages video types and first-review QC points at
`/admin/video-types`. The catalog starts with short form 1, long form 3, and
podcast 6 points. A disabled type stays on existing jobs and historical charges
but cannot be selected for new work. New charges use the current catalog price;
charged rows keep their original points. The 24/12 daily budgets, repeat-review
halving, and part-time podcast cap still apply. Apply migration `0029` to the
server database when deploying this code.

**Status: built and shipped (2026-08-07), migration `0019`.** This document is
kept as the reasoning behind the model — why a review is priced this way, why
the budget is daily, and which four rules must not move. The working summary a
reader needs day to day now lives in
[Pipeline & routing](05-pipeline-and-routing.md), whose *Scoring* section this
replaced as planned; the ledger is in [Data model](03-data-model.md).

Four things came out differently from what is written below. They are recorded
in [§12](#12--what-changed-in-the-build) rather than edited into the text, so
the design and the decisions taken against it stay separately readable.

QC1 is always the pod TL and is never auto-assigned. Everything below governs
**QC2 only**.

## Why

Migration `0018` moved every screen from `Job.weight` (light / standard / heavy)
to `Job.video_type` (short_form / long_form / podcast), and deliberately left
`weight` behind, saying so in its own docstring:

> `weight` is what QC2 routing and editor load are counted in … Every job now
> takes the default (`standard`), which makes the load maths **a job count in
> disguise until the score is rebuilt on something real.** That is a deliberate
> holding position, written down here rather than left for somebody to discover
> in six months.

This is that rebuild. Today every job weighs the same to the router, a part-timer
is loaded exactly like a full-timer, and a fifth revision round costs a reviewer
as much as a first watch. None of those are true of the work.

## 1 · Point cost per video

| Content type | First review | Round 2, 3, 4 … |
|---|---|---|
| Short form | 1 | 1 |
| Long form | 3 | 2 |
| Podcast | 6 | 3 |

A repeat round is a change-list check, not a fresh watch, so it costs
`ceil(base / 2)`. **The halving happens once.** Round 2 and round 6 cost the
same — it is half of the base price, never half of the previous round. `ceil`
keeps every figure an integer, which keeps the budgets below divisible.

A *different* reviewer picking up a round-2 job pays full price. They have not
seen the cut, so it is a first watch for them whatever the job's round counter
says. This is why the price is stamped on the charge rather than recomputed from
`round` — see §8.

## 2 · Daily capacity

| Reviewer | Points / day | Max short form | Max long form | Max podcast |
|---|---|---|---|---|
| Full-time | 24 | 24 | 8 | 4 |
| Part-time | 12 | 12 | 4 | 2 (capped to 1, see below) |

Anchored on the agreed figure of **8 long-form reviews in a full-time day**. Both
budgets divide cleanly by 1, 3 and 6, so no combination of content types leaves
an unusable remainder.

The per-type columns are arithmetic, not separate limits — they fall out of the
points. The one real extra constraint is `PART_TIME_PODCAST_MAX = 1`.

## 3 · The budget is daily, and that is not a work-in-progress cap

This is the decision that shapes the whole build, so it is worth being blunt
about: **points are spent against a date, and finishing a job does not hand them
back the same day.** A full-timer who burns 24 points by lunch is done until
tomorrow.

That cannot be derived from open jobs the way today's weighted load is, because a
job cleared at noon must still count against the afternoon. It needs a ledger:

```
qc2_charges
  id, job_id, reviewer_id, work_date, points, round, created_at, released_at
```

A reviewer's load right now is one query over it:

```sql
SELECT COALESCE(SUM(points), 0) FROM qc2_charges
WHERE reviewer_id = :reviewer AND (work_date = :today OR released_at IS NULL)
```

Two clauses, and each one is there for a reason:

- **`work_date = today`** — everything spent today, cleared or not. No same-day
  refunds. This is the half that makes the budget daily rather than a WIP cap.
- **`released_at IS NULL`** — a round still open from an earlier day, which keeps
  occupying the budget until it is actually reviewed. Without it, a reviewer who
  sat on Monday's podcast starts Tuesday looking free and the router hands them
  another one.

A row matching both clauses is still one row, so the sum does not double-count.

**`released_at` is not a refund.** It marks a round finished. A charge is
released when the job leaves QC2 in *either* direction — passed to Final, or sent
back to Revisions — because the reviewer's work for that round is done either
way. When the re-cut returns, a **new** charge is written at the re-review price
against the day it returns on. So a podcast is 6 points on Monday and 3 on
Thursday, rather than 6 points blocked across three days in which the reviewer
did nothing with it.

**The day rolls over in `settings.qc2_day_timezone`, defaulting to
`Asia/Kolkata`.** Everything else in the app stores UTC and is right to; a budget
is different, because it is a promise about a working day. Left implicit it would
reset at 05:30 IST — before anyone starts, so it would mostly have worked, which
is the worst kind of accident to leave in a schedule.

## 4 · Constants for the code

Only these go into the build. The fill tables in §5 are reference for the ops
team — do not hardcode them, or a fourth content type breaks the lookup.

```python
QC2_WEIGHT            = {"short_form": 1, "long_form": 3, "podcast": 6}
CAPACITY              = {"full_time": 24, "part_time": 12}
REREVIEW_DIVISOR      = 2      # ceil(base / 2), applied once
RUSH_OVERFLOW         = 1.25   # rush only, least-loaded reviewer
PART_TIME_PODCAST_MAX = 1      # per reviewer per day
```

`QC2_WEIGHT` is a **new** dict and does not replace `WEIGHT_POINTS` in
`services/routing.py`. That one counts *editor* load, which is a different
question: a podcast is quick to edit and slow to review, so the two values
diverge and cannot share a column. This is the same reason `video_type` was made
a separate field from editing weight in the first place.

## 5 · Exact-fill combinations (reference only)

A reviewer may sit below any of these; they are ceilings, not targets.

**Full-time — 24 points**

| # | Podcast | Long form | Short form | Videos |
|---|---|---|---|---|
| 1 | 0 | 8 | 0 | 8 |
| 2 | 0 | 7 | 3 | 10 |
| 3 | 0 | 6 | 6 | 12 |
| 4 | 0 | 5 | 9 | 14 |
| 5 | 0 | 4 | 12 | 16 |
| 6 | 1 | 6 | 0 | 7 |
| 7 | 1 | 5 | 3 | 9 |
| 8 | 1 | 4 | 6 | 11 |
| 9 | 1 | 3 | 9 | 13 |
| 10 | 1 | 2 | 12 | 15 |
| 11 | 2 | 4 | 0 | 6 |
| 12 | 2 | 3 | 3 | 8 |
| 13 | 2 | 2 | 6 | 10 |
| 14 | 2 | 1 | 9 | 12 |
| 15 | 2 | 0 | 12 | 14 |
| 16 | 3 | 2 | 0 | 5 |
| 17 | 3 | 1 | 3 | 7 |
| 18 | 3 | 0 | 6 | 9 |
| 19 | 4 | 0 | 0 | 4 |

**Part-time — 12 points**

| # | Podcast | Long form | Short form | Videos |
|---|---|---|---|---|
| 1 | 0 | 4 | 0 | 4 |
| 2 | 0 | 3 | 3 | 6 |
| 3 | 0 | 2 | 6 | 8 |
| 4 | 0 | 1 | 9 | 10 |
| 5 | 0 | 0 | 12 | 12 |
| 6 | 1 | 2 | 0 | 3 |
| 7 | 1 | 1 | 3 | 5 |
| 8 | 1 | 0 | 6 | 7 |

Row 1 is the agreed baseline: four long-form videos and nothing else.

> The original spec carried a ninth part-time row — 2 podcasts, 0 long, 0 short —
> which `PART_TIME_PODCAST_MAX = 1` makes unreachable. The constant is the build
> and the tables are reference, so the constant wins and the row is struck.

## 6 · Assignment order

1. **Sticky check.** Round 2 or later with a prior QC **still available** →
   return to that same reviewer at the re-review price, even if it takes them
   over capacity. If that account is deactivated or unavailable, fall through to
   the pool — today nothing re-checks, so a deactivated reviewer keeps a job
   forever.
2. **Build the pool.** Available today, active account, and
   `current_load + this job's cost ≤ their capacity`. Note this is the incoming
   job's cost, not just "are they under the cap" — a reviewer with 4 points free
   cannot take a podcast. Part-timers already holding their podcast are out for
   podcasts and still in for everything else.
3. **Empty pool.** Rush jobs may exceed the least-loaded reviewer by 25%.
   Otherwise the job holds as unrouted and alerts the TL.
4. **Score.** `load ÷ capacity`, minus `0.15` for pod familiarity, minus `0.05`
   per idle day, capped at 3 days.
5. **Assign.** Lowest score wins. Write the charge, stamp the assignment time,
   fire `qc2_assigned_v1`.

`load ÷ capacity` is a **fraction**, not a 0–100 percentage. At 0–100 the 0.15
familiarity bonus would be rounding noise.

## 7 · Four rules not to change without sign-off

- **The sticky check runs before the pool filter.** A repeat round never
  re-enters load balancing.
- **An empty pool holds the job.** It never assigns to the least-bad option and
  never silently overflows.
- **Scoring uses percentage of capacity, not raw points** — otherwise part-timers
  get loaded like full-timers, which is the entire reason the two capacities
  exist.
- **A charge is released on pass, not on assignment**, so unfinished reviews go
  on occupying the budget.

## 8 · What this needs that already exists

| Requirement | Where it already is |
|---|---|
| Content type captured at intake | `Job.video_type` — `models/job.py`, migration `0018`, captured in `NewJobWizard.tsx`. **This dependency is already met.** |
| Sticky check before the pool filter | `routers/jobs.py` only calls `route_qc2` when `qc2_reviewer_id is None` |
| A job that cannot be placed holds and alerts the TL | `route_qc2` returning `None` leaves the job at stage `qc2` with a null reviewer — this *is* the "awaiting QC" state. TL notified in `services/notify.py`; it appears in the Unrouted queue and is claimable via `POST /jobs/{id}/claim-qc2` |
| Familiarity and idle-day bonuses | `services/routing.py`, with the old constants |
| An event on assignment | `services/events.py::record_event`, and the `qc2_claimed` event as precedent |
| A per-user capacity field edited inline by an admin | `User.max_concurrent_jobs` (migration `0014`), edited per row on the Users admin page — the pattern for full-time / part-time to copy |

## 9 · What has to be built

**Backend**

- `User.employment_type` — enum `full_time` / `part_time`, default `full_time`.
  The budget is derived from it via `CAPACITY`, never stored per account: change
  what a part-time day is worth and it changes for everybody at once.
- `models/qc2_charge.py` — the ledger from §3. Indexed on
  `(reviewer_id, work_date)` and on `reviewer_id WHERE released_at IS NULL`,
  which are the two halves of the load query. A partial unique index on
  `job_id WHERE released_at IS NULL` keeps a job to one open round, so two
  assignment paths racing cannot bill one review twice.
- **Migration `0019`** — the enum, the user column, the ledger table, and a
  backfill: every job currently in `qc2` or `revisions` with a reviewer gets an
  open charge dated today, priced off its `video_type` and `round`. Without the
  backfill those reviewers start the day looking empty while holding real work.
- `services/routing.py` — the constants from §4; `qc2_cost(video_type, repeat)`
  as the single place a price is decided; `daily_load()` replacing
  `_weighted_open_load()`; `route_qc2()` taking the job rather than a weight
  string; the §6 pool filter and score; `sticky_reviewer()` with the
  availability fall-through; and `charge()` / `release()` as the only two
  functions that write the ledger. Routing logic lives here and is never
  duplicated into a route handler.
- `routers/jobs.py` — write the charge on assignment and emit `qc2_assigned_v1`
  carrying reviewer, cost and winning score; release it when the job leaves QC2
  in either direction; write a fresh charge when a re-cut comes back.
- `services/access.py::ensure_assignable_reviewer` — a lead naming a reviewer by
  hand is *by definition* overriding the score, so no capacity check is added.
  It does need to write the charge, or hand-assigned jobs are invisible to every
  load query.
- `routers/users.py` — `/users/qc-load` and `/users/me/qc-load` both bake the
  global cap into their response today. Both move to the reviewer's own capacity
  and gain a breakdown: spent today, carried from earlier days, videos by type,
  podcasts held.
- `services/ai/tools/capacity.py` — the chatbot's prompt states the old
  light/standard/heavy weights in prose. Stale text there means the bot quotes
  the wrong model with full confidence.

**Admin panel**

- Users admin page: a full-time / part-time control per row, cloning the inline
  `max_concurrent_jobs` editor, with the derived budget shown read-only beside it
  so the number is never typed twice.
- Add-teammate modal: employment type at onboarding, shown when the role is QC.
- Team Capacity, QC tab: the biggest visual change. Per-user capacity instead of
  a global cap, an FT/PT badge, `18/24 pts today`, the split between spent-today
  and carried-over, videos-by-type chips, and an explicit "cannot take a podcast"
  state.
- QC router panel: say *why* a job is unrouted — "all four reviewers are out of
  points today" beats a silent list. The manual reviewer dropdown should show
  each name's points left.

**Tests**

The existing `test_documented_constants` asserts the old numbers verbatim and
will fail by design. Beyond swapping it, the cases worth having are the ones that
pin the model's surprising edges: a cleared job still counts against today but
not tomorrow; Monday's open job still counts on Tuesday; the halving applies once
and rounds 3–5 cost the same as round 2; the pool filter respects
`load + cost`; a part-timer at 50% ranks ahead of a full-timer at 60%; and sticky
falls through when the prior reviewer is deactivated. Day-boundary tests need the
clock injected rather than `date.today()` called inside `daily_load`.

## 10 · ~~Deferred:~~ rush

> **Built in the same release, not deferred.** The plan below was to ship
> `RUSH_OVERFLOW` with the branch stubbed, because nothing in the product set a
> rush flag. Building the input turned out to be an afternoon — a boolean, a
> toggle in the intake wizard, a badge in the three places the video-type chip
> already renders, and a filter — and a constant with no way to fire is a
> constant somebody deletes as dead code in six months. §6 step 3 is live.
>
> Two things the build settled that the design did not say: rush does **not**
> lift `PART_TIME_PODCAST_MAX` (that cap is not a budget, so there is nothing
> for an overflow to overflow), and the ceiling is `floor(capacity × 1.25)` —
> 30 on a full day, 15 on a half — so nothing turns on rounding.

~~`RUSH_OVERFLOW` has no input. There is no rush, priority or urgency flag
anywhere in the backend or frontend today. §6 step 3 therefore cannot fire, and
until it can, an empty pool always holds the job and alerts the TL — which
already works.~~

~~The constant goes in with the overflow branch stubbed so nothing has to move
later. The follow-up is a `Job.rush` column, a checkbox in the intake wizard, a
badge on the job card and pipeline row, a filter, and then the branch.~~

## 11 · Sequencing

1. Migration, models, ledger, `routing.py`, tests — the whole model, and
   independently shippable.
2. `routers/users.py` endpoints and schemas.
3. Admin panel and Team Capacity UI.
4. Fold the new scoring into [Pipeline & routing](05-pipeline-and-routing.md) and
   the new tables into [Data model](03-data-model.md), and tick
   [Build status](00-status.md).
5. Follow-up release: rush.

The ledger makes this larger than a constants swap — roughly two to two and a
half days of backend including the migration backfill and the day-boundary tests,
and about a day of frontend.

## 12 · What changed in the build

Four decisions were taken against this document rather than from it. Each one
is here with the reason, so the next person reads the design and the departure
together instead of finding one and trusting it.

**1 · Stickiness survives the availability toggle.** §6 step 1 says a sticky
round falls through to the pool if the prior reviewer is "deactivated or
unavailable". The justification it gives is entirely about the first — "today
nothing re-checks, so a deactivated reviewer keeps a job forever" — and that
half is exactly right and is built. The second half is not. `available` means
*"don't send me new QC work today"*, and a cut this person already watched and
wrote the change list for is not new work. Falling through on it would make a
stranger pay full price for a cut nobody has seen, leave the person who raised
the changes never finding out whether they were addressed, and quietly scatter
every open revision somebody had the moment they took a day off. docs/05's
"stickiness is not an optimization, it's the point" is the older statement and
the one that survives. Deactivation breaks stickiness; `available` does not.

**2 · `video_type` is stamped on the charge.** §3's ledger sketch lists `id,
job_id, reviewer_id, work_date, points, round, created_at, released_at`. The
built table adds `video_type`, for the same reason `points` is stamped rather
than derived: a job's type can be corrected after the fact through
`PATCH /jobs/{id}`, and a correction must not rewrite what a reviewer's Tuesday
cost them. It is also what the part-time podcast cap and the videos-by-type
breakdown are counted from, neither of which should have to join back to `jobs`
on the load query's hot path.

**3 · Scrap and restore.** Not covered here at all, and they had to be: a job
scrapped at QC2 leaves an *open* charge, and an open charge carries forward
into every following day for good, because no stage move will ever come along
to release it. So **scrapping releases** — the points stay spent for the rest
of today, which is the same answer this model gives about any finished round,
and stop counting tomorrow. **Restoring re-bills**, or a restored job would be
invisible to load while a reviewer holds it.

That pair opens one hole, which `charge()` closes: a scrap at 11 and a restore
at 3 is *one* review, and billing it twice would charge somebody a second
podcast for their TL changing their mind. Before inserting, `charge()` looks
for an existing row on `(job_id, reviewer_id, work_date=today, round)` and
reopens it instead. The `round` half of that predicate is what keeps it honest:
a job sent back and returning the same day does **not** match, because the
round counter moved on the way out, so it correctly writes a fresh row at the
re-review price. Two pieces of work in one day both cost.

**4 · Rush shipped instead of being deferred** — see §10.

One thing §9 missed, found while building: `services/ai/tools/roster.py`
switches on `args.measure` and priced *QC* work with the editor's
`WEIGHT_POINTS` over `Job.weight`, for both delivered totals and open load. Its
QC branch now uses `QC2_WEIGHT` over `video_type`, and takes current load from
the ledger rather than from open jobs. Stale numbers in a tool the bot reads are
worse than none: it quotes them with full confidence.


## 13 · Points are a QC2 word

Added after the fact, because the bot was caught saying otherwise: *"Vested has
7 jobs open right now with a weighted load of 14 points."*

That number was `Job.weight` summed over open jobs, and every job carries the
default since migration 0018 — so it was the job count doubled, quoted with the
confidence of a measurement. Worse, it invited the reader to compare it against
a QC2 reviewer's points, which are a different currency for a different job: a
podcast is quick to cut and slow to review.

So the rule, enforced in `services/ai/prompt.py` and in every tool that
answers with a number:

- **QC2 reviewers** are measured in points — 1/3/6 per review against a daily
  budget of 24 (full-time) or 12 (part-time). This is the only points scale in
  the product.
- **Editors** are measured in *videos held* against `max_concurrent_jobs`.
- **Client pods** are measured in *videos*, and have no capacity number at all.

`Job.weight` still exists and is still what `WEIGHT_POINTS` prices, because
`cross_pod_capacity` returns it; nothing renders it, and `open_count` is what
the screens and the bot now read. The same fix corrected `CapacityBar` on the
Analytics page, which plotted weight points against a concurrent-job cap — an
editor holding three of their allowed five drew as six against five, in red.
