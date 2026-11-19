# Kontent OS

Internal project management platform for Kontent Media. See [docs/](docs/) for
the full architecture, data model, pipeline logic, and coding conventions —
read `docs/README.md` first.

## Quick start (Docker)

1. Copy `.env.example` to `.env` and fill in real values (at minimum, change `JWT_SECRET`).
2. `docker compose up --build`
3. Run migrations: `docker compose exec app alembic upgrade head`
4. Bootstrap the first Owner login (no route can create the first user — see
   below): `docker compose exec app python -m scripts.create_owner "Mukul" mukul@kontent.media <password>`
5. Frontend: http://localhost — API: http://localhost:8000/api/health

## Local development (without Docker)

**Backend**
```
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env   # point DATABASE_URL at a local Postgres
alembic upgrade head
python -m scripts.create_owner "Mukul" mukul@kontent.media <password>
uvicorn app.main:app --reload
```

**Frontend**
```
cd frontend
npm install
npm run dev
```
Vite proxies `/api` to `http://localhost:8000` in dev — see `vite.config.ts`.

## VS Code

`.vscode/tasks.json` is set up — press **Ctrl+Shift+B** (Cmd+Shift+B on Mac)
to bring up the whole stack via `docker compose up --build`. Other tasks
(stop, migrate, logs, bootstrap owner) are in the Tasks palette
(`Ctrl+Shift+P` → "Run Task").

## Tests

```
cd backend && python -m pytest -q
```

Runs against a separate `kontent_test` database, never the dev one. CI
(`.github/workflows/ci.yml`) runs this plus a full frontend `tsc -b` and
`vite build` on every pull request and push to master; deployment is a
separate workflow.

## Status

See [docs/00-status.md](docs/00-status.md) for the actual, checkbox-tracked
build status — what's verified working end-to-end vs. what's still missing.

Short version: Phase 1 is complete and verified against a real Postgres
database in Docker — auth and per-role permissions, the full job pipeline with
its state machine, QC2 auto-routing and stickiness, the revision loop with
change lists, notifications, certification, delivery checklist, brand assets,
analytics, and the whole frontend (pipeline table, job inspector panel, QC
queue, team capacity, client pods, admin). Frame.io is a permanent manual
link-paste workflow, not an integration in progress — the editor uploads to
Frame.io themselves and pastes the share link on the job, no API involved.
Phase 2 (WhatsApp) is built: a direct Meta Cloud API integration with no BSP
in the middle, where templates are submitted and their approval status read
back through the app's own admin page. It has not yet been run against real
Meta credentials, and messaging ships switched off — see
[docs/13-whatsapp.md](docs/13-whatsapp.md). Phase 3 (the AI chatbot) is built
but unverified against a real model.
<!-- Auto-deploy test: Tue Aug  4 15:48:50 UTC 2026 -->
<!-- Auto-deploy test 2: Tue Aug  4 15:52:20 UTC 2026 -->
