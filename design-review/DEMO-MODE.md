# Demo mode and Vercel test deploy

Demo mode runs the redesigned frontend with dummy data and **no backend**. It is only active when `VITE_DEMO=true`. A normal `npm run build` contains none of the demo code (verified: no demo chunks in `dist`).

## Run locally
```
cd frontend
npm run dev:demo        # http://localhost:5173 (or --port 5174)
npm run build:demo      # production demo build into dist/
npm run preview:demo
```

## Demo accounts (any password works)
| Role | Email |
|---|---|
| Owner / admin | priya@kontent.media |
| Team Lead | karan@kontent.media |
| Editor | ravi@kontent.media |
| QC | dev@kontent.media |
| HR | anita@kontent.media |

The login page also has "Try it as..." buttons. Data lives in the browser (localStorage key `km_demo_db`). Use "Reset demo data" (sidebar or More page) to restore it.

## What is mocked
All API calls are answered by `src/demo/server.ts` through an axios adapter (installed in `src/api/client.ts`). Jobs, stages, advance/reassign/scrap, users, pods, notifications, brand kit, voice notes and WhatsApp all work in-browser. The chat assistant is scripted (`src/demo/chat.ts`). Real push notifications and file uploads to a server do not work.

## Deploy to Vercel without touching the main code
1. Put the project in its own git repo/branch (for example branch `ui-demo`). Do not merge it into main.
2. Vercel > Add New > Project > import the repo, and choose the `ui-demo` branch as the Production Branch (or create a separate Vercel project, which is safest).
3. Root Directory: `Kontent-Ops-master/frontend` (or `frontend`, depending on repo root).
4. Framework: Vite. `vercel.json` already sets build command `npm run build:demo`, output `dist` and the SPA rewrite. No environment variables are needed.
5. Deploy. Open the HTTPS URL on a phone and use Add to Home Screen (iOS Safari) or Install (Android Chrome).

Using the CLI instead: `npm i -g vercel`, then `vercel` inside `frontend`.

## Merging with the real backend later
The UI calls the same API functions as before, so no logic changed. To go live: build with `npm run build` (no demo flag). To strip demo code completely: delete `src/demo`, `.env.demo`, the `VITE_DEMO` branches in `src/api/client.ts` and `src/api/chat.ts`, and the `DemoNotice` usages (AppLayout, LoginPage, MorePage).
