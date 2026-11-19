# Permissions

## The one rule that makes the structure work

**Client Pod TL owns the output. Team Lead owns the person.**

Delivery slipping, QC quality, client escalation → Pod TL.
Growth, pay, leave, performance, conflict → Team Lead.

These can be the same human wearing two hats, but never blur the two
questions — that's how matrix orgs end up with two bosses answering the same
question differently. `Pod.tl_id` and `Team.lead_id` are separate fields for
exactly this reason (see [Data model](03-data-model.md)).

## Two things a role is not

A role in this product answers exactly one question: **what may this person
do.** It is not their job title, and it is not the only role they hold.

- **Job titles are a separate field.** "Graphic Designer", "Social Media",
  "Motion" are `role_titles` rows on a `staff` account. `staff` grants
  nothing — profile, notifications, and that is all — so hiring somebody the
  pipeline has no word for costs no access decision. The old workaround was to
  file them under VE so the onboarding form would accept them, which put a
  designer in editor pickers, QC routing and the certification history.
- **A second role can be lent.** `users.secondary_role` holds one extra role
  on top of the person's own, and the only legal value is `tl`
  (`SECONDARY_ROLES`). It means *a real Team Lead on the pods whose
  `Pod.tl_id` is them* — an editor who runs two client pods of their own, an
  HR who onboards their own clients and leads them, a Founder's Office. Ask
  through `effective_roles(user)` / `has_role(user, "tl")`, never
  `user.role == "tl"`, which is now wrong on its face.

Reach over the work comes from **being handed pods**, not from what a role is
called. That is the whole of the change in this release, and the two roles it
takes reach away from are HR and the Founder's Office.

## Role matrix

"FO" is the Founder's Office. It has no column of its own any more: it is a
role name with no powers, and every existing FO account was migrated to
`secondary_role='tl'` (migration 0017), so read it as the **TL** column. The
same is true of anyone else holding a lent TL — an HR, an editor, a Graphic
Designer — on the pods they were given and nowhere else.

**Custom** is a `staff` account with a job title and no secondary role.

