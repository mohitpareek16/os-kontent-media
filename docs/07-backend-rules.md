# Backend rules (FastAPI)

## Folder structure

```
app/
  main.py            # app instantiation, router registration, middleware
  core/
    config.py        # Pydantic BaseSettings — every env var read here, nowhere else
    security.py       # JWT encode/decode, password hashing
    deps.py           # require_role(), require_pod_member(), get_current_user()
  models/            # SQLAlchemy ORM models, one file per entity
  schemas/           # Pydantic request/response models, one file per entity
  api/
    routers/         # thin route handlers — one file per resource (jobs.py, pods.py...)
  services/          # business logic — routing.py, certification.py, notify.py, storage.py
  db/
    session.py
    migrations/      # Alembic
```

## The core rule

**Routers stay thin. Business logic lives in `services/`.** A route handler
parses the request, calls a service function, returns the response — it does
not contain scoring math, permission logic, or multi-step state transitions
inline. This is what keeps the QC routing algorithm, certification check, and
notification dispatch each defined exactly once, callable from anywhere
(an API route today, a scheduled job or the future AI chatbot's tool-calling
layer tomorrow) without copy-pasting the logic into a second place.

## Permissions

Every route that touches pod-scoped data depends on `require_pod_member(pod_id)`
or `require_role(...)` from `core/deps.py` — never an inline `if user.role !=`
check written fresh in a handler. One implementation, reused everywhere; see
[Permissions](04-permissions.md) for the actual matrix these enforce.

Three service functions carry the rules that don't fit a dependency, because
they need the resource loaded first:

- `services/access.py::job_scope_clauses(user)` — row visibility for any list
  query, and `can_read_job()` / `require_job_read()`, its single-row mirror.
  **Both halves must exist.** The list endpoint scoped rows correctly while
  `GET /jobs/{id}` checked only the VE case, so every other role could read
  any job in the company by id. A scoping rule that lives in only one of the
  two read paths is not a scoping rule.
- `services/access.py::ensure_assignable_editor()` — the target of an
  assignment is validated, not just the actor.
- `services/stage_machine.py::can_advance()` — role × current stage × target
  × ownership, kept next to the transition table because which moves exist
  and who may make them are one rule together.

**A route with no permission dependency and no service check is a bug, not a
public endpoint.** `POST /jobs`, `POST /jobs/batch` and `POST /jobs/{id}/advance`
all shipped that way.

## Validation

Enum-backed columns are validated in the Pydantic schema with `Literal`, never
left to the database. A free string (`weight="gigantic"`, `status="exploded"`)
reached Postgres and came back to the caller as a **500**; it should be a 422
naming the allowed values. The same goes for length and range rules —
`password` had `min_length` on the reset endpoint and nothing on account
creation, so the only thing enforcing 8 characters on a new account was a
`minLength` attribute in the browser.

## Identifiers

Human-facing reference codes come from a database sequence
(`services/codes.py`, migration 0004), never from `count(rows) + 1`. The count
version broke twice over: two concurrent creates read the same count and the
loser died on the unique index, and deleting any row made the count go
backwards so every later create collided forever.

## Migrations

- Alembic, one migration per schema change, generated via `alembic revision
  --autogenerate` and reviewed by hand before committing — autogenerate
  misses things like renames.
- Never edit a migration that's already been applied anywhere (including your
  own dev DB history once shared) — write a new one.
- Migrations are the only place schema changes happen. No manual `ALTER
  TABLE` against a running database.

## API design

- REST, resource-based routes (`/pods/{id}/jobs`, `/jobs/{id}/events`), plural
  nouns.
- Consistent error shape across every endpoint (`{"detail": "..."}` — FastAPI
  default, don't invent a second error format).
- Every list endpoint paginates from day one, even at current scale — adding
  it later means changing every caller.
- **Filtering, searching and sorting belong in the query, next to the
  pagination.** A paginated endpoint that leaves filtering to the caller is
  worse than an unpaginated one: the client asks for a large page to have
  something to filter, so the page size stops being a limit and starts being
  a silent cap, and the `total` it pages against counts rows the user isn't
  being shown. Several endpoints drifted into exactly that — a table would
  request 500 or 1000 rows and slice them in the browser.
- Every list endpoint answers in the same envelope (`schemas/common.py::Page`
  — `items`, `total`, `page`, `page_size`), where `total` counts rows matching
  the filters. Counts a screen shows *outside* its rows (unread notifications,
  status-tab counts, roster totals) are computed over their own scope and
  returned alongside, never derived from `items`.
- `sort_by` is user input reaching an `ORDER BY`, so it is a whitelist of
  column names, never a passthrough. Always add a unique tiebreak (`id`) to
  the ordering: a tied sort lets the database order rows differently per page,
  which shows one row twice and hides another.
- `JobEvent` rows are **written by services, not by routers directly** — any
  code path that changes a job's stage calls the same
  `services/events.py::record_event()`, so the event log can never be
  accidentally bypassed by a new route.

## Notifications

`services/notify.py` exposes one function — `notify(user, event)` — and it
writes exactly one in-app `Notification` row. Extra *deliveries* of that
notification hang off it rather than beside it: it queues the row's id, and
`services/dispatch.py` fans that id out to desktop push
(`services/push.py`) and WhatsApp (`services/whatsapp/`) after the response
has been sent. Never a parallel notification path, and never a second place
that decides who gets told.

Three consequences worth keeping:

- **The queue belongs to the notification, not to a channel.** It lived in
  `push.py` while push was the only consumer, and dropped everything when VAPID
  keys were absent — which left a WhatsApp-only deployment with an empty queue.
- **Delivery happens after the response, in a fresh session.** `notify()` runs
  inside the caller's transaction, before the commit that makes the row real;
  sending from there announces work a later failure rolled back. Re-reading the
  ids afterwards is what makes a rolled-back notification send nothing, with no
  outbox table.
- **A failed delivery never raises into the request.** Each channel's flush is
  wrapped, and the senders below it return rather than throw.

See [WhatsApp notifications](13-whatsapp.md).

## Testing

- Service-layer logic (routing score, certification threshold, permission
  checks) gets unit tests — this is where the actual business rules live and
  where a silent regression is expensive.
- Routers get integration tests against a test database, not mocked
  dependencies — the goal is confidence the whole request path works, not
  just that a function returns the right value in isolation.
- **Every permission hole that gets found gets a regression test**, phrased as
  the exploit: "a VE cannot create a job in a pod they aren't in", "a QC
  cannot read a job from another pod by id". The five holes listed in
  [Permissions](04-permissions.md) all passed code review and all survived a
  live end-to-end verification session, because both were reasoning about
  what the UI offers. Only `curl` as the wrong role finds them.
- Tests run against a separate `kontent_test` database, created and dropped by
  the suite — never against the dev database, which holds real work.
- CI (`.github/workflows/ci.yml`) runs the backend suite and a full frontend
  `tsc -b` + `vite build` on every pull request and every push to master. The
  deploy workflow is separate and only runs on master.
