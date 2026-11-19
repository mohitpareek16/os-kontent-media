# Overview

## What Kontent Media does

Video editing agency. Clients send raw footage/briefs, editors cut, QC reviews,
client receives the final video. Volume: ~300 videos/month across ~22+ editors
and multiple simultaneous clients.

## The problem this replaces

- One spreadsheet per client ("Dhan Work Tracker", "Vested Work Tracker", ...)
  plus a separate internal ops tracker — two sheets that must be manually kept
  in sync at every delivery, and drift when someone forgets.
- Coordination happens over WhatsApp with no system of record — status lives in
  chat history, not in a queryable place.
- No visibility into where jobs are stuck, who's overloaded, or which editor/QC
  pairing is actually fast vs. slow.

## Actors

| Role | Who | Owns |
|---|---|---|
| **Owner** | Mukul | Everything. Cross-pod visibility, team-level analytics. |
| **TL (Team Lead)** | e.g. Abhishek, Ravi | Output of their pod(s): client onboarding, brand briefs/SOPs, assignment, QC1, final check, delivery. Accountable for *what ships*. |
| **QC** | Dedicated QC team | QC2 review. QC1 is done by the TL; QC2 is a separate, dedicated reviewer, auto-routed by load. |
| **VE (Video Editor)** | Editors, e.g. Aditya | Executes the cut, handles revision rounds. Sees only their own assigned jobs and their own performance trend. |

A **Team Lead owns the person** (growth, pay, leave, conflict). A **Pod TL owns
the output** (deadlines, QC quality, client escalation). These are different
questions and should never be blurred — see [Permissions](04-permissions.md).

## Client Pods

There is no separate "Client" record — the **Pod is the client**, not a
client-owned entity underneath it. One client = one pod = one TL-owned
workspace, the software equivalent of one client's spreadsheet (name,
billing currency, retainer volume, and status live directly on `Pod`).
Mukul owns all pods (cross-pod view); a TL owns only the pods assigned to
them; an editor can be a member of multiple pods across different TLs.

"Team Abhishek" is not a separate structure to model — it's just the union of
members across the pods Abhishek owns. Rendered as a view, not stored as an
entity.

## The pipeline, at a glance

Intake → Assigned → Editing → QC1 → QC2 → (Revisions ↺) → Final check → Delivered

Full detail, including the revision loop and QC2 auto-routing, in
[Pipeline & routing](05-pipeline-and-routing.md).

## Design principles carried through every decision below

- **One source of truth.** No dual-sheet sync points. Client-facing views are
  generated from the same data TLs work from, not maintained separately.
- **Routing balances load but favors continuity.** A job's first QC2 assignment
  is load-balanced; every subsequent round on that job stays with the same
  reviewer, because they already know the change list.
- **Certification is computed, not maintained.** Nobody edits a list of who's
  qualified on a client — it falls out of delivery history.
- **No leaderboards, and no metrics shown to the person being measured.**
  Analytics is an Owner/TL surface only; editors and QCs get no performance
  view, their own included. Ranking creative work distorts it toward gaming
  the metric, and a number handed to someone with no context attached gets
  optimized for rather than worked with. Performance is a management
  conversation — see [Permissions](04-permissions.md).

  The precise boundary, since Kontent Bot's `compare_editors` sits near it:
  *no standing ranked surface, and nothing to the person being measured.* A
  manager asking "who delivered most this month" and getting an answer is
  the management conversation, not a substitute for it — so the bot answers
  it, for the pods that manager leads, with the caveats attached (volume is
  not quality, 3 deliveries is not comparable to 30, high round counts are
  usually a briefing problem). What stays unbuilt is the always-on ranked
  board: a number nobody asked for, kept warm, that the team learns to play
  to. See [Kontent Bot](11-ai-chatbot.md).
- **Build for the AI layer without building it yet.** Every job-stage change
  writes to a single event log. That log is what Phase 3's chatbot will query
  — see [Roadmap](08-roadmap.md).
