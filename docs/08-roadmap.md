# Roadmap

## V1 — core pipeline (building now)

- Client Pods: workspace per client, owned by a TL, members with roles
  (TL / QC / VE), editors can belong to multiple pods
- Job pipeline: 8 stages, revision loop, `round` counter
- QC2 auto-routing: least-load + stickiness + familiarity bonus + capacity cap
  (see [05](05-pipeline-and-routing.md))
- Certification: computed automatically from delivery history
- Frame.io: **manual link only, permanently** — the editor edits and uploads
  the cut to Frame.io themselves, then pastes the share URL on the job. No
  API integration is planned, ever (see Explicitly out of scope, below)
- Brand asset library: briefs / SOPs / kits / do-not lists per pod, versioned,
  stored on disk
- Permissions: full Owner / TL / QC / VE matrix
- Analytics: first-pass rate, avg QC rounds, stage-distribution bottleneck
  view, 3+ round flag, cross-pod capacity view
- Client onboarding flow (Owner/TL)
- In-app notifications + activity feed, backed by the `JobEvent` log

Scale target: ~20-30 users. No hard deadline — prioritize correctness of the
routing/permission logic over speed of shipping.

## Phase 2 — real-time integrations — built

### WhatsApp Business notifications
Built. Documented in full at [WhatsApp](13-whatsapp.md).

**The BSP was dropped.** This phase waited on a Gupshup / Twilio / 360dialog
account that was never bought, and going direct to Meta's Cloud API turned out
to be the smaller job rather than the larger one: no reseller markup, no second
vendor's abstraction over Meta's own error codes, and — the part that decided
it — template submission and approval status become things this application
can do itself, from its own admin page, instead of things somebody does in a
third party's dashboard and then reports back.

The cost of going direct is real and is where most of the code went: we own the
template lifecycle, the webhook listener, the signature check and the error
taxonomy. That is what `/admin/whatsapp` exists to make operable.

It plugs into the existing `services/notify.py` interface as a second delivery
of the same notification — see [Backend rules](07-backend-rules.md) — not a
parallel system. The queue moved from `push.py` to `services/dispatch.py` so
that both channels read it.

Still to do: the Meta-side setup (business verification, WABA, number, System
User token, webhook subscription) and the ramp. Messaging ships switched off.

## Phase 3 — AI chatbot over ops data

Replaces the team's current habit of asking Gemini over Google Sheets for
"how's this client doing / how's this editor doing" answers with a
"Kontent Bot" that answers the same questions from real platform data.

Scoped and approved 2026-08-03. Not started.

### Decisions taken

- **Owner and TL only** (TLs scoped to their own pods), matching analytics
  exactly — the bot reads the same numbers through the same permission
  functions, so it cannot be a looser door onto them. QCs and VEs get no bot.
  See [Permissions](04-permissions.md).
- **Read-only.** No tool advances a stage, assigns an editor, or writes
  anything in v1. Job titles and QC change lists are user-written text that
  lands in the model's context, which makes prompt injection a live surface;
  an empty write surface removes the risk instead of mitigating it. Actions
  are a later phase, behind a UI confirmation step, if wanted at all.
- **Model access via OpenRouter** — model-agnostic gateway, so the underlying
  model (Gemini, Claude, others) can be swapped without changing the
  application's integration code. No account yet, so the build starts with the
  half that needs no key (see build order).
- **Query surface is the `JobEvent` log plus the core tables** — this is why
  the schema was built relationally (see [Architecture](02-architecture.md)
  decision log) and why every state change is written to one append-only
  event table instead of being inferred from current-state diffs.
- **Typed query tools, never generated SQL.** A small set of tool functions
  with Pydantic argument models, from which the JSON schema handed to the
  model is generated — so a tool's contract and its validation cannot drift,
  the same rule enum columns already follow (see [Backend rules](07-backend-rules.md)).
  The tools double as documented, reusable query functions the rest of the app
  can call.

### The rule the design hangs on

**The bot is a new client of the permission model, not a new path around it.**
Every tool runs as the calling user and reuses the existing functions —
`services/access.py::job_scope_clauses()`, `can_read_job()`,
`core/deps.py::check_pod_lead()`. No new scoping logic is written for the AI
layer. A tool the caller may not use is filtered out of the tool list *before*
the request leaves the server, and re-checked in code when it is called.

This is the direct lesson of [the hardening pass](00-status.md#the-hardening-pass-2026-08-03):
five permission holes shipped because a rule lived in one read path and not
its twin. An LLM querying through a service account would reintroduce all of
them at once, and hand out the cross-editor comparison
[Permissions](04-permissions.md) exists to prevent.

### Build order

1. **Tool layer + tests** — needs no API key and no model; fully testable in
   CI. This is the bulk of the work and where all the risk sits.
2. **OpenRouter client, agent loop, `POST /api/chat`** — needs the key.
   Streaming, with a hard cap on tool-call iterations.
3. **Chat UI** — job codes in an answer open the existing `JobDetailPanel`.
4. **Conversation persistence + per-user daily cap + `docs/11-ai-chatbot.md`.**
   The cap ships with the feature, not after it: this is the first endpoint
   where a runaway loop costs real money, and [Build status](00-status.md)
   lists "no rate limiting" as a standing gap.

Design constraint that was carried through V1 and still holds: don't do
anything that makes this harder later (e.g. don't skip writing `JobEvent` rows
for a state change just because no UI reads them yet).

## Explicitly out of scope, no current plan

- Real-time (WebSocket) updates — revisit only if polling proves genuinely
  too slow in practice.
- **Frame.io API integration** — a deliberate permanent decision, not a
  deferred phase. The editor uploads to Frame.io and pastes the share link in
  manually; there is no plan to automate that with the Frame.io API,
  webhooks, or OAuth.
- Mirroring Frame.io comments into this app's database — always link out,
  never duplicate.
- Company-wide editor leaderboards **as a standing UI surface** — a deliberate
  permanent decision, not a deferred feature (see
  [Permissions](04-permissions.md)). Asking the bot to compare the people you
  lead is not this and is built (`compare_editors`); an always-on ranked board
  the team can watch itself on is what stays unbuilt.