| Action | Owner | TL (own or lent) | QC | VE | HR | Custom |
|---|---|---|---|---|---|---|
| Onboard client (creates the pod) | ✓ | ✓ | — | — | — | — |
| Edit pod settings — rename, pause/churn, retainer (`PATCH /pods/{id}`) | ✓ | ✓ (own pods) | — | — | — | — |
| Reassign a pod's TL (`PATCH /pods/{id}` with `tl_id`) | ✓ | — | — | — | — | — |
| Be a pod's TL (`Pod.tl_id`) | ✓ | ✓ | — | — | — | — |
| Be added to a pod | ✓ | ✓ | ✓ | ✓ | only as a role they hold | only as a role they hold |
| Upload / replace brand brief, SOP, kit, do-not list | ✓ | ✓ (own pods) | — | — | — | — |
| Read + download brand assets | ✓ | ✓ | ✓ (pods they're in) | ✓ (pods they're in) | pods they're in | pods they're in |
| Add / remove pod members | ✓ | ✓ (own pods) | — | — | — | — |
| Add / rename / retire a channel (`POST`, `PATCH /pods/{id}/channels`) | ✓ | ✓ (own pods) | — | — | — | — |
| Read a client's channels (`GET /pods/{id}/channels`) | ✓ | ✓ | ✓ (pods they're in) | ✓ (pods they're in) | pods they're in | pods they're in |
| Read every channel they can see (`GET /pods/channels`) | ✓ | own pods | pods they're in | pods they're in | pods they're in | pods they're in |
| File videos under a channel, one or many (`PATCH /jobs/{id}`, `POST /jobs/bulk-channel`) | ✓ | ✓ (own pods) | — | — | — | — |
| See all pods | ✓ | own pods only | own queue only | — | — | — |
| See all jobs in a pod | ✓ | ✓ (own pods) | in-queue only | own jobs only | — | — |
| Create a job (`POST /jobs`, `/jobs/batch`) | ✓ | ✓ (own pods) | — | — | — | — |
| Edit a job — title, deadline, video type, editor (`PATCH /jobs/{id}`) | ✓ | ✓ (own pods) | — | — | — | — |
| **See a job's client deadline** | ✓ | ✓ (own pods) | — | — | — | — |
| Set a job's client deadline | ✓ | ✓ (own pods) | — | — | — | — |
| Comment on a job (`POST /jobs/{id}/notes`) | ✓ | ✓ | ✓ | ✓ — anyone who can see it | — | — |
| Assign & advance stages | ✓ | ✓ (own pods) | QC2 → final / revisions, on jobs routed to them | own jobs, editor moves only, and only once briefed | — | — |
| Hand a job to a different editor (`POST /jobs/{id}/reassign`) | ✓ | ✓ (own pods) | — | — | — | — |
| Scrap a project / restore it (`POST /jobs/{id}/scrap`, `/restore`) | ✓ | ✓ (own pods) | — | — | — | — |
| See how QC1 went (`GET /jobs/{id}/qc1-pass`) | ✓ | ✓ | ✓ — anyone who can see the job | ✓ | — | — |
| Flag a QC1 as not done (`POST /jobs/{id}/qc1-flag`) | ✓ | — | ✓ — jobs routed to them | — | — | — |
| Clear a QC1 flag (`POST /jobs/{id}/qc1-flag/clear`) | ✓ | — | ✓ — only one they raised | — | — | — |
| Claim an unrouted QC2 job (`POST /jobs/{id}/claim-qc2`) | — | — | ✓ (pods they're in) | — | — | — |
| See own QC load vs the routing cap (`GET /users/me/qc-load`) | — | — | ✓ | — | — | — |
| Deliver to client | ✓ | ✓ (own pods) | — | — | — | — |
| Toggle own availability (`PATCH /users/me/availability`) | ✓ | ✓ | ✓ | — | — | — |
| Analytics of any kind — team or own-trend | ✓ | ✓ (own pods) | — | — | — | — |
| Kontent Bot, the AI chatbot over ops data | ✓ | ✓ (own pods) | — | — | — | — |
| Voice-note library (`/voice-notes/admin/*`) | ✓ | — | — | — | — | — |
| WhatsApp setup — templates, events, delivery log, numbers (`/whatsapp/*` admin) | ✓ | — | — | — | — | — |
| Own WhatsApp opt-in (`GET/PATCH /whatsapp/me`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Read the account directory + role counts (`GET /users`, `/users/stats`) | ✓ | ✓ | — | — | ✓ | — |
| Create user accounts (`POST /users`) | ✓ — any role | — | — | — | ✓ — TL / QC / VE / custom | — |
| Lend or take back the TL role (`secondary_role`) | ✓ | — | — | — | at onboarding only | — |
| Edit / deactivate / reset-password on an existing account | ✓ — anyone | — | — | — | — | — |
| Reset password (HR: only TL/QC/VE/staff accounts, never itself) | ✓ | — | — | — | ✓ (limited) | — |
| Impersonate user account (`POST /auth/impersonate/{id}`) | ✓ — anyone | — | — | — | — | — |

## Notes that matter more than the table

- **The WhatsApp admin page is the Owner's alone, and deliberately narrower
  than the other two admin screens.** Users & Roles and the Voice-note library
  are Owner + Founder's Office; this one is not. It exposes the WABA id, the
  whole company's delivery log, every staff phone number, and a button that
  spends money — and behind it sits a System User token that can message the
  entire team from the business number. `ADMIN_ROLES` is already "the Owner,
  and only the Owner" for exactly this class of thing (accounts, roles,
  impersonation), and widening it later is one constant.

  The exception is `/whatsapp/me`, which anyone may read and write because it
  returns nothing but the caller's own row. Consent that only an Owner can
  record is consent nobody gives — see [WhatsApp](13-whatsapp.md).

  **The public webhook is the one route in the product with no role behind it
  at all**, because Meta cannot carry a bearer token. Its HMAC signature check
  stands in for one, and a quick-reply tap that would move a job is re-checked
  through the same `stage_machine.can_advance` predicate the HTTP route uses.

- **VEs get read access to brand briefs/SOPs for every pod they're a member
  of** — not just their assigned task list. Withholding brand context from the
  person executing the brand is how QC rounds happen. Task visibility is
  scoped to "assigned to me"; context visibility is scoped to "pod
  membership" — these are two different scopes, don't collapse them into one.
- **The QC1 flag is the one place a TL is deliberately not in charge.** QC1 is
  their own review, so the flag that says it never happened is raised by the
  QC2 reviewer and cleared only by that reviewer or the company-wide tier —
  never by the pod TL, who would otherwise be both the subject and the judge.
  Nobody can flag a pass they made themselves, editors cannot flag at all
  (they have the most to gain from discrediting a review of their own cut),
  and everyone who can see the job can see both the evidence and the flag,
  including the editor — the same stance the change list and the edit-bay
  clock already take. See [Pipeline](05-pipeline-and-routing.md).
- **Analytics is a lead surface, full stop.** QCs and VEs get no
  analytics view at all — not a leaderboard, and not an own-trend view either.
  An earlier version of this table promised every role "own analytics (trend,
  not ranking)"; that promise is withdrawn, and it was never built. Performance
  numbers are a management conversation, held by the person accountable for
  the output — see the Pod TL / Team Lead split at the top of this file. A
  metric shown to the person being measured, with no context attached, gets
  optimized for instead of worked with; ranking creative work distorts it
  either way — see [Overview](01-overview.md) design principles.
- **`GET /users/me/qc-load` is not an exception to that.** A QC seeing their
  own weighted load against the 8-point routing cap is an operational readout,
  not a performance metric: it is the number that decides whether toggling
  availability off actually matters, and the QC queue is unusable without it.
  It reports current queue state, never history, quality, or anyone else.
- **"Advance stages" is scoped per role, per move, not per screen.**
  `can_advance()` in `services/stage_machine.py` is the one implementation
  (the route only raises the 403):
  - **VE** — their own assigned job, and only the three moves that make up the
    editor's loop: `assigned → editing`, `editing → qc1`, `revisions → qc1`.
    An editor never clears their own QC and never sends their own job back.
  - **QC** — only a job routed to *them* (`qc2_reviewer_id`), and only out of
    QC2: `qc2 → final` (cleared) or `qc2 → revisions` (change list). They own
    the QC2 stage per [05](05-pipeline-and-routing.md), so clearing it forward
    is theirs; delivery is not.
  - **TL** — anything, on pods where they are `Pod.tl_id`, and it makes no
    difference whether the role is their own or lent. A TL who merely sits in
    another pod as a member does not get that pod's job controls.
  - **Owner** — everything, on every pod.

  Every branch is an independent check, not an `elif`: somebody can be the
  editor on a job *and* the lead of the pod it sits in, and the answer has to
  be the union of what those two people could do.
- **Moving a job off an editor is the pod TL's call, and it carries a
  reason.** Work stalls on the person — off sick, week full, the cut is beyond
  them — and the TL is the one who re-plans it (`check_pod_lead`, same gate as
  scrapping). An editor cannot pass their own job on and a QC cannot move it
  off the person they are reviewing. The reason is mandatory because the swap
  itself is already visible on the job and is not the thing anyone asks about
  later; `POST /jobs/{id}/reassign` is therefore the *only* way to change an
  editor who is already on a job. `PATCH /jobs/{id}` and the
  `assigned_editor_id` passenger on `POST /jobs/{id}/advance` both still make
  the *first* assignment and both now refuse a swap — a route that changes the
  same field without the reason makes the reason optional in practice.
- **Scrapping a project is the pod TL's call, not the editor's or the QC's.**
  It cancels a client commitment, and the reason is mandatory and goes on the
  record with the actor and the timestamp. It reads `check_pod_lead`, the same
  gate as editing a job or delivering it. A delivered job cannot
  be scrapped by anyone. See [Pipeline](05-pipeline-and-routing.md).
- **QC sees "in-queue only,"** meaning jobs currently routed to them for QC2,
  not the whole pod's backlog — they're a shared resource across pods, not a
  pod member with full visibility.
- **Enforcement is server-side**, not just hidden UI. Every API route checks
  role + pod membership before returning data; the frontend hiding a button is
  a UX nicety, not the security boundary. This is not a theoretical rule — it
  was broken in five places at once and every one of them was reachable with
  a valid login and a `curl`: job creation had no check, `GET /jobs/{id}` and
  its event log leaked across pods, `POST /jobs/{id}/advance` accepted anyone,
  brand-asset upload accepted any pod member, and a pod could be created with
  a VE as its TL, which handed that VE full pod-lead powers. The UI hid all of
  it. See [Build status](00-status.md) for the fixes and their regression
  tests.
- **A lead's buttons are narrower than a lead's powers.** Server-side, the
  Owner may make any legal move on any pod and a TL any legal move on the pods
  they lead — that stays true and is what unsticks a job when
  somebody is unreachable. The job panel does *not* draw all of it: a lead is
  offered only the moves their own desk owns (`STAGE_OWNER_ROLE` — intake, QC1
  and the final check), because "Start editing" and "Send to QC2" sitting in
  front of a TL on work that is with the editor is one stray click away from
  a stage the TL's name is now on for work they did not do. The rest is behind
  an explicit **Admin override** toggle, Owner only. Hiding it is a UX
  decision; the API is unchanged and still the boundary.
- **The Founder's Office holds nothing until it is handed pods.** It used to
  be the Owner minus the account tier: every pod, every job, every stage move,
  analytics, the bot, onboarding clients *and* people. It is now a role name
  with no powers, plus whatever an Owner gives it — which for every account
  that already existed is `secondary_role='tl'` (migration 0017) and the pods
  it actually leads.

  Nothing about the account tier changed, because there was never anything to
  change: FO is simply not in `ADMIN_ROLES` any more, so the four
  "cannot administer an Owner" carve-outs it used to need are now the ordinary
  case. Why: a delegate's reach should be the reach it was given, item by
  item, not a role name that quietly means "nearly everything" and has to be
  fenced back in one endpoint at a time.
- **HR onboards people and reads the roster. That is the whole of it.**
  `GET /users`, `GET /users/stats`, `POST /users` — and no pod, no job, no
  queue, no analytics, no bot.

  This reverses the previous release, which made HR a Team Lead over every pod
  on the reasoning that one function could also run delivery. What that
  actually bought was a role whose *name* granted company-wide reach over
  work it was never handed, which is exactly the shape this release is
  removing. An HR who really does run clients gets the TL role lent to them
  and the pods to go with it — and then holds a TL's powers **there**,
  visibly, like everybody else. Three rules still hold the line:
  - **HR cannot create an Owner, a Founder's Office or another HR**
    (`CREATABLE_ROLES` in `schemas/user.py`, enforced in the route with a
    403). Otherwise "create a user" is a self-service promotion path around
    every Owner-only endpoint, and the roster's own headcount becomes
    self-serve. Growing people-ops is an Owner decision.
  - **HR cannot administer an existing account** — no role change, no rename,
    no password reset, no lending of a role — and **cannot impersonate**.
    Those read `ADMIN_ROLES`, which HR is deliberately not in. With no email
    recovery in this system a password reset *is* a session as that account.
  - **HR can switch an account off, and only the kinds it can switch on.**
    This is the one exception to the rule above, and it is deliberate:
    onboarding without offboarding meant every leaver went through the single
    Owner account. The rule is one sentence — **you may deactivate only the
    roles you may create** — which is `CREATABLE_ROLES` again, the same table
    that already governs onboarding and role changes. So HR may deactivate
    and reactivate **TL, QC, VE and staff**, and may not touch an Owner, the
    Founder's Office, another HR, or themselves.

    It is a dedicated pair of routes (`POST /users/{id}/deactivate` and
    `/reactivate`, `require_can_switch_off`) rather than opening `PATCH
    /users/{id}` to HR. That route also changes roles, lends the TL secondary
    and sets capacity; handing over one power is a route, not a field
    exemption that the next field added to `UserUpdate` quietly widens.

    Every path that flips the switch writes a `user_events` row naming the
    actor — the Owner's `PATCH` included. The moment more than one person can
    lock somebody out, "who did this" stops having an obvious answer.

    HR also reads `GET /users/{id}/open-work`: three integers saying how many
    videos, reviews and pods the account still holds. Deactivation reassigns
    nothing, so that is the number the confirm dialog has to show — and it is
    three integers and no job data, because HR reads the roster, not the
    board.
  - **HR is a pod member only where it holds the role.** The old rule was a
    flat "HR accounts are not pod members"; the rule now is that anybody added
    to a pod must hold the `pod_role` they are added as. Same protection —
    `pod_role` decides who appears in editor pickers, QC routing and
    certification history — stated as the thing that is actually true, which
    also lets an HR with a lent TL lead their own pod.
- **The client deadline is shown to the Owner and to the job's own pod TL.**
  Two deadlines exist because there are two facts: `deadline` is what the team
  works to, `client_deadline` is what the client was promised, and the first
  is usually earlier so a revision round has somewhere to go. The whole
  arrangement only works if the team is shown one date, so this one is
  **redacted at the edge of the API, never hidden in the browser**.

  `services/access.py::visible_client_deadline` is the single decision, and
  `leads_pod` is the test it makes — the company-wide tier, or `Pod.tl_id ==
  you`, which is also how a lent TL passes. It has to be applied on every read
  path, and the ones that exist are:

  - the job payloads (`JobRead` / `JobDetailRead`, via `_to_detail`),
  - the activity feed — a `job_updated` event carrying a `client_deadline`
    key is stripped for non-leads (`redact_event_payload`). This is the one
    that is easy to miss: the field can be redacted perfectly while the log
    of it being changed sits one tab away,
  - the bot's `find_jobs` and `get_job_timeline`, which must answer exactly
    what the caller could already read (docs/11).

  There is deliberately **no filter or sort on `client_deadline`**. A
  `client_deadline_from`/`_to` pair would let an editor binary-search a date
  they cannot read, which is the same disclosure by a slower route.

- **Search adds no reach.** `GET /search` carries no `require_role`, and that
  is not an oversight: everyone may search, and each of its three queries
  composes the clause the matching list endpoint already uses
  (`services/search.py` → `job_scope_clauses`, `pod_scope_clauses`, and
  pod-membership for people, which is the `GET /pods/{id}/members` rule). A VE
  searching finds their own jobs; a TL finds their pods' work and the people in
  them; nobody finds a name they could not already reach. This matters because
  a search box is the easiest surface in a product to enumerate an org through
  — one endpoint answering about three tables at once, from a control that is
  on every screen. Whenever a fourth kind of result is added here, it gets its
  scope from the list endpoint that already owns it, never a fresh clause.
- **A role check is not enough on its own — the *target* has to be valid too.**
  A job's `assigned_editor_id` must be an active VE with a free slot
  (`services/access.py::ensure_assignable_editor`); a pod's `tl_id` must be a
  TL or Owner account. Without those, a QC could be set as a job's editor —
  which silently removed the job from every capacity view, since those filter
  on `role='ve'`. A named QC2 reviewer is checked the same way
  (`ensure_assignable_reviewer`). Pod membership is the one part of both
  checks which *grants* instead of refusing: someone from outside the pod is
  added to it as the assignment is made (docs/05, cross-pod capacity). That is
  not a hole — a TL may already add anyone to their own pod, and the pickers
  offer every active account company-wide, so refusing the save only cost the
  TL a detour.

## Impersonation stays with the admin tier

`POST /auth/impersonate/{user_id}` mints a valid token for another account so
an admin can see exactly what a TL, QC or editor sees. It is **admin-only and
stays that way** — a TL cannot impersonate their own editors, and nobody can
impersonate an Owner except an Owner. `ADMIN_ROLES` is the Owner alone, so
this is now one rule rather than a tier with an internal ceiling.

- The route is guarded by `require_impersonator`, which resolves the real
  admin behind the session (see below) and checks it against `ADMIN_ROLES`.
  There is no second path to a token for another user.
- The issued token carries an `impersonated_by` claim, and the UI shows a
  permanent banner plus a one-click "Stop impersonating" revert while it's
  active. Impersonation is never silent.
- The impersonated session has exactly the target's permissions, not the
  Owner's — an Owner impersonating a VE gets 403s on Owner-only routes. That
  is the point: it's for *seeing what they see*, not for acting with borrowed
  authority.
- It is the intended way to debug "why can't this person see their job", and
  the intended way to verify a permission change without asking someone for
  their password. It is not a substitute for the Owner-relayed password reset
  when someone is genuinely locked out.

## Account lifecycle

Accounts are **deactivated, never deleted** (`User.is_active`, admin-only via
`PATCH /users/{id}` — and an owner-level account only by the Owner). Every job, event and notification a person ever touched
references their id, so deleting the row would tear holes in the history the
whole system is built on. A deactivated account is refused at login and on
every authenticated request — checked per-request, not baked into the token,
so switching someone off takes effect immediately rather than whenever their
token happens to expire.

Two flags that look similar and are not:

- `available` — *"don't route new QC work to me today."* Self-service, read by
  `route_qc2`. A holiday, not an exit.
- `is_active` — *"this person has left."* Admin-only, blocks login entirely.

An Owner cannot deactivate their own account, and the last active Owner cannot
be demoted — either would lock everyone out of user admin and impersonation.

## Auth implementation notes

- JWT access token, role and `user_id` in the claims. Pod membership is
  looked up per-request (not embedded in the token) so removing someone from
  a pod takes effect immediately, not after their token expires.
- A single `require_role(*roles)` and `require_pod_member(pod_id)` dependency
  pair in FastAPI, used everywhere — never re-implement an ad-hoc permission
  check inline in a route. See [Backend rules](07-backend-rules.md).
