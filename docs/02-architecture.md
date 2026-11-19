# Architecture

## Stack

| Layer | Choice |
|---|---|
| Backend | FastAPI (Python), async |
| ORM / migrations | SQLAlchemy + Alembic |
| Database | PostgreSQL |
| Frontend | React (Vite) + Tailwind |
| Auth | Email + password, JWT session tokens |
| File storage | Plain disk on the VPS (no S3/MinIO for v1) |
| Real-time | None for v1 — polling/refresh on navigation |
| Deployment | Docker Compose, self-hosted on Kontent's own VPS |
| Reverse proxy | Nginx (TLS termination, serves the built frontend, proxies `/api` to FastAPI) |

No BaaS (Supabase/Firebase). Both frontend and backend are owned outright —
deliberate, since the team plans to add custom AI/analytics features over time
and doesn't want to be boxed in by a managed platform's data/auth model.

## Why these choices (decision log)

- **Postgres over MongoDB.** The domain is relational (Pod → Member → Job —
  a pod carries its client's attributes directly, there's no separate
  Client table), QC routing and certification require live aggregate queries and
  read-then-write consistency, and the future AI chatbot is a text-to-SQL
  problem — LLMs are far more reliable generating SQL than Mongo aggregation
  pipelines. `JSONB` columns cover the few places that genuinely need flexible
  shape (event payloads, webhook bodies) without giving up relational
  integrity everywhere else.
- **FastAPI over Django.** API-first (no server-rendered pages needed), async
  native, lighter weight. No built-in admin panel — not needed, the whole
  point is a purpose-built UI for TL/Owner data management.
- **Polling over WebSockets for v1.** Nobody asked for sub-second updates;
  periodic refresh is dramatically simpler to build and operate. Revisit if
  usage shows people actually need instant cross-screen updates.
- **Plain disk over object storage for v1.** At current scale (a few hundred
  brand-kit files) a disk folder is simplest. Structure uploads so a later
  move to S3/MinIO/R2 is a path swap, not a rewrite: keep file references as
  `pod_id/asset_type/filename`, never hardcode `/var/...` paths outside one
  storage module.
- **Uploaded files are served through the API, not as a static mount.**
  `GET /pods/{pod_id}/brand-assets/{id}/download` re-checks pod membership on
  every read; a static Nginx location would hand anyone with the URL a
  client's brand kit. It also means the swap to object storage later is a
  signed-URL change in one handler rather than a web-server config change.
  (For a while there was no download path at all — files could be uploaded
  and listed but never opened.)
- **Docker Compose over bare metal.** Reproducible, easy to redeploy or move
  to a new VPS, easy to hand to another developer.

## Deployment topology

```
Internet
   │
   ▼
 Nginx (TLS, :443)
   ├── /            → static React build
   └── /api/*        → FastAPI container (:8000)
                            │
                            ▼
                       Postgres container
                            │
                            ▼
                   Disk volume: /data/uploads
```

Three containers: `app` (FastAPI), `db` (Postgres), `web` (Nginx serving the
built frontend + reverse-proxying `/api`). A named Docker volume backs
Postgres data and `/data/uploads` so both survive container rebuilds — back
both up.

## Environment / config

Single `.env` per environment (dev / prod). No secrets committed. Config read
via `app/core/config.py` (Pydantic `BaseSettings`), never scattered `os.getenv`
calls through the codebase — one place to see every required env var.

## Escape hatches deliberately left open

- `JobEvent.payload` is `JSONB` — new event types don't require a migration.
- File storage is behind a single module (`app/services/storage.py`) so
  swapping disk → S3-compatible storage later touches one file.
- Notification delivery is behind a single interface
  (`app/services/notify.py`) with one implementation today (`in_app`) — see
  [Roadmap](08-roadmap.md) for how WhatsApp plugs into the same interface
  later.
