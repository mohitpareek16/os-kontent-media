# Kontent OS: Complete Product & UI Brief for the Redesign

> **Who this is for:** the designer and frontend developer who will design and build a new UI for Kontent OS.
> **What it is:** one self-contained file covering every feature, role, screen, field, value, state, rule and piece of copy in the current product, so you can redesign without reading the code.
> **Source of truth:** generated from the `master` branch of `milankumawat01/Kontent-Ops` (backend FastAPI + Postgres, frontend React/Vite/Tailwind) on 2026-10-03. Where the code and the older docs disagree, this file follows the **code** and flags the conflict.

---

## How to read this document

| Part | What's inside | Read it when |
|---|---|---|
| **Part A: The product** (§1–§9) | What the business does, roles, core concepts, the pipeline, permissions, navigation, the current design system, data shapes, notifications | First, start to finish. You cannot design this product without these rules. |
| **Part B: Screen-by-screen** (§10–§13) | Every screen, panel, modal and widget: layout order, fields, buttons, states, exact copy | While designing each screen |
| **Part C: Extras** (§14–§17) | Browser extension, the older prototype, every known inconsistency/gap, design deliverables checklist | Before you finalise scope |

**Conventions**
- `code_font` = a value/field name as the API sends it. "Quoted text" = exact on-screen copy today (you may rewrite copy, but keep the meaning).
- Icons are referenced by their current **Remix Icon** class (`ri-…`). You can swap the icon set.
- "Lead" = Owner or anyone holding the TL role. "Pod" = client (same thing; see §3).
- API paths are relative to `/api`.

---

# PART A: THE PRODUCT

## 1. Product in one page

**Kontent Media** is a video-editing agency: ~300 videos/month, 22+ editors, many simultaneous clients. Clients send raw footage and briefs, editors cut, two QC passes review, and the final video goes to the client.

**Kontent OS** is their internal operations platform. It replaces:
- one spreadsheet per client ("Dhan Work Tracker", "Vested Work Tracker"…) plus a separate internal ops sheet that had to be manually synced,
- WhatsApp as the only coordination channel (no system of record),
- zero visibility into where jobs are stuck, who is overloaded, and which editor/QC pairings are fast or slow.

**What the product does (feature list)**

| # | Feature | Short description |
|---|---|---|
| 1 | **Login & sessions** | Email + password, JWT. No self-signup, no email recovery (Owner resets passwords). |
| 2 | **Client Pods** | One pod = one client. TL-owned workspace with members, channels, brand kit, status (active/paused/churned), billing currency, retainer volume. |
| 3 | **Client onboarding wizard** | Create a new pod/client. |
| 4 | **Channels** | A client's publishing destinations (e.g. "Dhan HQ", "AAD"). Jobs are filed under channels. Add, rename, archive. Bulk filing. |
| 5 | **Jobs (edit jobs / videos)** | The core object. Code (e.g. `KM-1052`), title, pod, channel, video type, rush, editor, QC2 reviewer, deadlines, links, round count, stage. |
| 6 | **New Job wizard** | Create one or many jobs, including pasting a list from WhatsApp/Slack/Drive, with bulk editor/type/channel/rush/date tools. |
| 7 | **8-stage pipeline + state machine** | Intake → Assigned → Editing → QC1 → QC2 → (Revisions loop) → Final check → Delivered. Role-scoped moves. |
| 8 | **Pipeline table + Kanban board** | Master work list with 8 status tabs, rich server-side filters, sort, pagination, bulk channel filing. |
| 9 | **Job detail (drawer + full page)** | Everything about a job: next-step actions, fields, links, QC1 evidence, change lists/comments, timeline, activity feed, rush, reassign, scrap/restore, delivery checklist. |
| 10 | **Revision loop with change lists** | Send-backs carry a change list; the re-cut returns to whichever desk sent it back. |
| 11 | **QC1 review evidence + QC1 flag** | Shows how fast and with how many comments the TL cleared QC1; the QC2 reviewer can flag "QC1 never happened". |
| 12 | **QC2 auto-routing (points model)** | Automatic reviewer assignment by video-type points against a daily budget, sticky on later rounds, with an unrouted pile, manual assign and claim. |
| 13 | **QC Auto-Router view** | Lead view: why jobs are unrouted, who routing can pick, manual reviewer assignment, rules explainer. |
| 14 | **My QC Queue** | Reviewer workspace: availability toggle, today's points, 5 job groups, claim unrouted work. |
| 15 | **Team Capacity** | Editors tab (videos held vs cap, per-pod load) and QC tab (points today/carried/left). |
| 16 | **Editor capacity cap** | Each editor has a max concurrent jobs (default 5). Full editors are not offered in pickers. |
| 17 | **Certification** | An editor is certified on a pod after 3 deliveries at ≤1 QC round. Computed, not edited. |
| 18 | **Brand Kit** | Per-pod files: Brief, SOP, Kit, Do-not list. Versioned uploads, secure download. |
| 19 | **Overview dashboard** | KPI tiles + per-pod status cards. Every number is a link to the filtered list. |
| 20 | **Analytics** | Per-pod: stage distribution, first-pass rate, avg QC rounds by editor, stuck jobs. Leads only. |
| 21 | **Kontent Bot (AI chat)** | Chat over ops data with tool calls and charts (bar/line/area/pie/donut…), conversation history, daily question cap. Full page + floating widget. |
| 22 | **Notifications** | In-app inbox, header bell with unread count, live toasts with sound, desktop/OS push (service worker). |
| 23 | **WhatsApp notifications (Phase 2)** | Direct Meta Cloud API: templates, event toggles, delivery log, staff numbers/opt-in, kill switch, quick-reply buttons that move jobs. Built, but switched off by default. |
| 24 | **Global search** | Header search over jobs, clients, channels, people, scoped to what you can see. |
| 25 | **Users & Roles (admin)** | Directory, stats, add teammate, change role, lend TL, capacity, employment type, reset password, deactivate/reactivate. |
| 26 | **Team Directory (HR)** | HR's roster and onboarding/offboarding surface. |
| 27 | **Impersonation ("Viewing as")** | Owner can view the app as any user, with a permanent banner and one-click exit. |
| 28 | **Voice Notes library + Frame.io browser extension** | Extension records voice notes pinned to Frame.io video timestamps; admin page browses/plays/deletes them. |
| 29 | **Light/Dark theme** | Toggle in profile menu; default light. |

