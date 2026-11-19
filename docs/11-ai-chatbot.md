# Kontent Bot — the AI layer over ops data

Phase 3. Replaces the habit of asking Gemini over a Google Sheet "how's this
client doing" with the same question answered from live platform data.

Owner and TL only. Read-only. Typed query tools, never generated SQL.

---

## The rule the whole design hangs on

**The bot is a new client of the permission model, not a new path around it.**

Every tool runs as the calling user and reuses the functions the REST routes
already use — `services/access.py`, `core/deps.py::check_pod_lead`. No tool
writes scoping logic of its own.

This is not caution for its own sake. [Build status](00-status.md#the-hardening-pass-2026-08-03)
lists five permission holes that shipped at once, every one of them because a
rule lived in one read path and not its twin. A bot querying through a
service account would reintroduce all five in a single move, and would hand
out the cross-editor comparison [Permissions](04-permissions.md) exists to
prevent. So: one definition, reused; the model is a caller, not an exception.

Two mechanisms enforce it:

1. `schemas_for(user)` filters the tool list **before the request leaves the
   server**. A QC is offered nothing, so the model cannot offer them anything.
2. `run_tool()` re-checks the role and then runs the tool, whose body performs
   the real check. The frontend hiding a button is not the boundary, and
   neither is the tool list.

A refusal comes back to the model as a readable result rather than an
exception, so the bot can say "I can't see that client" instead of the request
dying. It still doesn't get the data.

## Shape

```
app/services/ai/
  openrouter.py   transport — knows HTTP, not jobs
  agent.py        the tool-calling loop — knows neither
  prompt.py       the system prompt
  history.py      conversation storage + the daily cap
  tools/
    base.py       registry, role filtering, validation, refusal handling
    entities.py   resolve_entity
    pods.py       get_pod_health
    editors.py    get_person_performance
    jobs.py       find_jobs, get_job_timeline
    capacity.py   get_team_capacity
    roster.py     list_pods, compare_editors, get_pod_team
    trends.py     get_delivery_trend, get_intake_trend
    library.py    list_brand_assets, search_voice_notes
    charts.py     render_chart
app/api/routers/chat.py    thin — decides what's an HTTP status and what's an SSE frame
```

Swapping the model is a config change. Swapping the gateway touches
`openrouter.py` only. Adding a question the bot can answer means adding a
module under `tools/` — the agent, the router and the frontend all read the
registry, never a hand-kept list.

**An answer can be written next to a tool call, not only after one.** Some
models emit only the call and save their words for a closing message; others
write the answer and attach the call to the same message. The loop keeps the
closing message when there is one and falls back to what was said along the
way when it is empty (`agent.py::_final_answer`). It used to keep the final
message only, so the second kind of model produced truncated answers — or a
chart with no words under it. The earlier prose is a fallback rather than a
prefix, so a model that narrates *and* summarises doesn't say it all twice.
Found by switching models, not by review; regression-tested both directions.

## The tools

| Tool | Answers | Permission it reuses |
|---|---|---|
| `resolve_entity` | name → id, for pods, people and jobs | `pod_scope_clauses` + `job_scope_clauses` — same rows as `GET /pods` and `GET /jobs` |
| `get_pod_health` | "how is this client doing" — stages, deliveries, first-pass rate, avg rounds, overdue, stuck | `check_pod_lead` — same as `/pods/{id}/analytics/*` |
| `get_person_performance` | "how is this editor doing" on one pod | `check_pod_lead` on that pod |
| `find_jobs` | filtered job lists and counts | `job_scope_clauses` — same as `GET /jobs` |
| `get_job_timeline` | why a job is late, from the event log | `require_job_read` — same as `GET /jobs/{id}` |
| `get_team_capacity` | who's free, who's over the routing cap, what's unrouted | owner/tl, same as `GET /users/capacity`; load comes from `services/routing.py` |
| `list_pods` | "how are all my clients doing" — every visible pod with its headline numbers | `pod_scope_clauses` — same rows as `GET /pods` |
| `compare_editors` | "who delivered most", "who is strongest", "who needs help" | `check_pod_lead` on the named pod; `pod_lead_clauses` when none is named |
| `get_pod_team` | who works on a client, who is certified there | pod membership — same as `GET /pods/{id}/members` |
| `get_delivery_trend` | deliveries over time, split by pod, editor or weight | `job_scope_clauses`; the editor split uses pod leadership |
| `get_intake_trend` | new jobs per day, to read against deliveries | `job_scope_clauses` |
| `list_brand_assets` | what brief/SOP/kit/do-not a client has, and what's missing | pod membership — same as `GET /pods/{id}/brand-assets` |
| `search_voice_notes` | which review videos have notes waiting | owner only, same as `/voice-notes/admin/*` |
| `render_chart` | draws a chart in the conversation | none — it reads no data (see [Charts](#charts)) |

`resolve_entity` is not a convenience. Everything is uuid-keyed and everyone
asks by name; without it the model cannot take a first step, and the
alternative is letting it guess ids — which is how you get a confident answer
about the wrong client.

`get_person_performance` requires a pod on purpose. It keeps a per-person
question inside the scope the asker is accountable for. `compare_editors` is
the deliberate counterpart added later: the same numbers for everyone on a
pod at once, because refusing "who delivered most this month" to the person
accountable for that output was a worse answer than giving it with the
caveats. Both stay inside pod leadership, which is who
`/pods/{id}/analytics/avg-rounds-by-editor` already serves — so this widened
what can be *asked*, not what can be *seen*.

The breadth tools exist because the first six all start from an id. Answering
"how is everything going" by resolving and querying pods one at a time spends
an iteration per client and hits the loop cap before it finishes. `list_pods`
and `compare_editors` are one call each.

Tool arguments are Pydantic models, and the JSON schema handed to the model is
**generated from them** — so a tool's advertised contract and the validation it
performs cannot drift, the same rule enum columns already follow
([Backend rules](07-backend-rules.md)). Invalid arguments come back as a
readable error the model can correct, which is the LLM equivalent of a 422 that
names the allowed values instead of a 500.

## Charts

The bot draws real charts. It does **not** generate images: `render_chart`
takes a spec — chart type, labels, named series of numbers — which the
frontend renders with Recharts (`components/chat/ChartBlock.tsx`).

That split buys three things a generated image would not:

- **The numbers stay auditable.** The spec is stored on the message next to
  `tool_calls`, so "the bot showed me a graph saying Aditya delivered 14" is
  answerable from the row. A chart is a claim about data, and it gets the same
  receipt a quoted figure gets.
- **It renders in the app's design language**, in both themes, responsive, and
  still legible when the thread is reopened on a phone.
- **No new model capability is required.** Any model that can call a tool can
  fill in the schema — which matters, because the deployed model is chosen for
  cheap tool-calling, not image generation.

`render_chart` touches no database. Every number in a spec was already fetched
by a tool that enforced permissions on it, so this is a formatting step and
adds no route to data. What it does enforce is shape: a series shorter than
its labels is refused, because that renders *successfully* with every point
shifted onto the wrong date — a chart that lies rather than one that fails.

The spec is lifted out of the tool result by the agent loop and never fed back
to the model (`agent.py::_take_chart`). The model gets a one-line ack instead.
Echoing the series back would pay for those numbers again on every later turn
of the conversation, to tell the model something it just said.

`get_delivery_trend` returns `labels` and per-series arrays that are already
dense and aligned — a bucket with no deliveries is a `0`, not a gap — so the
model can pass them straight through rather than re-deriving them.

**Two tools must never answer the same question differently.** Counting
deliveries by stage (`list_pods`, `get_pod_health`) and by date (the trend
tools) are both legitimate, and they agree only if every delivered job has a
delivery date. One row without one made the bot say "2" in one breath and "1"
in the next. That invariant is now a database constraint, not a convention —
see migration `0009`. A contradiction between two confident answers is worse
than either being wrong alone, because it destroys the reason to trust any of
them.

Series colors are eight fixed slots (`--series-N` in `index.css`), assigned in
order and never cycled, with separately chosen dark-mode steps. Eight is also
the server-side cap on series per chart, so there is nothing to cycle for.
Three light-mode slots sit below 3:1 contrast on a white card, which is why
every chart carries a **table toggle** — the exact values have to stay
reachable as text. That toggle is a requirement, not a nicety.

Recharts is the heaviest thing the frontend imports and most answers draw no
chart, so `ChartBlock` is lazy-loaded — it costs nothing until a graph appears.

## Why not SQL generation

Considered and rejected in [Roadmap](08-roadmap.md) before any of this was
built. Generated SQL against production has no permission model, and bolting
one on means re-deriving row scoping in a second place — the exact failure
this app has already had. The tools double as documented query functions the
rest of the app can call.

## Prompt injection

Job titles and QC change lists are free text typed by staff, and they land
verbatim in the model's context. Nothing stops someone writing "ignore all
previous instructions" in a change list.

The defence is layered, and the order matters:

1. **There are no write tools.** The bot cannot advance a job, assign an
   editor or change anything. There is nothing to inject *toward*.
2. **Permissions are in code, not in the prompt.** A model fully talked into
   fetching another TL's client still gets a 403 from `check_pod_lead`. This
   is covered by a regression test that scripts a model which *does* obey the
   injected instruction, and asserts it gets nothing
   (`tests/api/test_chat.py::test_a_note_that_tries_to_give_the_model_orders_changes_nothing`).
3. **The prompt says tool output is data, not instruction**, and user-written
   notes are returned under their own key so the boundary is visible.

Layer 3 alone would be theatre. Layers 1 and 2 are what actually hold.

## Streaming

`POST /api/chat` returns Server-Sent Events: `meta` (conversation id), `tool`
(a lookup started / finished / was refused), `chart` (a chart finished
rendering), `message` (the answer), `error`, `done`.

A `chart` frame arrives before the answer for the same reason the tool chips
do — there is no sense hiding a finished graph while the model composes a
paragraph about it. The same specs arrive again on the stored message, which
is what the thread re-renders from after a reload.

Frames are **event-typed, not token-typed**. Tool calls are resolved with
`stream=false` upstream, because streaming a response that may or may not turn
out to be a tool call means reassembling `tool_calls` from deltas by index —
real code that cannot be verified until an OpenRouter account exists. Adding
token streaming later is a new `delta` event; no caller changes.

Everything decidable before the model is involved — no key (503), over the
daily cap (429), someone else's conversation (404) — is answered as a real
status code. A 429 buried inside a 200 stream is a 429 nobody handles.

An `error` frame carries a `code` when the failure has a *fix*:
`out_of_credits` (gateway 402) and `invalid_key` (401). Everything else — a
timeout, a rate limit, a malformed response — is worth retrying and gets no
code. The UI branches on it: a coded failure renders `BillingNotice` with the
steps and the OpenRouter link, because "The OpenRouter account is out of
credits" in small red text names what broke and nothing about how to unbreak
it, and the person reading it is usually the person holding the card. Matching
on the message text instead would break the first time the wording changed.

The stream opens **its own database session**, not the request's: the
generator runs while the response is being sent, which is after FastAPI has
closed the injected one.

## Storage

`chat_conversations` and `chat_messages` (migration `0007`). Conversations are
private to the person who created them — not shared with the Owner — and
reading someone else's is a 404, not a 403, because whether that id exists is
not the caller's business.

`chat_messages.tool_calls` stores which lookups produced each answer. When
someone says "the bot told me Dhan delivered 12 last month and that's wrong",
that trace is the only way to tell a bad query from a bad summary.

`chat_messages.charts` (migration `0008`) stores the specs an answer drew,
rather than regenerating them on read. Reopening a thread must show the graph
that was actually shown, not one redrawn from data that has since moved.

History sent back to the model is prior user/assistant turns only, capped at
20. Old tool results are deliberately not replayed: they would grow the
context every message with numbers the model can look up again, and a stale
figure presented as current is worse than a second query.

## Cost control

- `AI_MAX_TOOL_ITERATIONS` (default 8, raised from 6 when charting landed —
  a charted answer spends its usual rounds looking things up, then one more
  per chart it draws, and at 6 those answers were losing the graph to the
  cap) — rounds of the tool loop. On hitting
  it, the loop makes one final call **with no tools offered**, forcing an
  answer out of what was already gathered. Erroring out instead would charge
  for six round-trips and throw the work away.
- `AI_DAILY_MESSAGE_CAP` (default 50) — per user, rolling 24h.

This is the first endpoint in the app where a loop costs real money, which is
why the cap shipped with it rather than after — [Build status](00-status.md)
still lists "no rate limiting on login" as an open gap elsewhere.

## Configuration

All read in `core/config.py`, nowhere else:

| Variable | Default | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | *(empty)* | Empty is a valid state: `/api/chat` answers 503 with a usable message and the UI says so. |
| `OPENROUTER_MODEL` | `google/gemini-2.5-flash` | Any OpenRouter slug. This line is the whole point of the gateway. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | |
| `OPENROUTER_APP_URL` / `OPENROUTER_APP_TITLE` | | Attribution on the OpenRouter dashboard. |
| `AI_MAX_TOOL_ITERATIONS` | `6` | |
| `AI_REQUEST_TIMEOUT_SECONDS` | `60` | |
| `AI_DAILY_MESSAGE_CAP` | `50` | `0` disables the cap. |

The key never reaches the browser.

**Model choice is a correctness decision, not a cost one.** Driven against
three models on the same questions and the same data (2026-08-04):
`gemini-2.5-flash` hedges — it answers specific questions well but meets a
vague one with a menu of options instead of a tool call, and no amount of
prompt strengthening moved it. `gemini-2.5-pro` engages and then **fabricates**
— it called `compare_editors`, received one editor, and reported three with
invented statistics. `claude-sonnet-4.5` engaged and stayed inside the data.

The tools cannot defend against this: permissions stop a model reaching data
it shouldn't, but nothing stops one inventing data it never fetched. The
`tool_calls` trace stored on each message is the only way to catch it after
the fact — compare what was called against what was claimed. When changing
`OPENROUTER_MODEL`, ask something whose true answer is *small* and check the
model doesn't return a bigger one.

## Frontend

`/bot`, Owner/TL only, plus the floating widget on other pages. Both mount the
same `ChatThread` — one component, two mounts, the arrangement
`JobDetailContent` already uses so the two can't drift.

Tool activity renders as chips in plain words ("Reading client delivery
stats"), and a refused lookup renders differently from a failed one: *you
can't see that* and *there is no data* are different answers and the prose
alone doesn't always distinguish them.

Job codes in an answer are clickable and open the same inspector the pipeline
table opens.

Charts render under the answer they belong to, and a turn carrying one is
given a wider column — a chart squeezed into a narrow bubble stops being
readable. See [Charts](#charts) for the palette and the table toggle.

The SSE call is the one place in the app that uses `fetch` rather than the
axios instance — axios in the browser can't expose a partial response body. It
lives in `api/chat.ts` (transport belongs in `api/`, per
[Frontend rules](06-frontend-rules.md)) and calls the same `endExpiredSession`
the axios interceptor does, so "what happens on a 401" stays one decision.

## Testing

No key, no network, no nondeterminism. `tests/stubs.py` scripts the model.

- `tests/unit/test_ai_tools.py` — every tool, phrased as the exploit: *a TL
  cannot read another TL's client*, *pod membership alone does not grant pod
  analytics*, *a QC is offered no tools at all*.
- `tests/unit/test_ai_agent.py` — the loop: tool results fed back, refusals
  reported rather than raised, malformed arguments corrected, the iteration
  cap forcing an answer.
- `tests/unit/test_ai_charts.py` — the chart spec refusing what would render
  wrong, and the handshake that sends a chart to the browser but not back
  into the model's context.
- `tests/unit/test_ai_breadth_tools.py` — the questions the bot used to
  refuse, each asserted to come back with numbers *and* to still come back
  empty when the pod belongs to someone else.
- `tests/api/test_chat.py` — the request path: role gating, 503/429/404,
  persistence (including that a chart survives reopening the thread),
  per-user cap, and the injection regression.

## Deliberately not built

- **Write tools.** Later, if wanted, behind a UI confirmation step.
- **Token-level streaming.** See above; the SSE contract already has room.
- **Any bot access for QC or VE.** Not deferred — decided against, alongside
  analytics ([Permissions](04-permissions.md)).
- **Live verification against a real model.** Blocked on an OpenRouter
  account. Everything above is covered by tests against a scripted model,
  which is not the same thing as having watched a real one answer.
