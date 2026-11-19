# Redesign – implementation status

**Not yet built or run.** Node.js was not available in the environment where this was implemented, so
`npm run build` (`tsc -b && vite build`), `npm run lint` and a browser check have **not** been run. Every
changed file was checked only for balanced brackets and by reading it. First step for the developer:

```powershell
cd frontend
npm install
npm run build      # fix any type errors first – there may be a few
npm run dev        # then look at each screen, light and dark, as each role
```

**Original code backup:** `design-review/frontend-src-backup/` (copy of `frontend/src` before any change),
plus `design-review/index.html.frontend.bak` and `frontend-src-backup/../tailwind.config.js.bak`.
There is no git repository in this folder, so use these (or `git init` + diff) to see exactly what changed.

## Done

**Foundations**
- `src/index.css` – new light/dark tokens (text colours now ≥ 4.5:1), semantic `--ok/--warn/--bad-*`, `--stage-*`
  colours, global keyboard focus ring, `prefers-reduced-motion`, flat cards (no blur/glow), `.card-interactive`,
  `.skeleton`, `.k-table`, `.num`, neutral `.avatar-circle`, solid brand mark. Old gradient logo classes removed.
- `tailwind.config.js` – `darkMode` follows `data-theme`; the 300–600 shades of amber/emerald/rose/purple/indigo/teal/
  sky/violet/cyan/orange now resolve to CSS variables (light theme → readable 700 shade). This fixes the ~300 bare
  `text-amber-400`-style classes everywhere **without editing each file**.
- Mechanical sweep across all `.tsx`: `text-[10px]`/`text-[11px]` → `text-xs`, `hover:-translate-*` / `hover:scale` /
  `backdrop-blur` removed, primary gradients → flat primary, `uppercase tracking-wider` labels → sentence case,
  KPI numbers `font-mono … font-extrabold` → `.num … font-bold`.

**Shared components** (`components/ui`, `components/layout`, `hooks`)
`Button` (sm/md/lg, flat), `Input`, `Select`, `Badge`, `PillButton`, `Stepper`, `RushBadge`, `StageBadge`
(per-stage tokens + dot), `Modal` & `Drawer` (role=dialog, aria-labelledby, Escape, focus trap + restore),
`useFocusTrap`, `Toast` (live region, tone border), new: `Field`, `TabBar` + `Segmented`, `Avatar`, `Skeleton*`,
`EmptyState`, `ErrorState`, `Banner`, `BrandMark`, `PageHeader`, `AuthLayout`.

**Screens**
- App shell: tinted/indicator nav, 14px nav, collapsible Admin group (remembered), 22px title, friendly role chip,
  measured impersonation banner (no hard-coded offset), profile menu with dark-mode switch, OS theme default.
- Login, Forgot password, Reset password (split layout, visible labels, live password rules), 404 (role-aware).
- Overview (needs-attention cards, health strip, pods sorted most-overdue first), Pipeline (tabs with counts,
  9-column 14px table with sticky header), **Board** (compact fixed-height cards, deadline chips, per-column overdue
  count from the server, Delivered collapsed to a rail, table/board choice remembered).
- Video Editor home (`EditorQueue`), QC queue tabs, Job panel (next step first, collapsible sections, 22px title),
  Job page (breadcrumb, wider), Client Pods (compact cards + Manage drawer), HR directory (strip + table),
  Users & Roles (header, filters with counts, avatars), Notifications (list first, settings in a drawer),
  Brand Kit hub + Brand kit header (gradient hero removed), Video Types (table + add form), WhatsApp (banners,
  tab bar, status card), Analytics header, Chat (15px bubbles, aria-live), Onboarding (labels + side panel),
  Team Capacity header (+ garbled characters fixed).
- Role chips are neutral (`ROLE_META` badge/ring/dot no longer coloured).

## Finished in the second pass
- Board: leads open on Board the first time (stored choice wins afterwards); on phones the board shows one stage at a time with a stage tab strip.
- Analytics: 3-cell stat strip (first-pass, avg rounds, stuck jobs) and a single stacked stage bar + legend; editor and stuck lists side by side.
- Team Capacity: stat strip, shared segmented control, and one `PersonCard` for editors and QC reviewers (slot bar you can count, status pill, facts); Skeleton / EmptyState used.
- Job page: real two-column layout (`JobDetailContent page`) with the next step, corrections and scrap pinned in a sticky right column; the panel keeps the stacked order.
- Voice Notes: table + "Open notes" side panel + shared confirm dialog for "delete all"; skeleton and empty state.
- Users & Roles: aligned table (Person, Role, Extra access, Capacity, Status) with a "⋯" menu for Edit details / Reset password / Deactivate; reset password is a modal; fields still save on change.
- New Job wizard step 3: bulk-apply controls relabelled (Editor, Video type, Channel, Client date, Team date) with 36px controls, 14px table inputs, sticky footer.

## Still not done / not checked
- Never built or run (no Node here): expect a few type errors on the first `npm run build`; nothing viewed in a browser, in dark mode, or on a phone.
- Wizard: the controls are restyled but still the per-control "Apply" pattern (not one combined "Apply to all" button), and the bulk panel appears only when rows are selected.
- Other older "Loading…" lines and hand-written empty blocks across smaller components are untouched.
- The pipeline table header no longer sorts by video type / rush / channel (the URL deep links still work).
- Contrast of every remaining ad-hoc colour, keyboard flow and the mobile layouts of the pages above have not been verified.
## Mobile app / PWA (third pass)
- **Installable:** `public/manifest.webmanifest`, icons in `public/icons/` (192, 512, maskable, 180 apple-touch, favicon), theme-color + Apple meta tags + `viewport-fit=cover` in `index.html`, pass-through fetch handler in `sw.js` (still caches nothing). Install button (Android/Chrome) and Share → Add to Home Screen steps (iPhone) in `InstallCard`, shown as a dismissible banner and on the More page.
- **Phone layout (< 768px):** `MobileShell` replaces the sidebar: per-platform header (iOS nav bar + large title, Android app bar + "New job" button), bottom tab bar per role (lead: Home/Pipeline/Inbox/Capacity/More; editor: My queue/Inbox/Brand kits/More; QC: Queue/Inbox/Brand kits/More; HR: Directory/Inbox/More), back button on pushed screens, search, client picker. New `/more` page (profile, install, dark mode, notification settings, secondary pages, sign out). Safe-area insets, `100dvh`, no tap highlight / overscroll bounce.
- **Sheets:** `Drawer` becomes a bottom sheet with a grabber on phones.
- **Pipeline on phones:** table rows render as cards carrying every table field.
- **Table ↔ Board parity:** Editor and QC reviewer are now columns 3–4 of the table (right after Stage) and both are shown on every board card. The board card now also shows client, channel, rounds, "waiting on you"/QC1-flagged labels, actual deadline, cut link and scrapped-by/reason; the table gained a "Next: TL/VE/QC" line (the board column's whose-move tag). Nothing was removed from either view.
- Not done on phones: bulk "file under channel" checkboxes (table only), pull-to-refresh, swipe actions, Capacitor store wrapper.