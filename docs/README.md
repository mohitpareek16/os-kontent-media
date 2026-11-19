# Kontent OS — Docs Index

Internal project management platform for Kontent Media (video editing agency).
Tracks client work through the edit → QC → delivery pipeline, replacing per-client
spreadsheets and ad-hoc WhatsApp coordination.

**Start here:** [Build status](00-status.md) — what's actually done vs. not,
checkbox-tracked and re-verified against the running app, not just written
intent. Read this first when resuming work in a new session.

Then, background reading:

1. [Overview](01-overview.md) — what this is, who uses it, the problem it replaces
2. [Architecture](02-architecture.md) — stack, deployment, infra decisions
3. [Data model](03-data-model.md) — entities, schema, relationships
4. [Permissions](04-permissions.md) — role matrix (Owner / TL / QC / VE)
5. [Pipeline & routing](05-pipeline-and-routing.md) — stages, revision loop, QC2 auto-routing
6. [Frontend rules](06-frontend-rules.md) — React conventions, component/hook reuse
7. [Backend rules](07-backend-rules.md) — FastAPI conventions, project structure
8. [Roadmap](08-roadmap.md) — V1 scope vs. deferred phases
9. [Future integrations](09-integrations-future.md) — the WhatsApp planning spec it was built from; Frame.io stays a permanent manual link-paste, see [Roadmap](08-roadmap.md)
10. [Deployment guide](10-deployment-guide.md) — fresh VPS setup: private repo clone via deploy key, Docker, Nginx + Let's Encrypt HTTPS
11. [Kontent Bot](11-ai-chatbot.md) — the Phase 3 AI layer: tool design, the permission rule it hangs on, prompt injection, cost control
12. [QC2 load model](12-qc2-load-model.md) — **specified, not built**: review cost per content type, the daily points budget, and the assignment order that replaces today's QC2 score
13. [WhatsApp notifications](13-whatsapp.md) — direct Meta Cloud API: which events message whom, templates submitted and status-checked from the admin page, the webhook, and what a button tap may do

These docs are the source of truth for the build; update them if a decision
changes instead of letting the code and docs drift apart. **Whenever you
finish a chunk of work, update [00-status.md](00-status.md)'s checkboxes** —
that's what keeps this useful across sessions.