**Design principles the product is built on (keep these in the redesign)**
1. **One source of truth.** No duplicate trackers; client-facing views come from the same data.
2. **Every number is clickable** and lands on exactly the rows behind it.
3. **Don't render numbers you don't have.** Unknown = "—", never a fake 0 or 100%.
4. **No leaderboards, and no metrics shown to the person being measured.** Analytics is for leads only; editors/QCs never see performance rankings (a QC sees their *own current points* only because it's operational).
5. **Server is the security boundary.** Hidden buttons are a UX nicety; the API enforces everything. Some data (the client deadline) is *never sent* to people who may not see it.
6. **Lists are server-side.** Filtering, sorting, counts and pagination are API params. A capped list must say "+N more".
7. **Nothing is deleted.** Users are deactivated; jobs are scrapped (with reason) and restorable; channels are archived.
8. **Reasons are mandatory** for socially sensitive actions (scrap, reassign, QC1 flag: ≥10 characters).

---

## 2. Users & roles

A **role** answers "what may this person do". It is not their job title.

| Role key | Label | Who (examples) | What they do | Colour family today | Icon |
|---|---|---|---|---|---|
| `owner` | Owner | Mukul (founder) | Everything, every pod. Only admin: accounts, roles, impersonation, WhatsApp setup. | Brand purple → fuchsia | `ri-vip-crown-2-fill` |
| `tl` | Team Lead | Abhishek, Ravi | Runs their own pods: onboarding clients, brand kit, creating/assigning jobs, QC1, final check, delivery, analytics, bot. | Indigo (#4f46e5) | `ri-user-star-fill` |
| `qc` | QC Reviewer | Farah, Ishan | QC2 review on jobs routed to them. Shared company-wide resource. | Amber (#d97706) | `ri-shield-check-fill` |
| `ve` | Video Editor | Aditya | Cuts videos assigned to them, handles revision rounds. Sees only their own jobs. | Teal (#0d9488) | `ri-movie-2-fill` |
| `hr` | HR | People-ops | Roster + onboarding/offboarding of TL/QC/VE/staff. No work access. | Rose | `ri-shake-hands-fill` |
| `fo` | Founder's Office | — | A name with no powers of its own; existing FO accounts have TL lent to them. | Sky/blue | `ri-compass-3-fill` |
| `staff` | Team member | Graphic Designer, Social Media | A job title only, no system access beyond profile + notifications. | Slate | `ri-user-3-fill` |

**Role modifiers the UI must show**
- **Secondary (lent) role:** anyone can be lent `tl` on top of their own role, e.g. "Video Editor · also Team Lead". They get TL powers **only on pods where they are the TL**. The UI composes navigation from *all* roles a person holds.
- **Job title** (`role_title`): shown instead of the role name for `staff` ("Graphic Designer").
- **Employment type** (QC): Full-time = 24 QC2 points/day, Part-time = 12.
- **Max concurrent jobs** (editors): hard cap, default 5.
- **Available** (self toggle, QC/TL/Owner): "don't route new QC work to me today". Not the same as deactivated.
- **Active / deactivated**: a leaver can't log in; shown as "LEFT" in search and directories.

**Key org rule:** *Pod TL owns the output* (deadlines, QC quality, client escalation). *Team Lead owns the person* (growth, pay, leave). Never blur these in the UI.

---

## 3. Core concepts (glossary)

| Concept | Meaning | Values / format |
|---|---|---|
| **Pod** (= Client) | One client = one pod, owned by one TL (`tl_id`). No separate "client" object. | `name`, `status` active / paused / churned, `billing_currency`, `retainer_volume` (videos/month, optional) |
| **Pod member** | A person in a pod with a pod role | `pod_role` tl / qc / ve, `certified_at` (date or null) |
| **Channel** | A destination inside a client (e.g. "Dhan HQ", "AAD", "lwdhan") | `name`, `archived_at`, `job_count` (live jobs). Unique per pod. Archived = off pickers, still on old jobs. |
| **Job** | One video to be edited | `code` "KM-1052", `title`, see §8 for all fields |
| **Stage** | Where the job is | intake, assigned, editing, qc1, qc2, revisions, final, delivered (labels: Intake, Assigned, Editing, QC 1, QC 2, Revisions, Final check, Delivered) |
| **Round** | Number of send-backs so far | integer ≥0. 0 = "First pass"; 1–2 amber; 3+ red (usually a briefing problem) |
| **Video type** | Format of the video | Podcast / Long form / Short form (default Long form). Decides QC2 cost. |
| **Rush** | "Can't wait for someone to free up" | boolean. Only effect: QC2 routing may overload a reviewer up to 125%. **Not** a priority sort. |
| **Deadline** | Team deadline: what everyone works to | date. Label "Deadline". Drives overdue, row colour, sort. |
| **Actual deadline** | What the client was promised (`client_deadline`) | date, usually later. **Only Owner + that pod's TL** see it. "Buffer" = days between the two. |
| **Briefed** | A job at an editor stage needs **both** an editor and a deadline before it becomes the editor's move | otherwise it stays on the TL's plate ("BriefGate") |
| **QC1** | First review, done by the pod TL | Outcomes: "QC1 approved" or "QC1 comments added" (comments live on Frame.io) |
| **QC2** | Second review by a dedicated QC reviewer, auto-routed | Points model, see §4.3 |
| **QC2 points** | Cost of a review | Short 1, Long 3, Podcast 6; repeat round = half rounded up (1/2/3). Budget 24/day full-time, 12 part-time. Daily: clearing doesn't refund same day. |
| **Unrouted** | At QC2 with no reviewer (nobody had room) | Shows in Unrouted lists; can be claimed by a QC or assigned by a lead |
| **Sticky routing** | Later rounds go back to the same QC2 reviewer, even if over budget | |
| **Change list** | Note attached to a send-back | Required on send-back |
| **Mine** | "Waiting on me right now": whose move it is per stage, computed by the server (`is_mine`) | Owner's Mine is hidden (always empty) |
| **Intake vs Active** | Intake = arrived, no editor. Active = assigned → final check. **Disjoint.** | Overdue counts both |
| **Scrapped** | Cancelled before delivery, with mandatory reason. **Not a stage**; job keeps its stage. Restorable. | `scrapped_at`, `scrapped_by`, `scrap_reason` |
| **QC1 flagged** | QC2 reviewer says QC1 never really happened. Not a stage; job keeps moving. | `qc1_flagged_at`, by, about which TL, reason |
| **Links** | `raw` = client footage (TL adds), `video` = the cut (editor adds; Frame.io share link) | multiple each, with optional title |
| **Delivery checklist** | Two ticks needed before delivery: "Client sheet updated" (`client_sheet_ok`) and "Ops tracker updated" (`ops_tracker_ok`) | temporary bridge from spreadsheets |
| **Certification** | Editor certified on a pod after 3 deliveries with ≤1 QC round | computed |
| **Brand assets** | Per-pod files | type: Brief / SOP / Kit / Do-not list; `title`, `version` |
| **Frame.io** | External review tool. **Not integrated**: editors paste the share link manually. Per-frame comments stay in Frame.io. | |

---

## 4. The pipeline (the heart of the product)

### 4.1 Stages and whose move it is

| # | Stage | Label | Whose move ("owner") | Badge colour today | What happens |
|---|---|---|---|---|---|
| 1 | `intake` | Intake | TL | neutral grey | Job created from a brief; no editor yet |
| 2 | `assigned` | Assigned | VE | indigo | Editor picked (+ deadline); editor should start |
| 3 | `editing` | Editing | VE | teal | Editor cutting |
| 4 | `qc1` | QC 1 | TL | indigo | TL's first-pass review |
| 5 | `qc2` | QC 2 | QC | amber | QC reviewer's review (auto-routed) |
| 6 | `revisions` | Revisions | VE | red | Editor works the change list |
| 7 | `final` | Final check | TL | indigo | TL's last look + delivery checklist |
| 8 | `delivered` | Delivered | (none, terminal) | green | Sent to client; frees editor slot |

> Note: Assigned, QC 1 and Final check currently share one indigo badge. The redesign should give every stage a distinct look.

### 4.2 Allowed moves (state machine)

```
intake ──assign editor (+deadline)──▶ assigned ──▶ editing ──▶ qc1 ──▶ qc2 ──▶ final ──▶ delivered
                                                     ▲           │       │       │
                                                     │           └───────┴───────┴──send back (change list)──▶ revisions
                                                     └────────────────────────── revisions ─▶ editing (editor restarts)
editing (after a revision) ──▶ returns to the desk that sent it back (qc1 / qc2 / final)
```

| Who | Moves they can make |
|---|---|
| **VE** (own job, only once briefed) | assigned → editing ("Start editing"), editing → qc1 / back to sender ("Send to QC"), revisions → editing |
| **TL** (own pods) | Everything on their pods. UI offers only their own desks (intake, QC1, final, deliver); other moves are behind an Owner-only "Admin override" toggle |
| **QC** (jobs routed to them) | qc2 → final ("Clear QC2") or qc2 → revisions (send back with change list) |
| **Owner** | Everything everywhere (+ Admin override in UI) |

- QC1 forward = **two equal buttons**: "QC1 approved" / "QC1 comments added". Send-back is a smaller text link.
- A send-back requires a **change list** (non-empty). A forward move can carry an optional note.
- Delivery requires **both checklist ticks**.
- No cap on rounds; loop exits when a review raises zero changes.

### 4.3 QC2 auto-routing (summary)
1. **Sticky:** round 2+ goes back to the reviewer who raised the changes, at half price, even over budget (unless that account is deactivated).
2. **Pool:** available + active + `load + this job's cost ≤ capacity`. Part-timers hold max 1 podcast/day. Pod's own QC members first, else whole QC team.
3. **Empty pool:** rush jobs may go to least-loaded reviewer up to 125%; otherwise job stays **unrouted** and the pod TL is notified.
4. **Score:** `load ÷ capacity − 0.15 (knows this pod) − 0.05 × min(days idle, 3)`. Lowest wins.
5. Unrouted jobs: QC can **Claim**; lead can **Assign reviewer** (shows each reviewer's points left).
6. The day rolls over at midnight **Asia/Kolkata**.

**QC load statuses:** `unavailable`, `idle_next` ("Idle, next in line"), `idle`, `loaded`, `full` ("Spent out for today").

### 4.4 Row colour language (used in every list)
Priority (first match wins): **Scrapped** (grey, 60% opacity, title struck through) > **QC1 flagged** (amber) > **Delivered** (green) > **Mine / "Waiting on you"** (brand purple) > none.

### 4.5 Deadline display
"No deadline" (dim) · "Delivered" (green) · "Overdue by N days" (red) · "Due today" / "Due tomorrow" (amber) · "N days left" (amber if ≤3, else muted). Absolute format "2 Aug 2026".

### 4.6 WhatsApp trigger spec (from `pipeline_logic_and_whatsapp_trigger_spec.png` in the repo)

| Step | Actor | System logic | WhatsApp message |
|---|---|---|---|
| Client brief arrives | TL | Manual entry point | none |
| Log job in pod | TL | Code set, stage = Intake | none |
| Assign editor | TL | Cross-pod load check | `job_assigned_v1` → editor, 2 buttons |
| Editor taps "Started" | VE | Opens 24h free window | inbound reply; next 24h free-form |
| Edit the video | VE | Frame.io holds asset | none |
| Upload cut | VE | Version set, QC1 opens | `qc1_ready_v1` → TL |
| QC1 review | TL | Human judgement | none |
| Hand off to QC2 | TL | Routing engine (sticky, then least load) | `qc2_assigned_v1` → routed reviewer |
| QC2 review | QC | Counts open comments | none |
| Request changes | QC | Round +1 | `changes_raised_v1` → editor |
| Fix & upload v+1 | VE | Returns to same QC | none |
| Final check | TL | Human judgement | `final_check_v1` → TL |
| Deliver | TL | Sheets/cert sync, clean-rate update | `delivered_v1` → TL (digest) |

(The current template list in the admin page has 13 templates; see §13, WhatsApp Setup.)

---

## 5. Permissions matrix (who can do what)

TL = own pods only (own or lent role). "—" = not allowed.

| Action | Owner | TL | QC | VE | HR | Staff |
|---|---|---|---|---|---|---|
| Onboard client (create pod) | ✓ | ✓ | — | — | — | — |
| Edit pod settings (rename, pause/churn, retainer) | ✓ | ✓ | — | — | — | — |
| Change a pod's TL | ✓ | — | — | — | — | — |
| Upload/replace brand assets | ✓ | ✓ | — | — | — | — |
| Read/download brand assets | ✓ | ✓ | pods they're in | pods they're in | pods they're in | pods they're in |
| Add/remove pod members | ✓ | ✓ | — | — | — | — |
| Add/rename/archive channels; file jobs under channels | ✓ | ✓ | — | — | — | — |
| See pods | all | own | own queue | — | — | — |
| See jobs | all | own pods | routed to them + unrouted in their pods | own jobs | — | — |
| Create/edit jobs (title, deadline, type, editor, rush) | ✓ | ✓ | — | — | — | — |
| **See/set Actual (client) deadline** | ✓ | ✓ | — | — | — | — |
| Comment on a job | ✓ | ✓ | ✓ | ✓ (anyone who can see it) | — | — |
| Advance stages | all | all on own pods | qc2 → final / revisions | editor moves on own job, once briefed | — | — |
| Reassign editor (reason required) | ✓ | ✓ | — | — | — | — |
| Scrap / restore (reason required) | ✓ | ✓ | — | — | — | — |
| See QC1 evidence | ✓ | ✓ | ✓ | ✓ | — | — |
| Raise QC1 flag | ✓ | — (never on own review) | ✓ (routed to them) | — | — | — |
| Clear QC1 flag | ✓ | — | ✓ (only one they raised) | — | — | — |
| Claim unrouted QC2 job | — | — | ✓ | — | — | — |
| See own QC load | — | — | ✓ | — | — | — |
| Deliver | ✓ | ✓ | — | — | — | — |
| Toggle own availability | ✓ | ✓ | ✓ | — | — | — |
| Analytics, Team Capacity, Kontent Bot | ✓ | ✓ | — | — | — | — |
| Voice-note library | ✓ (route also allows FO) | — | — | — | — | — |
| WhatsApp setup | ✓ | — | — | — | — | — |
| Own WhatsApp opt-in (API exists, **no UI yet**) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Read user directory + stats | ✓ | ✓ (API) | — | — | ✓ | — |
| Create accounts | any role | — | — | — | TL/QC/VE/staff | — |
| Lend TL role | ✓ | — | — | — | at onboarding only | — |
| Edit role/capacity/employment, reset password | ✓ | — | — | — | — | — |
| Edit name + email ("Edit details") | ✓ | — | — | — | ✓ | — |
| Deactivate/reactivate | anyone except self | — | — | — | TL/QC/VE/staff | — |
| Impersonate | ✓ | — | — | — | — | — |
| Global search | ✓ (scoped to what each person can see) | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## 6. Information architecture & navigation

### 6.1 Routes

| Route | Screen | Allowed roles | Header title |
|---|---|---|---|
| `/login` | Login | public | none |
| `/` (`?view=overview`) | Overview dashboard | leads (HR/FO/staff land here too) | "Overview" |
| `/?view=pipeline` | Pipeline Table / Board | everyone with job access | "Pipeline Table" (VE sidebar: "My Edit Pipeline") |
| `/?view=qcteam` | QC Auto-Router | leads | "QC Auto-Router" |
| `/?view=qcqueue` | My QC Queue | QC (also Owner/TL) | "My QC Queue" |
| `/?view=capacity` (`&tab=qc`) | Team Capacity | leads | "Team Capacity" |
| `/?view=bot` | WhatsApp Bot placeholder (outdated, see §16) | Owner | "WhatsApp Bot" |
| `/?view=brandkit` | Brand-kit pod picker | leads | "Brand Kit" |
| `/?newJob=1` | New Edit Jobs wizard (modal over any view) | leads | (n/a) |
| `/jobs/:jobId` | Job detail full page | anyone who can see the job | "Job Detail" |
| `/notifications` | Notification inbox + desktop alert settings | everyone | "Notifications" |
| `/pods` | Client Pods | leads | "Client Pods" |
| `/pods/new` | Onboard Client wizard | leads | "Onboard Client" |
| `/pods/:podId/brand-assets` | Brand Kit for one pod | pod members + leads | "Brand Kit" |
| `/analytics` | Analytics | leads | "Analytics" |
| `/bot` | Kontent Bot (full page) | leads | "Kontent Bot" |
| `/hr` | Team Directory | HR, Owner | "Team Directory" |
| `/admin/users` | Users & Roles | Owner, HR | "Users & Roles" |
| `/admin/voice-notes` | Voice Notes library | Owner, FO | "Voice Notes" |
| `/admin/whatsapp` | WhatsApp Setup | Owner | "WhatsApp Setup" |
| `*` | Not found (inside app chrome) | any | (n/a) |

**Default home after login:** Lead → Overview; QC → My QC Queue; VE → Pipeline; others → Overview.

### 6.2 App shell (today)
- **Left sidebar (250px, fixed):** logo ("K" + "ontent" / "MEDIA"), *Active Pod / Client* selector (only on client-scoped screens: pipeline, QC router, brand kit; "All" = no filter), nav sections **COMPANY-WIDE**, **CLIENT WORKSPACE**, **ADMIN**, and at the bottom, for the Owner, a **"VIEWING AS (SIMULATION)"** user picker.
- **Top header (72px, sticky):** page title + subtitle "{Pod} Workspace" or "All Clients" · "Role: {ROLE}"; right side: **Global search**, **"+ New Edit Job"** (leads), **Notification bell** (unread badge), **Profile menu** (avatar initials → name/email, Appearance light/dark toggle, Sign out).
- **Impersonation banner** (fixed top, when active): "ADMIN IMPERSONATION MODE ACTIVE: Viewing session as {name} ({ROLE}) — {email}" + "← Stop Impersonating (Return to Admin)".
- **NotificationWatcher** (invisible): polls the inbox and raises each new notification as a sticky toast with a chime.

### 6.3 Sidebar per role (composed from all roles held, de-duplicated)

| Role | Items |
|---|---|
| **Owner** | Company-wide: Overview, Team Capacity, Analytics, Kontent Bot, WhatsApp Bot · Client workspace: Pipeline Table, QC Auto-Router, Brand Kit · Admin: Onboard Client, Client Pods, Users & Roles, Voice Notes, WhatsApp Setup |
| **TL** | Company-wide: Overview, Team Capacity, Analytics, Kontent Bot, Onboard Client, Client Pods · Client workspace: Pipeline Table, Brand Kit (no QC Auto-Router link even though allowed) |
| **QC** | QC Queue |
| **VE** | My Edit Pipeline |
| **HR** | Team Directory, Edit user details (→ /admin/users) |
| **Staff / FO without pods** | (nothing beyond Overview / notifications) |

### 6.4 URL state (keep shareable links)
`view`, `status` (tab), `flagged=1`, `tab=qc`, `newJob=1`, deep-link filters `editor`, `stage` (repeatable), `unrouted=1`, `sort` + `dir`, `channel`. Overview tiles, search results, analytics tiles and QC cards all deep-link this way.

### 6.5 Responsiveness today
Desktop-first. Sidebar is fixed 250px with no mobile collapse; bot conversation list hidden below `lg`. **The redesign should add a proper mobile/tablet layout** (editors and QCs check status on phones).

---

## 7. Current design system (as-is, for reference; you may replace it)

**Brand:** primary **#7F00FF** (hover #6D00DB, light #9D38FF, glow rgba(127,0,255,.4)/.15). Accent cyan #00F2FE (barely used).
**Status accents:** green #10B981, amber #F59E0B, red #EF4444, each with a 12% tinted background.
**Role colours:** TL indigo #4f46e5, VE teal #0d9488, QC amber #d97706 (+ Owner purple, HR rose, FO sky, Staff slate).
**Video-type colours:** Podcast violet, Long form sky, Short form emerald (deliberately quiet).
**Rush:** rose with flashlight icon.

**Fonts:** Outfit (display/headings, 300–900), Plus Jakarta Sans (body, 400–800), JetBrains Mono (numbers, codes, counts).
**Icons:** Remix Icon 4.2 (CDN).
**Shape:** radius 12px (cards), 8px (small); "glass card" = translucent card + 1px purple-tinted border + soft purple shadow + 12–16px backdrop blur.
**Layout:** sidebar 250px, header 72px, page padding 32px, section gap 24px.
**Motion:** fade-in-up 0.35s, slide-in-right for drawers, hover lift (-2px), animated ping dot on impersonation banner.
**Custom bits:** gradient "K" logo, "filmstrip" stage progress (8 small bars: done/active/pending), WhatsApp bubble style, purple gradient avatar circles with initials, thin purple scrollbars.

**Theme tokens**

| Token | Light | Dark |
|---|---|---|
| `--bg-app` | #F6F4FA | #0B0813 |
| `--bg-sidebar` | rgba(255,255,255,.9) | rgba(16,11,28,.85) |
| `--bg-header` | rgba(255,255,255,.85) | rgba(16,11,28,.75) |
| `--bg-card` | rgba(255,255,255,.85) | rgba(23,16,41,.65) |
| `--bg-card-hover` | #FFFFFF | rgba(33,23,59,.8) |
| `--bg-input` | #F0ECF8 | rgba(30,20,52,.7) |
| `--bg-pill` | rgba(127,0,255,.06) | rgba(255,255,255,.06) |
| `--border-color` | rgba(127,0,255,.15) | rgba(127,0,255,.18) |
| `--border-color-hover` | rgba(127,0,255,.4) | rgba(127,0,255,.45) |
| `--border-color-subtle` | rgba(0,0,0,.06) | rgba(255,255,255,.08) |
| `--text-main` | #1A1528 | #F3F0FC |
| `--text-muted` | #6B7280 | #9CA3AF |
| `--text-dim` | #9CA3AF | #6B7280 |

**Chart palette (8 fixed series slots, never cycled; max 8 series per chart):**
Light: #7F00FF, #EB6834, #1BAF7A, #EDA100, #E87BA4, #008300, #2A78D6, #E34948 · Dark: #9D38FF, #D95926, #199E70, #C98500, #D55181, #008300, #3987E5, #E66767. Grid: rgba(0,0,0,.08) / rgba(255,255,255,.09).

**Design-system asks for the redesign**
- Both themes must work; every colour as a token (no hard-coded hex that only works on one background).
- Distinct colours for all 8 stages; keep the 4-tone row language (§4.4) or an equally clear replacement.
- Number-heavy UI: tabular/mono numerals for counts, codes, points.
- Components needed (minimum): Button (primary/secondary/ghost/danger/outline), PillButton/segmented control, Badge/Chip, StageBadge, RushBadge, VideoTypePill, RoundBadge, RoleBadge, Avatar (initials), Input, Select, searchable person picker (with capacity info), Date input, Toggle switch, Checkbox, FilterMenu (multi-select dropdown with count), Tabs/status cards, Table (sortable, selectable rows, tinted rows), Kanban column + card, Pagination, Modal (sizes up to XL), Drawer (right side), ConfirmDialog, Stepper, Toast (info/success/error; sticky notification toasts), ErrorNote, Empty state, Loading state/skeleton, StatTile/KPI card, BarList, Charts (bar, grouped bar, stacked bar, line, area, pie, donut), Load bar (two-segment: today + carried), Capacity bar, Timeline, Activity feed, Chat thread + composer, Notification item, Search dropdown with grouped results.

---

## 8. Data the UI displays (field reference)

### Job (`JobDetail`)
| Field | Type | Shown as |
|---|---|---|
| `code` | text | "KM-1052" (mono) |
| `title` | text | job title |
| `pod_id` / `pod_name` | id / text | client pod |
| `channel_id` / `channel_name` | id / text or null | channel chip; null = "Not filed" |
| `stage` | enum (8) | StageBadge |
| `video_type` | podcast / long_form / short_form | pill |
| `rush` | bool | Rush badge |
| `assigned_editor_id` / `editor_name` | | "Unassigned" if null |
| `qc2_reviewer_id` / `qc2_reviewer_name` | | "Not routed" if null |
| `tl_id` / `tl_name` | | pod's TL |
| `sent_back_from` | qc1 / qc2 / final / null | where a revision returns to |
| `frame_link` | url | newest cut link (film icon "A cut is linked") |
| `round` | int | round counter |
| `deadline` | date | "Deadline" |
| `client_deadline` | date or null (redacted for non-leads) | "Actual deadline" |
| `delivered_at` | datetime | |
| `client_sheet_ok`, `ops_tracker_ok` | bool | delivery checklist |
| `created_at` | datetime | |
| `scrapped_at`, `scrapped_by_name`, `scrap_reason` | | scrapped banner/columns |
| `qc1_flagged_at`, `qc1_flagged_by_name`, `qc1_flag_tl_name`, `qc1_flag_reason` | | QC1 flag banner/chip |
| `is_mine` | bool (server) | "Waiting on you" |
| `weight` | light/standard/heavy | **never shown** (legacy) |

### Status counts (`/jobs/stats`)
`intake, active, overdue, mine, delivered, all, scrapped, flagged`.

### Overview (`/jobs/overview`)
`in_flight, intake, overdue, delivered, clean_delivered, pending_qc1, first_pass_pct (null = "—"), qc1_flagged`, and per pod `pod_name, status, in_flight, intake, delivered, in_qc, overdue`.

### Pod
`name, tl_id, status (active/paused/churned), billing_currency, retainer_volume`. Members: `name, email, role, pod_role, certified_at`.

### User
`name, email, role, role_title, secondary_role, phone, available, is_active, max_concurrent_jobs, employment_type, last_status_change {action, actor_name, reason, created_at}`. Open work before deactivation: `editing, reviewing, leading_pods`. Directory stats: `active, inactive, by_role {total, inactive}`.

### Editor capacity (`/users/editor-capacity`)
`name, open_by_pod [{pod_name, count}], open_count, delivered_count, clean_pct, max_concurrent_jobs, free_slots, reachable_free`.

### QC load (`/users/qc-load`)
`name, available, employment_type, capacity (24/12), points_today, points_carried, load, points_left, open_count, videos_by_type, podcasts_held, can_take_podcast, cleared_count, status`.

### QC1 pass (`/jobs/{id}/qc1-pass`)
`round, entered_at, cleared_at, seconds (null = unknown), cleared_by_name, comments, outcome (approved / comments_added / null = unknown)`.

### Job link
`kind (raw/video), title, url, added_by_name, created_at`.

### Brand asset
`type (brief/sop/kit/do_not), title, version, file`.

### Notification
`headline, body, job_code, job_title, pod_name, stage, actor_name, note, event_type, read_at, created_at`.

### Search results
Jobs (`code, title, stage, pod_name, channel_name, editor_name, matched_on` job/pod/channel/editor/tl/reviewer → "via client Dhan", `scrapped_at`), Pods (`name, status, tl_name, open_jobs, channels`), Channels (`name, pod_name, open_jobs, archived`), People (`name, email, role, is_active, pods[], open_jobs`).

### Chat
Conversation `title, updated_at`; message `role, content, tool_calls [{name, ok}], charts [ChartSpec], model`; status `enabled, model, daily_cap, used_today, reason`. ChartSpec: `chart_type (bar/grouped_bar/stacked_bar/line/area/pie/donut), title, labels, series [{name, values}], y_label, value_format (number/percent/days/points), note`.

### Job event types (activity feed)
`intake, stage_changed, changes_raised, note_added, job_updated, link_added, link_removed, job_reassigned, qc2_claimed, job_scrapped, job_restored, qc1_flag_raised, qc1_flag_cleared` (+ `qc2_assigned_v1`). Details on rendering in §11 (Activity feed).

### API endpoints (for the frontend developer)
- **auth:** `POST /auth/login`, `POST /auth/impersonate/{user_id}`, `POST /auth/change-password`
- **jobs:** `GET /jobs` (filters: pod_id, search, stage[], video_type[], editor_id, unassigned, unrouted, rush, channel_id, no_channel, qc1_flagged, deadline_from/to, status, reviewer_id, scrapped, sort_by, sort_dir, page, page_size), `GET /jobs/stats`, `GET /jobs/overview`, `GET /jobs/{id}`, `POST /jobs`, `POST /jobs/batch`, `POST /jobs/bulk-channel`, `POST /jobs/{id}/advance`, `PATCH /jobs/{id}`, `POST /jobs/{id}/reassign`, `POST /jobs/{id}/claim-qc2`, `GET /jobs/{id}/qc1-pass`, `POST /jobs/{id}/qc1-flag`, `POST /jobs/{id}/qc1-flag/clear`, `POST /jobs/{id}/scrap`, `POST /jobs/{id}/restore`, `POST /jobs/{id}/notes`, `PATCH /jobs/{id}/checklist`, `GET /jobs/{id}/events`, `GET/POST /jobs/{id}/links`, `DELETE /jobs/{id}/links/{link_id}`
- **pods:** `GET/POST /pods`, `GET /pods/channels`, `PATCH /pods/{id}`, `GET/POST /pods/{id}/members`, `DELETE /pods/{id}/members/{user_id}`, `GET/POST /pods/{id}/channels`, `PATCH /pods/{id}/channels/{channel_id}`
- **brand assets:** `GET/POST /pods/{id}/brand-assets`, `GET /pods/{id}/brand-assets/{asset_id}/download`
- **analytics:** `GET /pods/{id}/analytics/stage-distribution | first-pass-rate | avg-rounds-by-editor | stuck-jobs`
- **users:** `GET /users/me`, `GET /users`, `GET /users/stats`, `PATCH /users/me/availability`, `GET /users/me/qc-load`, `GET /users/capacity | ve-load | editor-capacity | qc-load | role-titles`, `POST /users`, `GET /users/{id}/open-work`, `POST /users/{id}/deactivate | reactivate | reset-password`, `PATCH /users/{id}`
- **notifications:** `GET /notifications`, `POST /notifications/read-all`, `POST /notifications/{id}/read`, `GET /notifications/push/key`, `POST /notifications/push/subscribe | unsubscribe | test`
- **search:** `GET /search?q=`
- **chat:** `GET /chat/status`, `POST /chat` (streams, SSE), `GET /chat/conversations`, `GET/DELETE /chat/conversations/{id}`
- **voice notes:** `POST/GET /voice-notes/`, `GET /voice-notes/{id}/audio`, `DELETE /voice-notes/{id}`, `GET /voice-notes/admin/videos`, `GET /voice-notes/admin/videos/{key}/notes`, `DELETE /voice-notes/admin/bulk-delete`
- **whatsapp:** `GET /whatsapp/status | templates | events | settings | messages | messages/stats | numbers | me`, `POST /whatsapp/templates/sync`, `POST /whatsapp/templates/{name}/submit | resubmit`, `DELETE /whatsapp/templates/{name}`, `PATCH /whatsapp/settings | numbers/{user_id} | me`, `POST /whatsapp/test-send | scheduler/run`, webhook `GET/POST /whatsapp/webhook`

---

## 9. Notifications, real-time and integrations (overview)

- **No websockets.** Lists poll every **30 s**; the notification watcher polls the unread inbox.
- **In-app inbox** (`/notifications`): every notification is one row with a server-rendered `headline` + `body`; mark read / mark all read. Unread count badge on the bell (counted over the whole inbox).
- **Live toasts:** each new notification pops a toast that must be dismissed, with a chime sound.
- **Desktop/OS push:** service worker + Web Push; per-browser subscription; settings card on the notifications page with a "send test" button.
- **WhatsApp:** extra delivery of the same notification via approved Meta templates, with quick-reply buttons that can move a job. Kill switch off by default; Owner admin page manages it (§13, WhatsApp Setup).
- **Frame.io:** manual link paste only (permanent decision). The browser extension adds voice notes on Frame.io (§14).
- **AI (Kontent Bot):** OpenRouter-backed LLM with tool calls over ops data; daily per-user question cap; refuses data the user can't see.

Notification types, their wording and colours are listed in §12 (Notifications page).



---

# PART B: SCREEN-BY-SCREEN

The sections below are exhaustive inventories of the current UI. Sub-numbering inside each section is local to that section.


## 10. Dashboard views (Overview, Pipeline, QC Auto-Router, My QC Queue, Team Capacity, Brand-kit picker) + New Edit Jobs wizard


Source files: `frontend/src/pages/DashboardPage.tsx`, `components/pipeline/NewJobWizard.tsx`, `components/qc/*`, `components/capacity/TeamCapacityPanel.tsx`, `components/analytics/{KontentBotWidget,StatTile,BarList}.tsx`, `lib/{jobRowTone,qc2,videoType}.ts` (plus supporting `lib/format.ts`, `lib/roles.ts`, `StageBadge`, `RushBadge`, `FilterMenu`, `Pagination`, `Stepper`, `NewChannelInline`, `AppLayout`).

All API paths below are relative to the API base (`/api`). Icons are Remix Icon (`ri-*`). Colours are given as the current theme tokens / Tailwind hues so the designer can map them to a new palette.

---

### 0. Global concepts used across these screens

#### 0.1 Roles (who sees what)
| Role key | Label | Notes |
|---|---|---|
| `owner` | Owner | Admin; "leads all pods" (company-wide reach). |
| `tl` | Team Lead | Leads specific pods (Pod.tl_id). Can also be *lent* as a secondary role to another user (e.g. an editor who is also TL). |
| `qc` | QC Reviewer | Does QC2 reviews. |
| `ve` | Video Editor | Cuts the work. |
| `hr`, `fo` (Founder's Office), `staff` | — | Not lead roles for these screens; land on Overview by default but see little. |

Predicates: **Lead** = has `owner` or `tl` (primary or secondary). **Leads all pods** = Owner only.

#### 0.2 Dashboard route & view switching
- Single route `/` renders `DashboardPage`; the sub-screen is chosen by `?view=`: `overview` | `pipeline` | `qcteam` | `qcqueue` | `capacity` | `bot` | `brandkit`. `?newJob=1` opens the New Job Wizard modal on top of whatever view is showing.
- **Default (home) view by role** (when no `?view=`): Lead → `overview`; QC (non-lead) → `qcqueue`; VE (non-lead) → `pipeline`; everyone else → `overview`. Non-overview homes are written into the URL (e.g. `/` becomes `/?view=qcqueue`) so sidebar highlight & header title match.
- **Guards**: `qcteam` requested by a non-lead → redirected to their home view. `qcqueue` requested by someone without `qc`/`owner`/`tl` → home view. Invalid view values → home view.
- **Before user is loaded**: whole page shows only `⟳ Loading your workspace...` (spinner icon + muted text), to avoid a flash of the wrong view.

#### 0.3 Header (from AppLayout, frames every view)
- Title per view: overview "Overview", pipeline "Pipeline Table", qcteam "QC Auto-Router", qcqueue "My QC Queue", capacity "Team Capacity", bot "WhatsApp Bot", brandkit "Brand Kit".
- Subtitle: `{Pod name} Workspace` (when a pod is selected AND view is client-scoped: `pipeline` or `qcteam`) else `All Clients`, then ` · Role: {ROLE UPPERCASE}`.
- Pod selector (sidebar) shown only on client-scoped views (`pipeline`, `qcteam`, brand-assets pages) when pods exist. Empty selection = "All".
- Header actions: Global search; **"+ New Edit Job"** button (Leads only) → navigates to `/?newJob=1`; Notification bell; Profile menu.

#### 0.4 Sidebar entries pointing into this page
- Owner: Overview (`/`), Team Capacity (`/?view=capacity`), Analytics, Kontent Bot, WhatsApp Bot (`/?view=bot`), [client-scope] Pipeline Table (`/?view=pipeline`), QC Auto-Router (`/?view=qcteam`), Brand Kit (`/pods/{id}/brand-assets` if pod selected else `/?view=brandkit`).
- TL (non-owner): Overview, Team Capacity, Analytics, Kontent Bot, Onboard Client, Client Pods, [client] Pipeline Table, Brand Kit. (Note: TL has no sidebar link to QC Auto-Router, though the view is allowed for leads.)
- QC: "QC Queue" (`/?view=qcqueue`).
- VE: "My Edit Pipeline" (`/?view=pipeline`).
- Multi-role users get the union, de-duplicated.

#### 0.5 Stages (StageBadge) — order, labels, owner, colours
| Stage key | Label | Whose move (board column chip) | Badge colour |
|---|---|---|---|
| intake | Intake | TL | neutral pill (bg-pill / text-muted) |
| assigned | Assigned | VE | indigo-500/10 bg, indigo-400 text |
| editing | Editing | VE | teal-500/10, teal-500 |
| qc1 | QC 1 | TL | indigo |
| qc2 | QC 2 | QC | amber-500/10, amber-500 |
| revisions | Revisions | VE | accent-red bg/text |
| final | Final check | TL | indigo |
| delivered | Delivered | TL | accent-green bg/text |

#### 0.6 Video types (`lib/videoType.ts`)
| Key | Label | Icon | Pill colour | QC2 cost (points, `lib/qc2.ts`) |
|---|---|---|---|---|
| podcast | Podcast | ri-mic-2-line | violet-500/10 bg, violet-400 text | 6 |
| long_form | Long form | ri-film-line | sky-500/10, sky-400 | 3 |
| short_form | Short form | ri-smartphone-line | emerald-500/10, emerald-500 | 1 |
Order offered everywhere: Podcast, Long form, Short form. Default for new jobs: Long form. Colours are intentionally quiet so they don't compete with row tones. Repeat-round review = half cost rounded up (not modelled in UI).

QC2 daily budgets: full-time 24 pts, part-time 12 pts. Helper copy: "24 points a day — 8 long-form reviews, or the same points in other work".

#### 0.7 Job row tones (`lib/jobRowTone.ts`) — used by pipeline table, board cards, QC tables/lists
Exactly four states get colour; priority order (first match wins): **scrapped > qc1_flagged > delivered > mine > none**.
| Tone | Condition | Table row style | Board card style | Tooltip/legend text |
|---|---|---|---|---|
| scrapped | `scrapped_at` set | bg-pill, 2px left border text-dim, 60% opacity; title struck through | bg-pill, normal border, 60% opacity | "Scrapped" |
| qc1_flagged | `qc1_flagged_at` set | accent-amber-bg tint, 2px amber left border | amber tint bg, amber-500/40 border | "QC1 flagged as not done" |
| delivered | stage = delivered | accent-green-bg tint, green left border | green tint, emerald-500/30 border | "Delivered" |
| mine | `is_mine` (server-computed "waiting on you now") | primary-glow-subtle (brand purple) tint, primary left border | purple tint, primary@45% border | "Waiting on you" |
| none | otherwise | transparent left border | bg-app, subtle border | (none) |
Rationale copy in code: a flag outranks delivered/mine because a skipped QC1 on a delivered video is what a lead most needs to catch; "Waiting on you" text still prints from `is_mine` even when another tone wins.

#### 0.8 Deadline display (`lib/format.ts deadlineInfo`)
Relative label + tone from `job.deadline` (team date) and stage:
- No deadline → "No deadline" (tone none, text-dim)
- Stage delivered → "Delivered" (tone done, green)
- Past → "Overdue by N day(s)" (red)
- Today → "Due today"; tomorrow → "Due tomorrow" (amber "soon")
- else "N days left" (amber if ≤3, else muted "ok")
Absolute date format: "2 Aug 2026" (`formatFullDate`).
Two deadline words: **"Deadline"** = `job.deadline`, the team date everyone sees. **"Actual deadline"** = `job.client_deadline`, client-promised date, visible only to Owner + that pod's TL (server redacts it for others). Buffer helper: "N day(s) of buffer" or "no buffer".

#### 0.9 Rush
`job.rush` boolean. Badge: rose-500/15 bg, rose-400 text, uppercase bold, ri-flashlight-fill icon + "Rush" (compact = icon only). Tooltip: "Marked urgent: QC2 routing may place this on a reviewer who is already out of points, rather than leaving it unrouted. It does not jump the queue."

#### 0.10 Rounds colouring
- Pipeline table/board: number in mono; 0 = dim, 1–2 = amber-400, ≥3 = rose-400. Board shows "R{n}" only when >0.
- QC tables: badge "First pass" (round 0, neutral pill), "Round N" (1–2 amber bg/text), (≥3 red bg/text). Meaning: 3+ rounds usually signals a briefing problem.

#### 0.11 Polling
Pipeline table, board columns, status counts, QC queue groups, QC router unrouted list all refetch every **30 s**.

---

### 1. VIEW: Overview (`/` or `?view=overview`)

**Who**: Default home for Leads (Owner, TL). Also lands here for HR/FO/staff (no other home), though data endpoints may be scoped/empty for them. Header title "Overview".
**Purpose**: Company/pod-level health at a glance; every tile is a shortcut into the filtered pipeline.

**Data**:
- `GET /jobs/overview` → `WorkspaceOverview { in_flight, intake, overdue, delivered, clean_delivered, pending_qc1, first_pass_pct (nullable), qc1_flagged, pods[] }`, each pod `{ pod_id, pod_name, status (active|paused|churned), in_flight, intake, delivered, in_qc, overdue }`. Fetched only when on overview.
- `GET /jobs/stats` (with pipeline filters, which on overview are basically empty) → `JobStatusCounts` — used only for the "ON MY PLATE" tile (`mine`).

#### 1.1 KPI tile grid (section 1)
Grid: 1 col mobile → 2 (sm) → 3 (lg) → 4 (xl); wraps to 2 rows. Each tile = glass card: small uppercase label (top-left), coloured square icon chip (top-right), big mono number, one-line muted sub-caption. Hover lifts. Value shows "—" while loading.

| # | Label (exact) | Icon / chip colour | Value source | Number colour | Sub-caption (exact) | Click → |
|---|---|---|---|---|---|---|
| 1 | ON MY PLATE *(hidden for Owner — "Mine" not offered to leads-all-pods)* | ri-user-line, brand purple | `stats.mine` | brand purple | ">0: "Waiting on you right now" / 0: "Nothing is waiting on you" | Pipeline, status=mine |
| 2 | IN FLIGHT JOBS | ri-film-line, purple-500 | `overview.in_flight` (assigned→final, excludes intake & delivered) | default | "Assigned and moving" | Pipeline, status=active |
| 3 | AWAITING ASSIGNMENT | ri-inbox-line, amber | `overview.intake` | amber if >0 else default | ">0: "Arrived, no editor picked yet" / 0: "Everything has an editor" | Pipeline, status=intake |
| 4 | OVERDUE | ri-alarm-warning-line, rose | `overview.overdue` | red if >0 | ">0: "Past deadline, not delivered" / 0: "Nothing past its deadline" | Pipeline, status=overdue |
| 5 | FIRST-PASS SUCCESS | ri-checkbox-circle-line, emerald | `overview.first_pass_pct` → "{n}%"; null → "—" | green (dim when null) | null: "No deliveries yet to measure" / else "{clean_delivered} of {delivered} delivered with no revision round" | Link to `/analytics` (tooltip "Open Analytics — first-pass rate and average rounds, per client and per editor") |
| 6 | PENDING QC1 | ri-eye-line, amber | `overview.pending_qc1` | amber | "First-pass review, with the pod TL" | Pipeline, status=active + Stage chip = QC 1 |
| 7 | DELIVERED | ri-rocket-line, emerald | `overview.delivered` | green | ">0: "Signed off and sent to the client" / 0: "Nothing delivered yet" | Pipeline, status=delivered |
| 8 | QC1 FLAGGED | ri-flag-2-line, amber | `overview.qc1_flagged` | amber if >0 | ">0: "Passed through QC1 without a review" / 0: "No QC1 has been flagged" | Pipeline, status=all + "QC1 flagged" toggle on. Tooltip "Jobs a QC2 reviewer says never got a real QC1" |

#### 1.2 "Client Pod Status Overview" (section 2)
- Heading: ri-layout-grid-line (purple) + "Client Pod Status Overview".
- Grid of pod cards (1 / 2 md / 3 lg). Each card is a button (tooltip "Open {pod} in the pipeline table") → sets sidebar pod selector to that pod and switches to `?view=pipeline`.
- Card contents: pod name (bold, truncated); under it "⊞ Open pipeline" (ri-table-line, muted); status chip top-right; divider; 4-column mini-stat row:
  - "In Flight" `in_flight`
  - "Intake" `intake` (amber when >0)
  - "Delivered" `delivered`
  - "In QC" `in_qc`
- Status chip logic: pod status ≠ active → "Paused"/"Churned" (neutral pill); active with overdue>0 → "{n} overdue" (red bg/text, rose border); else "Active" (green).
- Empty: card text "No client pods yet. Onboard a client and its jobs, editors and QC routing all hang off that pod."

---

### 2. VIEW: Pipeline (`?view=pipeline`)

**Who**: Everyone with job access. Header "Pipeline Table" (VE's sidebar calls it "My Edit Pipeline"). Home view for editors. Server scopes rows to what the user may see (VE: own jobs; TL: own pods; Owner: all).
**Purpose**: The master work list — filter, sort, open jobs, file videos under channels; two display modes (Table, Board).

**Scope**: Sidebar pod selector (if a pod selected → `pod_id` filter) else All Clients.

**Data**:
- Table: `GET /jobs` with `{...filters, status, sort_by, sort_dir, page, page_size}` → `{items: JobDetail[], total, page, page_size}`. Only when mode = Table.
- Board: one `GET /jobs` per stage column (see 2.6).
- Status counts: `GET /jobs/stats` with same filters (minus status) → counts per tab.
- Channels: `GET /pods/channels` (all channels user can see; each has `pod_name`, `archived_at`, `job_count`).
- Editors list (lead only): `GET /users` (active), filtered to role `ve`.
- Pods: `GET /pods`.
- Side panel: `GET /jobs/{id}` and `GET /jobs/{id}/events` (JobDetailPanel — documented elsewhere).

Filter object (shared by table, board, counts): `pod_id, search, stage[], video_type[], editor_id, unassigned, unrouted, rush, channel_id | no_channel, qc1_flagged, deadline_from, deadline_to`.

#### 2.1 Layout order
1. Status cards row
2. Toolbar: search + status tabs (left), Board/Table toggle (right)
3. Filter bar
4. (Board mode) Kanban board — OR — (Table mode) Bulk-file bar (when rows ticked) + Table + Pagination
5. "Loading jobs..." line while table loads
6. Job detail side panel (slides in when a row/card is clicked)

#### 2.2 Status tabs / status cards
Status = which tab; stored in URL `?status=` (`active` default, omitted from URL). Offered tabs depend on role:
- Full ordered list: `intake, active, overdue, mine, delivered, all, scrapped, flagged`.
- `intake` and `flagged` are **lead-only** (hidden for VE/QC).
- `mine` hidden for Owner (leads all pods).
So: Owner sees 7 (no Mine); TL sees all 8; VE/QC see 6 (active, overdue, mine, delivered, all, scrapped).

**Status cards** (one per offered tab, grid 2 / 3 sm / N lg where N = number of cards). Card: uppercase label, icon chip, mono count from `/jobs/stats` ("—" loading). Tooltip = hint. Clicking selects the tab; selected card gets glowing primary border.
| Key | Label | Hint (tooltip) | Icon / chip | Count colour |
|---|---|---|---|---|
| intake | Intake | "Arrived, no editor picked yet — waiting to be assigned" | ri-inbox-line amber | amber |
| active | Active | "Assigned and moving — editing through the final check" | ri-film-line purple | default |
| overdue | Overdue | "Past deadline and still open" | ri-alarm-warning-line rose | rose |
| mine | Mine | "Waiting on you right now" | ri-user-line brand purple | brand purple |
| delivered | Delivered | "Signed off and gone to the client" | ri-rocket-line emerald | green |
| all | All | "Everything you can see, scrapped included" | ri-layout-grid-line brand purple | default |
| scrapped | Scrapped | "Cancelled before delivery" | ri-close-circle-line neutral | muted |
| flagged | Flagged | "QC1 a reviewer says never happened — for an admin to rule on" | ri-flag-2-line amber | amber |

Tab semantics (which stages each can contain): intake = intake only; active = everything except intake & delivered; overdue / mine / scrapped = not delivered; delivered = delivered only; all & flagged = any stage.

**Toolbar tab buttons**: same tabs repeated as compact pill buttons labelled in UPPERCASE (`INTAKE`, `ACTIVE`, …). Selected: dark slate bg, white text, purple border.

#### 2.3 Toolbar
- Search input: placeholder "Search jobs by title or code...", search icon, ~256px, debounced 300ms → `search` filter.
- View toggle (segmented): "Board" (ri-kanban-view) / "Table" (ri-table-line). Default **Table**. Selected = primary fill, white text. Local state (not in URL).

#### 2.4 Filter bar (all server-side; wraps)
1. **Stage** multi-select (FilterMenu, icon ri-flow-chart): options Intake, Assigned, Editing, QC 1, QC 2, Revisions, Final check, Delivered. Active state: primary border + tint + count badge. Menu has "Clear stage" link when any selected.
2. **Video type** multi-select (icon ri-film-line): Podcast / Long form / Short form, each label tinted with its type colour. "Clear video type".
3. **Channel** select (shown only when there are channels in scope): first option "Any channel"; then channels (flat list if a pod is selected, else grouped by client name as optgroups); last option "Not filed yet" (value `__none` → `no_channel=true`). Highlighted when set.
4. **"+ Add a channel for this client"** inline creator — shown instead of the channel filter when a pod is selected, it has no channels, and user is a lead (dashed-border box).
5. **Editor** select (Leads only): "Any editor", "Unassigned" (→ `unassigned=true`), then each active VE by name. Highlighted when set.
6. **Unrouted QC2** toggle (ri-user-unfollow-line). Tooltip "Jobs sitting at QC2 that routing could not place". On: primary styling.
7. **Rush** toggle (ri-flashlight-line). Tooltip "Jobs somebody marked urgent — QC2 routing may place these on a reviewer with no points left". On: rose border/tint/text.
8. **QC1 flagged** toggle (ri-flag-2-line). Tooltip "Jobs a QC2 reviewer says never got a real QC1". On: amber. Stored in URL `?flagged=1`.
9. **Deadline range**: calendar icon + date input (aria "Deadline from") + "→" + date input ("Deadline to").
10. **"⊗ Clear N filter(s)"** link-button — appears when ≥1 filter active; resets all of the above (not search, not status tab). Count: each stage chip + each video type + editor/unassigned (1) + unrouted + rush + channel + flagged + deadline range (1).

Any filter/sort/page-size change resets to page 1, and clears row selection.

Deep-link params accepted then stripped from URL: `editor`, `stage` (repeatable), `unrouted=1`, `sort` + `dir`, `channel`. Also `status`, `flagged=1`, `view`. Used by Overview tiles, QC router cards, Analytics tiles, global search (e.g. editor hit → `/?view=pipeline&editor={id}`; channel hit → `/?view=pipeline&status=all&channel={id}`). If a pod switch makes the channel filter stale, it is cleared.

#### 2.5 Table mode
Glass card with table, then Pagination footer.

**Columns (in order)**:
| # | Header | Sortable | Cell content |
|---|---|---|---|
| 0 | [checkbox] — only if user can file at least one row on the page; header checkbox "Select every video on this page" | – | Checkbox only on rows the user may file (see bulk filing); empty cell otherwise |
| 1 | Job | yes (`title`) | Title bold (struck through if scrapped). Sub-line (10px dim): code (mono) · film icon if a cut link exists (tooltip "A cut is linked") · "Waiting on you" (brand purple, when `is_mine`) · "⚑ QC1 flagged" (amber, tooltip = flag reason) |
| 2 | Stage | yes (`stage`) | StageBadge |
| 3 | Deadline | yes (`deadline`) | Relative label coloured by deadline tone; below: absolute date or "—", plus a flag icon if an Actual deadline exists. Tooltip (leads only, when client_deadline present): "Actual deadline {date} · {N days of buffer / no buffer}" |
| 4 | Video type | yes (`video_type`) | Type pill with icon + label |
| 5 | Rush | yes (`rush`) | Rush badge or "—" |
| 6 | Client Pod | yes (`pod`) | pod name |
| 7 | Channel | yes (`channel`) | See ChannelCell below |
| 8 | Editor | no | editor name or dim "Unassigned" |
| 9 | QC Reviewer | no | QC2 reviewer name or dim "Not routed" |
| 10 | Rounds | yes (`round`) | round number coloured (0 dim, 1–2 amber, 3+ rose) |
| 11–12 | Scrapped by / Reason — **only on the Scrapped tab** | no | Scrapped-by name (or "—") + relative time ("3d ago"); reason truncated to one line, full text on hover |
| last | (chevron) | – | ri-arrow-right-s-line |

Sort: header click toggles asc/desc on same field, or switches to new field asc. Indicators: up/down arrow in primary colour on active column; faint up-down icon otherwise. **Default sort = "pipeline"** (not a column): grouped by work state (in progress → waiting for editor → delivered → scrapped), then deadline asc. Deep links may also use `round`.

Row: whole row clickable → opens Job detail side panel; selected row gets 1px inset primary ring; hover bg-pill; tone classes per §0.7; tooltip = tone label.

**ChannelCell** (per row):
- If user can't file this row: channel name pill (bg-pill, muted, bold) or dim "—".
- If user can file (Owner, or the row's pod TL; never on scrapped jobs):
  - If the pod has no channels: inline "+ Channel" creator (compact). Creating it files the row immediately.
  - Else a small select: "Not filed" + pod's channels. Change → `PATCH /jobs/{id}` with `channel_id` or `clear_channel: true`. Disabled while saving. Error toast "Could not file this video."
  - Clicking inside doesn't open the row's panel.

**Empty states** (single full-width cell):
- Contradictory stage filter (selected stage can't exist in this tab): "The {TAB} tab never contains **{Stage names joined with ' or '}** — that's what it means. [Open the INTAKE tab | Open the DELIVERED tab | Switch to ALL] to see them." (link-style button switches tab.)
- Scrapped tab: "Nothing has been scrapped here. Good."
- Delivered tab: "Nothing delivered yet under these filters."
- Otherwise: "No jobs match these filters."
**Loading**: below the table, "⟳ Loading jobs..." (spinner).

**Pagination** (shared component): left "Showing {first}–{last} of {total} jobs" (or "No jobs"), page-size select 10/25/50/100 (default 25) + "per page"; right: first-page icon, "Prev", "Page X / Y" (mono), "Next", last-page icon. Disabled ends at 40% opacity.

#### 2.6 Bulk "file under channel" bar (table mode, when ≥1 row ticked)
Who: Owner (any row) or TL (rows of pods they lead); scrapped rows never tickable. Bar: primary-bordered, primary-tint strip above the table.
- Chip: "{n} selected".
- If all ticked rows are from one client: label "FILE UNDER" + select ("Choose a channel..." + that client's channels) + **Apply** button (ri-play-list-add-line; disabled until a channel chosen; "Filing..." with spinner while pending) + inline "+ New channel" creator (creating also immediately files the selection).
- If rows span multiple clients: text "Videos from {n} clients are selected. A channel belongs to one client, so pick one client's rows to file them — unfiling still works across all of them."
- **Unfile** (ri-eraser-line) text button, tooltip "Take the selected videos back out of their channels"; hover amber.
- **Clear selection** (right-aligned, ri-close-circle-line).
- API: `POST /jobs/bulk-channel {job_ids, channel_id | null}` → `{updated, unchanged}`.
- Success toast: "{n} video(s) filed under {channel}." or "{n} video(s) taken back out of their channels." + optional " — {k} already were/weren't." Error toast: "Could not file those videos."
- Selection auto-clears on any filter/tab/sort/page/page-size/mode change.

#### 2.7 Board (Kanban) mode
- Horizontal scroller of 8 fixed-width (280px) columns, one per stage in order; board height stretches to bottom of viewport.
- Each column fetches `GET /jobs {filters, status, stage:[thisStage], page_size:25, sort_by:deadline, sort_dir:asc}`. Special case: when tab = Active, the Intake column asks with status=intake and the Delivered column with status=delivered (so they aren't permanently empty).
- Column header: stage label + total count pill (mono) on left; owner chip right ("TL"/"VE"/"QC", indigo-500/10 bg, indigo-400 text).
- Card (clickable → side panel; tone styling §0.7; hover lift + primary border; tooltip = tone label):
  - Row 1: code (mono, dim) + amber flag icon if QC1 flagged (tooltip "QC1 flagged as not done"); right: channel name or, if none, pod name.
  - Title (semibold, struck through if scrapped).
  - Deadline: calendar icon + relative label, coloured by tone.
  - Footer (divider): user icon + editor name or "Unassigned"; right: "R{round}" when round>0 (rose if ≥3).
- Column empty: centred inbox icon + "Nothing in {Stage}".
- Overflow: "+{n} more — switch to Table to page through them".
- No checkboxes / bulk actions in board mode.

---

### 3. VIEW: QC Auto-Router (`?view=qcteam`)

**Who**: Leads only (Owner, TL). Sidebar link only for Owner ("QC Auto-Router", ri-cpu-line, client-scoped so pod selector shows). Non-leads redirected to their home.
**Purpose**: See what QC2 auto-routing would do now, why jobs are unrouted, and hand unrouted jobs to reviewers manually.

**Data**:
- `GET /users/qc-load` → `QcLoad[]` per reviewer: `name, available, employment_type (full_time|part_time), capacity (24|12), points_today, points_carried, load (= today+carried), points_left, open_count, videos_by_type {type: count}, podcasts_held, can_take_podcast, cleared_count, status (unavailable|idle_next|idle|loaded|full)`. Company-wide (not pod-filtered).
- `GET /jobs {status:active, pod_id?, unrouted:true, page_size:50}` → unrouted jobs (pod-filtered by sidebar selector). Polled 30s.

Derived reviewer buckets: **eligible** = available AND points_left>0; **out_of_points** = available AND points_left≤0; **unavailable** = not available. **Next in line** = reviewer with status `idle_next`. **Biggest gap** = max points_left among eligible. **Podcast-capable** = eligible with `can_take_podcast`.

#### 3.1 Layout order
1. Three stat cards (links)
2. Loading line: "⟳ Loading QC routing state..." (while either query loads)
3. Unrouted jobs card
4. "Who routing can pick from" card
5. "How a QC2 job gets routed" explainer card
6. Job detail side panel

#### 3.2 Stat cards (grid 1 / 3 sm). Each is a Link card.
| Label | Icon/chip | Value | Value colour | Sub-caption | Link → / tooltip |
|---|---|---|---|---|---|
| UNROUTED NOW | ri-error-warning-line amber | unrouted total ("—" loading) | amber if >0 | ">0 "Nobody is reviewing these" / 0 "Every QC2 job has a reviewer" | `/?view=pipeline&status=all&unrouted=1`; "Open these in the pipeline table" |
| REVIEWERS OPEN | ri-shield-check-line emerald | "{eligible}/{total reviewers}" | default | "On duty with points left · {k} can take a podcast" | `/?view=capacity&tab=qc`; "Open the QC load view — every reviewer's day, in full" |
| NEXT IN LINE | ri-user-follow-line purple | reviewer name (not mono) or "—" | default | name: "Idle longest — takes the next job" / none: "Nobody is fully idle; lowest score wins" | `/?view=capacity&tab=qc`; "Open the QC load view to see {name}'s day" |

#### 3.3 Unrouted jobs card (UnroutedJobsCard → QcJobList)
- Header: amber icon chip (ri-error-warning-line), title "Unrouted — nobody has these", count pill (server total).
- Hint (lead version): "At QC2 with no reviewer attached. Nobody is reviewing them until someone is put on them." (QC version, if used with claimable: "At QC2 with no reviewer attached. Claim one and it stays yours for every later round — QC2 is sticky.")
- When there are rows, an amber info box:
  - Line 1 = **reason** (computed):
    - Pod has eligible reviewers but none podcast-capable: "Nobody can take a podcast right now — the largest gap left in anyone's day is {n} point(s), and a podcast costs 6. Shorter work would still route."
    - Eligible reviewers exist: "There are reviewers with room now — these arrived while nobody was free, and nothing has re-routed them since."
    - All unavailable: "All {n} reviewer(s) is/are marked unavailable, so routing had nobody to score."
    - All spent out: "All {n} reviewers are out of points for today. The budget is daily — these will route on their own tomorrow morning, or a lead can hand one over now."
    - Otherwise: "No reviewer was both on duty and had room for these when they arrived."
    - Fallback (no load data): "Auto-routing could not place these: every reviewer was either off duty or had already spent their points for the day when the job arrived."
  - Line 2 (dim): "Routing doesn't come back for them later — it only runs as a job enters QC2, so one of these needs picking up by hand. The points budget is daily, so a job left here is reachable again tomorrow morning."
- **Rows** (QcJobRow; tone-styled; clickable → side panel): code (mono) · title · StageBadge · ri-group-line + pod name · ri-scissors-cut-line + editor or "No editor yet" · calendar + relative deadline (tone colour) · round badge ("First pass"/"Round N") · chevron. Right side: row action.
- **Row action (lead)**: "Assign reviewer" select (w-64). Placeholder: "Assign a reviewer... (costs {cost} pt(s))" where cost = QC2 points for the job's video type; shows "Assigning..." while pending. Options = every reviewer (no one filtered out — hand-pick is the override): "{name} — {points_left} of {capacity} left" + " · PT" if part-time + " · off duty" if unavailable + (" · already has today's podcast" if podcast and reviewer can't take one, else " · would go over" if points_left < cost). Select → `PATCH /jobs/{id} {qc2_reviewer_id}`. Disabled when no reviewers. Inline red error under it (fallback "Could not assign that reviewer.").
- Empty: "Nothing unrouted. Every QC2 job you can see has a reviewer on it."
- Overflow: "+{n} more in this group — the pipeline table pages through them." (page size 50).

#### 3.4 "Who routing can pick from" card
- Title: ri-cpu-line + "Who routing can pick from". Sub: "Points spent today against each reviewer's own daily budget, grouped by whether the next QC2 job could go to them." Right link: "Full QC load view →" (`/?view=capacity`).
- Empty (no QC accounts): "No QC accounts exist yet, so nothing can be routed. Create one under Users & Roles and QC2 jobs will start being assigned automatically."
- Three groups, each a small uppercase label + wrap of reviewer chips:
  - "Eligible now" (green label) — empty: "Nobody — the next QC2 job will land in the unrouted list above."
  - "Skipped — out of points for today" (amber label; chips muted) — empty: "Nobody has spent their day out."
  - "Skipped — marked unavailable" (dim label; chips muted) — empty: "Everyone is available."
- **Reviewer chip**: name · "PT" mini-tag if part-time · "{load}/{capacity}" (mono) · "{n} left" or "spent out". Tooltip: "{name} works part-time — 12 points a day" / "full-time — 24 points a day".

#### 3.5 "How a QC2 job gets routed" explainer (static)
- Title: ri-route-line + "How a QC2 job gets routed".
- Monospace formula block:
  ```
  cost  = 1 short form · 3 long form · 6 podcast     (half, rounded up, on a repeat round)
  pool  = on duty, and points_spent_today + cost ≤ their daily budget
  score = points_spent_today ÷ daily_budget
        − 0.15  if they've cleared work on this pod before
        − 0.05 × min(days_idle, 3)
  ```
- Caption: "Lowest score wins. A repeat round skips all of this and goes straight back to the reviewer who raised the changes."
- 2-column grid of 7 rule tiles (icon + title + body):
  1. ri-price-tag-3-line — "A review is priced by what it is" — "Short form 1 point, long form 3, podcast 6. A repeat round costs half of that, rounded up — and halved once, so round 5 costs the same as round 2."
  2. ri-battery-charge-line — "24 points a day, or 12 part-time" — "Spent against a date, not a queue: finishing a job does not hand the points back until tomorrow. Somebody who burns 24 by lunch is done for the day."
  3. ri-scales-3-line — "Lowest share of their own day wins" — "Scored on load ÷ capacity, not on raw points — otherwise a part-timer gets loaded like a full-timer, which is the whole reason two budgets exist."
  4. ri-award-line — "−0.15 if they know the pod, −0.05 per idle day" — "Familiarity is worth about a fifth of a day. The idle term caps at three days: a tiebreak, so the same person doesn't catch three jobs in a row."
  5. ri-shut-down-line — "The job has to fit what's left" — "Not "are they under the cap" but "does this one fit": four points free is not enough for a podcast. A part-timer holds at most one podcast a day."
  6. ri-pushpin-line — "Sticky on every revisit" — "Only a first watch is scored. Later rounds go back to the same reviewer at half price even if it takes them over — they wrote the change list."
  7. ri-flashlight-line — "Rush may overflow, once nobody has room" — "A job marked rush can be pushed onto the least-loaded reviewer up to 125% of their day. Past that it still holds — an empty pool never silently overflows."
- Footer (dim, mono paths): "Full rule: docs/12-qc2-load-model.md · implementation: app/services/routing.py" (developer-facing; designer may drop).

---

### 4. VIEW: My QC Queue (`?view=qcqueue`)

**Who**: QC reviewers (home view). Also reachable by Owner/TL (allowed), but the availability card's load section and Claim buttons are QC-only. Header "My QC Queue"; sidebar "QC Queue".
**Purpose**: Reviewer's own workspace: set availability, see today's points budget, and work through five groups of jobs.

**Data**:
- `GET /users/me` (current user; `available` flag).
- `GET /users/me/qc-load` (QC only) → own `QcLoad`.
- Five `GET /jobs` queries (page_size 25, status=all, scrapped=false, reviewer_id=me), polled 30s:
  - waiting: stage qc2
  - sent_back: stage revisions
  - in_loop: stages intake, assigned, editing, qc1
  - cleared: stages final, delivered
  - unrouted: `{status:all, scrapped:false, unrouted:true}` (not reviewer-filtered)
- Toggle availability: `PATCH /users/me/availability {available}`.

#### 4.1 Layout order
1. Reviewer status card
2. Five group cards (tabs)
3. Group table card (header + table + overflow note)
4. Job detail side panel

#### 4.2 Reviewer status card
- Status dot (green with glow if available, dim if not) + heading: "Available for new QC2 work" / "Not available for new QC2 work".
- Sub: "Turn this off and new QC2 work stops being routed to you — jobs already in your queue stay yours."
- Right: toggle switch (green when on; disabled while saving or no user). aria "Available for new QC2 work".
- Error line: "Could not save that — try again."
- **"YOUR DAY"** section (only if own load loaded, i.e. QC users):
  - Right: "{load}/{capacity} pts" (red when spent out).
  - Two-segment bar: today's points (amber, or red when spent out) + carried-over points (rose-400/70). Widths = points/capacity.
  - Line: "{open_count} open · {cleared_count} cleared · {n} point(s) left today" OR when spent out "you're out of points for today, so nothing new will route to you until tomorrow"; plus (rose) " · {n} carried over from an unfinished round" when >0.
  - Dim explainer: "Points are spent against the day, not the job: clearing something does not hand them back until tomorrow. A short form costs 1, a long form 3, a podcast 6 — half that, rounded up, on a round you have already watched."

#### 4.3 Group cards (grid 2 / 3 sm / 5 xl; staggered fade-in). Click selects group (default "Waiting on me"). Active card: primary border + purple shadow. Tooltip = hint. Count = server total.
| Key | Label | Icon / chip | Count colour | Hint | Empty text |
|---|---|---|---|---|---|
| waiting | Waiting on me | ri-eye-line amber | amber | "At QC2 and routed to you. Clear it forward, or send it back with a change list." | "New QC2 work lands here automatically while you're available." |
| sent_back | Sent back | ri-arrow-go-back-line rose | default | "You raised a change list. The editor is working through it; it comes back to you." | "You haven't sent anything back that's still open." |
| in_loop | Still yours, elsewhere | ri-loop-left-line indigo | default | "Yours from an earlier round, currently with the TL or the editor. Routing is sticky, so these return to you." | "Nothing of yours is elsewhere in the loop." |
| cleared | Cleared | ri-checkbox-circle-line emerald | default | "You passed these at QC2 — with the TL for final check, or already delivered." | "Jobs you pass at QC2 land here." |
| unrouted | Unrouted | ri-user-search-line slate | default | "At QC2 with nobody reviewing — routing could not place them. Anyone in the pod can pick one up." | "Everything at QC2 has a reviewer." |

#### 4.4 Group table card
- Header: group icon + label + total (mono, dim); hint underneath.
- **QcQueueTable** columns: Job (title + code mono + amber "⚑ QC1 flagged" if flagged) · Stage (badge) · Deadline (relative label tone-coloured + absolute date or "—") · Video type (type pill + compact rush icon) · Client pod · Editor (or dim "No editor yet") · Rounds (badge "First pass"/"Round N") · [Action — only in Unrouted group for QC users].
- Row: tone styling (§0.7), clickable → side panel, selected row bg-pill, tooltip = tone label.
- **Claim** action (Unrouted group, QC role only): secondary button "⊕ Claim" (ri-user-add-line) → `POST /jobs/{id}/claim-qc2`; "Claiming..." while pending; inline red error (fallback "Could not claim this job."; e.g. race with another reviewer). Claimed job stays with that reviewer for later rounds.
- Loading: "⟳ Loading your queue…". Empty: inbox icon + "Nothing here." + group's empty text.
- Overflow (>25): "Showing the first 25 of {total}. The pipeline table pages through the rest."

---

### 5. VIEW: Team Capacity (`?view=capacity`)

**Who**: Sidebar link for Owner and TL ("Team Capacity", ri-team-line). Data endpoints are lead-only (others would get 403 / empty). Header "Team Capacity".
**Purpose**: Can anyone take another edit? (Editors tab) / another review? (QC tab).

Tab switch (segmented control): "✂ Editors" (ri-scissors-cut-line) / "🛡 QC" (ri-shield-check-line). In URL as `?tab=qc` (editors is default, omitted). Selected = primary fill.

#### 5.1 Editors tab
- Data: `GET /users/editor-capacity` → `EditorCapacity[] { name, open_by_pod[{pod_id,pod_name,count}], open_count, delivered_count, clean_pct (nullable), max_concurrent_jobs, free_slots, reachable_free }`.
- One glass card per editor:
  - Left: name (bold) · chip "{open_count} open" (green) · capacity chip: if free_slots = 0 → "full — {max} at a time" (rose); else "{free} free of {max}" (neutral) · optional chip "💬 reachable free" (green, ri-chat-3-line) when `reachable_free`.
  - Right: "Delivered {n}" · "Clean {pct}%" (or "—").
  - Below (if any): per-pod chips "{pod name} {count}".
- Loading: "⟳ Loading editor capacity...". Empty: "No editors found."

#### 5.2 QC tab
- Data: `GET /users/qc-load` (same `QcLoad` as §3).
- One glass card per reviewer:
  - Left: availability dot (green glow / dim) · name (dimmed if unavailable) · employment tag "FULL-TIME" / "PART-TIME" (tooltip "{capacity} QC2 points a day") · status badge:
    - unavailable → "Unavailable" (neutral)
    - idle_next → "Idle — next in line" (emerald)
    - full → "Spent out for today" (amber)
    - idle / loaded → no badge
  - Right: "Open {n}" · "{load}/{capacity} pts today" (tooltip "Points spent against today, cleared work included — the budget is daily") · "Cleared {n}".
  - **Load bar**: two segments — today (amber-400) + carried-over (rose-400/70 with diagonal stripes = warning), widths relative to capacity.
  - Detail line: "{points_today} spent today" · (rose, only if >0) "{points_carried} carried over" (tooltip "Rounds still open from an earlier day") · "{points_left} left" · "·" · per-type pills "{count} {Type}" in video-type colours · (amber, when available and can't take podcast) mic-off icon + "already has today's podcast" (part-timer holding one) or "no room for a podcast".
- Loading: "⟳ Loading QC load...". Empty: "No QC reviewers found."

---

### 6. VIEW: WhatsApp Bot placeholder (`?view=bot`)

**Who**: Owner sidebar ("WhatsApp Bot", ri-whatsapp-line). Header "WhatsApp Bot".
**Purpose**: Phase-2 placeholder — not built.
- Single card (max ~672px): neutral icon chip ri-whatsapp-line; title "WhatsApp notifications aren't connected yet"; small uppercase tag "Phase 2".
- Body: "Phase 2 sends stage hand-offs and stuck-round alerts to WhatsApp, inside Meta's 24-hour reply window with approved templates outside it. Until then, every notification lands in the in-app inbox, and there is no message log or cost data to show here."
- Footer (dim): "Spec: docs/09-integrations-future.md" (developer-facing).
- No data, no actions.

### 7. VIEW: Brand Kit picker (`?view=brandkit`)

**Who**: Owner/TL via sidebar "Brand Kit" when **no pod is selected** (with a pod selected the link goes straight to `/pods/{id}/brand-assets`). Header "Brand Kit".
**Purpose**: Explain brand kits are per-client and let user pick one.
- Card: ri-book-open-line + "Pick a client to open its brand kit".
- Text: "Briefs, SOPs, do-not lists and kits are stored per pod, because that's the unit that owns the brand context. There is no company-wide kit to show."
- Pill links, one per pod (`GET /pods`) → `/pods/{id}/brand-assets`. Hover: primary border/text.
- Empty: "No pods yet — onboard a client first and its brand kit comes with it."

---

### 8. MODAL: New Edit Jobs wizard (`?newJob=1`)

**Who**: Leads only (Owner, TL). Opened from header button "+ New Edit Job". Non-leads with `?newJob=1` see nothing. Closing removes `newJob` from URL and fully resets the wizard.
**Purpose**: Create one or many edit jobs for a client pod in one batch (often by pasting a list from WhatsApp/Slack/Drive), optionally assigning editors, channels, types, rush and dates.

**Modal**: title "New Edit Jobs", size XL. Stepper at top with 3 steps: **"Select Pod" → "Add Edits" → "Assign & Create"** (current = gradient purple circle with number; completed = green circle with check; future = grey).

**Data**: `GET /pods` (pods), `GET /users/ve-load` → `VELoad[] {user_id, name, assigned_count, completed_count, max_concurrent_jobs, free_slots}`, `GET /pods/{podId}/channels` (after pod chosen), create channel (NewChannelInline → pod channel create endpoint), submit `POST /jobs/batch`.

#### 8.1 Step 1 — Select Pod
- **Recent Pods** (only if any): heading "🕘 RECENT PODS"; grid 2 / 4 md of up to 4 tiles (stored in browser localStorage `km_recent_pods`, most recent first). Tile: folder-video icon square, pod name, status dot (green if active, amber otherwise) + status word. Click = select & go to step 2. Selected tile: purple gradient.
- **All Client Pods** heading (ri-group-line) with status filter pills on the right: `ACTIVE` (default) / `PAUSED` / `ALL`.
- Search input "Search all client pods..." + scrollable list (max ~192px) of pod rows: group icon square, pod name, status badge (active = emerald, paused = amber, else rose; lowercase word). Click = select pod, save to recents, advance to step 2.
- Empty: search-eye icon + "No pods match your search".
- No Next button; selection advances directly.

#### 8.2 Step 2 — Add Edits
- **Pod banner** (purple tint): folder icon, pod name (bold), status tag, "{n} channel(s)". Right: "+ New channel" inline creator, "← Change" (back to step 1).
- **Mode toggle** (segmented): "⊕ Single Entry" (default) / "📋 Paste Multiple".

**Single Entry mode**
- Info line: "Add edit jobs one by one. You can add more with the button below."
- Repeating row card, each with:
  - Row number
  - **Video title** — text input, placeholder "Video title". Required (rows without a title are ignored at submit).
  - **Drive link** — text input, placeholder "Drive link (optional)". Saved as a *raw* link (client footage).
  - **Video type** — select: Podcast / Long form / Short form. Default Long form.
  - **Channel** — select: "No channel" (default) + pod's channels; if pod has no channels, shows inline "+ Channel" creator instead (new channel becomes the selection).
  - **Rush toggle** — pill switch "⚡ RUSH" (off: neutral bordered; on: rose tint/text, filled bolt). aria "Mark this video urgent". Tooltip off: "Mark urgent — lets QC2 routing place this on a full reviewer rather than leaving it unrouted." On: "Urgent: if no QC reviewer has room, this can still be given to the least-loaded one instead of waiting. It does not jump the queue." Default off.
  - Delete (red trash icon) — only when >1 row.
- Dashed full-width button "+ Add Another Edit".
- Proceed allowed when at least one row has a title.

**Paste Multiple mode**
- Info line: "Paste the list from WhatsApp/Slack/Drive. Numbered or not — any line with a title and a link is picked up, and a link on its own line joins the title above it."
- Monospace textarea (~160px tall) with example placeholder:
  ```
  This Gold Pattern Hasn't Failed in 25 Years<TAB>https://drive.google.com/drive/folders/...
  Is Gold Preparing for Its Next Big Rally?<TAB>https://drive.google.com/drive/folders/...
  3. Momentum trading with Super Scalper<TAB>https://drive.google.com/drive/folders/...
  ```
- Parsing rules: a line with a URL + text → one job (title = text before URL, with list markers `1.` `2)` `-` `*` `•` `–` `—` and trailing separators stripped). A URL alone on a line attaches to the preceding title-only line. Title-only lines with no following link and bare links with no title are **skipped**. Trailing `),.;` trimmed from URLs.
- Live preview (once text entered): green badge "✓ {n} edits detected"; amber badge "⏭ {k} lines skipped" (if any); collapsible "View skipped lines" showing "L{lineNo}: {text}" in mono on amber tint.
- Proceed allowed when ≥1 edit detected. Parsed rows (defaults: Long form, no channel, not rush, no dates, no editor) replace the row list on Next.

**Navigation**: "← Back" (ghost, to step 1) · "Next: Assign VE →" (primary; disabled until proceed allowed).

#### 8.3 Step 3 — Assign & Create
- **Pod banner**: folder icon, pod name, compact "+ New channel", right-aligned green "{n} edit(s)".
- **Bulk actions toolbar**: "☐ Select All" checkbox; divider; then, only when ≥1 row selected:
  - Chip "{n} selected"
  - "BULK VE:" + VE dropdown + **Apply** (outline; disabled until a VE chosen). Fills selected rows one by one up to the editor's free slots (counting rows already lined up for them); overflow rows get no editor. If not all fit, info toast: "{Editor} has room for {filled} more — the other {n} stay unassigned and will be created in intake."
  - "BULK TYPE:" select (Podcast/Long form/Short form; default Long form) + **Apply**.
  - "BULK CHANNEL:" channel select ("No channel" + channels, or "+ Channel" creator if none) + **Apply** (only when the pod has channels). Blank clears selected rows to unfiled.
  - **"⚡ Mark rush"** (outline) — tooltip "Mark every selected row urgent". One-way (no bulk un-mark).
  - "BULK CLIENT DATE:" date input + **Apply** (disabled until date) → sets Actual deadline on selected rows.
  - "BULK TEAM DATE:" date input + **Apply** (disabled until date) → sets Deadline on selected rows.
  - **"⏮ Team date −3d"** (outline) — sets each selected row's Deadline to 3 days before its Actual deadline (only rows that have one). Disabled unless a selected row has an Actual deadline. Tooltip "Set the deadline 3 days before the actual one, on every selected row that has one".
- **Assignment table** columns:
  | Header | Content / control |
  |---|---|
  | (checkbox) | row select |
  | # | row number (mono) |
  | Title | inline-editable borderless text input |
  | Raw files | Drive link shown as Google icon + first 28 chars + "..." (opens new tab; full URL tooltip), or "—" |
  | Channel | channel select / "+ Channel" creator |
  | Video type | select |
  | Rush | Rush toggle |
  | Assigned VE | VE dropdown (below) |
  | Actual deadline | date input. Header tooltip "What the client was promised. Only you and the Owner ever see this." |
  | Deadline | date input. Header tooltip "What the team works to — the date the editor sees." Validation: if Deadline > Actual deadline, red border + tooltip "This is after the client's date — the server will refuse it" (not blocked client-side). |
- **VE dropdown** (custom searchable): trigger shows selected name or dim "Select VE..."; panel (~288px) with search "Search editors...", first option italic "— Unassigned —", then editors **with free slots only** (full editors hidden). Each option: initial avatar (gradient circle), name, badge "{free} free" (amber if ≤1 free, else emerald), "{assigned}/{max}" (dim). Selected option purple-tinted. Empty: "Every editor is at their limit — leave these in intake and assign when one delivers" (if some are full) or "No editors found".
- **Error** (ErrorNote): server message, fallback "Couldn't create these jobs — nothing was saved." Batch is all-or-nothing; wizard stays open with rows intact.
- Helper note (inbox icon, dim): "An editor and a deadline are optional — anything you leave blank is created in intake and shows up on the Intake card for the TL to assign later. The actual deadline is what you were really promised; only you and the Owner ever see it."
- **Navigation**: "← Back" (to step 2) · primary "✓✓ Assign & Create {n} Jobs" (n = rows with a title) → "⟳ Creating..." while pending. Disabled while pending or if no titled rows.
- Submit payload `POST /jobs/batch`: `{pod_id, jobs:[{title, channel_id|null, video_type, rush, raw_links:[{url}] or [], deadline|null, client_deadline|null, assigned_editor_id|null}]}`. Untitled rows dropped.
- Success: toast "{n} job(s) created in {Pod name}." and wizard closes/resets. Error toast "Couldn't create these jobs."

Field summary:
| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| Pod | single choice | yes | none | step 1 |
| Title | text | yes (row ignored if blank) | "" | |
| Drive link | text (URL) | no | "" | becomes raw link |
| Video type | select | yes | Long form | 3 options |
| Channel | select | no | No channel | can create new inline |
| Rush | toggle | no | off | |
| Assigned VE | searchable select | no | Unassigned | only editors with free slots |
| Actual deadline | date | no | blank | lead/owner-only visibility |
| Deadline | date | no | blank | must be ≤ Actual deadline (server-enforced) |

---

### 9. Job detail side panel (opened from Pipeline, QC Router, QC Queue)
`JobDetailPanel` (separate component, out of this inventory's scope) slides in when a row/card is clicked; closes via its own close control. It renders immediately from the row data, then refreshes from `GET /jobs/{id}` + `GET /jobs/{id}/events`.

---

### 10. Floating widget: Kontent Bot (`KontentBotWidget`)
**Where**: Currently mounted on the Analytics page (`/analytics`). **Who**: Leads only (Owner, TL); returns nothing for others.
- Floating round button bottom-right (56px, purple gradient, sparkle icon ri-sparkling-2-line; becomes ✕ when open). aria "Open Kontent Bot" / "Close Kontent Bot".
- Popover card (w-96, max 70vh) above it: header "✨ Kontent Bot" + link "Full page ↗" (→ `/bot`, closes popover).
- Body: compact chat thread (same `ChatThread` as `/bot`): message list, input with placeholder "Ask Kontent Bot something…"; when bot disabled: amber banner with server `reason` (plug icon) and placeholder "Kontent Bot isn't connected yet"; when daily cap hit: placeholder "Daily question limit reached" (input disabled).
- Data: `GET /chat/status` (enabled, reason, daily_cap, used_today), conversations `GET /chat/conversations…`, send `POST /api/chat` (Server-Sent Events streaming reply).

### 11. Shared widget: StatTile
Used on Analytics page (per-pod section). Glass card: uppercase dim label, big mono value (red if tone "critical"), optional muted hint line. If clickable it's a button with hover lift and tooltip.
Current uses: "First-pass rate" (value `{round(first_pass_rate*100)}%` or "—", hint "Delivered with no revision round", → pipeline delivered for pod) and "Avg QC rounds" (value 1-decimal or "—", hint "Rounds per delivered job", → pipeline status=all sorted by rounds desc).

### 12. Shared widget: BarList
Horizontal labelled bar list: label (128px, truncated, muted) · rounded track (bg-pill, 16px tall) with fill (default primary, or per-item colour; min 4% width; scaled to max value) · right-aligned mono value (custom formatter). Empty: "No data yet.".
Uses: Analytics "Stage distribution" (stage bar colours: intake gray-400, assigned/qc1/final indigo-500, editing teal-500, qc2 amber-500, revisions rose-500, delivered emerald-500), Analytics "Avg QC rounds by editor" (1 decimal), Pods `CapacityBar` (open videos per editor; rose-500 if at/over max concurrent jobs else indigo-500).

---

### 13. Toasts & error copy (this area)
- "Could not file this video." (single-row channel change failed)
- "{n} video(s) filed under {channel}[ — k already were]." / "{n} video(s) taken back out of their channels[ — k already weren't]." / "Could not file those videos."
- "Channel "{name}" is ready." / "Could not add that channel." (inline channel creator; its input placeholder "New channel for {Pod}" or "Channel name — Dhan HQ, AAD..."; Enter saves, Esc cancels; ✓ and ✕ icon buttons)
- "{Editor} has room for {x} more — the other {y} stay unassigned and will be created in intake." (info)
- "{n} job(s) created in {Pod}." / "Couldn't create these jobs." / inline "Couldn't create these jobs — nothing was saved."
- "Could not claim this job." / "Could not assign that reviewer." / "Could not save that — try again." (availability)

### 14. Design notes / observations for the redesign
- Every count tile is meant to be clickable and land on exactly the rows behind its number — keep this pattern.
- Many states are URL-addressable (view, status tab, flagged, capacity tab, deep-link filters) — the new design should keep shareable links.
- Row tone system (4 colours with strict priority) is a core visual language reused across table, board and QC lists.
- Pipeline toolbar is dense: 8 status tabs appear twice (cards + pill buttons) — a candidate for consolidation.
- Several dev-facing strings (doc paths, "Phase 2", formula block) appear in UI; designer may decide whether to keep.
- TL has no sidebar link to QC Auto-Router even though the view is permitted.
- Header title for VE's pipeline is "Pipeline Table" while the sidebar says "My Edit Pipeline".


---

## 11. Job detail (drawer + full page), stage actions, QC1 review, links, comments, timeline, activity feed


Scope: the full job page (`/jobs/:jobId`), the slide-in job inspector drawer, and every component inside them. Source files: `pages/JobDetailPage.tsx`, `components/pipeline/*` (excluding NewJobWizard), `lib/stageTransitions.ts`, `lib/format.ts`, `components/ui/RushBadge.tsx`, plus the hooks, API and types behind them.

Icons are Remix Icon (`ri-*`). Colours are CSS tokens (`--primary`, `--accent-red`, `--accent-amber`, `--accent-green`, `--text-main/muted/dim`, `--bg-pill`, `--bg-card`, `--bg-input`, `--border-color`), plus a few raw Tailwind hues (indigo, teal, amber, rose, emerald, violet, sky). The base card is `glass-card`.

---

### 0. Glossary: roles and the people on a job

| Role code | Display name | What they do on a job |
|---|---|---|
| `owner` | Owner | Admin. Leads every pod ("leadsAllPods"). The only role that gets the **admin override**. |
| `tl` | Team Lead (pod TL) | Leads specific pods (`job.tl_id`). Owns intake, QC1 and the final check. Edits job fields. A role can be *lent* (`secondary_role`), so an editor can also be a TL. |
| `qc` | QC Reviewer | Owns QC2, but only on jobs routed to them (`job.qc2_reviewer_id`). Can flag QC1. |
| `ve` | Video Editor | Owns assigned, editing and revisions, but only on jobs assigned to them, and only once "briefed". |
| `hr`, `fo`, `staff` | — | No special job-detail powers. They see the read-only view if they can open the job at all. |

The people named on a job:
- Pod TL: `tl_name`
- Editor: `editor_name` / `assigned_editor_id`
- QC2 reviewer: `qc2_reviewer_name` / `qc2_reviewer_id`

**"Lead of this pod"** means the Owner, or a user holding the TL role whose id equals `job.tl_id`. Most edit permissions below use this rule. Call it **PodLead**.

**"Briefed"** means the job has both an assigned editor and a deadline. If a job sits at an editor's stage (assigned, editing or revisions) without being briefed, it is "awaiting brief". In that state it is still the TL's move, and every "currently with" sentence names the TL.

---

### 1. Two containers, one body

Both containers render the same body component (`JobDetailContent`). Only the header differs.

#### 1a. Full page — route `/jobs/:jobId`
- Single centred column, max width about 768px (`max-w-3xl`). Sections are spaced 20px apart.
- **Header block** (bottom border, 20px bottom padding):
  1. Back link, small, muted, left arrow icon: **"Back to pipeline"**. Goes to `/?view=pipeline`.
  2. One row that wraps:
     - **Title** (H1, 24px, extra-bold): job code in monospace, dimmed and smaller (`job.code`), then " — ", then `job.title`. A pencil icon sits beside it for users who can edit (see §6.1).
     - **StageBadge** (see §2).
     - **RevisionCounter**: refresh icon + **"Round {n}"**. Dim at rounds 0–2. Red when `round >= 3`.
- Body: `JobDetailContent`.

#### 1b. Inspector drawer (`JobDetailPanel`)
Opened by clicking a row on the Dashboard pipeline, the QC Queue, the QC Router, Analytics (via JobCard) and Chat.
- A right-side drawer, full height, max width about 672px (`max-w-2xl`). It sits over a 50% black backdrop with a 2px blur. It slides in from the right (0.22s) and the backdrop fades in.
- Clicking the backdrop or pressing **Esc** closes it. Close button (X) top right, aria-label "Close panel".
- **Sticky header** (frosted `--bg-header`, bottom border, 24px × 16px padding):
  - Row 1: job code (monospace, 12px, dim), StageBadge, then right-aligned link **"Full page ↗"** (11px, external-link icon) to `/jobs/{id}`.
  - Row 2: job title (16px, extra-bold, **single line, truncated**). The pencil edit sits here too.
  - Row 3: pod name (`pod_name`), 12px, muted.
  - The drawer header has **no** revision counter. The full page header has **no** pod name (pod appears in the field grid instead).
- Loading, while there is no job yet: the header says "Loading job..." and the body shows a spinner with **"Loading job..."**.
- Body scrolls independently, with 24px × 20px padding. The drawer supports a pinned footer, but the job panel does not use it.

#### 1c. Full-page loading and error states
- Loading: spinner icon + **"Loading..."** (small, muted, not centred, no back link).
- Error: back link, then a centred card (40px padding). It contains a large red icon, a title, a body and, on API errors, a secondary button **"Try again"** (refresh icon) that refetches.

| Case | Icon | Title | Body |
|---|---|---|---|
| HTTP 404 | file-search | **That job doesn't exist** | The link may be out of date, or the job was removed. Check the pipeline for the current list. |
| HTTP 403 | lock | **You don't have access to this job** | It belongs to a pod you're not on. Ask that pod's TL to add you if you need it. |
| Other error / network | wifi-off | **Couldn't load this job** | The server didn't answer. Check your connection and try again. |
| No error but no job (no id) | file-search | **No job to show** | This link doesn't point at a job. Head back to the pipeline and pick one. (No Try again button.) |

- Events (activity) load separately. While they load, the body renders with an empty event list.
- Data does **not** auto-poll. It refreshes when a mutation invalidates the `["jobs"]` cache.

---

### 2. Stages: badge labels and colours

There are 8 stages, in pipeline order. Badges are small pills (`Badge` component) with a 10%-opacity tinted background and coloured text.

| # | Key | Badge label | Badge colour (bg / text) | Solid bar colour (charts) | Owner chip | Stage hint sentence (the "where it is now" card) | Action label when moving **into** this stage |
|---|---|---|---|---|---|---|---|
| 1 | `intake` | **Intake** | neutral pill bg / muted text | gray-400 | TL | Intake — brief is in, no editor picked yet. | "Back to intake" (defined but never offered) |
| 2 | `assigned` | **Assigned** | indigo-500/10 / indigo-400 | indigo-500 | VE | Assigned — waiting for the editor to start. | **Assign to editor** |
| 3 | `editing` | **Editing** | teal-500/10 / teal-500 | teal-500 | VE | Editing. | **Start editing** (or **Start on the changes** from revisions) |
| 4 | `qc1` | **QC 1** | indigo-500/10 / indigo-400 | indigo-500 | TL | QC1 — first-pass review with the pod TL. | **Mark as edited — send for QC** (or **Re-submit fixed cut for QC** on round ≥1) |
| 5 | `qc2` | **QC 2** | amber-500/10 / amber-500 | amber-500 | QC | QC2 — second-pass review with the QC team. | **Pass QC1 — send to QC2**. In practice it is replaced by the two QC1 outcome buttons; see §5. |
| 6 | `revisions` | **Revisions** | accent-red-bg / accent-red | rose-500 | VE | Revisions — back with the editor for the change list. | **Send back with changes** |
| 7 | `final` | **Final check** | indigo-500/10 / indigo-400 | indigo-500 | TL | Final check — last look by the TL before the client sees it. | **Clear QC2 — send to final check** |
| 8 | `delivered` | **Delivered** | accent-green-bg / accent-green | emerald-500 | TL | Delivered to the client. | **Mark delivered** |

Notes:
- Assigned, QC 1 and Final check share the same indigo badge. The colours alone do not tell them apart, so a redesign may want to fix this.
- Owner chip colours (used in the timeline): TL is indigo, VE is teal, QC is amber. These match the role colours used across the app.

#### "Scrapped" is not a stage
- Scrapping sets `scrapped_at`, `scrapped_by_id` and `scrap_reason`. The job **keeps the stage it died at**, and the StageBadge still shows that stage. No "Scrapped" badge exists in this area.
- Scrapped state shows through:
  - a red **ScrappedBanner** at the top of the body
  - the hidden status card
  - the hidden "Your next step" section
  - the final section, retitled "Scrapped"
- The red-tinted styling uses `accent-red` with a 35% border and the `accent-red-bg` fill.

#### QC1 flag (also not a stage)
`qc1_flagged_at` is a statement that a QC reviewer says QC1 was rubber-stamped. It is shown as an amber banner and amber panel (see §8).

---

### 3. Body layout, top to bottom (`JobDetailContent`)

Vertical stack, 16px gaps. A "Section" is a glass card with 16px padding, a 14px bold heading and a primary-coloured icon before the heading.

| Order | Block | Shown when | Heading / icon |
|---|---|---|---|
| 1 | ScrappedBanner | `scrapped_at` set | (banner) |
| 2 | Qc1FlagBanner | `qc1_flagged_at` set | (banner) |
| 3 | "Where it is now" status card | not scrapped | (no heading) |
| 4 | Fields grid ("who, what, when") | always | (no heading, glass card) |
| 5 | Files on this job | always | **Files on this job** · links icon |
| 6 | Delivery checklist | stage = final AND user is any lead (Owner or holds TL) AND not scrapped | (own card) "Delivery checklist" |
| 7 | Your next step | not scrapped | **Your next step** · flashlight icon |
| 8 | Who's on it (reassign) | PodLead AND has an editor AND not scrapped AND not delivered | **Who's on it** · user-shared icon |
| 9 | How urgent (rush) | PodLead AND not scrapped AND not delivered | **How urgent** · flashlight icon (same icon as #7) |
| 10 | Which channel | PodLead AND not scrapped | **Which channel** · play-list icon |
| 11 | How QC1 went | job is flagged OR stage ∈ {qc2, final, delivered} | **How QC1 went** · shield-check icon |
| 12 | Change list & comments | always | **Change list & comments** · chat-check icon |
| 13 | Pipeline progress (timeline) | always | **Pipeline progress** · route icon |
| 14 | Activity | always | **Activity** · history icon |
| 15 | Danger zone / Scrapped | PodLead | **Danger zone** (live) or **Scrapped** (scrapped) · close-circle icon |

A non-lead (editor or QC) usually sees blocks 3, 4, 5, 7, (11), 12, 13 and 14.

---

### 4. Status card and field grid

#### 4.1 "Where it is now" card (block 3)
Rounded box with a primary-tinted border (28%) on the pill background.
- Line 1 (14px): the stage hint sentence from the table in §2.
- Line 2 (12px, muted):
  - If delivered: **"Delivered {date-time}"** from `delivered_at`.
  - Otherwise: **"Currently with {Holder}"**, with the holder's name bold. If `round > 0`, it appends " · round {n}".
- **Holder resolution** (`stageHolder.ts`):
  - At qc2: the QC2 reviewer's name.
  - At VE stages: the editor's name. If the job is not yet briefed, it is the TL's name instead.
  - At TL stages: the TL's name.
  - If the name is missing, the fallback is "the pod TL", "the editor" or "the QC team".

#### 4.2 Fields grid (block 4)
Glass card, 2 columns (3 at the `sm` breakpoint and up), 16px gap. Each field has an uppercase label (10px, bold, tracking-wide, dim) and a value below it (14px, semibold, single line truncated). Editable fields show a pencil on the label to PodLead users only (see §6). Fields in order:

| # | Label | Source | Formatting / empty state |
|---|---|---|---|
| 1 | **Client pod** | `pod_name` | plain |
| 2 | **Channel** ✎ | `channel_name` | Dim "Not filed" if null |
| 3 | **Editor** | `editor_name` | "Not assigned" |
| 4 | **QC reviewer** | `qc2_reviewer_name` | "Not routed yet" |
| 5 | **Pod TL** | `tl_name` | "—" |
| 6 | **Video type** ✎ | `video_type` | Icon + label: Podcast (mic icon), Long form (film icon), Short form (smartphone icon). The **RushBadge** follows when the job is rush. |
| 7 | **Revision rounds** | `round` | Integer. Red when ≥3. |
| 8 | **Came in** | `created_at` | date-time, e.g. "2 Aug, 4:15 pm" |
| 9 | **Deadline** ✎ | `deadline` | Full date "2 Aug 2026"; "None set" if null |
| 10 | **Actual deadline** ✎ | `client_deadline` | **Only rendered to PodLead.** The server strips the field for everyone else. Shows the full date or "None set", plus an inline buffer: " · {n} day(s) of buffer" (dim), or " · no buffer" (amber) when it is ≤0 days. No buffer text appears if either date is missing. |
| 11 | **Status** | derived from `deadline` and stage | See the deadline status table below. |

**Deadline status** (`deadlineInfo`), with colour tones:

| Condition | Label | Tone colour |
|---|---|---|
| No deadline | "No deadline" | dim |
| Stage is delivered | "Delivered" | green |
| Past due | "Overdue by {n} day" / "days" | red |
| Due today | "Due today" | amber |
| Due tomorrow | "Due tomorrow" | amber |
| 2–3 days away | "{n} days left" | amber |
| More than 3 days away | "{n} days left" | muted |

#### 4.3 RushBadge (`components/ui/RushBadge.tsx`)
- Renders nothing if the job is not rush.
- Otherwise it is a small rounded chip: rose-500/15 background, rose-400 text, bold uppercase, a filled flashlight icon and the word **"RUSH"**. The compact variant shows the icon only.
- Tooltip: *"Marked urgent: QC2 routing may place this on a reviewer who is already out of points, rather than leaving it unrouted. It does not jump the queue."*

#### 4.4 Date and time formats (`lib/format.ts`, browser locale)
- `formatDate`: "2 Aug" (no year). Null shows "—".
- `formatFullDate`: "2 Aug 2026". Used for deadlines.
- `formatDateTime`: "2 Aug, 4:15 pm". Used for the timeline, activity tooltips, notes and banners.
- `formatDuration` (seconds): "45s", "12m", "2h 14m", "3d 4h". At most two units. Under a minute shows seconds rather than "0m".
- `timeAgo`: "just now" (<60s), "{n}m ago", "{n}h ago", "{n}d ago" (<30d). Older dates fall back to "2 Aug".
- `deadlineBuffer`: "{n} day(s) of buffer" or "no buffer".

---

### 5. "Your next step": stage transitions (`AdvanceStageControl`)

#### 5.1 The state machine
- Forward path: intake → assigned → editing → qc1 → qc2 → final → delivered.
- **Send-back**: from qc1, qc2 or final, the job can go to **revisions**. This requires a change-list note, and the server increments `round`.
- **revisions → editing** is the only exit from revisions ("Start on the changes").
- **editing → wherever it was sent back from**. The server records `sent_back_from` (qc1, qc2 or final). With no send-back history, editing goes to qc1.
- delivered: no moves.
- Scrapped: the whole section is hidden.

#### 5.2 Who is offered which buttons
The server re-checks everything; the UI only hides buttons it knows will fail.

| Current stage | Moves | Offered to (default) |
|---|---|---|
| intake | → assigned | Owner; TL of this pod (or any TL if the job has no `tl_id`) |
| assigned | → editing | Assigned editor, **only if briefed** |
| editing | → qc1 / qc2 / final (resubmit target) | Assigned editor, if briefed |
| qc1 | → qc2 (two outcome buttons), → revisions | Owner; pod TL |
| qc2 | → final, → revisions | The QC reviewer routed to this job (`qc2_reviewer_id` = me) |
| revisions | → editing | Assigned editor, if briefed |
| final | → delivered, → revisions | Owner; pod TL |
| delivered | none | — |

- A person can hold multiple roles, for example an editor with a lent TL role. They get the union of the buttons for each role.
- The Owner and TLs are **not** offered moves on stages owned by the editor or QC. For the Owner only, an **Admin override** toggle reveals them (see §5.8). TLs never get the override.

#### 5.3 States of the section
**A. Awaiting brief** (an editor's stage with no editor or no deadline, and no buttons for this user): render **BriefGate** (§5.9) and, if available, the override toggle.

**B. Nothing for you to do.** One line with a clock icon (or a green filled check if delivered):
- Shows the stage hint sentence.
- If not delivered, it adds: *"Nothing for you to do here — it sits with **{Holder}**. You can still leave a comment below."*
- Then the override toggle, if available.

**C. Starting an edit (compact mode).** Applies when the only move is → editing: assigned → editing, or revisions → editing.
- An error note, if any.
- Primary button with a scissors icon: **"Start editing"**. When stage = revisions, it reads **"Start on the changes"**.
- Small text toggle: **"Add a note or link"** (plus icon), or **"Hide the note and link"**. Opening it reveals the Frame link field and the Note field (§5.5).
- Override toggle.
- No confirmation: one click moves the job.

**D. QC1 desk** (stage qc1 and → qc2 offered). Two forward buttons side by side:
- Primary, shield-check icon: **"QC1 Approved"**. Sends to qc2 with outcome `approved`.
- Secondary, chat icon: **"QC1 Comments Added"**. Sends to qc2 with outcome `comments_added`.
- Helper (11px, dim): *"Both send the cut on to QC2. Pick **Comments added** when you have left notes on Frame.io — it is the only way QC2 can tell a reviewed cut from a waved-through one, and it keeps a real review off the flag list."*
- Text toggle **"Add a note for {QC2 reviewer or 'the QC team'}"** / **"Hide the note"**. It reveals the Note field.
- The send-back is a **small text link**, not a button: undo-arrow icon, **"Send back to {editor name or 'the editor'} instead"**, hovers red. Clicking it switches to send-back mode (§5.6).
- The QC1 desk has **no** Frame link field.
- No confirmation dialogs.

**E. Generic form.** Used for intake → assigned, editing → qc*, qc2 and final. In order:
1. **Frame link field.** Label "FRAME.IO / WORKING FILE LINK", placeholder "https://f.io/...". Starts empty, optional, and is sent with any move.
2. *(Intake only)* the **editor assignment block** (§5.4).
3. **Note field** (§5.5).
4. Error note.
5. Button row:
   - One primary button per forward move, with the label from the §2 table or the resubmit variants below.
   - If a send-back is allowed: a secondary button **"Send back with changes"** (undo icon).
6. Send-back mode (§5.6) replaces the forward buttons.
7. With the override active, an amber warning line (unlock icon): *"These moves belong to {Holder}. Making one puts your name on the record for it."*
8. Override toggle.

**Button labels when leaving editing (resubmits):**
- First cut (round 0) → qc1: **"Mark as edited — send for QC"**
- Round ≥1 → qc1: **"Re-submit fixed cut for QC"**
- → qc2 (QC2 had sent it back): **"Re-submit fixed cut to QC2"**
- → final (the final check had sent it back): **"Re-submit fixed cut for the final check"**
- Icon: send-plane for all of them.

**Other icons:**

| Button | Icon |
|---|---|
| Assign to editor | user-add |
| Start editing | scissors |
| Pass QC1 | shield-check |
| Send back | undo arrow |
| Clear QC2 — send to final check | double check |
| Mark delivered | rocket |

#### 5.4 Intake: assign to editor (hand-off)
- If every editor is at capacity, an amber notice (user-forbid icon) replaces the picker: *"Every editor is at their limit right now — this one waits in intake until somebody delivers."*
- Otherwise:
  - **Select** with placeholder option **"Assign to editor..."**. Options read "{Editor name} — {n} free". The list holds active editors with free slots only; full or deactivated editors are hidden.
  - **Deadline** date input, labelled "DEADLINE". It is prefilled with the job's existing deadline if there is one.
    - If the job has an actual (client) deadline, a pill above the input shows a flag icon and *"Client wants this by **{2 Aug 2026}**"*.
    - Helper: *"This is the date the editor sees. They can't start until it's set — without it the job stays with you."*
    - Live buffer line as the date is typed: *"Leaves you {n} day(s) of room."* (dim), or *"No room left between this and the client's date."* (amber).
- **Validation:** "Assign to editor" stays disabled until both an editor and a deadline are chosen.

#### 5.5 Note field (on every forward move)
- Label:
  - **"Note for {next holder} (optional)"**. At intake, the next holder is the picked editor's name, or "the editor you pick".
  - **"Note on the job (optional)"** if the next holder is the current user.
- Textarea, 2 rows. Placeholder: *"Anything {next holder} should know before they pick this up"*, or the self version *"Anything worth putting on the record as you move this"*.
- Helper: *"Goes on the change list below with your name on it, and is the first thing {next holder} sees on the job."* Self version: *"Goes on the change list below with your name on it — everyone on the job sees it."*

#### 5.6 Send-back mode (→ revisions)
- The note field turns into **"Change list for {editor name or 'the editor'}"**. It is a textarea (4 rows) and gets focus automatically.
- Placeholder: *"What needs to change? Timestamps help — 0:14 lower third off-brand, 0:42 audio dips..."*
- Buttons:
  - Danger (red): **"Send back to {editor}"** (undo icon). **Disabled until the note is non-empty.**
  - Ghost: **"Cancel"**. It clears the note and leaves send-back mode.
- While the note is empty: *"A send-back needs a change list — the editor picks the job up from this note."*
- On success, the note clears and the job moves to Revisions; the server increments the round.

#### 5.7 Errors and pending
- All buttons are disabled while a move is pending.
- On failure, a red inline ErrorNote shows the server's `detail` message. Fallback: *"Could not move the job — the server rejected that transition."*
- A red toast also appears, with fallback "Could not move the job."
- The typed note and link are kept so the user can retry.

#### 5.8 Admin override (Owner only)
- A small dim text button. Locked: lock icon + **"Admin override — move it anyway"**. Unlocked: unlock icon + **"Hide the moves that aren't yours"**.
- It appears only when it would reveal extra moves.
- When it is active, the generic form shows the amber warning from §5.3 E.

#### 5.9 BriefGate (an editor's stage, no deadline)
**Non-fixer view** (editor, QC, or a TL of another pod). One line with an amber calendar-close icon:
- To the assigned editor: *"Not on your plate yet — this one has no deadline. **{TL}** sets one, and then it comes to you. Nothing to start against no date."*
- To others: *"No deadline on this job yet, so it hasn't gone to the editor. **{TL}** has to set one first."*

**Fixer view** (Owner, or the pod's TL):
- Message: *"**{Editor}** is on this one but cannot start it: there is no deadline. It stays with you until there is."* With no editor: *"This one has no editor and no deadline on it yet. It stays with you until there is."*
- **Deadline** date input. It has the same "Client wants this by …" pill and buffer line as §5.4.
- Error fallback: "Could not set the deadline."
- Primary button (calendar-check icon): **"Set the deadline — hand it over"**. Disabled until a date is chosen.

#### 5.10 Delivery checklist (block 6, `ChecklistToggle`)
- Shown at stage **final** to any lead (Owner, or anyone holding TL). This check is looser than PodLead.
- Glass card with the title **"Delivery checklist"** (list-check icon). It has two checkboxes, and each saves immediately on toggle with no Save button:
  - **"Client sheet updated"** (`client_sheet_ok`)
  - **"Ops tracker updated"** (`ops_tracker_ok`)
- Footnote: *"Both must be checked before this job can be delivered — see docs/03-data-model.md."* This is internal-facing copy that a redesign may want to rewrite.
- The UI does **not** disable "Mark delivered" when the boxes are unchecked. The server rejects the move instead, and the user sees an error note.
- There is no loading or error display on the toggles.

---

### 6. Edit controls (inline field edits)

**Who can edit:** PodLead (the Owner, or this pod's TL), and only while the job is not scrapped. Everyone else sees static text with no pencil. Every edit is a `PATCH /jobs/{id}` and creates a `job_updated` activity event.

**Pattern:** the pencil icon sits at 50% opacity next to the label and goes to 100% on hover. Clicking swaps the value for a small inline editor with a close (X) button.

| Control | Location | Editor | Save behaviour | Clearing | Error copy |
|---|---|---|---|---|---|
| **Title** (`EditableTitle`) | Page H1 and drawer header | Text input, autofocus, prefilled | Save button or Enter; Cancel button or Esc. Empty or unchanged closes without saving. Save is disabled when empty. | Cannot be cleared | "Could not rename this job." |
| **Channel** (`ChannelField`) | Fields grid | Select with "Not filed" plus the pod's channels | **Saves on selection** | Choose "Not filed" | "Could not file this job." If the pod has no channels: *"{Pod} has no channels yet — add one under "Which channel" below."* |
| **Video type** (`VideoTypeField`) | Fields grid | Select: Podcast / Long form / Short form | **Saves on selection** | Not clearable | "Could not change the video type." |
| **Deadline** (`DeadlineField`) | Fields grid | Date input, then a **Save** button and a **"No deadline"** text link (red on hover; empties the draft) | Explicit Save or Enter; Esc cancels. Unchanged closes without saving. | "No deadline" then Save | "Could not change the deadline." |
| **Actual deadline** (`ClientDeadlineField`) | Fields grid (PodLead only) | Date input + helper *"Only you and the Owner see this. The team works to the deadline above."* + **Save** + **"None"** link | Same as Deadline | "None" then Save | "Could not change the actual deadline." |

Errors show both inline and as a toast.

#### 6.1 "Which channel" section (block 10, `ChannelControl`)
This duplicates the Channel field edit and adds channel creation.
- Full-width select. The first option is **"Not filed under a channel"**, followed by the pod's channels. It saves on change.
- Text link **"+ New channel for {Pod name}"** opens an inline box with:
  - Input with placeholder *"Channel name — Dhan HQ, AAD..."* (Enter submits)
  - Primary button **"Add and file this job"** (disabled when empty), which creates the channel and files the job under it
  - **"Cancel"**
- If the pod has no channels: *"{Pod} has no channels yet. Add one and every job for this client can be filed under it."*
- Errors: "Could not file this job." / "Could not add that channel."

#### 6.2 Rush (block 9, `RushControl`)
Shown to PodLead on live, undelivered jobs.
- Explanatory paragraph:
  - When not rush: *"An ordinary job. Mark it rush when a client escalates one that is already moving: QC2 routing may then place it on a reviewer who is out of points, up to 125% of their day. It does not jump a queue and does not change what the review costs."*
  - When rush: *"Marked urgent. Everyone on the job sees it, and QC2 routing may place this on a reviewer who is already out of points — up to 125% of their day — rather than leave it waiting for somebody to free up."*
- Toggle button:
  - Not rush: primary, filled flashlight icon, **"Mark this job rush"**.
  - Rush: secondary, outline flashlight icon, **"Remove the rush flag"**.
  - No confirmation.
- Extra hint when the job is not rush, at qc2, with no reviewer (user-search icon): *"This one is waiting for a reviewer right now — marking it rush re-runs the routing immediately, and it lands on the least-loaded reviewer if it fits inside their 125%."*
- Footer: *"Goes on the record with your name on it — "who called this urgent" is the first question asked when somebody ends the day over their budget."*
- Errors: "Could not change the rush flag." (inline), and a toast "Could not turn rush on/off."

#### 6.3 Reassign editor (block 8, `ReassignEditorControl`)
Shown to PodLead when the job has an editor and is not scrapped or delivered. It is an inline expanding panel, not a modal.

**Collapsed:**
- Text link with user-shared icon: **"Reassign to another editor"**
- Helper: *"{Current editor} has this one. Moving it needs a reason, and both of them are told."*

**Expanded** (primary-tinted bordered box):
- Heading **"Hand this job to someone else"**
- Description: *"It stays exactly where it is in the pipeline — {Stage label}[, round n] — and only the name on it changes. {Current editor}, the new editor and the pod TL are all told, and the handover goes on the job's record with your reason on it."*
- **New editor** select:
  - Placeholder "Pick an editor...".
  - Options read "{Name} — {open} open · {free} free".
  - The list holds **all active editors company-wide** with free slots, excluding the current one.
  - If no one qualifies: *"Every editor is at their concurrent limit right now. Wait for a delivery to free a slot, or raise someone's limit on the admin screen."*
  - Helper: *"Anyone can take it. An editor who isn't on this pod yet joins it when you hand it over."*
- **Why is it moving?** textarea (3 rows, autofocus):
  - Placeholder *"Out sick until Monday, week is full, brand needs someone certified on it..."*
  - Helper: *"Goes on the timeline with your name on it. This is the only place the handover is ever explained — "capacity" tells the next reader nothing."*
- Buttons:
  - Primary **"Move to {chosen name or 'the new editor'}"**, disabled until an editor is picked **and** the reason has ≥10 characters.
  - Ghost **"Cancel"**.
- While the reason is too short: *"A reason is required — at least 10 characters."*
- Errors: inline and toast, "Could not reassign this job." The form stays open on error.
- The capacity and user data are fetched only once the panel is opened.

#### 6.4 Scrap / restore (block 15, `ScrapJobControl`)
Shown to PodLead. Inline, not a modal.

**Live job, collapsed:**
- Section title "Danger zone". Contents: a deliberately quiet dim text link (close-circle icon, red on hover), **"Scrap this project"**.

**Expanded** (red-tinted box):
- Heading **"Scrap this project"**
- Body: *"It stops counting as work — out of the pipeline, out of everyone's load, out of the overdue and first-pass numbers — and stays on the record with your name on it. The editor, the QC reviewer and the pod TL are told. It can be restored."*
- **Why is it being scrapped?** textarea (3 rows, autofocus):
  - Placeholder *"Client cancelled the campaign, brief withdrawn, shoot never happened..."*
  - Helper *"Read months from now by someone who wasn't in the conversation. Name the decision, not just the outcome."*
- Buttons:
  - Danger **"Scrap {JOB-CODE}"**, disabled until the reason has ≥10 characters.
  - Ghost **"Cancel"** (clears the reason).
- Validation: *"A reason is required — at least 10 characters."*
- Error: "Could not scrap this project."

**Scrapped job:**
- The section title becomes "Scrapped".
- Secondary button (undo icon) **"Restore this project"**. One click, with no confirmation and no reason asked.
- Helper: *"It comes back at {intake / the {stage} stage}, with its {n} revision round(s) intact — the work stands where it stopped."* The raw stage key is used here, e.g. "the qc2 stage", not "QC 2".
- Error: "Could not restore this project."

**ScrappedBanner** (block 1, visible to everyone):
- Red-tinted box. Title (filled close-circle icon): **"This project was scrapped"**.
- Body: *"{Name or 'Someone'} scrapped it on {date-time}, at the {raw stage key} stage[ after {n} revision round(s)]. No further work can be logged against it."*
- Then the reason, in a quote block with a red left border.

**Effects of scrapping elsewhere on the panel:**
- The status card and "Your next step" are hidden.
- Field pencils disappear.
- Rush, Reassign and Channel are hidden.
- Link add and remove are hidden.
- The QC1 flag button is hidden.
- The checklist is hidden.

---

### 7. Files on this job (`JobLinksPanel`, block 5)
- Loading: *"Loading links..."* (12px, dim).
- Two lists, stacked:

| Kind | List title (uppercase, with count "(n)") | Icon | Who can add | Add link label | Empty (viewer) | Empty (can add) | URL placeholder | Title placeholder |
|---|---|---|---|---|---|---|---|---|
| `raw` | **Raw files** | folder-video | PodLead | **"+ Add raw files"** | *"Nothing here yet — the TL adds the client's footage."* | *"Add the folders the client sent. A shoot is usually more than one."* | https://drive.google.com/... | *"What is it? A-roll, B-roll, graphics..."* |
| `video` | **Cuts** | film | Assigned editor only | **"+ Add a cut"** | *"No cut yet — it appears here when the editor sends one for QC."* | *"Your exports land here when you send a cut for QC. Add another any time."* | https://f.io/... | *"Which cut is this?"* |

- **Link row** (bordered card):
  - Optional bold title (12px), then the URL truncated (11px, muted).
  - Outlined button **"Open ↗"** opens the link in a new tab.
  - Trash icon button, red on hover. Tooltip: "Remove — added by {name}". It shows if the user added the link, or is PodLead. **It deletes immediately, with no confirmation.**
- **Add form** (inline box, pill background): URL input (autofocus), optional title input, error note, then a primary **"Add"** button (link icon, disabled when the URL is empty) and **"Cancel"**.
- No URL format validation; the server decides.
- Errors: "Could not add that link." and "Could not remove that link." (toast).
- All add and remove controls are hidden on scrapped jobs.
- Frame links entered on stage moves (§5) are separate from this panel.

---

### 8. QC1 review evidence and flag (`Qc1ReviewPanel` + `Qc1FlagBanner`)

#### 8.1 Visibility
The section (block 11, "How QC1 went") appears when the job is flagged **or** the stage is qc2, final or delivered.

#### 8.2 States
- Loading: spinner + *"Reading the log..."*
- No pass on record: *"This job hasn't been through QC1 yet — there's nothing to show until the pod TL passes it to QC2."*

#### 8.3 Evidence grid
2 columns, or 4 at `sm`. Stat tiles use the same label/value style as the fields grid.

| Label | Value | Warning (amber) when |
|---|---|---|
| **Cleared by** | `cleared_by_name` or "Someone" | — |
| **When** | `cleared_at`, as a date-time | — |
| **Sat at QC1 for** | `formatDuration(seconds)`; if unknown, "Not on the log" (never "0s") | under 120 seconds |
| **Notes left here** | "None" or the count | the count is 0 and the outcome is not "comments added" |

#### 8.4 "How it was passed" row
- `approved`: green shield-check icon + **"Approved — nothing raised"**
- `comments_added`: primary chat icon + **"Comments left on Frame.io"**
- Null (legacy): dim *"Not recorded — passed before this was asked"*

#### 8.5 Footnote
11px, dim: *"Elapsed time between the cut arriving at QC1 and being passed on, and anything said while it was there — including the note attached to the hand-off. Comments written on Frame.io are not counted here; the line above is the only record that they exist. Round {n}."*

#### 8.6 Flag flow
**Who can flag:**
- The QC reviewer routed to this job, or the Owner.
- Not the person who cleared that QC1 pass.
- Not on scrapped jobs.
- The pod TL and the editor cannot flag.

**"Looks unreviewed" nudge.** Shown when the outcome is not comments_added, there are 0 comments, and the pass took less than 120 seconds. It is an amber box: *"Passed in {duration} with nothing said. That's usually a cut that went straight through — but not always, so it's your call."*

**Collapsed trigger:** dim text link, flag icon, amber on hover: **"Flag: QC1 wasn't done"**.

**Expanded form** (amber-tinted box):
- Heading **"Flag this QC1 as not done"**
- Body: *"{Cleared-by name or 'Whoever cleared it'} and the pod TL are told, and the job is marked on every list until it's cleared. Nothing about the job itself moves — carry on with your QC2 review as normal."*
- **What did you find?** textarea (3 rows, autofocus):
  - Placeholder *"Passed in 30 seconds with no notes — the hook is still 4:5, the do-not list says 9:16..."*
  - Helper *"This names a colleague, so name what you found. Something they can answer beats "QC1 not done"."*
- Buttons: Danger **"Raise the flag"** (flag icon), disabled until the reason has ≥10 characters; Ghost **"Cancel"**.
- Validation: *"A reason is required — at least 10 characters."*
- Error: "Could not raise this flag." (inline and toast). The form stays open with the text intact.

#### 8.7 Flagged state inside the panel
Amber box replacing the flag trigger:
- Title (filled flag icon): **"QC1 flagged as not done"**
- Body: *"{Flagged-by or 'A reviewer'} raised this on {date-time} against {TL name or 'whoever cleared QC1'}. They and the pod TL were told."*
- The reason, in a quote block with an amber left border.
- **Clear button** (secondary, undo icon), shown to the flagger or the Owner. The label is **"Withdraw this flag"** if the user is the flagger, otherwise **"Dismiss this flag"**. No confirmation and no reason asked.
  - Helper: *"The job stops being tinted, and both the flag and the clearing stay in the timeline — "raised and withdrawn an hour later" is worth being able to read."*
  - Error: "Could not clear this flag."
- The TL it names cannot clear it.

#### 8.8 Qc1FlagBanner (block 2, visible to everyone)
- Amber box. Title: **"QC1 was flagged as not done"**
- Body: *"{Flagged-by or 'A QC reviewer'} says this cut went past QC1 without a review[, by {TL}] — {date-time}."*
- The reason, in an amber quote block.

---

### 9. Change list & comments (`ChangeRequestList`, block 12)
A threaded, **chronological (oldest first)** view of everything a human typed.

#### 9.1 What appears
It is filtered from the event log to three types: `changes_raised`, `note_added` and `job_reassigned`. Notes attached to forward moves are recorded as `note_added`.

#### 9.2 Empty state
*"Nothing written on this job yet — no change requests, a clean run so far. Start the thread below."*

#### 9.3 Card types
| Event | Header label | Icon | Card style |
|---|---|---|---|
| changes_raised | **"Changes requested"** (red, bold) | warning | Red-tinted bg and border. The **latest** card gets an extra red ring if it is a change request ("this is what the editor is working from"). |
| job_reassigned | **"Handed to {to editor}"**, then muted "from {from editor}" | user-shared | Neutral card |
| note_added | **"Note"** | chat | Neutral card |

#### 9.4 Header meta and body
- Header meta, inline: "at {Stage label}", from the payload's `from_stage` or `stage`. Then "round {n}" in monospace if n > 0.
- Right-aligned, monospace 10px: "{Actor or 'Someone'} · {date-time}".
- Body: the full text with line breaks preserved (`note` or `reason`).

#### 9.5 Compose box (always shown, any role)
- Label **"ADD A COMMENT"**. Textarea (2 rows), placeholder *"Ask a question, flag something, or leave context — without moving the job."*
- Footer:
  - Left: *"Whoever the job is with right now gets notified. ⌘/Ctrl + Enter to post."*
  - Right: primary button **"Post comment"** (send icon). While posting it shows a spinner and **"Posting..."**. Disabled when empty.
- ⌘/Ctrl+Enter submits.
- Error: *"Could not post that comment — nothing was saved, try again."*
- Not hidden on scrapped jobs; the server may refuse.

---

### 10. Pipeline progress timeline (`JobTimeline`, block 13)
A vertical "ladder" of all 8 stages, always in canonical order.

**Left rail:** a 16px circle per stage, joined by a 1px connector line.

| Stage state | Circle | Connector below |
|---|---|---|
| Current | Filled primary, white, with a 4px primary glow ring | default border colour |
| Done (entered at some point and not current) | Filled green with a check | green, 45% opacity |
| Not reached | Hollow, border colour | default border colour |

**Row left side:**
- Stage label. Current is primary-light, done is main text, not reached is dim.
- On Revisions with `round > 0`: a red monospace **"×{round}"**.
- On the current stage: a pill **"HERE NOW"** (primary glow background, 10px uppercase).
- Below the label, an owner chip **TL / VE / QC** in the role colours (§2).

**Row right side** (right-aligned, max 45% width):
- Date-time the job **last** entered that stage (monospace 11px), or "—".
- Below it, the actor's name with a user icon, or an italic dim **"system"** if there is no actor.
- Tooltip: "Created by {actor}" for intake, "Moved to {Stage} by {actor}" otherwise.

**Data rules:**
- Intake uses the `intake` event, or falls back to `created_at`. Other stages use the latest `stage_changed` event targeting them.
- After loops, later stages entered in an earlier round show as "done" even though the job is currently earlier in the pipeline.
- Skipped stages, such as revisions on a clean run, show as not reached even though later stages are done.

---

### 11. Activity feed (`ActivityFeed`, block 14)
**Reverse-chronological** (newest first) list of every event.

**Empty state:** *"Nothing logged on this job yet — every move, note and edit shows up here."*

**Row layout:**
- A 2px left border line; small vertical padding.
- Line 1 (single line, truncated): event icon (red for "bad news" events, otherwise dim), **actor name** in bold (or "Someone"), then the verb phrase.
- Optional line 2, the detail: indented 22px, 12px muted, truncated. The full text is in the tooltip.
- Right side: relative time in monospace ("3h ago"). The tooltip shows the full date-time.

| event_type | Verb phrase | Icon | Red? | Extra on line 1 | Detail line 2 |
|---|---|---|---|---|---|
| `intake` | Job created | add-circle | no | — | — |
| `stage_changed` | Moved | arrow-right | no | " → {Stage label}" in primary-light | — |
| `changes_raised` | Raised changes | error-warning | **yes** | — | First line of the note, in curly quotes |
| `note_added` | Left a note | chat | no | — | First line of the note, quoted |
| `job_updated` | Edited the job | pencil | no | — | Unquoted prose, e.g. "deadline 5 Aug 2026 → 8 Aug 2026 · rush off → on" |
| `job_reassigned` | Reassigned the job | user-shared | no | " → {to editor}" | Unquoted: "{From} → {To} · "{first line of reason}"" |
| `job_scrapped` | Scrapped the project | close-circle | **yes** | — | Reason first line, quoted |
| `job_restored` | Restored the project | undo | no | — | Reason first line, quoted (if any) |
| `qc2_claimed` | Claimed QC2 | user-follow | no | — | — |
| `qc1_flag_raised` | Flagged QC1 as not done | flag | **yes** | — | Reason first line, quoted |
| `qc1_flag_cleared` | Cleared the QC1 flag | flag-off | no | — | Reason first line, quoted (if any) |
| *(unknown)* | event_type with underscores replaced by spaces | record-circle | no | — | — |

**`job_updated` field wording:**

| Field | Wording | Values |
|---|---|---|
| title | "title" | as written |
| weight | "weight" | as written |
| deadline | "deadline" | ISO dates are shown as full dates |
| client_deadline | "actual deadline" | Leads only; the server redacts it for others |
| frame_link | "working file link" | Any value is shown as "a new link" |
| assigned_editor_id | "editor" | Any value is shown as "someone else" |
| video_type | "video type" | raw value (e.g. "long_form") |
| rush | "rush" | "on" / "off" |
| any other field | underscores replaced by spaces | — |

- Null or empty values read "not set".
- Several changed fields are joined with " · ".

---

### 12. JobCard (list row used on Analytics)
- Full-width row, hover pill background, 12px vertical padding.
- Left side:
  - Line 1: monospace code + " — " + title (truncated, 14px semibold).
  - Line 2: RevisionCounter ("Round n", red at ≥3).
- Right side: StageBadge.
- If the row is given a selection handler, it is a button that opens the drawer. Otherwise it links to `/jobs/{id}`.

---

### 13. Shared feedback patterns
- **ErrorNote**: inline red pill (warning icon, 12px). Shows the server's `detail` string, or the listed fallback.
- **Toasts**: errors are also pushed as red toasts that auto-dismiss after 6s.
- **Buttons** come in four variants: primary, secondary, ghost and danger. All are disabled while their mutation is pending. Only "Post comment" shows a spinner label.
- **No modals or confirmation dialogs anywhere in this area.** Every risky flow (scrap, reassign, flag, send-back) is an inline expanding box that requires typed text. Restore, Dismiss/Withdraw flag, link delete, rush toggle, checklist and all forward moves are one-click.
- **Minimum text:**
  - Scrap reason, reassign reason and QC1 flag reason: ≥10 characters (trimmed).
  - Send-back change list: non-empty.
  - Comment: non-empty.
  - Title: non-empty.

### 14. Inconsistencies a redesign may want to resolve
- The channel is editable in two places: the pencil on the Channel field, and the "Which channel" section.
- "Your next step" and "How urgent" use the same flashlight icon.
- Assigned, QC 1 and Final check share an identical indigo badge.
- The scrapped banner and restore helper print raw stage keys ("qc2") instead of labels ("QC 2").
- No StageBadge variant marks a job as scrapped; it only shows in the banner.
- The checklist footnote references an internal doc path.
- The drawer header shows the pod but not the round. The page header shows the round but not the pod.
- "Mark delivered" is not visually gated by the checklist; the user only finds out through a server error.
- The QC1 desk's "QC1 Approved" and "QC1 Comments Added" replace the defined "Pass QC1 — send to QC2" label, which never appears in practice.


---

## 12. Login, 404, Client Pods, Onboarding, Brand Kit, Analytics, Kontent Bot, Notifications, Global Search


Source: `frontend/src` of Kontent-Ops (read-only survey). Copy in "quotes" is exact on-screen text. `{field}` = data field from the API. Icons are Remix Icon names (`ri-*`), noted where they carry meaning.

### Role glossary (as used below)

- Account roles: `owner` (Owner), `fo` (Founder's Office), `tl` (Team Lead), `qc` (QC Reviewer), `ve` (Video Editor), `hr` (HR), `staff` (Team member). A person can also have a lent `secondary_role` (today only TL). "Lead" = Owner or anyone holding TL (own or lent) — `LEAD_ROLES = [owner, tl]`.
- Pod roles (role *inside* a client pod): `tl` "Leads this pod", `qc` "QC on this pod", `ve` "Edits for this pod". Account role and pod role can differ on purpose.
- Route guards (App.tsx): `/login` public; `/notifications`, `/pods/:podId/brand-assets`, `*` (404) any signed-in user; `/pods`, `/pods/new`, `/analytics`, `/bot` lead roles only (Owner, TL). The server re-checks everything.

---

### 1. Login page (`/login`)

**Who:** Anyone signed out. Full-screen, no app chrome.

**Layout (centered, single card, max ~384px):**
1. Background: app background with two blurred ambient glow blobs (purple `#7F00FF` top-left, cyan `#00F2FE` bottom-right).
2. Glass card containing:
   - Brand logo lock-up: big "K" + stacked "ontent" / "Media" wordmark.
   - Subtitle: "Sign in to your operations workspace".
   - Email field — mail icon prefix, placeholder "Email", type email, autofocus, autocomplete username, no autocapitalise/spellcheck. Value trimmed + lower-cased on submit.
   - Password field — lock icon prefix, placeholder "Password", eye toggle button on the right ("Show password" / "Hide password", toggles masked/plain).
   - Primary full-width button: "Sign in" (login icon); while pending: spinner + "Signing in..." and disabled.
   - Error banner (red, below button): if server returns 403 with a message (deactivated account) → that server message verbatim; anything else → "Invalid credentials".
   - Session-expired banner (amber, clock icon) when URL has `?expired=1` and no error: "Your session expired — sign in again."
- No required/HTML validation beyond the email type; no "forgot password" (product has no email recovery), no sign-up.

---

### 2. Not Found page (any unmatched URL, inside app chrome)

**Who:** Any signed-in user.
- Centered glass card: compass icon; heading "This page doesn't exist"; body "Nothing is routed at `{pathname}`. The link may be out of date, or the job or pod it pointed at may have been renamed." (path shown in mono).
- Primary link-button: "Back to the dashboard" (home icon) → `/`.

---

### 3. Client Pods page (`/pods`)

**Who:** Owner and TL (incl. lent TL). Inside each card, manage rights = Owner, or the TL of that pod (`pod.tl_id === me.id`). Changing a pod's TL = Owner only.

**Purpose:** Roster of client pods ("pod" = one client account): status, TL, billing, retainer, members, publishing channels, link to brand kit.

**Layout in order:**
1. Page header: eyebrow "Client Pods" (group icon); H1 "Client Pods"; subtitle "Manage rosters, TLs, retainers and brand kits per client — and keep the status honest when one pauses or churns." Right side: primary button "Onboard client" (→ `/pods/new`).
2. Filter row:
   - Search input, placeholder "Search client pods..." (debounced; server-side search by name). Resets to page 1.
   - Status pill tabs, each with a count from the server (`counts.all/active/paused/churned`; counts ignore the active status filter; "—" while loading): "All pods {n}", "Active {n}" (play icon), "Paused {n}" (pause icon), "Churned {n}" (close-circle icon).
3. Loading: spinner + "Loading pods...".
4. Grid of PodCards (1 col mobile, 2 cols ≥md), staggered fade-in.
5. Empty states (glass card, group icon):
   - No pods at all: "No client pods yet." / "Onboarding a client creates their pod, its TL and the first brand kit in one pass."
   - Search with no match: "No pods match that search." / "Clear the search or switch to All pods to see the rest of the roster."
   - Status tab empty: "No {status} pods." / same second line.
6. Pagination (only if total > 24; page size 24; noun "pods").

#### 3a. PodCard (one per client)

Data: `Pod { id, name, tl_id, status, billing_currency, retainer_volume }`, TL user (looked up by `tl_id`), channel count (from cross-pod channel list filtered to this pod).

Visual: whole card at 75% opacity when churned.

Sections in order:
1. Header row:
   - Avatar tile: first letter of `{name}` uppercase; purple gradient (grey if churned).
   - `{name}` (bold); below: "TL: {tl.name}" (or "—"), user-star icon.
   - Status badge (right): Active (green, play icon) / Paused (amber, pause icon) / Churned (red, close-circle icon). Tooltip = status blurb:
     - Active: "Retainer running — jobs flow normally."
     - Paused: "On hold — no new work expected this cycle."
     - Churned: "Client has left. Kept for history and past deliveries."
2. Stats strip (2 columns): "Billing" → `{billing_currency}` (mono, e.g. INR); "Retainer / mo" → `{retainer_volume}` or "—".
3. Action buttons (wrap, equal width, secondary style):
   - "Brand assets" (book icon) → `/pods/{id}/brand-assets`.
   - "Members" (group icon) ↔ "Hide members" (toggles Members drawer).
   - "Channels · {count}" (or just "Channels" when 0) ↔ "Hide channels" (toggles Channels drawer). Tooltip: "{name} publishes to {n} channel(s)" or "No channels on {name} yet — add one and every video can say which it is for". Only one drawer open at a time.
   - "Edit pod" (settings icon) ↔ "Cancel" (outline) — only if can manage.
4. Success line after save: "Pod updated." (green check).
5. Edit form (inline, when editing):
   - "Client name" — text, required, prefilled.
   - "Status" — 3 pill buttons Active / Paused / Churned; below, the live blurb for the selected status.
   - "Billing currency" — free text, placeholder "INR" (blank falls back to current value).
   - "Videos / month" — number, min 0, placeholder "—"; blank = null.
   - "Pod TL" — select of active TL/Owner accounts, option text "{name} ({ROLE})"; disabled unless Owner. Includes current TL even if not in list ("Current TL" fallback). Helper: Owner → "Handing the pod over also adds the new TL to the roster. Only TL or Owner accounts can lead a pod."; others → "Only an Owner can hand this pod to a different TL."
   - Error note: server message or "Could not save those pod changes."
   - Buttons: "Cancel" (secondary), "Save changes" (save icon; pending "Saving...").
   - Changing status to Churned triggers a confirm dialog first.
6. Drawer: MemberList or ChannelList (below).
7. Churn confirm dialog: title "Mark {name} as churned?"; body "The pod stays in the system with all its jobs, brand assets and history — churning is a status, not a delete. It will read as **Churned** everywhere instead of silently showing as active, and you can set it back to Active later if they return."; confirm "Mark as churned" (close-circle icon); error fallback "Could not update the pod."; Cancel.

#### 3b. MemberList (pod roster drawer)

Data: `PodMember { user_id, name, email, role (account), pod_role (tl|qc|ve), certified_at }`.
- Loading: "Loading members...".
- Empty (dashed box, team icon): "Nobody on this pod yet." + manager copy "Add the editors and QC who work this client — pod membership is what gives them the brand brief and SOPs." / non-manager copy "The pod's TL adds editors and QC to this roster."
- Row per member: `{name}` / `{email}`; badges: account role ("Owner", "Team Lead", "QC", "Editor", "HR", "Team member", "Founder’s Office"), pod role "{TL|QC|VE} in pod" (tooltip "Leads this pod"/"QC on this pod"/"Edits for this pod"), green "Certified" (medal icon) when `certified_at` set.
  - Remove button (red user-unfollow icon; tooltip "Remove {name} from {pod}") — managers only, not on the pod TL.
  - Pod TL row shows a lock icon instead (tooltip "Reassign the pod's TL first").
- Add form (managers only): select "Add a member..." listing active users not already in pod and not HR, as "{name} ({account role label})"; pod-role select TL / QC / VE (default VE); button "Add" (disabled until a user picked). Note when nobody left: "Everyone with an active account is already on this pod." Error fallback "Could not add that teammate to the pod."
- Remove confirm dialog: "Remove {name} from {pod}?" / "They lose access to this client's brand brief, SOPs and do-not list. Their past work and QC history stay exactly as they are. Add them back any time." / confirm "Remove from pod"; error fallback "Could not remove that member."

#### 3c. ChannelList (publishing destinations drawer)

A "channel" = a client's publishing destination (e.g. Dhan HQ, AAD). No delete, only "retire" (archive).
Data: `Channel { id, name, job_count, archived_at }`.
- Header: label "CHANNELS"; manager link "Add a channel" (+).
- Loading: "Loading channels...".
- Empty: "{pod} publishes to one place as far as this system knows. Add a channel if the client has more than one, and every video can say which it is for."
- Row: playlist icon, `{name}`, "{job_count} video(s)"; managers get pencil "Rename" (inline input + "Save"/"Cancel"; Enter saves) and archive icon "Retire" (tooltip "Retire it — the videos already filed under it keep the name, and it stops appearing in pickers"). No confirm on retire.
- Add box: input placeholder "Channel name — Dhan HQ, AAD..." (Enter adds); buttons "Add" (disabled when empty) / "Cancel".
- Error toasts: "Could not rename that channel." / "Could not retire that channel." / "Could not add that channel."

#### 3d. NewChannelInline (reusable "+ New channel" control)

Used in the New Job wizard and the pipeline table/bulk toolbar (DashboardPage), not on the Pods page.
- Closed: small link "+ New channel" (label customisable; compact size variant). Tooltip "Add a channel to {pod}".
- Open: inline input (placeholder "New channel for {pod}" or "Channel name — Dhan HQ, AAD..."), green check button "Add it" (spinner while saving), × "Cancel". Enter submits, Escape cancels.
- Success toast: 'Channel "{name}" is ready.' (re-using an existing or retired name returns/un-retires that channel). Error toast "Could not add that channel."

#### 3e. PodSwitcher

Select used on Analytics: first option "All Clients" (= null), then every pod by name. Hidden while loading.

#### 3f. CapacityBar

Bar list of editors' current load: label = `{name}`, value = `{open_count}` (videos held now across all pods), sorted descending; bar red when `open_count >= max_concurrent_jobs`, indigo otherwise. Value shown as plain integer. (Explicitly videos, not weight points.)

---

### 4. Client Onboarding wizard (`/pods/new`)

**Who:** Owner, TL.
**Layout:** narrow centered column (max ~512px).
1. Header: eyebrow "Client Onboarding"; H1 "Onboard a client".
2. Stepper: 1 "Pod" → 2 "Brand kit" (completed steps show a check).
3. Step 1 form (glass card):
   - "Client / pod name" — text, required.
   - TL select — required, placeholder "Select a TL" (disabled option); options = active users holding TL or Owner, "{name} ({ROLE uppercase})".
   - "Billing currency" — free text, default "INR".
   - "Expected videos/month (optional)" — number; blank = null.
   - Error: server message or "Could not create that pod."
   - Submit: "Next: brand kit →" (pending "Saving..."). On success the pod exists and wizard moves to step 2.
4. Step 2 (glass card):
   - Info line: "Optional — upload the first brief/SOP now, or skip and add it later from the pod's brand asset library."
   - BrandAssetUploadForm (stacked layout), submit label "Upload and finish" → on success navigates to that pod's brand kit page.
   - Secondary full-width "Skip for now" → `/pods`.

---

### 5. Brand Kit page (`/pods/:podId/brand-assets`)

**Who:** Any pod member can read/download (the server checks membership). Upload/replace = Owner or that pod's TL only.
**Purpose:** The client's brief, editing SOPs, brand kit material and do-not list, versioned.

**Layout (max ~672px):**
1. Header: eyebrow "Brand Kit" (book icon); H1 "{pod name} — brand kit" (or "Brand kit"); subtitle "Everything you need to edit for this client: the brief, the editing SOPs, the brand kit and the do-not list. Open any file — they're all here for every member of the pod."; back link "← Back to the board" (→ `/`).
2. If can upload: subheading "Add or update a document" (upload-cloud icon) + inline BrandAssetUploadForm (with known titles for versioning).
   Else: info note "You have full read and download access to every document here. Only this pod's TL (or an Owner) can upload or replace them, so what you're reading is always the version you're judged against."
3. Loading: "Loading...".
4. BrandAssetList.

#### 5a. BrandAssetList

Data: `BrandAsset { id, pod_id, type, title, file_path, version }`. Grouped by type (fixed order), then by title (alphabetical), newest version first.
- Download error banner: server message or "That file could not be opened."
- Four sections, each: icon + label, one-line blurb, list (or empty box):
  1. "Briefs" (file-text) — "What this client wants, in their words."
  2. "SOPs" (book-open) — "How this client's edits get made, step by step."
  3. "Kits" (palette) — "Logos, fonts, LUTs, lower thirds — the raw brand material."
  4. "Do-not list" (forbid) — "The things that come back as a QC round. Read this one first."
- Empty per section: uploader → "No {label} uploaded yet — add one above so the pod is working from it."; reader → "No {label} here yet. Ask your pod TL to upload one."
- Row per title: file icon + `{title}`; version chip "v{n}" + "current version" (if older exist) or "only version".
  - "{n} older" (history icon) toggle ↔ "Hide history" → nested list of older versions: "v{n}" + "Open this version".
  - "Open" button (download icon; "Opening..." while fetching) → fetches file through API and opens it in a new tab.

#### 5b. BrandAssetUploadForm

Layouts: inline one-row bar (brand kit page) or stacked (onboarding).
- Type select (default Brief): Brief / SOP / Kit / Do-not list.
- "Title" — text, required; autocomplete suggestions from existing titles.
- File picker (dashed label): "Choose file (max 25MB)" → shows chosen filename; required. Any file type.
- Submit: "Upload" (or custom label); pending "Uploading...".
- Hint when title matches an existing one (case-insensitive): "That title already exists — this uploads as a new version, and the old one stays in the history."
- Client-side size check (25 MB): "{filename} is {x.x}MB — the limit is 25MB."
- Server error fallback: "Upload failed — check the file size (25MB max) and try again."
- On success: title and file cleared.

---

### 6. Analytics page (`/analytics`)

**Who:** Owner, TL. The data endpoints are per-pod and require pod lead (Owner or that pod's TL).
**Purpose:** Pipeline health, revision load, and editor capacity — company-wide or per client.

**Layout:**
1. Header: eyebrow "Analytics"; H1 "Analytics"; subtitle "Pipeline health, revision load, and editor capacity — company-wide or per client."; right: PodSwitcher ("All Clients" default).
2. No pod picked → info card (pie icon): "Showing company-wide capacity below. Pick a specific client above for its pipeline-stage breakdown."
3. Pod picked:
   - Two clickable StatTiles:
     - "FIRST-PASS RATE" — `round(first_pass_rate*100)%` or "—". Measures share of this pod's **delivered** jobs that needed 0 revision rounds. Hint "Delivered with no revision round". Click → pipeline table filtered to this pod, `status=delivered` (tooltip "Open this pod's delivered jobs in the pipeline table").
     - "AVG QC ROUNDS" — `avg_rounds` to 1 decimal or "—". Mean revision rounds per delivered job. Hint "Rounds per delivered job". Click → pipeline, all statuses, sorted by round desc (tooltip "Open this pod's jobs, most revision rounds first").
   - Card "Stage distribution" (kanban icon): horizontal BarList, one row per stage — Intake, Assigned, Editing, QC 1, QC 2, Revisions, Final check, Delivered — value = job count in that stage; per-stage colours (grey, indigo, teal, indigo, amber, rose, indigo, emerald).
   - Card "Avg QC rounds by editor" (user icon): BarList, label = editor name, value = mean rounds over their delivered jobs in this pod (1 decimal).
   - Card "Stuck jobs (3+ rounds)" + dim aside "— a briefing problem, not an editor one": list of JobCards (code, title, round, stage) for non-delivered, non-scrapped jobs with round ≥ 3. Clicking one opens the Job Detail side panel in place. Empty: "Nothing past 3 rounds in this pod — briefs are landing."
4. Card "Cross-pod capacity" + aside "— every editor's load across all their pods" (speed icon) — CapacityBar (always shown to leads, regardless of pod picker).
5. Job Detail panel (slide-over, shared with pipeline).
6. Floating KontentBotWidget (bottom-right).

#### BarList (generic)
Row: label (truncated, fixed width) · rounded track with filled bar (min 4% width, scaled to max) · value right-aligned mono. Empty: "No data yet." Labels always written beside the bar (colour never the only identifier).

#### StatTile (generic)
Uppercase small label, big mono number (red when tone "critical"), optional hint line. Becomes a button (hover lift) when clickable.

---

### 7. Kontent Bot — full page (`/bot`)

**Who:** Owner and TL only (QC, VE, HR, FO-without-TL get no bot). Read-only AI assistant over live ops data, scoped to the asker's permissions.

**Layout (fills viewport height):**
1. Header: eyebrow "Kontent Bot" (sparkle icon); H1 "Ask about your ops"; subtitle "Client health, editor trends, stuck jobs and capacity — answered from live platform data, scoped to what you can see. Read-only: it can't change anything."
2. Two-column body (≥lg): left 16rem ConversationList (hidden on smaller screens — no mobile conversation list today), right glass card with ChatThread.
3. Job Detail side panel: opens when a job code in an answer is clicked (code resolved via job search).

#### 7a. ConversationList
- Top: secondary full-width button "+ New conversation".
- Empty: "Nothing yet. Your past questions will be listed here — they're private to you."
- Rows (up to 50, most recent): `{title}` (first 80 chars of the first question, or "New conversation") + relative time `{updated_at}` ("5m ago"). Active row has purple border. Hover reveals a trash icon (aria "Delete {title}") — deletes immediately, no confirm; deleting the open one starts a new conversation.
- Conversations are private to their creator (not visible even to Owner).

#### 7b. ChatThread (shared by page and widget)
Top to bottom:
1. **Not-connected banner** (amber, plug icon) when bot disabled; text = server reason: "Kontent Bot isn't connected yet — no OpenRouter API key is configured on the server. Everything else about it is built and waiting for that one setting."
2. **Message scroll area** (bordered, app-bg):
   - Loading history: "Loading this conversation…".
   - Empty state: sparkle icon, "Ask about your clients, your editors, or a specific job." / "Answers come from live platform data — the same numbers as the analytics pages, scoped to what you're allowed to see. It can read, not change anything."
   - User message: right-aligned purple gradient bubble (square top-right corner), white text.
   - Bot message: left bot avatar (sparkle in tinted circle) + column with: text bubble (card bg, square top-left; line breaks kept; job codes matching `KM-…` render as clickable mono chips that open the job panel), then any charts (column widens to ~672px when a chart is present), then tool-activity chips. A chart-only answer shows no empty bubble.
   - Pending turn: user's question bubble at 70% opacity; bot bubble with spinner and "Thinking…" (no tools yet) or "Looking that up…" (tools running); charts that already arrived render immediately; live tool chips below.
   - Auto-scrolls to bottom on new messages.
3. **Error area** (one of):
   - Fixable billing errors → BillingNotice (below).
   - Other errors → red line with warning icon. Possible texts: server detail; "Kontent Bot couldn't answer that." (generic); "This browser can't read streamed responses."; "Lost the connection before the answer arrived."; daily cap: "Daily limit of {cap} questions reached. This resets on a rolling 24-hour basis."; "Conversation not found".
4. **Suggestion chips** (only when empty and enabled; full page shows 5, widget shows first 2) — clicking fills the input (does not send):
   - "Chart deliveries per week for the last 3 months"
   - "How is this month going for my clients?"
   - "Who has delivered the most this month?"
   - "Anything stuck at 3+ rounds?"
   - "Who has capacity for a heavy job this week?"
5. **Composer**: text input + send button (send-plane icon; spinner while pending). Placeholder: "Ask Kontent Bot something…" / disabled "Kontent Bot isn't connected yet" / over cap "Daily question limit reached". Send disabled when empty, pending, disabled or over cap. Enter submits.
6. **Usage footer** (right-aligned, tiny, when enabled & cap > 0): "{used_today}/{daily_cap} questions today · {model}" (default cap 50/user rolling 24h; default model e.g. `google/gemini-2.5-flash`).

#### 7c. ToolActivity chips
Pill chips showing what the bot looked up — states: running (spinner), done (check, neutral), refused (lock, red, suffix " — not permitted"; means "you can't see that", distinct from "no data"). Live while streaming; stored with the message afterwards. Labels:

| Tool | Chip label | What it answers |
|---|---|---|
| resolve_entity | Finding who you meant | name → pod/person/job |
| get_pod_health | Reading client delivery stats | stages, deliveries, first-pass rate, avg rounds, overdue, stuck for one client |
| get_person_performance | Reading one person's numbers | one editor on one pod |
| find_jobs | Searching jobs | filtered job lists/counts |
| get_job_timeline | Reading a job's history | why a job is late (event log) |
| get_team_capacity | Checking team capacity | who's free / over cap / unrouted |
| list_pods | Reading every client's numbers | all visible pods' headline numbers |
| compare_editors | Comparing the team's delivery record | who delivered most / strongest / needs help |
| get_pod_team | Reading who works on this client | roster + certification |
| get_delivery_trend | Reading deliveries over time | deliveries per period, split by pod/editor/weight |
| get_intake_trend | Reading incoming job volume | new jobs per day |
| list_brand_assets | Checking the client's brand kit | which brief/SOP/kit/do-not exist or are missing |
| search_voice_notes | Searching voice notes | review videos with notes waiting (Owner only) |
| render_chart | Drawing the chart | draws a chart (reads no data) |
Unknown tools fall back to the name with underscores → spaces.

#### 7d. ChartBlock (bot-drawn charts)
Spec: `chart_type`, `title`, `labels[]`, `series[{name, values[]}]` (≤ 8 series), `y_label`, `value_format` (number | percent → "%", days → "d", points → " pts"), `note`.
- Chart types: **bar, grouped_bar, stacked_bar, line, area, pie, donut**.
- Frame: bordered card; caption = `{title}` (bold) + `{y_label}` (tiny uppercase); top-right pill toggle "Table" ↔ "Chart".
- Chart height 224px (page) / 160px (widget). Lazy-loaded; placeholder of same height: spinner "Drawing the chart…".
- Styling rules: 8 fixed series colour tokens `--series-1..8`, assigned in order, never cycled; horizontal gridlines only; axis ticks 11px dim; ISO dates shown as "12 Mar"; legend (circle markers, muted text) only when ≥ 2 series (always for pie/donut); bars max 24px wide, rounded top only (stack: only top segment rounded), 2px surface-colour gaps between stack segments / pie slices; lines monotone 2px with ringed dots; area = line + faint gradient wash; donut inner radius 52%; tooltip in card style.
- Table view: "Label" column + one column per series (colour dot + name), values formatted, sticky header, scrolls at 224px. The table toggle is a required accessibility feature (some light-mode colours are low contrast).
- Optional `{note}` under the chart in tiny dim text.

#### 7e. BillingNotice (fixable bot failures)
Amber bordered alert box shown instead of the red error line when error code is `out_of_credits` or `invalid_key`.
- Out of credits (wallet icon): title "Kontent Bot is out of credits"; text "The OpenRouter account that powers the bot has a zero balance, so every question will fail until it's topped up. Nothing else in the app is affected." Steps (full page, numbered): 1 "Open openrouter.ai/settings/credits and sign in." (link) 2 "Click **Add Credits** and pay. $5–10 goes a long way — a question costs a fraction of a cent." 3 "Come back here and ask again. No restart or redeploy is needed."
- Invalid key (key icon): title "Kontent Bot's API key isn't working"; text "OpenRouter rejected the key this server is using — it's been deleted, rotated, or copied incorrectly. Nothing else in the app is affected." Steps: 1 "Create a fresh key at openrouter.ai/settings/keys." 2 "Put it in the server's `.env` as `OPENROUTER_API_KEY`." 3 "Restart the app container — unlike credits, a key change is only picked up on startup."
- Compact (widget): no list, single link "Add credits on OpenRouter" / "Create a new key on OpenRouter".
- Footer (tiny, dim): "OpenRouter said: {raw detail}".

#### 7f. KontentBotWidget (floating launcher)
Currently mounted on the Analytics page. Owner/TL only.
- 56px round purple FAB bottom-right; sparkle icon ↔ × (aria "Open Kontent Bot"/"Close Kontent Bot").
- Popover panel (384px wide, max 70vh, above FAB): header "Kontent Bot" + link "Full page ↗" (→ `/bot`); compact ChatThread (scroll area max ~288px, 2 suggestions, compact charts, compact billing notice). Always starts a fresh conversation; no conversation list; job codes are not clickable here.

#### Bot behaviour notes for the designer
- Streaming is event-based (not token-by-token): tool chips and charts appear first, then the full answer at once.
- Bot is read-only (no write actions); answers stay inside the user's permissions; refused lookups appear as red chips.
- Answers quote job codes (`KM-…`) which become clickable.

---

### 8. Notifications page / inbox (`/notifications`)

**Who:** Every signed-in user (their own inbox).

**Layout (max ~672px):**
1. Header: eyebrow "Inbox" (bell icon); H1 "Notifications" + purple pill "{unread} new" (server count over whole inbox, shown if > 0). Right: secondary "Mark all read" (double-check icon; one request clears whole inbox; shown if unread > 0).
2. DesktopAlerts card (settings for browser push; see 8a).
3. Filter row: search input "Search by job title or code..." (debounced) + pills "All" / "Unread only".
4. Loading "Loading..."; error: server msg or "Could not load your inbox. Refresh to try again."
5. Day groups: label "Today" / "Yesterday" / full date (e.g. "2 Aug 2026"), then a glass card list. Each row is a link to `/jobs/{job_id}` (clicking marks it read):
   - Left tone icon tile (see table below; tones: primary = purple tint, danger = red tint, muted = grey).
   - `{headline}` (bold/main if unread; medium/muted if read).
   - `{job_title} · {pod_name}`.
   - First line of `{note}` in italic quotes, if any.
   - Right: time "3:42 PM" (tooltip full date-time); purple dot if unread.
   - Unread rows: purple left border + faint purple background.
6. Empty: inbox icon; "You're all caught up" / "Jobs landing with you, change lists and comments on your work all show up here." — or with filters: "Nothing matches that" / "Clear the search or switch back to All to see the rest of your inbox."
7. Pagination (page size 25, noun "notifications").

#### Notification types (headline text rendered by server; icon/tone by frontend)
`{who}` = actor name or "Someone"; `{code}` = job code; `{Stage}` = Intake, Assigned, Editing, QC 1, QC 2, Revisions, Final check, Delivered.

| event_type | Headline | Icon | Tone |
|---|---|---|---|
| intake | "{who} created {code}" | add-circle | primary |
| stage_changed | "{who} moved {code} to {Stage}" (or "...moved {code} along") | arrow-right-circle | primary |
| changes_raised | "{who} requested changes on {code}" | error-warning | **danger** |
| note_added | "{who} commented on {code} at {Stage}" (or "...commented on {code}") | chat-1 | muted |
| job_updated | "{who} edited the details on {code}" | pencil | muted |
| job_reassigned | "{who} moved {code} to a different editor" | user-shared | primary |
| job_scrapped | "{who} scrapped {code} — stop work on it" | close-circle | **danger** |
| qc1_flag_raised | "{who} flagged QC1 on {code} as not done" | flag-2 | **danger** |
| qc1_flag_cleared | "{who} cleared the QC1 flag on {code}" | flag-off | primary |
| qc2_assigned_v1 | "{code} was routed to you for QC2" | shield-check | primary |
| job_restored | "{who} restored {code}" | arrow-go-back | primary |
| (unknown) | "{who} · {event type words} on {code}" | information | muted |

Body (second line, used in toast and OS notification): "{job_title} · {pod_name}" or "{job_title} · {pod_name} — “{first line of note}”".
Notification `channel` can be `in_app` or `whatsapp` (WhatsApp delivery is a separate admin area).

#### 8a. DesktopAlerts (browser push settings card)
States (from browser + server):
- unsupported → plain dim line: "This browser cannot do desktop notifications. The in-app alerts still work while the app is open."
- unconfigured → "Desktop alerts are not set up on this server yet."
- off → card: "Desktop alerts" (bell-off icon) / "Get told about a hand-off while the app is behind something else." + primary button "Turn on".
- on → green bell; "Reaching you on this browser, even with the window minimised." + ghost "Turn off"; plus outline button "Send me a test alert in 5 seconds" (volume icon; "Sending...") + "Then minimise this window."; plus explainer: "With the app open in a tab you get our chime as well as the system sound, even minimised. With every tab closed you get the system notification sound only — a website cannot choose that one. If you hear nothing at all, check that Focus assist (Do not disturb) is off in Windows."
- blocked → "Blocked in this browser. Open the padlock menu next to the address bar and allow notifications — nothing here can undo it for you." (no button).
- Button pending: "Working...". Permission prompt is only raised by clicking "Turn on" (never on load).
- Toasts: on → "Desktop alerts are on for this browser." (success); blocked → "Your browser is blocking notifications for this site. Turn them back on in the padlock menu next to the address bar." (info); failure → "Could not change desktop alerts."; test sent → "Minimise this window now — the alert lands in {n} seconds." (success) or "No browsers are registered for alerts on this account yet." (info); test failure → "Could not send the test alert."
- A `compact` variant exists (no card chrome) but is currently unused.

#### 8b. NotificationBell (top bar, every page)
36px square bordered button with bell icon → `/notifications`. Red count badge top-right with server unread total (hidden at 0; no cap like "99+").

#### 8c. NotificationWatcher (global, invisible; real-time alerts)
Runs on every screen for signed-in users.
- Polls unread notifications every 15 s (others poll every 30 s); also refreshes instantly when a push arrives.
- First poll after page load is treated as backlog (no toast/sound). Already-announced ids remembered in localStorage (last 300).
- For each new notification: an **alert toast** (bottom-right stack, oldest first, newest at bottom): purple-bordered card, event icon, bold headline, muted body, small purple hint "Click to open · ✕ to dismiss". Never auto-dismisses. Click body → opens `/jobs/{id}` and dismisses; × dismisses. Dismissing marks it read (so it won't return). De-duplicated by notification id.
- When > 3 alert toasts are stacked: sticky button on top "Dismiss all {n} notifications" (marks the whole inbox read in one call).
- One chime per batch of new notifications.

#### 8d. Toast system (general, for reference)
Bottom-right, max 24rem wide. Variants: success (green, check, auto-hides 6 s), info (neutral, auto-hides 6 s), error (red, stays until ×), alert (purple, stays until ×).

#### 8e. Sound (notificationSound)
Synthesised two-tone chime played twice: A5 (880 Hz) → E6 (1318.5 Hz), repeat after a beat, ~1.1 s total, triangle wave, deliberately loud. Audio is unlocked on the user's first click/keypress anywhere. No settings/mute control exists in the UI today.

#### 8f. Push / Service worker (OS-level notifications)
- OS notification title = headline (fallback "Kontent OS"), body = body line (fallback "Something needs your attention."), app favicon as icon/badge, stays on screen until interacted with, same id collapses duplicates.
- Clicking it focuses an existing app tab and navigates to the job (fallback `/notifications`), or opens a new window.
- If no app tab is visible, an open-but-hidden tab plays our chime; a visible tab just refreshes and shows the toast. With all tabs closed: OS notification + system sound only.
- Subscription silently re-registered on every load if permission already granted.

---

### 9. Global Search (top bar, every page)

**Who:** All signed-in users; the People group only for leads (Owner/TL). Results scoped server-side to what the user can see. Max 8 per group.

**Input:** search icon, placeholder "Search jobs, clients, channels, people...", 300px wide, keyboard hint badge "⌘K" (Mac) / "Ctrl K". Cmd/Ctrl+K focuses it from anywhere. Debounced; min 2 characters.

**Dropdown panel** (520px, max 70vh, right-aligned under input), shown when input non-empty and focused:
- < 2 chars: "Keep typing — 2 characters minimum."
- Searching: spinner "Searching…".
- No results: 'Nothing matches “{query}” — no job, client, channel or teammate.'
- Results in groups (headers "Jobs", "Clients", "Channels", "People"), keyboard-navigable as one list (↑/↓ wrap, Enter opens, Esc closes & clears; hover moves the highlight). Footer: "↑↓ to move · ↵ to open · esc to close" + spinner while refetching.

Result kinds:
1. **Job** (film icon): `{title}` + red "SCRAPPED" tag if `scrapped_at`; line "{code} · {pod_name} · {channel_name} · {editor_name}" (missing parts skipped); optional purple "matched on {client | channel | editor | pod TL | QC reviewer}" when matched through a relation; right: stage badge. → `/jobs/{id}`. (Search is the only place scrapped jobs still appear.)
2. **Client/pod** (group icon): `{name}`; line "TL {tl_name} · {open_jobs} open · {channels} channel(s)"; right status tag (green if active, grey otherwise). → pipeline view filtered to that pod.
3. **Channel** (playlist icon): `{name}` + grey "ARCHIVED" tag if retired; line "{pod_name} · {open_jobs} open". → pipeline view (all statuses) filtered to that pod + channel.
4. **Person** (leads only; initials avatar): `{name}` + grey "LEFT" tag if inactive; line = comma-joined pods (or email if none) + " · {open_jobs} on their plate" if > 0; right role badge (Owner / Team Lead / QC Reviewer / Video Editor / HR / Founder's Office / Team member, each with its role colour). Destination: VE → pipeline filtered to that editor; others → `/hr` team directory if viewer is HR/Owner; otherwise the row is hidden (no profile pages exist).

---

### Cross-cutting notes for redesign

- Visual language today: light theme by default (dark optional), "glass card" surfaces, purple primary gradient (`--primary` → `--primary-hover`), accent tokens green/amber/red with tinted backgrounds, uppercase eyebrow labels above every H1, Remix icons, mono font for numbers/codes, fade-in-up animations.
- Repeated page-header pattern: eyebrow (icon + caps label) / H1 / one-line subtitle / right-aligned primary action.
- Errors use a shared ErrorNote (server `detail` or a page-specific fallback sentence); confirms use a shared ConfirmDialog (title, body, confirm label + icon, pending, error).
- Gaps worth designing for: conversation list hidden below `lg` (no mobile history access); no notification mute/sound setting; no confirm on channel retire or conversation delete; bell badge has no overflow cap; widget only on Analytics.


---

## 13. Admin & people: Users & Roles, Team Directory (HR), people modals, Voice Notes, WhatsApp Setup, shared UI kit


Scope: `frontend/src/pages/{UsersAdminPage,HrPage,VoiceNotesAdminPage,WhatsAppAdminPage}.tsx`, `frontend/src/components/people/*`, `frontend/src/components/ui/*`, `extension/`, `kontent-ops-v4.jsx`, `docs/13-whatsapp.md`, plus the relevant parts of `docs/04-permissions.md`.

Icons everywhere in the app are **Remix Icon** classes (`ri-*`). Fonts: Outfit (display), Plus Jakarta Sans (body), JetBrains Mono (numbers/codes). Brand purple `#7F00FF`. All four pages render inside the app shell (sidebar + top header), and each page's root is a vertical stack with 24px gaps (`space-y-6`).

---

### 0. Roles and who reaches what

Roles in roster order (`ROLE_OPTIONS`): `owner`, `fo`, `tl`, `qc`, `ve`, `hr`, `staff`. Each role has display metadata (`ROLE_META`) that every roster surface uses:

| Role | Label | Blurb (one-liner shown on tiles) | Icon | Colour family (badge / avatar gradient) |
|---|---|---|---|---|
| owner | Owner | Runs the workspace | ri-vip-crown-2-fill | brand purple → fuchsia-600 |
| fo | Founder's Office | Runs the pods it is given | ri-compass-3-fill | sky-500 → blue-700 |
| tl | Team Lead | Owns pods and delivery | ri-user-star-fill | indigo-500 → indigo-700 |
| qc | QC Reviewer | Reviews before delivery | ri-shield-check-fill | amber-500 → amber-700 |
| ve | Video Editor | Cuts the work | ri-movie-2-fill | teal-500 → teal-700 |
| hr | HR | Onboards the team and keeps the roster | ri-shake-hands-fill | rose-500 → rose-700 |
| staff | Team member | A job title, and no system access | ri-user-3-fill | slate-500 → slate-700 |

Badges use a 10% tint background with the colour as text (e.g. `bg-amber-500/10 text-amber-500`).

Extra role concepts the designer must show:
- **Secondary (lent) role**: today only "TL". An editor can be "Video Editor · also Team Lead". The display string is built by `roleLabel()`: job title if any, else role label, then ` · also Team Lead` if lent.
- **Job title** (`role_title`): custom label such as "Graphic Designer", "Social Media". The account underneath is `staff` (grants no access). Shown instead of "Team member".
- **Employment type** (QC only): Full-time = 24 QC2 points/day; Part-time = 12 points/day. A review costs 1 (short form), 3 (long form), 6 (podcast).
- **Capacity** (`max_concurrent_jobs`): how many videos a person may hold at once (0–999).
- **Available**: "Taking new work" vs "Not taking new work" (green/grey dot on avatar).

Permissions that drive these pages:
- `canAdminister` (rename via role dropdown, change role, lend TL, capacity, employment type, reset password, deactivate/reactivate on Users & Roles): **Owner only**.
- `creatableRoles`: Owner → all 7 roles; HR → TL, QC, VE, staff (job titles); everyone else → none.
- `canSwitchOff(actor, target)`: you may deactivate/reactivate only the kinds of account you may create, never yourself. So HR can switch off TL/QC/VE/staff, not Owner/FO/HR.
- Edit name + email ("Edit details"): Owner and HR.

| Page | Route | Route guard (actual code) | Sidebar entry |
|---|---|---|---|
| Users & Roles | `/admin/users` | owner, hr | Owner: "Users & Roles" (ri-user-settings-line) in Admin section. HR: "Edit user details" (same route, same icon) in their workspace section |
| Team Directory (HR) | `/hr` | hr, owner | HR: "Team Directory" (ri-team-line). Owner reaches it by URL / global search (not in Owner nav) |
| Voice Notes | `/admin/voice-notes` | owner, fo | Owner only: "Voice Notes" (ri-mic-line) in Admin section. FO can reach by URL but has no nav item |
| WhatsApp Setup | `/admin/whatsapp` | owner | Owner only: "WhatsApp Setup" (ri-plug-line) in Admin section |

Breadcrumb/header titles registered in the shell: "Voice Notes", "Users & Roles", "WhatsApp Setup", "Team Directory".

**Inconsistencies worth resolving in the redesign** (the code and docs disagree):
- `docs/04-permissions.md` says the voice-note library is Owner-only, and in another paragraph says Users & Roles and Voice Notes are "Owner + Founder's Office". The routes actually allow Users & Roles to Owner+HR and Voice Notes to Owner+FO.
- The WhatsApp Numbers tab says "The number itself is edited on Users & Roles", but Users & Roles has **no phone field**. The phone can only be set in the Add-teammate form. The Edit details modal covers name and email only.
- There is **no UI anywhere for a person's own WhatsApp opt-in**, even though the `/whatsapp/me` endpoint exists and the docs treat it as the consent path. Only the Owner can toggle opt-in, on the Numbers tab.
- The WhatsApp settings include a **pilot list** (`pilot_user_ids`) that the docs call central to rollout, but no screen edits it.
- Users & Roles empty state says "Create the first teammate with the form on the left", but the form is now a modal opened from the header button. The copy is out of date.
- Users & Roles uses a generic ConfirmDialog for deactivation. HR uses the richer DeactivateModal (open-work warning + reason). The two flows ought to be the same.

---

### 1. Users & Roles — `UsersAdminPage.tsx` (`/admin/users`)

**Who**: Owner (full control). HR also lands here ("Edit user details" in their nav) but gets read-only rows, apart from Edit details and Add teammate.
**Purpose**: the account directory. Here you create logins, change role, lend TL, set capacity and QC working day, reset passwords, deactivate and reactivate accounts, and edit name and email.

#### 1.1 Layout, top to bottom
1. **Page header** (bottom border, flex row that wraps):
   - Eyebrow: `ri-shield-user-line` + "ADMIN PANEL" (11px, bold, uppercase, brand-light purple).
   - H1: **"Users & Roles"** (2xl, extrabold).
   - Subtitle (xs, muted). Owner sees "Edit names and emails, create teammates, manage roles, reset credentials and switch accounts off." Everyone else sees "Edit teammate names and login emails."
   - Right side:
     - Primary button **"Add teammate"** (`ri-user-add-line`), which opens AddTeammateModal.
     - A count chip: `ri-team-line` + **{active}** (mono, bold) + "active". If any accounts are deactivated, the chip adds a divider and "{n} deactivated".
2. **Role breakdown tiles**: a grid with 2 columns on mobile, 3 on small screens and 7 on xl. There is one tile per role, in roster order, and each tile is a button that filters the directory.
   - Tile content: role label (10px uppercase dim) and a 32px square icon chip (role gradient, white icon) at the top. Below that sits the **total count** (2xl mono extrabold, "—" while loading), and under it the sub-line "{n} deactivated" or "all active".
   - Tooltip: "Filter the directory below to {Role}". Clicking toggles the role filter. The active tile gets a purple glow border (`border-glow`).
   - Hover lifts the tile 2px. Tiles fade in, staggered 60ms apart.
3. **Directory card** (glass card):
   - **Toolbar row**: a search input (max-width xs, search icon on the left) with placeholder "Search by name or email...". It is debounced and searched on the server. To its right are role pills: "All", then one pill per role labelled with the **uppercase role code** ("OWNER", "FO", "TL", "QC", "VE", "HR", "STAFF"). Note that the HR page uses full labels here instead.
   - **Status row**: label "ACCOUNT STATUS", then pills "Everyone" (default), "Active", "Deactivated".
   - Loading: spinner + "Loading users...".
   - **User rows** (divided list, described in 1.2).
   - **Empty state** (centred): `ri-user-search-line` icon (3xl). If any accounts exist it reads "No teammates match these filters." / "Clear the search or switch back to Everyone to see the full directory." Otherwise it reads "No accounts yet." / "Create the first teammate with the form on the left." (this copy is stale).
   - **Pagination** footer: 25 per page, noun "teammates".
   - Changing the search, role or status filter resets to page 1.

#### 1.2 User row (one per account)
Left block:
- Avatar: 40px rounded-xl square with initials (two letters), filled with the role gradient. Deactivated accounts get a grey, desaturated avatar.
- Availability dot (bottom-right of the avatar, active accounts only): green means "Taking new work", grey means "Not taking new work".
- Name (sm bold). A **"YOU"** micro-tag appears if the row is the viewer.
- Under the name: email, plus " · {job title}" if there is one.
- Deactivated rows have the left block at 55% opacity and a faint tinted background.

Right block (wraps; contents depend on permissions):
- **"Edit details"** secondary button (`ri-edit-line`): Owner and HR only. Opens EditUserDetailsModal.
- **"Deactivated"** red badge (`ri-forbid-2-line`) when the account is inactive.
- If the account is **active and the viewer is the Owner**, these inline controls appear:
  - **Role select** (150px). Options are the row's current role plus the roles the viewer may assign, labelled with full names. Tooltip: "Change what this account can do across the workspace." It is disabled while saving or if this is the **last active Owner**. It saves immediately on change, with success text "Role changed to {Role}."
  - **Extra access select** (150px). Options: "No extra access" / "Also TL". Tooltip: "Also give them Team Lead powers, on the pods they are given." Disabled when the row's own role is TL or Owner. On save the message is either "{Name} is now also a Team Lead — give them a pod to lead." or "Team Lead access taken back."
  - **Capacity box**: a bordered inline group with `ri-speed-up-line`, a number input (0–999, mono, 44px wide) and the suffix "AT A TIME". A ✓ save button appears only when the value has changed. It commits on blur or Enter, and Escape reverts. Tooltip: "How many videos this teammate can hold at once. A slot frees up when one is delivered; assignment past the limit is refused." Success text: "{Name} can now hold {n} video(s) at a time."
  - **Working day** (QC rows only): an inline group with `ri-time-line` and a select (Full-time / Part-time), followed by a read-only mono label "24 pts/day" or "12 pts/day". Tooltip: "A QC reviewer's day, in review points: a full day is 24, half a day is 12. Short form costs 1, long form 3, a podcast 6." Success text: "{Name}: 24 points a day — eight long-form reviews, or the same points in other work." (12 points shows "four long-form reviews").
- If the account is inactive, or the viewer is not the Owner, a **role badge** (role icon + label) appears instead.
- **Reset password** (Owner, active rows): secondary button "Reset password" (`ri-key-2-line`), tooltip "Set a new password for this teammate". Clicking turns it into an inline form with a password input (placeholder "New password", minimum 8, required, autofocus, 160px), a ✓ submit and an ✕ cancel. Success shows "Password reset."
- **Deactivate** (Owner, active rows): ghost button in red text, "Deactivate" (`ri-forbid-2-line`). It is disabled on your own row, with tooltip "You cannot deactivate your own account."; the normal tooltip is "Switch this account off — they can no longer log in." It opens the confirm dialog (1.3).
- **Reactivate** (Owner, inactive rows): secondary button "Reactivate" (`ri-refresh-line`). While saving it shows a spinner and "Working...". It reactivates immediately with no confirm, and shows "Account reactivated."

Below the row:
- On the last active Owner's row: a lock note, "The last active Owner can't be demoted — promote someone else first."
- Per-row result notes, pinned to the row that caused them. The ErrorNote fallback is "That change was rejected." (the server's own `detail` text is shown when present). The SuccessNote carries the success message.
- After a teammate is created, the note "{Name} added." appears on that new user's row.

#### 1.3 Deactivate confirm (ConfirmDialog, danger)
- Title: "Deactivate {Name}?"
- Body (in the info box with a red warning icon): "They will be signed out and can no longer log in. Nothing is deleted — every job, QC score and event they touched keeps pointing at their account, and they stay visible here as deactivated. You can switch them back on at any time."
- Buttons: "Cancel" (secondary) and **"Deactivate account"** (danger, `ri-forbid-2-line`). While pending the confirm button reads "Working...". If the server rejects the action, the error shows inside the dialog with fallback "Could not deactivate that account."

#### 1.4 Data sources
- Directory: `GET /users` with search, role, status (all/active/inactive), page and page_size=25.
- Tiles: `GET /users/stats`, which gives `active`, `inactive` and per-role `{total, inactive}` across the whole roster (not just the page).
- Mutations: update user (role, secondary_role or clear_secondary_role, max_concurrent_jobs, employment_type, is_active, name, email) and reset password.

---

### 2. Team Directory (HR) — `HrPage.tsx` (`/hr`)

**Who**: HR and Owner.
**Purpose**: people-ops: headcount by role, the roster by name, onboarding new employees, and offboarding (deactivate/reactivate) the roles HR is allowed to create. It deliberately has **no** role dropdowns, capacity or password reset.

#### 2.1 Layout
1. **Header**:
   - Eyebrow `ri-shake-hands-line` "PEOPLE OPS".
   - H1 **"Team Directory"**.
   - Subtitle: "Everyone on the roster, split by what they do — and the place to onboard the next teammate."
   - Right side: primary **"Onboard employee"** (`ri-user-add-line`).
2. **Success banner** after an onboard (SuccessNote, green): "{Name} can now log in with the password you set. Share it with them out of band — there is no email invite yet."
3. **Tiles**: 8 tiles in a grid of 2, then 3 (sm), then 7 (xl) columns, so the 8th tile wraps.
   - First tile **"TOTAL EMPLOYEES"**: purple→indigo icon chip (`ri-team-fill`), count = active + inactive, sub-line "{n} active" if any are deactivated, otherwise "all active". Clicking clears the role filter. Tooltip "Show everyone in the list below".
   - Then one tile per role, as on Users & Roles, except the sub-line shows the **role blurb** when nobody in that role is deactivated. Tooltip: "{blurb} — click to filter the list below".
4. **Roster card**:
   - Search: "Search by name or email...".
   - Pills: "Everyone", then full role labels ("Owner", "Founder's Office", "Team Lead", "QC Reviewer", "Video Editor", "HR", "Team member"), a "|" divider, and two toggle pills: "Active only" and "Deactivated". These toggle off back to all, and deactivated people are included by default.
   - Loading: "Loading the roster...".
   - Rows: avatar (as before; greyed when inactive), name with an optional "YOU" tag, and email. For deactivated people a third line reads **"Deactivated {full date} by {actor} — “{reason}”"** (actor and reason only if present). The whole row is at 55% opacity when inactive.
   - Right side: a red "Deactivated" badge if inactive; a role badge using `roleLabel` (so a job title or "· also Team Lead" appears); and a ghost button **"Deactivate"** (`ri-forbid-2-line`) or **"Reactivate"** (`ri-user-follow-line`), shown only where `canSwitchOff` allows. Its tooltip is "Deactivate {Name}" or "Reactivate {Name}".
   - Empty state: if people exist, "Nobody matches these filters." / "Clear the search or switch back to Everyone."; otherwise "Nobody on the roster yet." / "Use Onboard employee to add the first teammate."
   - Pagination: 25 per page, noun "employees", sorted by name.
5. Modals: **AddTeammateModal** with title "Onboard employee" and submit "Add employee", and **DeactivateModal**.

---

### 3. People modals — `components/people/*`

#### 3.1 AddTeammateModal (used by Users & Roles as "Add teammate", and by HR as "Onboard employee")
Modal size sm. The form resets every time it opens.
- Intro copy: "This creates their login. Putting them on a client pod is a separate step, done by the Owner or that pod's TL."
- Fields, in order (each text input has a leading icon):
  1. **Full name** (`ri-user-3-line`): text, required, autofocus.
  2. **Email address** (`ri-mail-line`): email, required.
  3. **Phone (optional)** (`ri-phone-line`): free text, optional. This is the only place in the UI where a phone is set; WhatsApp reads it.
  4. **Initial password (min 8 characters)** (`ri-lock-2-line`): password, required, minLength 8.
  5. **ROLE** (label above): a single select with two option groups.
     - "Roles in the pipeline": each creatable role except staff, shown as "{Label} — {blurb}", e.g. "Video Editor — Cuts the work". The default is the first creatable role (Owner for an Owner; TL for HR).
     - "Job titles": existing saved titles (from `useRoleTitles`), then **"+ New job title…"**.
  6. If "+ New job title…" is picked: a text input with placeholder "e.g. Graphic Designer, Social Media", required, max 60 characters, and the help text "Saved for next time, so the next hire is filed under the same word. A job title gives no access on its own."
  7. If the role is QC, **WORKING DAY** select:
     - "Full-time — 24 points a day — eight long-form reviews, or the same points in other work"
     - "Part-time — 12 points a day — four long-form reviews, or the same points in other work"
     - Help text: "How much QC2 work routing will send them in a day. A review costs 1 point for a short form, 3 for a long form and 6 for a podcast; a part-timer takes at most one podcast a day whatever their points say."
  8. **EXTRA ACCESS** select (always shown on both pages): "No extra access" / "Also a Team Lead — can run client pods of their own". Help text: "Team Lead reaches only the pods they are given, so this is safe to hand out and still means something. An Owner can take it back later."
- Error: ErrorNote with fallback "Could not add them — check the email isn't already registered."
- Buttons: "Cancel" (secondary) and the primary submit "Add teammate" or "Add employee" (`ri-user-add-line`). While pending it shows a spinner and "Adding…".
- What gets sent: picking a job title creates role=staff plus the title (new or existing id). employment_type is sent only for QC.

#### 3.2 DeactivateModal (HR page; also used for reactivation)
- Title: "Deactivate this account" or "Reactivate this account".
- Identity card (pill background): name in bold, and "{role label} · {email}".
- **Deactivating** shows a three-item list with icons:
  - `ri-login-circle-line` (red): "They can no longer log in."
  - `ri-user-forbid-line` (red): "They drop out of editor pickers and QC routing."
  - `ri-history-line` (dim): "Nothing is deleted — every job, review and comment still names them."
  - **Open-work check**: while loading it shows "Checking what they still hold...". If they still hold work, an amber callout appears: "⚠ This work stays with them" / "{n} videos being cut, {n} reviews in their QC queue, {n} client pods they lead. Deactivating does not reassign any of it — a TL has to hand it over." Otherwise: "Nothing open is assigned to them right now."
- **Reactivating** shows: "They will be able to log in again, and will start appearing in editor pickers and QC routing from the next assignment onwards."
- **REASON (optional)** input, max 500. Placeholder "Left the company — last day 15 Sep" (deactivate) or "Rejoined the team" (reactivate). Help text: "Recorded against your name either way, so the directory can say who did this."
- Error fallback: "Could not change this account's status."
- Buttons: "Cancel" (ghost) and either danger "Deactivate {FirstName}" (`ri-forbid-2-line`) or primary "Reactivate {FirstName}" (`ri-user-follow-line`). While pending: "Saving...".
- On success a toast appears: "{Name} has been deactivated. Their history stays on every job they touched." or "{Name} can log in again." On error, a toast reads "Could not deactivate/reactivate this account."

#### 3.3 EditUserDetailsModal (Owner and HR, from "Edit details")
- Title: "Edit {Name}".
- Fields: **Name** (text, required, max 120, autofocus) and **Email** (email, required, saved trimmed and lowercased).
- Note: "Use the updated email to sign in. The password stays the same."
- Error fallback: "Could not update user details."
- Buttons: "Cancel" and "Save changes" (shows "Saving..." while pending). Save is disabled while the name is blank, and the modal cannot be closed while saving.

---

### 4. Voice Notes library — `VoiceNotesAdminPage.tsx` (`/admin/voice-notes`)

**Who**: Owner (in nav); FO can reach it by URL.
**Purpose**: an admin view of every voice note recorded with the browser extension on Frame.io review pages. Notes are grouped by video. You can play and delete them individually or delete all of a video's notes at once. Notes **auto-expire after 60 days** and are cleaned daily.
There is no page header or H1 on this page; the title comes from the app shell ("Voice Notes").

#### 4.1 Layout
1. **KPI cards** (3 columns from sm):
   - **"VIDEOS WITH NOTES"**: purple `ri-film-line` chip, big mono number = total matching videos, sub-line "Unique Frame.io review links". This card is a button: it clears the search and scrolls to the table. Tooltip: "Click to jump to the list", or "Click to clear the search" while a search is active.
   - **"TOTAL VOICE NOTES"**: cyan `ri-mic-line` chip, total notes across matching videos, sub-line "Across all videos · auto-delete after 60 days". Same button behaviour.
   - **"RETENTION"**: emerald `ri-calendar-check-line` chip, big text "60d", sub-line "Notes auto-expire and are cleaned daily". Static, not a button.
2. **Toolbar**: a search input (max-width md, card background) with placeholder "Search by video URL or title..." (server-side, debounced), and to the right a count "{n} video(s)".
3. **Videos table** (glass card). Columns:
   | (chevron) | VIDEO | NOTES | LAST NOTE | ACTIONS (right-aligned) |
   - Chevron: right arrow when collapsed, down arrow when expanded.
   - Video: title (bold, truncated to 400px; "Untitled Video" if none), with the URL underneath (10px mono dim, truncated).
   - Notes: purple mono count pill.
   - Last note: date and time in en-IN format, e.g. "3 Oct 2026, 02:15 pm", or "—".
   - Actions:
     - **"Open"** (`ri-external-link-line`) opens the Frame.io URL in a new tab.
     - **"Delete All"** (`ri-delete-bin-6-line`, rose on hover) switches inline to a red **"Confirm"** button (shows "Deleting..." while pending) plus **"Cancel"**. Confirm bulk-deletes all of that video's notes.
   - Clicking anywhere on the row expands or collapses it. Only one video is expanded at a time, and the expanded row gets a pill background.
   - **Expanded panel** (faint purple background): a list of note cards. If the list is empty: "No notes found (they may have expired)".
4. **Note card** (one per note, horizontal):
   - Timestamp badge (purple, `ri-play-mini-fill`): the video position in **m:ss.mmm**, frame-accurate.
   - Duration (mono, dim), same format.
   - Recorded by: `ri-user-voice-line`, name (or "Anonymous") with the email underneath.
   - Created date and time.
   - Expiry: "{n}d left", turning rose when 7 days or fewer remain.
   - **Play/Pause** toggle (`ri-play-fill`/`ri-pause-fill`, purple when playing). It streams `/api/voice-notes/{id}/audio`. Note: playing several notes at once is possible here because there is no single-player guard.
   - **Delete** (trash icon) turns inline into a red "Del" (shows "..." while pending) and "✕".
5. **Empty table state**: `ri-mic-off-line` (4xl). With a search: "No videos match that search" / "Try a different part of the URL or title." Otherwise: "No voice notes yet" / "Install the Chrome extension on Frame.io review pages to start recording timestamped voice notes."
6. Pagination: 25 per page, noun "videos".
7. Loading: "Loading voice notes..." appears **below** the table, which is an odd placement.

Data: `GET /voice-notes/admin/videos` (search, page, returns `total` and `total_notes`), `GET /voice-notes/admin/videos/{base64key}/notes`, `DELETE /voice-notes/{id}`, `DELETE /voice-notes/admin/bulk-delete`. A video's identity is the `video_key` (the Frame.io asset id, e.g. `frameio:asset:<id>`), not the raw URL. Signed-in and anonymous Frame.io links to the same cut are grouped together.

Not present (possible additions): sort controls (the API supports sort by last_note_at, note_count, video_title, video_url), filtering by recorder, editing a note's author (the extension's README says to "fix those from the Voice Notes admin page", but no such UI exists), jumping to a timestamp in the video, and per-job linking.

---

### 5. WhatsApp Setup — `WhatsAppAdminPage.tsx` (`/admin/whatsapp`)

**Who**: Owner only.
**Purpose**: operate the direct Meta Cloud API integration. That covers:
- a kill switch;
- connection health and credentials presence;
- the template registry compared against Meta's status and category;
- per-event toggles;
- the delivery log;
- per-person phone numbers, opt-in and 24h-window status.

Background (from docs/13): WhatsApp is additive. In-app and desktop push always fire anyway, and a WhatsApp failure never blocks a job move. Template **shape** lives in code (`registry.py`); **status** lives at Meta; this page compares the two. All templates must be UTILITY and must end in a quick-reply button, because a tap opens the free 24h window. Messaging **ships switched off**.

#### 5.1 Page structure, top to bottom
1. **Kill switch card**:
   - Heading: `ri-whatsapp-line` (green when on) + "WhatsApp messaging is **on**" or "**off**".
   - Body when on: "Job events are being sent to people's phones. In-app notifications and desktop push are unaffected either way."
   - Body when off: "Nothing is being sent. In-app notifications and desktop push carry on exactly as they do now — WhatsApp is additive and never the only path."
   - Button when on: danger **"Stop all messages"** (`ri-stop-circle-line`). When off: primary **"Turn messaging on"** (`ri-play-circle-line`). There is no confirm in either direction.
2. **Red banner**, shown only if any template's category has drifted:
   - Heading: "⚠ Meta has re-categorised {n} template(s) away from Utility".
   - Body: "{names} — now {categories}. Marketing templates are capped at roughly two messages per person per day across every business on WhatsApp (error 131049), and no number of extra phone numbers works around it. Appeal the category in Meta Business Manager, or reword and resubmit."
3. **Amber banner**, shown only if any template has drifted from code:
   - Heading: `ri-git-branch-line` "{n} template(s) has/have drifted from the code".
   - Body: "{names} — the version Meta approved no longer matches what this app sends. The next message using one will be refused with error 132000. Resubmit them from the Templates tab."
4. **Tab bar** (rounded buttons; the active tab is solid purple with white text): **Connection** (ri-plug-line), **Templates** (ri-file-list-3-line), **Events** (ri-flashlight-line), **Delivery log** (ri-history-line), **Numbers** (ri-contacts-book-line). The default tab is Connection.
5. **Not-configured notice**, shown if the env credentials are missing:
   - "Not connected to Meta yet."
   - "Set `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_BUSINESS_ACCOUNT_ID` in the environment, then restart the app. The full setup sequence is in `docs/13-whatsapp.md`."
6. Active tab content.
7. Settings read error: "Could not read the WhatsApp settings".

#### 5.2 Connection tab
- Loading shows "Checking…". An error shows "Could not reach the connection check".
- **4 stat cards**: **Business number** (display phone), **Verified name**, **Quality rating** (badge: GREEN emerald / YELLOW amber / RED rose) and **Messaging tier** (e.g. a Meta limit tier). Any missing value shows "—".
- A live error line from Meta, if any (red alert box).
- **Credentials card**, a definition list in 2 columns:
  - Graph API version
  - WABA id (or "not set")
  - Phone number id (or "not set")
  - Access token: "set" / "not set"
  - App secret: "set" / "not set"
  - Verify token: "set" / "not set"
  - Footnote: "Values are never shown, only whether they are set — this screen would otherwise put a token that can message the whole company into a browser cache and a screenshot."
- **Webhook card**: "Last event received: **{date}**" or "—". If nothing has ever arrived, an amber warning reads: "Nothing has ever arrived. Template approvals, delivery receipts and button taps all come in this way, so until one does the integration is sending blind. Subscribe the app to the WABA at `/api/whatsapp/webhook` in Meta Business Manager."
- **"Send yourself a test" card**:
  - Copy: "Runs the real guard rails rather than bypassing them, so “nothing arrived” is diagnosed here instead of after a real hand-off goes missing."
  - Controls:
    - A native select listing the APPROVED, managed templates. If there are none it shows "No approved templates yet". The default is `job_assigned_v1`.
    - Primary **"Send test"** (`ri-send-plane-line`), disabled when no templates are approved.
    - Secondary **"Run hourly pass now"** (`ri-refresh-line`).
  - Test result line: "Result: **{status}** — {reason} (to {phone})".
  - Scheduler result line: "Reconciled {n} templates · sent {n} deadline, {n} stuck-round, {n} unrouted-QC2 and {n} digest messages."
  - Errors: "The test send failed" / "The scheduled pass failed".

#### 5.3 Templates tab
- Loading shows "Loading templates…". An error shows "Could not load the templates".
- Intro: "Shape is defined in code (`services/whatsapp/registry.py`); status and category are whatever Meta currently says. This table is where the two are compared."
- Buttons:
  - Secondary **"Sync from Meta"** (`ri-download-cloud-line`).
  - Primary **"Submit {n} missing"** (`ri-upload-cloud-line`), disabled when nothing is missing. It submits one template at a time and stops at the first refusal.
- Results and errors:
  - Sync result: "Synced {n} templates, {n} changed. Not in the registry: {names}."
  - Errors: "The sync failed" / "Meta refused the submission" / "Meta refused the resubmission".
- **Table columns**: Template | Category | Status | Quality | Last change | (action)
  - **Template**: the name is a link-style button that opens the **preview modal**. Below it sits the purpose text. For an unmanaged template the text is instead "Created at Meta by hand — nothing here knows how to fill it, so it is never sent." Below that are badges: recipient (`ri-user-line`, e.g. "Pod TL"), amber "code changed — resubmit" if drifted, and grey "unmanaged".
  - **Category**: badge, emerald when it matches the request and rose when drifted. When drifted, a line below reads "asked for {requested}".
  - **Status**: badge coloured by status:
    | Status | Colour |
    |---|---|
    | APPROVED | emerald |
    | PENDING | amber |
    | REJECTED | rose |
    | PAUSED | orange |
    | DISABLED | rose |
    | NOT_SUBMITTED | grey |

    If Meta gave a rejection reason, it appears in rose below the badge.
  - **Quality**: GREEN/YELLOW/RED badge or "—".
  - **Last change**: last_status_at or last_synced_at, formatted like "3 Oct, 02:15 pm".
  - **Action**: an outline "Submit" button if the template is missing, or an outline "Resubmit" if it has drifted or been rejected. Unmanaged templates get no action.
- **Preview modal** (title = template name):
  - A WhatsApp-style bubble (dark green tint) containing the body with literal `{{n}}` placeholders. If there is no body: "No body recorded — this template was made outside the app."
  - Footer "Kontent OS", then the quick-reply buttons as centred sky-blue lines.
  - A details list: Language, Parameters (count), Meta id, Approved (date).

**The template registry** (13 templates; all UTILITY; header, recipient, buttons and purpose as defined in code):

| Template | Header | To | Buttons (action) | Purpose |
|---|---|---|---|---|
| job_assigned_v1 | New video assigned | Assigned editor | Started (START → editing), Can't take it (DECLINE) | A TL assigned the editor and set the team deadline. |
| qc1_ready_v1 | Ready for QC1 | Pod TL | Reviewing now (ACK) | The editor marked the cut ready and it landed at QC1. |
| qc2_assigned_v1 | — | QC2 reviewer | Picked up (ACK) | The auto-router assigned this reviewer, or they claimed it. Body includes "Cost against today: {{7}} points". |
| qc2_unrouted_v1 | — | Pod TL | Looking into it (ACK) | A job entered QC2 with every reviewer at capacity or unavailable. |
| changes_raised_v1 | Changes requested | Assigned editor | On it (REVISE → editing), Need a call (DECLINE) | A send-back from QC1, QC2 or Final check dropped the job into Revisions. Includes "First note". |
| final_check_v1 | Ready for final check | Pod TL | Opening it (ACK) | QC2 passed the cut to Final check. |
| job_scrapped_v1 | Project scrapped — stop work | Everyone holding the job | Understood (ACK) | A job was cancelled; goes to editor, QC2 reviewer, pod TL. |
| job_reassigned_v1 | Editor changed | Everyone holding the job | Understood (ACK) | A handover; both editors + pod TL. |
| qc1_flag_raised_v1 | — | Pod TL | Responding (ACK) | A QC2 reviewer or lead flagged a QC1 pass as not done. |
| qc1_flag_cleared_v1 | — | Pod TL | Thanks (ACK) | A raised QC1 flag was withdrawn or dismissed. |
| deadline_soon_v1 | Deadline tomorrow | Any recipient (stage owner) | On track (ACK), Need more time (DECLINE) | Team deadline within 24h and not delivered (covers overdue). |
| stuck_rounds_v1 | Job is on round 3 | Pod TL | Looking into it (ACK) | Round counter hit 3; once per job. |
| daily_digest_v1 | Your day on Kontent OS | Any recipient | Open board (ACK) | One morning roll-up per person. |

Recipient display labels: Assigned editor, Pod TL, QC2 reviewer, Everyone holding the job, Any recipient. Sample body (job_assigned_v1): "Hi {{1}}, a new cut is yours. … Client: {{4}} / Type: {{5}} / Deadline: {{6}} — The brief and the raw files are on the job in Kontent OS." Example values used throughout: Farah, KM-1052, "Diwali campaign teaser", Dhan, "24 Sep". Footer on every template: "Kontent OS".

#### 5.4 Events tab
- Loading shows "Loading events…". An error shows "Could not load the event rules"; a failed save shows "Could not save that toggle".
- Intro: "Most job events are in-app only and are not listed here — six messages a video across twenty-two people is eighty pings each a month before anything optional is added."
- Three sections, each with a heading and a card of rows:
  - **"Core loop — sent immediately"**: event keys `stage_changed:assigned`, `stage_changed:qc1`, `stage_changed:qc2` (reviewer, or TL fallback via qc2_unrouted_v1), `stage_changed:revisions` and `stage_changed:final`.
  - **"Exception — rare, and too important to wait"**: `job_scrapped`, `job_reassigned`, `qc1_flag_raised`, `qc1_flag_cleared`.
  - **"Scheduled — fires on a date, not a move"**: `scheduled:deadline_soon`, `scheduled:stuck_rounds`, `scheduled:qc2_unrouted`, `scheduled:daily_digest`.
- Each row:
  - The template name, then the purpose (xs muted).
  - Badges: recipient (`ri-user-line`), the event key (mono 10px), and, if the template is not approved, an amber "template {STATUS} — nothing would send".
  - On the right: a **toggle switch** (44×24, green when on, white knob) with aria-label "Enable/Disable {event_key}". It saves on click.
- Events not sent by design: intake, job_updated, link added/removed, restored, qc2_claimed, entering editing, delivered (goes in the digest), note_added.

#### 5.5 Delivery log tab
- **5 stat cards**: Sent, Delivered, Read, Failed, Skipped (last 30 days).
- Note: "Counted over the last 30 days, across every row rather than this page. A **skipped** message is a decision with a reason on the record, not an absence — it is the answer to “why didn't they get it”."
- Status filter pills: All, sent, delivered, read, failed, skipped (lowercase labels; the active one is solid purple). Changing the filter resets to page 1.
- Loading shows "Loading…". An error shows "Could not load the delivery log".
- **Table columns**: When | To | Template | Job | Status
  - When: "3 Oct, 02:15 pm".
  - To: the user's name (or "—"), with the phone underneath (or "no number").
  - Template: the template name, with the event key underneath (mono 10px).
  - Job: the job code (e.g. KM-1052) or "—".
  - Status: a badge coloured by status (sent sky, delivered violet, read emerald, failed rose, skipped grey, queued amber). Under the badge can appear: the reason (muted, e.g. a skip reason); the error detail in rose; and, in emerald, "tapped {ACTION} · {time}" when a quick-reply button was pressed.
- Empty: "Nothing sent yet."
- Pagination: 25 per page, noun "messages".
- The skip reasons come from the eight guard rails, checked in order: integration configured, messaging on, event enabled, recipient in pilot group, account active, opted in, usable phone, template APPROVED.

#### 5.6 Numbers tab
- Loading shows "Loading the roster…". An error shows "Could not load the numbers"; a failed update shows "Could not update that row".
- **Amber banner** if anyone is unreachable: "{n} person/people cannot be reached" / "They will silently miss every hand-off, and nothing else in the product would ever say so — a message that was never sent leaves no trace anywhere a person looks."
- **Table columns**: Person | Typed | Dialled | Opted in | 24h window | (action). Unreachable rows get a faint amber background.
  - Person: name, with the role underneath.
  - Typed: the raw phone as entered, or "—".
  - Dialled: the normalised E.164 display, or a rose "not usable" badge. If another account holds the same number, a rose note reads "shared with another account — buttons cannot be attributed".
  - Opted in: a toggle switch (green or grey). Clicking toggles opt-in for that person.
  - 24h window: an emerald badge "open — replies free", or the last inbound time.
  - Action: a ghost **"Re-derive"** button, which recomputes the E.164 form from the typed number.
- Footnote: "The number itself is edited on Users & Roles, which is where the roster is maintained. “Re-derive” recomputes the dialled form from whatever is typed there — a bare ten-digit number is assumed Indian, and when that guess is wrong the typed column is how you can see it." (As noted in section 0, the phone is **not** actually editable there.)

#### 5.7 Data & API
Endpoints: `GET /whatsapp/status`, `/templates`, `POST /templates/sync`, `POST /templates/{name}/submit`, `/resubmit`, `GET /events`, `GET/PATCH /settings` (enabled, pilot_user_ids, event_flags), `GET /messages` (+ `/messages/stats?days=30`), `GET /numbers`, `PATCH` a number (opt_in, renormalise), `POST` test-send and run-scheduler. A `deleteTemplate` API exists but has no UI.

Suggested rollout sequence from the docs, which a redesign could turn into a setup checklist:
1. Credentials, then Sync.
2. Subscribe the webhook.
3. Submit the templates.
4. Numbers: opt in and fix numbers for the pilot pod.
5. Switch on with one pilot pod, Tier 1 only.
6. Widen the pilot, then enable Tier 2 and the scheduled events.

The Meta-side setup steps (7 manual steps) are documented only, with no UI.

---

### 6. Shared UI kit — `components/ui/*`

Design tokens live in `index.css` (light theme default plus a dark theme). Key tokens:
- Brand: `--primary` #7F00FF, `--primary-hover` #6D00DB, `--primary-light` #9D38FF, glow 40% and 15%.
- Accents: green #10B981, amber #F59E0B, red #EF4444, each with a 12% background; cyan #00F2FE.
- Light theme: app background #F6F4FA, cards white at 85% (glassy), input #F0ECF8, pill 6% purple, borders 15% purple, text #1A1528 / #6B7280 / #9CA3AF.
- Dark theme: app background #0B0813, cards rgba(23,16,41,.65), text #F3F0FC.
- Radius 12px (cards) and 8px (small). Sidebar 250px, header 72px.

Utility classes:
- `.glass-card`: card background, 1px purple-tinted border, 12px radius, card shadow, blur; the border darkens on hover.
- `.border-glow`: selected-state purple glow.
- `.avatar-circle`: centred initials.
- `.animate-fade-in-up`: 0.35s entrance.

| Component | Props / variants | Current styling & behaviour |
|---|---|---|
| **Button** | `variant`: primary (default), secondary, outline, ghost, danger; plus all native button props | Base: inline-flex, 6px gap, 8px radius, px-3.5 py-2, 14px semibold, 150ms transitions; disabled = 50% opacity, no lift. **primary**: purple gradient, white, purple glow shadow, lifts 2px on hover. **secondary**: card background, 1px border, hover border/background. **outline**: transparent, border, hover purple border+text. **ghost**: transparent, muted text, hover pill background. **danger**: rose-600→700 gradient, white, lifts on hover. Icons are passed as `<i>` children. |
| **Badge** | `children`, `className` (the className fully replaces the default colours) | inline-flex, 4px gap, 6px radius, px-2 py-0.5, 12px semibold. Default: pill background + border + muted text. Callers pass tint classes for status colours. |
| **PillButton** | `active: boolean` + native props | Small segmented/filter pill: 6px radius, px-2.5 py-1, 12px semibold. Active = solid purple, white text, subtle glow. Inactive = card background, border, muted text, hover border/text. Used for every filter strip. |
| **Input** | native input props | Full width, 8px radius, 1px border, input background, px-3.5 py-2.5, 14px, dim placeholder, purple border on focus. No label, error or icon slot built in; callers add icons as absolutely positioned `<i>` with `pl-9`. |
| **Select** | native select props | Matches Input, plus `appearance-none` and a purple (#7F00FF) chevron SVG on the right; 14px medium. Option groups are supported natively. |
| **Modal** | `open`, `onClose`, `title`, `children`, `size`: sm (max-w-lg, default), lg (3xl), xl (5xl), full (90vw) | Fixed overlay: black at 50% with a small backdrop blur; content centred and scrollable. Panel: `--bg-card-hover`, 1px border, 16px radius, 2xl shadow, 24px padding, fade-in. Header: title (base bold) and a 32px ✕ icon button. No footer slot (callers render their own buttons, right-aligned), no Escape handling, and the backdrop is not clickable. |
| **ConfirmDialog** | `open`, `title`, `description` (ReactNode), `confirmLabel`, `confirmIcon` (default ri-alert-line), `onConfirm`, `onCancel`, `pending`, `error`, `errorFallback` (default "That didn't go through."), `variant`: danger (default) / primary | Built on Modal. A description box (pill background, subtle border, 8px radius) with a leading icon: red `ri-error-warning-line` for danger, purple `ri-information-line` for primary. An inline ErrorNote. Right-aligned "Cancel" (secondary) and the confirm button (variant); pending shows a spinner and "Working...". Used for deactivate, churn client, remove pod member. |
| **Drawer** | `open`, `onClose`, `header` (ReactNode), `children`, `footer?`, `width`: md (max-w-md) / lg (max-w-2xl, default) | Right-side slide-in panel (0.22s), backdrop black at 50% with a 2px blur (click closes), Escape closes. App background, left border, shadow. Sticky header (blurred header background) with a "Close panel" ✕; a scrolling body (px-6 py-5); an optional pinned footer. Used for the job detail panel. |
| **ErrorNote** + **SuccessNote** | ErrorNote: `error` (falsy renders nothing), `fallback`, `className`. SuccessNote: `message`, `className` | Inline one-line status. Error: red 12% background, red text, `ri-error-warning-line`, 8px radius, px-3 py-2, 12px medium, role=alert; it shows the server's `detail` string (or joins pydantic messages) and otherwise the fallback. Success: the same shape in green with `ri-check-line`. Exports the `apiErrorMessage()` helper. |
| **Toast** (ToastProvider + `useToast`) | `notify(message, "success" or "info")`, `notifyError(error, fallback)`, `notifyAlert({key, title, body, icon?, to?, onDismiss?, onDismissAll?})` | Stack fixed bottom-right, width min(24rem, 100vw − 2.5rem), 8px gap, scrollable. Each toast: 12px radius, border, px-3.5 py-3, 12px medium, xl shadow, blur, fade-in-up, leading icon, ✕ dismiss. Variants: **error** (red tint, never auto-dismisses), **success** (green tint, 6s), **info** (neutral card, 6s), **alert** (card with purple border and glow, bold title above a muted body, never auto-dismisses; if it has a link it shows "Click to open · ✕ to dismiss" and clicking navigates). With more than 3 alerts a sticky "Dismiss all {n} notifications" (`ri-check-double-line`) button appears above them. Duplicate keys are ignored. |
| **Pagination** | `page`, `pageSize`, `total`, `onPageChange`, `onPageSizeChange?`, `noun` (default "results"), `className` | A row with px-4 py-3 and 12px muted text. Left: "Showing {first}–{last} of {total} {noun}" or "No {noun}". An optional rows-per-page select (10/25/50/100, "per page"). Right: First (skip-back icon), "Prev", mono "Page X / Y", "Next", Last (skip-forward icon). Buttons are small, bordered and card-backed, with a purple border on hover and 40% opacity when disabled. |
| **FilterMenu<T>** | `label`, `icon`, `options[{value,label,className?}]`, `selected[]`, `onChange`, `footer?` | Multi-select dropdown button: bordered, 12px semibold, icon + label + count chip (purple, mono) + chevron. When something is selected it gets a purple border, a glow background and light-purple text. The popover is 208px wide with a card background, border and xl shadow; it lists checkbox rows (14px square boxes, purple when checked). Option labels can carry colour classes (e.g. stage colours). An optional footer slot holds extra toggles. A "Clear {label}" link shows when active. It closes on outside click or Escape. Empty selection means no filter. |
| **RushBadge** | `rush: boolean`, `compact?` | Renders nothing unless rush. Rose 15% background, rose-400 text, uppercase bold, `ri-flashlight-fill` + "Rush" (icon only when compact). Tooltip: "Marked urgent: QC2 routing may place this on a reviewer who is already out of points, rather than leaving it unrouted. It does not jump the queue." |
| **Stepper** | `steps: string[]`, `current: number` | Horizontal numbered steps joined by 1px lines; 24px bottom margin. Each step is a 28px circle: current = purple gradient with white number and glow; done = green tint with ✓; upcoming = pill background with dim number. Label is 12px semibold, main colour when current, otherwise dim. Used in the new-job wizard and pod onboarding. |

Patterns repeated across pages that are not yet components (good candidates for the new kit):
- Page header block: eyebrow icon + label, H1, subtitle, right-side actions.
- **Stat tile**, in three variants: role tile with gradient icon chip; KPI card with tinted icon chip; WhatsApp plain stat.
- Search input with a leading icon.
- **Toggle switch** (hand-rolled twice on the WhatsApp page).
- Inline two-step delete (button → "Confirm/Cancel", or "Del/✕").
- Avatar with initials and status dot, plus the "YOU" tag.
- Table shells: glass card with uppercase dim headers.
- Empty state: big dim icon, bold line, muted hint.
- Warning banners in amber and red.
- Spinner + "Loading…" text line.

---


---

# PART C: EXTRAS

## 14. Browser extension: Kontent Voice Notes for Frame.io


**Purpose**: lets reviewers (TLs/QCs) record **timestamped voice notes** while watching a cut on Frame.io. Each note is pinned to the exact video position (`video.currentTime`, millisecond precision), uploaded to the team server (`https://ops.kontentmedia.in`, hardcoded) and **shared with everyone who has the extension** on the same video. The Voice Notes admin page (section 4) is the server-side library of the same notes. Notes expire after 60 days.

**Packaging**: one codebase, two manifests (MV3). Chrome/Edge/Brave uses a service worker; Zen/Firefox uses `background.scripts` (gecko id `kontent-voice-notes@kontent.media`, Firefox 140+, Android 142+). `build.sh` produces `dist/chrome` (+zip) and `dist/zen` (+xpi). Permissions: `storage`. Hosts: `app.frame.io`, `next.frame.io`, `f.io`, and the ops server. The icon is a purple mic (`icons/icon.svg`, rendered at 16/32/48/128).

#### 7.1 Toolbar popup (settings), 340px wide, dark theme
Styling: background gradient #1e1b2e→#151320; text #e2e8f0; header title in lavender #c4b5fd; purple buttons (gradient #7c3aed→#6d28d9); system font stack. The popup does not use the web app's tokens or fonts.
- Header: mic icon + **"Kontent Voice Notes"**, sub-line "Record timestamped voice notes on Frame.io review pages."
- **YOUR NAME**: text, placeholder "e.g. Rahul, Farah, Ishan...", hint "Shown on your voice notes so others know who recorded them".
- **YOUR EMAIL**: email, placeholder "you@kontentmedia.in", hint "Saved with every note you record, so a reviewer can be reached".
- **Connection row**: an 8px dot and a text line.
  - Grey "Checking connection..." / "Checking...".
  - Green "Connected to server" (on `/api/health` OK).
  - Red "Server responded with {status}".
  - Red "Cannot reach server — press Save to grant access".
- **Save** button, with validation errors shown in red for 2.5s: "Enter your name" / "Enter a valid email address".
- **Two-step confirm**: Save is replaced by an amber box reading "This is saved **permanently** and cannot be changed:" with "{name} · {email}" in bold, and the buttons **"Confirm & lock"** (purple) and **"Cancel"** (outline). Confirm also asks the browser for permission to reach the server origin.
- After locking: both inputs are disabled, and a grey note reads "🔒 Saved permanently — your name and email can't be changed." Status shows "✓ Saved", or "✓ Saved — but access to the server was not granted".
- There is no way to edit the identity from the UI. Fixing it means clearing extension storage from devtools.

#### 7.2 In-page UI (content script on Frame.io, rendered in a closed Shadow DOM)
- **Floating bubble**: a 56px purple gradient circle with a white mic icon and a lavender ring and glow. It defaults to the top-right (20px margin), clear of the player controls. It is **draggable** (a pointer drag of more than 4px counts as a drag; the position is saved to storage and clamped on resize). Clicking toggles the panel. Hover scales it to 1.08.
- **Panel**: 340×480 max, the same dark gradient, a 16px radius, a purple border and a big shadow. It opens toward the centre of the screen from the bubble, with a scale/fade animation.
  - Header: mic icon + **"Voice Notes"**. On the right: an **Export** button (download icon, label "Export"; disabled when there are no notes; tooltip "Download all {n} notes for this video as a .zip" or "Nothing to export yet") and an **×** close (red on hover).
  - **Recorder section**:
    - "Video: **{m:ss}**", a live readout of the player position polled every 250ms ("—" if no player is found).
    - A big **"Record Note"** button (purple, with a red dot). While recording it turns red and reads **"Stop & Save"**, and a pulsing timer "0:00" appears.
  - **Notes list** (scrollable, styled scrollbar). Empty: "No voice notes yet for this video". Each note item has:
    - Top line: a timestamp chip (▶ + m:ss.mmm, purple), the duration, a play icon button ("Play this note") and a trash button ("Delete note").
    - Meta line: "{recorded_by or Anonymous} · {date, e.g. 3 Oct, 02:15 pm}".
    - The whole row is clickable (tooltip "Go to {ts} and play this note"). It **pauses the video, seeks to the exact frame, and plays the note over the paused frame**. The playing row is highlighted, and clicking it again stops playback. Only one note plays at a time, and closing the panel stops playback.
    - Delete happens immediately, with **no confirmation**. Anyone can delete anyone's note.
  - **Status line** at the bottom, coloured by type:
    - recording (red): "Recording..."
    - info (blue): "Uploading..."
    - success (green): "Saved!", "Deleted", "Exported {n} notes"
    - error (red): "Microphone access denied", "Upload failed: …", "Could not load audio", "Could not play audio", "Export failed: …", and the seek failures "No video player found on this page", "Player has not loaded yet — try again", "Player would not seek that far (not buffered yet)", "Player refused to seek"
    - progress (purple): "Downloading note {i} of {n}…", "Zipping…"
  - **Export**: downloads every note's audio and a `notes.csv` index into `{assetId}.zip`. Files are named `001_0m14s250_Farah.webm`. The CSV columns are #, timestamp, timestamp_seconds, duration, recorded_by, email, recorded_at, file. While exporting, the button label shows progress, e.g. "3/7".

#### 7.3 Flows and plumbing
- **First run**: install → popup → name + email → Save → Confirm & lock → grant server access → the dot turns green.
- **Record**: open a review page → bubble → Record Note (first time triggers the browser mic prompt) → Stop & Save → upload → list refresh. The timestamp is captured at the moment recording **starts**.
- **Review**: click a note → video seeks and pauses → audio plays.
- All network calls go through the background script (to avoid CORS and mixed-content issues). Message types: UPLOAD_NOTE (multipart audio + metadata + identity), FETCH_NOTES (by video URL), DELETE_NOTE, FETCH_AUDIO (returns a data: URL), BROADCAST_SEEK (relays a seek to whichever frame holds the player), GET_CONFIG.
- Video detection scores every `<video>` element, including those inside shadow roots and iframes, to pick the real player rather than thumbnails.
- Audio is recorded with MediaRecorder (webm/ogg).

Design notes for the redesign: the extension has its own hardcoded dark-purple style, not shared with the app. It runs inside Frame.io's own (dark) UI, so the panel must be compact, high-contrast and must not collide with Frame.io's comment UI.

---


---

## 15. The earlier prototype (`kontent-ops-v4.jsx`)

Useful as design inspiration: it shows ideas (filmstrip progress, "bot fires next" preview, WhatsApp cost model, service-window cards) that the current app dropped.


**What it is**: a self-contained React prototype (≈1,200 lines, default export `KontentOps`), likely built as a Claude artifact. It persists to `window.storage` with keys `km4:pods`, `km4:jobs`, `km4:outbox`. It uses **lucide-react** icons and a **plain Tailwind slate/white palette**, quite unlike today's purple glass theme. All data is seeded and in-memory; there is no backend. Its main demo is the **WhatsApp bot**: it simulates which templated message fires on each pipeline move, the 24-hour free window, and the cost. It is a design ancestor of today's app: the same pipeline, roles, pods, QC routing and WhatsApp concepts.

#### 8.1 Visual language
- Light only. Page background slate-50; cards white with a slate-200 border and 8px radius. Typography: sans, with mono for numbers and codes.
- Primary actions are solid slate-900 buttons; active filter pills are slate-900 with white text.
- Role colour coding (kept in today's app):
  - TL: indigo (chip indigo-100/800, bar indigo-500)
  - VE: teal
  - QC: amber
- Status chips: emerald = good, rose = bad/rush/overdue, amber = warning.
- Toast: centred at the top, emerald or rose, lasts 2.6s.
- Section labels: xs uppercase tracking-wider slate-400 (the same "eyebrow" convention as today).

#### 8.2 Shell
- **Left rail** (224px, white):
  - App name "Kontent OS", with Frame.io and WhatsApp mini-badges.
  - A **pod switcher** dropdown (TL/Owner only): the client name, "TL {name}", and per-pod open-job counts.
  - Nav (lucide icons).
  - A **"Your WhatsApp window"** card: "Open · 3h 12m left" (emerald) or "Closed — templates only", with a "Simulate a reply" button.
  - A **"Viewing as"** select to impersonate any seeded user ("Mukul — Owner", "Abhishek — TL", …).
- **Header**: page title, plus a context sub-line: "{n} waiting on you · {n} bot messages" for VE/QC; "{n} sent · {x}/{y} windows open" on the bot view; otherwise "{client} · {n} in flight".

#### 8.3 Navigation per role
- **VE**: My work, My progress.
- **QC**: My QC queue, QC team load.
- **TL**: Pipeline, Brand kit, Members, Editor capacity, QC team load, WhatsApp bot, Insights.
- **Owner**: All pods, plus everything the TL has.

#### 8.4 Screens
- **All pods** (overview): a 2-column grid of pod cards. Each card shows the client, the Frame.io project, a status chip ("{n} overdue" rose or "On track" emerald), and In flight / Delivered / Assets counts. Clicking a card opens that pod's pipeline.
- **Pipeline**:
  - Search "Search jobs".
  - Filter pills: Active, Overdue, each of the 8 stages, All.
  - **JobTable** columns: Job (title + Rush chip; code · client), **Pipeline** ("filmstrip": 8 tiny bars, with the current stage wider and coloured by owner role, past stages grey, plus a "×{rounds}" counter that turns red at 3 or more), Frame.io (version badge "v2" with an amber unresolved-comment count and a link), Due ("3d left" / "Due today" amber / "2d overdue" rose / "Delivered" emerald, plus the date), and a chevron.
  - Empty: "Nothing here."
- **My work / My QC queue**: a **"What the bot sent you"** card showing the 3 latest WhatsApp bubbles, then search, the pills "Waiting on me" (or "Awaiting my review"), "All open" and "Everything", and the JobTable.
- **Job drawer** (right side, max-w-xl):
  - Header: client chip, code, Rush chip, title, filmstrip, stage chip "{Stage} · {owner}", due label, Frame.io badge.
  - **"Move this job"** card with role-specific buttons:
    - VE: "Mark sent to QC" / "Changes done" (teal).
    - QC: "Pass QC 2" (amber) and "Request changes" (amber outline).
    - TL/Owner: "Advance to {next}" / "Back to QC 2" (slate), "Approve & deliver" (emerald, at Final), "Send back" (at QC1/Final).
    - Otherwise: "With {owner}. Nothing for you yet."
  - **"Bot fires next"** preview: a chip ("Free — window open" or "Template · ₹0.115"), "To {name} · {template}", and a WhatsApp bubble.
  - **Frame.io** card: Version, Open comments, Rounds, and the review link. If there is no asset: "No asset yet. Created on the editor's first upload."
  - **QC 2 routing** card: the assigned reviewer and the routing reason (e.g. "Routed to Tanvi — 1 open (2 pts), knows this pod"), plus a "Reassign" list showing each QC with "{n} open · {pts} pts".
  - **Activity** timeline: date, actor role chip, text.
  - "Delete job" link.
- **Brand kit**: a 2-column grid of asset cards. Each card has a type chip (Brand brief / SOP / Asset kit / Do-not list, each with its own icon and colour), a title and a note.
- **Members**: a table with Member, Role chip, Open count, and WhatsApp ("window open · 5h" or "templates only").
- **Editor capacity**: one card per editor with the open count (rose at 4 or more), a "reachable free" chip, Delivered, Clean % (first-pass), and per-pod chips (dashed when the editor is only certified; ✓ when certified after 3 clean deliveries).
- **QC team load**: one card per reviewer with an availability dot, "Idle — next in line" / "Unavailable" / "window open" chips, Open / Load "{x}/8" / Cleared, and a load bar (amber, rose when over capacity).
- **WhatsApp bot**, the core of the prototype:
  - 4 stat tiles: Sent this session (free/billed split), Windows open x/y, Session spend ₹, Blocked (rose).
  - An indigo cost callout: "At 300 videos a month: roughly ₹{x} if nobody ever replies (6 templates per video), or ₹{y} if the first message gets a tap and the rest ride the free 24h window. That gap is the whole reason every template ends in a button."
  - **Service windows** grid: each person with an open or closed dot, role chip, time left, and a "reply" simulation button.
  - **Template registry** list: each template's name, category, a status chip ("Approved" / "Pacing · 7 days" / "Awaiting Meta"), "Immediate/Digest · to {role}", the body, and button chips.
  - **Outbox**: the last 12 messages, each with recipient, job code, a chip ("Free-form · ₹0" / "Template · ₹0.115" / "Blocked"), the time, any blocked reason, and the bubble. Empty: "Nothing sent yet. Advance a job in the pipeline and the bot fires."
  - **Event map** table: Trigger | Goes to | Template.
- **Insights** (per pod):
  - 4 tiles: In flight, Overdue, First-pass rate, Bot messages.
  - A **"Where work is sitting"** horizontal bar chart by stage, with bars coloured by owner role.
- **My progress** (VE): tiles for Open now, Delivered and Bot messages, plus "Recent from the bot" bubbles.

Prototype vs today:
- Stages were Intake → Assigned → Editing → QC 1 → QC 2 → Revisions → Final check → Delivered, each with an owner role.
- QC weights were Light 1 / Standard 2 / Heavy 4 against a capacity of 8. Today it is video-type points (1/3/6) against 24/12 per day.
- The prototype had 10 templates with different wording and an INR cost model. Today's WhatsApp admin page has no cost or spend view, and the prototype's "Bot fires next" preview in the job drawer does not exist in the current app. Both are worth considering in the redesign.

---

## 16. Known inconsistencies, gaps & redesign opportunities (consolidated)

These are places where the current UI is confusing, contradicts the rules, or is missing something. Fix them in the redesign (or consciously keep them).

**Navigation & IA**
1. TL is allowed to open **QC Auto-Router** but has no sidebar link to it.
2. VE's pipeline is "My Edit Pipeline" in the sidebar but "Pipeline Table" in the header.
3. The `?view=bot` **"WhatsApp Bot"** screen still says "WhatsApp notifications aren't connected yet / Phase 2", but WhatsApp **is built** (Owner → WhatsApp Setup). Either remove this screen or merge it into WhatsApp Setup.
4. Owner can reach Team Directory (`/hr`) only by URL/search, with no nav item.
5. Voice Notes route allows Owner + Founder's Office, but FO has no nav item; the permissions doc says Owner-only. Decide one rule.
6. No mobile layout: the sidebar never collapses, and bot history is hidden below `lg`.
7. Several developer-facing strings appear in the UI (doc paths like "docs/12-qc2-load-model.md", "Phase 2", formula blocks). Rewrite them for humans.

**Pipeline & jobs**
8. The 8 status tabs appear **twice** on the pipeline screen (status cards and pill buttons). Consolidate.
9. Assigned, QC 1 and Final check share an identical indigo badge, so every stage needs its own look.
10. There is no "scrapped" visual on the stage badge; it only shows in a banner and the row tint.
11. Scrapped banner and restore helper print raw stage keys ("qc2") instead of labels ("QC 2").
12. Channel is editable in two places on the job (field pencil and the "Which channel" section).
13. "Your next step" and "How urgent" use the same flashlight icon.
14. "Mark delivered" isn't visually blocked by the unticked delivery checklist; the user finds out from a server error. Show the gate up front.
15. Drawer header shows the pod but not the round; full page shows the round but not the pod. Unify.
16. No confirmation modals for risky actions (they rely on a typed reason ≥10 chars). Consider adding confirm steps for scrap, reassign, deliver.
17. No "bulk un-mark rush" in the New Job wizard (only "Mark rush").

**People & admin**
18. Owner deactivates via a plain confirm; HR uses a richer modal (open-work warning + reason). Use one flow for both.
19. **Phone number can't be edited after onboarding** (Edit details covers name + email only), yet the WhatsApp Numbers tab says to edit it on Users & Roles.
20. **No self-service WhatsApp opt-in screen**, even though the API (`/whatsapp/me`) exists and consent is meant to be personal. Add it to the profile menu or a "My settings" page.
21. WhatsApp **pilot list** (`pilot_user_ids`) has no editing UI.
22. Users & Roles empty-state copy refers to "the form on the left", but the form is now a modal.

**Notifications & bot**
23. No notification mute/sound setting.
24. Bell badge has no overflow cap (e.g. "99+").
25. No confirm on channel archive or conversation delete.
26. The Kontent Bot floating widget is mounted only on Analytics. Consider making it available on every lead screen.

**Missing screens worth designing (product gaps)**
- **My profile / settings** page: name, phone, password change (API exists: `POST /auth/change-password`), WhatsApp opt-in, notification preferences, theme.
- **Editor's own progress / certification** view: the docs say certification is "shown to the editor as progression on their own profile", but no such screen exists. (Must not show rankings or comparisons.)
- **Person profile** page (search currently has no destination for non-editors except the HR directory).
- **WhatsApp cost/spend view**: the prototype had one; the current admin page doesn't.
- **"What will be sent next"** preview on a job (prototype's "Bot fires next").

---

## 17. Designer deliverables checklist

Design **both light and dark** themes, and **desktop + mobile** for at least the starred (★) screens.

| # | Screen / component | Roles to show variants for | States to design |
|---|---|---|---|
| 1 | Login ★ | — | default, error, loading |
| 2 | App shell: sidebar, header, search, bell, profile menu, impersonation banner ★ | Owner, TL, QC, VE, HR, multi-role | pod selector on/off, impersonating |
| 3 | Overview dashboard ★ | Owner, TL | loading ("—"), zero states, overdue pods |
| 4 | Pipeline Table ★ | Owner, TL, VE, QC | 8 tabs, filters active, bulk-select bar, 4 row tones, empty variants, loading, pagination |
| 5 | Pipeline Board (Kanban) | same | empty column, "+N more" |
| 6 | Job detail drawer + full page ★ | Owner, TL, VE, QC (each sees different actions) | every stage, BriefGate, send-back mode, scrapped, QC1 flagged, delivered, checklist gate, errors |
| 7 | Modals: reassign editor, scrap/restore, QC1 flag/clear, add link, rush | lead / QC | validation (≥10 chars), pending, error |
| 8 | New Edit Jobs wizard (3 steps, single + paste modes, bulk tools) | Owner, TL | skipped lines, editor full, server error |
| 9 | QC Auto-Router | Owner, TL | unrouted reasons (5 variants), no QC accounts |
| 10 | My QC Queue ★ | QC | available/unavailable, spent out, carried points, 5 groups, claim |
| 11 | Team Capacity (Editors / QC tabs) | Owner, TL | full editor, part-timer, unavailable, spent out |
| 12 | Client Pods (cards, members drawer, channels drawer) | Owner, TL | paused/churned, empty |
| 13 | Onboard Client wizard | Owner, TL | validation |
| 14 | Brand Kit (list + upload) | lead (edit) vs member (read) | empty, versions |
| 15 | Analytics | Owner, TL | no data, per-pod |
| 16 | Kontent Bot (full page + floating widget) | Owner, TL | streaming, tool chips, 7 chart types, bot disabled, daily cap reached, billing error, empty |
| 17 | Notifications inbox + desktop alert settings + live toast ★ | all | unread/read, 11 notification types, push permission states |
| 18 | Global search dropdown ★ | all (scoped) | 4 result groups, scrapped/archived/left labels, no results |
| 19 | Users & Roles | Owner, HR | add teammate, change role, lend TL, capacity, employment type, reset password, deactivate |
| 20 | Team Directory (HR) | HR, Owner | onboard, offboard with open-work warning |
| 21 | Voice Notes library | Owner | per video, play, bulk delete |
| 22 | WhatsApp Setup (5 tabs) | Owner | kill switch, template statuses, delivery log, numbers/opt-in |
| 23 | 404 page | — | — |
| 24 | New: My profile/settings, editor progress (see §16) | all / VE | — |
| 25 | Design system / component library (§7 list) | — | all component states (hover, focus, disabled, error) |

**Handover requirements for the frontend build**
- Keep React + Vite + TypeScript + Tailwind (current stack) unless agreed otherwise; data via React Query; colours via CSS variables.
- Keep all URL-addressable state (§6.4) and the 30-second polling.
- Never compute counts or filter lists in the browser; use the API params and `total`.
- Never show the Actual (client) deadline to non-leads (the API already strips it; don't fake it).
- Keep every existing feature in §1. This is a redesign, not a feature cut.
