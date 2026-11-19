# Kontent OS – Frontend Redesign Spec (for the developer)

**Status:** approved by the product owner. **Scope:** `frontend/` only – no API, data or permission changes.
**Visual reference:** open `design-review/index.html` in a browser (needs internet for fonts/icons/Tailwind CDN). "Proposed" there is the target. Sample data in it is placeholder.
**Brand:** primary stays `#7F00FF`. Fonts stay Outfit (headings/numbers), Plus Jakarta Sans (body), JetBrains Mono (codes only – no longer used for numbers).

> Rules while implementing
> 1. Change tokens and shared components first (Phase 1–2); screens inherit most of the fix.
> 2. Every colour must come from a CSS variable (already the rule in `docs/06-frontend-rules.md`). Do not add new bare Tailwind palette classes (`text-amber-400`, `bg-indigo-500/10`…). There are ~294 today – remove them where you touch a file.
> 3. Verify both themes (`data-theme="light"` / `"dark"`) for every change.
> 4. Minimum text size is **12px** (`text-xs`). Body/table/field text is **14px**. Remove every `text-[10px]` / `text-[11px]` (121 / 146 uses).

---

## Phase 1 – Foundations (do first, ~1 day)

### 1.1 `frontend/src/index.css` – tokens

Change values of existing variables (names stay, so nothing else needs renaming).

**Light theme** (`:root` and `[data-theme="light"]` – both blocks must match):

| Variable | Now | New |
|---|---|---|
| `--bg-app` | `#F6F4FA` | `#F7F6FB` |
| `--bg-sidebar` | `rgba(255,255,255,.9)` | `#FFFFFF` |
| `--bg-header` | `rgba(255,255,255,.85)` | `#FFFFFF` |
| `--bg-card` | `rgba(255,255,255,.85)` | `#FFFFFF` |
| `--bg-card-hover` | `#FFFFFF` | `#FAF9FD` |
| `--bg-input` | `#F0ECF8` | `#FFFFFF` |
| `--bg-pill` | `rgba(127,0,255,.06)` | `#F6EEFF` |
| `--border-color` | `rgba(127,0,255,.15)` | `#E6E2F0` |
| `--border-color-hover` | `rgba(127,0,255,.4)` | `#7F00FF` |
| `--border-color-subtle` | `rgba(0,0,0,.06)` | `#EEEAF5` |
| `--text-main` | `#1A1528` | unchanged |
| `--text-muted` | `#6B7280` (4.43:1 ✗) | `#4B4760` (8.2:1) |
| `--text-dim` | `#9CA3AF` (2.5:1 ✗) | `#6B6785` (5.4:1) |
| `--shadow-card` | purple glow shadow | `0 1px 2px rgba(26,21,40,.05), 0 1px 3px rgba(26,21,40,.04)` |
| `--backdrop-blur` | `blur(12px)` | `none` |

**Dark theme** (`[data-theme="dark"]`):

| Variable | New |
|---|---|
| `--bg-app` | `#0E0B18` |
| `--bg-sidebar` / `--bg-header` | `#17122A` |
| `--bg-card` | `#17122A` |
| `--bg-card-hover` | `#1C1632` |
| `--bg-panel-solid` | `#1C1632` |
| `--bg-input` | `#1C1632` |
| `--bg-pill` | `#241A3F` |
| `--border-color` | `#2B2445` |
| `--border-color-subtle` | `#241E3A` |
| `--text-muted` | `#C4BFD9` |
| `--text-dim` | `#9A94B5` |
| `--shadow-card` | `none` |
| `--backdrop-blur` | `none` |

**Add** (both themes) – semantic *text* colours that are readable on their own tint. Keep the existing `--accent-*` for fills/bars/icons only.

```css
/* light */
--ok-text:#047857;  --ok-bg:#E2F7F0;
--warn-text:#92400E; --warn-bg:#FEF1DD;
--bad-text:#B91C1C;  --bad-bg:#FDECEC;
--primary-text:#6D00DB;           /* purple used as text; was --primary-light (#9D38FF) */
--focus-ring:0 0 0 3px rgba(127,0,255,.28);
/* dark */
--ok-text:#4ADE9F;  --ok-bg:rgba(74,222,159,.12);
--warn-text:#FBBF5C; --warn-bg:rgba(251,191,92,.12);
--bad-text:#FF8A8A;  --bad-bg:rgba(255,138,138,.12);
--primary-text:#C4A0FF;
--focus-ring:0 0 0 3px rgba(161,92,255,.4);
```

**Add stage tokens** (both themes) – one place for the stage colours; used by `StageBadge` and charts:

```css
/* light: text on tint (all ≥ 4.8:1) */
--stage-intake-fg:#4B5563;   --stage-intake-bg:#EDEEF0;
--stage-assigned-fg:#1D4ED8; --stage-assigned-bg:#E9EFFD;
--stage-editing-fg:#0F766E;  --stage-editing-bg:#E7F4F3;
--stage-qc1-fg:#6D28D9;      --stage-qc1-bg:#F2EBFD;
--stage-qc2-fg:#92400E;      --stage-qc2-bg:#FEF1DD;
--stage-revisions-fg:#B91C1C;--stage-revisions-bg:#FDECEC;
--stage-final-fg:#075985;    --stage-final-bg:#E2F4FC;
--stage-delivered-fg:#047857;--stage-delivered-bg:#E2F7F0;
/* dark */
--stage-intake-fg:#C4BFD9;   --stage-intake-bg:rgba(255,255,255,.08);
--stage-assigned-fg:#9DB8FF; --stage-assigned-bg:rgba(96,140,255,.16);
--stage-editing-fg:#5EEAD4;  --stage-editing-bg:rgba(45,212,191,.14);
--stage-qc1-fg:#C4B5FD;      --stage-qc1-bg:rgba(167,139,250,.16);
--stage-qc2-fg:#FBBF5C;      --stage-qc2-bg:rgba(251,191,92,.14);
--stage-revisions-fg:#FF8A8A;--stage-revisions-bg:rgba(255,138,138,.14);
--stage-final-fg:#7DD3FC;    --stage-final-bg:rgba(56,189,248,.14);
--stage-delivered-fg:#4ADE9F;--stage-delivered-bg:rgba(74,222,159,.14);
```

**Other `index.css` edits**
- `.glass-card`: remove `backdrop-filter`; border = `var(--border-color)`; hover must **not** change border (only interactive cards get a hover state – see 2.6). Keep the class name so 74 usages keep working.
- `.border-glow`: **delete the `!important` and the glow.** Replace with a plain selected style: `border-color: var(--primary); box-shadow: var(--focus-ring);`. Used 9 times – review each: it should mean "selected", not "decorated" (pod cards on Overview should not use it at all).
- `.logo-big-k` / `.brand-logo-custom`: **bug** – gradient starts at `#FFFFFF`, so the K is invisible on light. Replace the whole logo with a solid mark (see 2.1). Remove `filter: drop-shadow`.
- `.filmstrip-step.active` box-shadow glow → remove.
- Add reduced motion:
  ```css
  @media (prefers-reduced-motion: reduce){
    *,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}
  }
  ```
- Add a global keyboard-focus rule:
  ```css
  :where(a,button,input,select,textarea,[role="button"],[tabindex]):focus-visible{outline:none;box-shadow:var(--focus-ring)}
  ```
- Body: add `font-size:14px; line-height:1.5`.
- Add `.num { font-family: var(--font-display); font-variant-numeric: tabular-nums; letter-spacing:-.02em }` and use it instead of `font-mono` on every KPI/count number (77 `font-mono` uses: keep mono **only** for job codes like `KM-0412`).

### 1.2 `frontend/tailwind.config.js`
- Add `darkMode: ["selector", '[data-theme="dark"]']`. Today `dark:` classes (e.g. `TeamCapacityPanel.tsx`) follow the **OS** setting, not the in-app theme toggle.
- Remove the unused `role.tl/ve/qc` colours **or** move to variables. Add `colors: { ok:'var(--ok-text)', warn:'var(--warn-text)', bad:'var(--bad-text)' }` if useful.

### 1.3 `frontend/index.html`
- Keep the Outfit / Plus Jakarta Sans / JetBrains Mono links. Reduce Outfit weights to `500;600;700` and Plus Jakarta to `500;600;700;800` (drop unused weights → faster load).
- Theme default: in `AppLayout.tsx:56-58` default to `window.matchMedia('(prefers-color-scheme: dark)')` when `localStorage.km_theme` is absent (currently always light).

---

## Phase 2 – Shared UI components (`frontend/src/components/ui/`)

### 2.1 Logo (new `components/layout/BrandMark.tsx`, replaces inline copies in `AppLayout.tsx:255-261` and `LoginPage.tsx:53-59`)
- 36×36 rounded-10 square, background `var(--primary)`, white "K", Outfit 800 22px.
- Beside it: "Kontent" Outfit 800 18px, and "MEDIA" 11px, 600, uppercase, letter-spacing .08em, `var(--text-dim)`.
- Delete `.logo-big-k`, `.logo-text-stack`, `.logo-ontent`, `.logo-media` from `index.css`.

### 2.2 `Button.tsx`
- Add `size?: "sm" | "md" | "lg"` → heights 32 / 40 / 48px, radius 8 / 10 / 10, text 13 / 14 / 15px, weight 700.
- `primary`: **flat** `bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white`, shadow `var(--shadow-card)`. No gradient, no glow.
- `danger`: flat `#B91C1C` (dark: `#DC2626`), hover `#991B1B`.
- `secondary`: `bg-[var(--bg-card)] border border-[var(--border-color)]` + hover `bg-[var(--bg-card-hover)]`.
- **Remove all `hover:-translate-y-0.5`** (29 occurrences app-wide, incl. Button) – it shifts content under the cursor. Hover = colour/shadow only.
- Focus ring comes from the global rule (1.1).
- Replace the hand-rolled "New Edit Job" button in `AppLayout.tsx:357-363` with `<Button size="md">`.

### 2.3 `Input.tsx`, `Select.tsx`, `SearchableSelect.tsx`
- Height 44px for form fields (40px inside dense toolbars via `size="sm"`), text 14–15px, radius 10, `bg-[var(--bg-input)]`, `border-[var(--border-color)]`.
- Remove `outline-none` (there are 41) unless the global focus ring is applied instead; focus state = `border-[var(--primary)] + var(--focus-ring)`.
- New `Field` wrapper (new file `ui/Field.tsx`): `label` (14px, 700, `--text-main`, **above** the input, sentence case – replace all `text-[10px] uppercase` labels), optional `help` (12px, `--text-dim`), optional `error` (13px, `--bad-text`, with icon, `role="alert"`). Use it in LoginPage, PodCard edit form, AddTeammateModal, EditUserDetailsModal, NewChannelInline, BrandAssetUploadForm, WhatsApp admin forms.

### 2.4 `Badge.tsx` + `StageBadge.tsx`
- `Badge`: radius full, height 24, padding 0 10px, 12px/700, leading 6px dot in `currentColor`.
- `StageBadge.tsx` `STAGE_CLASSES` → use the stage tokens:
  `` `bg-[var(--stage-${stage}-bg)] text-[var(--stage-${stage}-fg)]` `` (write the 8 literals out in full so Tailwind can see them).
- `STAGE_BAR_COLORS` (used by `BarList`/Analytics) → switch to the validated `--series-1..8` palette already defined in `index.css`, in stage order, so charts and badges don't invent colours.
- Fix the file's mojibake comments (`â€”` etc.) – re-save as UTF-8.

### 2.5 `Modal.tsx` and `Drawer.tsx` (accessibility – real bugs)
- **Modal:** add `role="dialog" aria-modal="true" aria-labelledby={titleId}`, close on Escape, close on backdrop click, move focus to the dialog on open and restore it on close, trap Tab inside. Remove the duplicate inline `style={{background}}`.
- **Drawer:** add `aria-labelledby`, initial focus + focus restore + trap. Give it a `footer` in `JobDetailPanel` (see 3.6).
- Backdrop: `bg-black/50`, remove `backdrop-blur`. Panels: solid `--bg-card`, radius 16 (modal) / 0 (drawer), shadow `0 8px 24px -8px rgba(26,21,40,.18)`.
- Shared helper: write one `useFocusTrap(ref, open)` hook in `hooks/` and use it in both.

### 2.6 Cards, tabs, tables (new shared pieces – one definition each)
- **`ui/Card.tsx`** (or keep `.glass-card`): radius 14, solid bg, 1px `--border-color`. Add `interactive` prop → hover: border `--primary` + `shadow 0 8px 24px -8px rgba(26,21,40,.18)`; **no translate**.
- **`ui/TabBar.tsx`** (new): horizontal tabs, each `label + count pill`. Height 44, 14px/700. Selected: text `--primary-text`, 2px bottom border `--primary`, pill tinted `--bg-pill`. A tab may be `tone="alert"` (pill `--bad-bg`/`--bad-text`). Overflow → horizontal scroll with no scrollbar on mobile. **This is the single "selected" style for the app.**
- **`ui/DataTable` styles** (CSS class `.k-table` in `index.css` is enough): header 44px, 12px/700, `--text-muted`, sticky (`position:sticky; top:0`), background `--bg-card-hover`; cells padding `12px 16px`, 14px; row border `--border-color-subtle`; hover `--bg-card-hover`.
- **`ui/Avatar.tsx`** (new): initials circle, sizes 26 / 32 / 40, bg `--bg-pill`, text `--primary-text`. Replaces the gradient `.avatar-circle`.
- **`ui/StatTile` / `analytics/StatTile.tsx`:** label 13px sentence case `--text-muted`; value 30px Outfit `.num`; hint 12px; icon neutral (`--text-dim`) – colour only the **value** and only when it signals (see 3.2).

### 2.7 `Toast.tsx`
- Container needs `role="status" aria-live="polite"` (errors: `role="alert"`). Text 14px.

---

## Phase 3 – Screens

### 3.1 App shell – `components/layout/AppLayout.tsx`
- **Sidebar** (`:251`): width 248, solid `--bg-sidebar`, `border-r --border-color`.
- **Nav link** (`renderNavLink`, `:199-212`): height 40, `px-2.5`, `gap-2.5`, **14px/600** – delete `text-sm md:text-xs` (desktop is currently *smaller* than mobile).
  - Inactive: text `--text-muted`, icon `--text-dim`, hover bg `--bg-card-hover`.
  - **Active:** `bg-[var(--bg-pill)] text-[var(--primary-text)]`, icon `--primary`, plus a 3px left bar (`::before`, `--primary`, radius 0 3px 3px 0, inset-y 8px). **Delete** `bg-gradient-to-r from-purple-700 to-indigo-800 … shadow-purple-900/40`.
- **Group labels** (`:286,295,304`): these are `<label>` tags (wrong semantics). Change to `<p>`/`<h2 className="sr-only">`+visible `<p>`, 12px/700, sentence case ("Company-wide", "Client workspace", "Admin"), colour `--text-dim`. Make the **Admin** group collapsible (button + `aria-expanded`), remember state in `localStorage`.
- **"Viewing as" box** (`:315-321`): dashed border `--border-color`, label 12px "Viewing as (simulation)" with eye icon.
- **Header** (`:330`): height 68, solid. Title **22px Outfit 700** (was 18px). Subtitle 13px `--text-dim`; role becomes a **chip** (`Owner`, sentence case – not `.toUpperCase()`): height 22, radius full, bg `--bg-pill`, text `--primary-text`, 12px/700. Search 40px tall, 340px wide, show `⌘K` hint. Bell/profile buttons 40×40 (`NotificationBell`, `ProfileMenu`), bell badge min 18px, `--bad-text` bg → use solid `#B91C1C` + white text.
- **Content wrapper** (`:383`): `p-4 md:p-8` stays; add `max-w-[1360px]` to non-table pages (Overview, Analytics, admin pages). Pipeline table page stays full width.
- **Impersonation banner** (`:235`): replace hard-coded `pt-8` offsets with a CSS variable `--banner-h` set by the banner via `ResizeObserver` (or make it `sticky` in normal flow). Remove `animate-ping`. Use `--warn-bg/--warn-text` instead of the purple gradient so it reads as a *warning state*. Text 13px.
- **`ProfileMenu.tsx`**: items 14px, 40px tall; theme row = labelled switch ("Dark mode"); replace `text-purple-400`/`text-amber-500` icon colours with `--text-muted`.

### 3.2 Overview – `pages/DashboardPage.tsx` (overview block, lines ≈809-1037)
Replace the 8-tile grid with three bands:
1. **"Needs your attention"** – 3 cards, grid `lg:grid-cols-3`: *On my plate* (`showMine` only – if hidden, 2 columns), *Overdue*, *Awaiting assignment*. Each: label 14px/700 + icon right; value **44px Outfit `.num`**; description 13px; footer link "Open in pipeline →" 13px/700 `--primary-text`; 4px left border (primary / `--bad-text` / `--warn-text`). Whole card is the button (keep the existing `openPipeline(...)` handlers). Value colour only when > 0.
2. **"Pipeline health"** – one `Card` with 5 equal cells separated by 1px dividers: *In flight*, *Pending QC 1*, *Delivered*, *First-pass rate* (keep the `<Link to="/analytics">`), *QC 1 flagged*. Label 13px with neutral icon, value 30px, hint 12px. Keep every existing `onClick`/`Link`, `title` and the "don't render numbers you don't have" `"—"` fallbacks.
3. **"Client pods"** – heading 13px/700 + "N clients · sorted by attention needed" (sort: overdue desc, then intake desc – client-side sort over the already-loaded `overview.pods` is acceptable here; it is not pagination). Card per pod: name 17px/700, status pill (use the new `.st` pill: ok / bad / mute with dot), then a **distribution bar** (8px, rounded, segments Intake `--warn-text`, In flight `--primary`, In QC `--stage-editing-fg`, Delivered `--ok-text`, 2px gaps) and a 4-column legend with 18px Outfit numbers. **Remove `border-glow`** from these cards; hover = `interactive` card.
- Remove the five icon-chip hues. Icons are neutral.

### 3.3 Pipeline table – `pages/DashboardPage.tsx` (pipeline block, lines ≈1040-1704)
- **Status cards (`:1044-1065`) → `TabBar`** with the same 8 tabs and the same `statusCounts[key]`, `setFilter`, `title={card.hint}`; *Overdue* gets `tone="alert"` when > 0. Keep `CARD_GRID_COLS` removal (no longer needed). `STATUS_CARDS` keeps its filtering by `statusFilters`.
- **Toolbar:** search 40px (same `searchInput`/debounce logic), `Filters` and `Deadline` as `Button variant="secondary"`, right side: a 12px legend (purple bar = "Waiting on you", amber bar = "QC1 flagged"), then a segmented Table/Board control (keep existing `viewMode` state). Selected-filter chips below, 28px tall, 13px, removable.
- **Table (`:1425`):** remove `w-max`; use `w-full`. Text 14px (delete `md:text-xs`). Make the header sticky (container needs `max-height: calc(100vh - 280px); overflow:auto`).
- **Columns:** `☐ | Video | Stage | Deadline | Client | Editor | QC reviewer | Rounds | ›` (9, was 11).
  - **Video:** title 14px/700; second line 12px: code (mono), video-type `tag`, **Rush tag** (replaces the separate Rush column – use `RushBadge` restyled with `--bad-bg/--bad-text`), "Waiting on you" (`--primary-text`, 700), "QC1 flagged" (`--warn-text`, 700, flag icon).
  - **Deadline:** label 14px/700 coloured with `--bad-text`/`--warn-text`/`--text-main` (replace `DEADLINE_TONE_CLASSES` rose-400/amber-400 in `lib/format.ts`); date 12px `--text-dim`; keep the existing `title` tooltip.
  - **Client:** pod name 14px/600; under it the channel (12px `--text-dim`) or "Not filed". Keep `ChannelCell` behaviour (filing UI) but render it as the 12px second line.
  - **Editor / QC reviewer:** `Avatar` (26px) + name 14px/600; unassigned → "Unassigned" / "Not routed" in `--text-dim`.
  - **Rounds:** `.num` 14px/700; ≥3 `--bad-text`, >0 `--warn-text`, else `--text-dim`.
- Scrapped tab extra columns (`showScrapColumns`) unchanged, just restyled.
- **Row tones (`lib/jobRowTone.ts`):** keep the logic; change `ROW_CLASSES` tints to 4–6% (`mine: bg-[color-mix(in_srgb,var(--primary)_5%,transparent)]`, `qc1_flagged`: `--warn-bg`, `delivered`: no tint, only the 3px left stripe `#10B981`) and `border-l-[3px]`. `CARD_CLASSES` same idea.
- **Empty state:** icon + one sentence + one action, 14px.
- **Pagination.tsx:** 13px text, 32px buttons.
- **Bulk-filing bar (`:≈1340-1420`):** replace `text-[11px]`/`text-[10px]` with 13px; buttons via `Button size="sm"`.

### 3.3b Pipeline board – `pages/DashboardPage.tsx` (`viewMode === "kanban"`, `:1316-1333`) and `BoardColumn` (`:1760-1938`)
The board already exists (one column per stage in `STAGE_SEQUENCE`, per-column `useBoardJobs` query with server totals, "Load 10 more"). Keep **all** of that logic, filters, tab behaviour, polling and the click-to-open `JobDetailPanel`. Change the presentation:
- **Default view:** remember the choice – read/write `localStorage["km_pipeline_view"]` (`"kanban"|"table"`, wrapped in try/catch) in place of `useState("table")` (`:397`). Default for Owner/Team Lead = Board; for Editor/QC = their own views (3.15 / 3.9). Segmented Table/Board control per 3.3.
- **Column** (`BoardColumn` wrapper `:1792`): width **264px** (`w-[264px]`, not 320), `bg-[var(--bg-card-hover)]`, `border-[var(--border-color)]`, radius 12, 12px gap. Header (sticky inside the column): stage name Outfit 14px/700 · total pill (13px, `.num`) · **overdue count** (`--bad-text`, alarm icon, 12px/700 – only when > 0) · right-aligned neutral "whose move" tag (`STAGE_OWNERS[stage]`, `Badge` neutral – **not** indigo). The overdue count must come from the server (add `overdue_count` to the column query response, or a second `useJobs({stage:[stage], status:"overdue", page_size:1})` and read `total`) – do not count the loaded cards.
- **Delivered column:** collapsed by default to a 56px rail (vertical "Delivered" label + total + expand icon); expanding shows it as a normal column. State in `useState`, not persisted.
- **Card** (replaces `:1807-1904`): fixed height 112px, radius 10, `bg-[var(--bg-card)]`, `border-[var(--border-color)]`, `shadow-[var(--shadow-card)]`; tone = **3px left stripe** from `jobRowTone` (`mine` purple, `qc1_flagged` amber, `delivered` green, `scrapped` muted + line-through) – use the same `ROW_CLASSES`-style helper, add `jobCardStripeClass` in `lib/jobRowTone.ts` and delete `CARD_CLASSES` tints.
  - Row 1: code (mono 12px `--text-dim`) left; **Rush** tag (if `j.rush`) + video-type tag right (12px, neutral/`--bad-*` for rush).
  - Row 2: title 14px/700, max **2 lines** (`line-clamp-2`).
  - Row 3 (bottom): **deadline chip** left (24px high, 12px/700: overdue `--bad-bg/--bad-text` + alarm icon, due today/within 1 day `--warn-*`, else neutral; text from `deadlineInfo(j.deadline, j.stage).label`), assignee `Avatar` 26px right (editor for VE stages, QC reviewer at `qc2`; `title` = full name; "Unassigned" / "Not routed" 12px text when empty).
  - **Remove:** the per-card `StageBadge` (redundant), the Editor/QC `<dl>`, the whole `hidden group-hover:block` block, `hover:scale-[1.02]`, `shadow-md`. Hover = border `--primary` only (no size or position change). Focus = global focus ring. Everything that was in the hover block (client pod, channel, actual deadline, rounds, scrap details, flag reason) is already in `JobDetailPanel` on click; show **client pod** as the card's `title` attribute and add it as a 12px `--text-dim` line only on the **Pipeline-all-clients** board when no pod is selected (replace Row 1's code with `pod · code`).
  - Keep `title={TONE_LABELS[jobRowTone(j)]}`; add `aria-label` = "{title}, {stage}, {deadline label}".
- Column body: `overflow-y-auto`, 8px gap, 10px padding; skeleton cards (3.26 `SkeletonCards`) while `isPending`; empty = small `EmptyState` ("Nothing in QC 1"); error = `ErrorState` compact with Retry; "+N more · Load 10 more" → `Button secondary sm` "+{total - jobs.length} more".
- Board container (`:1317-1320`): keep `boardRef` + `useFillViewportHeight`; `overflow-x-auto`, `scroll-snap-type: x proximity` on mobile; no horizontal page scroll. **Mobile (< 768px):** show **one column at a time** with a stage `TabBar` (horizontally scrollable, counts) above the card list at full width – cards 100% wide, same compact card. Do not render the 8-column strip on phones.
- Drag-and-drop is **out of scope**: every stage change is a permission- and rule-checked action (`AdvanceStageControl`, `docs/05-pipeline-and-routing.md`), done from the job panel/page.
- Both themes; contrast per tokens (deadline chips ≥ 4.5:1).

### 3.4 Login – `pages/LoginPage.tsx`
- Desktop (≥1024px): two columns. **Left** (dark `#1A1528`, padding 56/64): `BrandMark` in white text, headline "Every video, from brief to delivery." (Outfit 700 44px), one supporting sentence (16px `#C4BFD9`), row of the 7 stage names as outlined pills, `© Kontent Media` 13px. A soft purple radial glow top-right is allowed here only. **Remove the cyan blob and the ambient blur blobs.**
- **Right** (solid `--bg-card`): form 380px wide, `Welcome back` 28px, subtitle 15px `--text-muted`. Use `Field` components with **visible labels** ("Email", "Password"), 44px inputs, `autoFocus` retained. Password label row has "Forgot password?" link on the right – **wire it to the existing hidden route** only if the product owner enables it (see comments in `LoginPage.tsx:103` and `App.tsx:29`); until then replace it with the helper text "Trouble signing in? Ask your team lead to reset your password."
- Button: `Button size="lg"` full width, text "Sign in".
- Error/expired messages: keep logic; render as 14px alert boxes with `--bad-bg/--bad-text` and `--warn-bg/--warn-text`, `role="alert"`.
- Below 1024px: single column, brand block collapses to a small `BrandMark` above the form.

### 3.5 Analytics – `pages/AnalyticsPage.tsx`
- Remove the duplicate title: delete the eyebrow `<p>` (`:67-69`) and the page `<h1>` (`:70-72`) – the layout header already renders the page title (and there must be one `<h1>` per page). Keep the description as a 14px intro line on the left; put `PodSwitcher` on the right as a segmented control / select.
- **Stat strip** (single Card, 4 cells): First-pass rate, Avg QC rounds (existing `StatTile` data, keep `onClick`s), **Stuck jobs** (`stuckJobs.length`), **Open load** only if derivable from existing `capacities` data – otherwise omit the 4th cell (do not invent numbers).
- **Stage distribution:** one 14px-tall stacked bar (segments in `--series-1..8`) + 8-column legend with 20px numbers, instead of 8 stacked rows. `BarList` stays for the editor chart.
- Lists below in a 2-column grid: "Avg QC rounds by editor" (Avatar + name + bar + value) and "Stuck jobs" (count pill + `JobCard` rows).
- Cross-pod capacity card stays full-width.
- Empty/"company-wide" notice: 14px, no big icon.

### 3.6 Job detail panel – `components/pipeline/JobDetailPanel.tsx`, `JobDetailContent.tsx`
- **Header:** row 1: code (mono 13px `--text-dim`) · `StageBadge` · Rush tag · spacer · "Open full page ↗" (13px/700 `--primary-text`) · close button 36px. Row 2: title **22px Outfit 700** (keep `EditableTitle`). Row 3: `pod · channel` 13px `--text-dim`.
- **Status band** (replaces the hint box `:88-100`): `--bg-pill` background, 1px `--border-color`, avatar of the current holder + "With **{holder}** · {STAGE}" 15px/700, second line 13px (`STAGE_HINTS[stage]`, round), deadline status right-aligned with tone colour.
- **Details card:** `<dl>` 2 columns, label 12px/600 `--text-dim` (sentence case – replace `Field`'s 10px uppercase), value 14px/600, **allow wrapping** (remove `truncate`, add `break-words`). Keep the pencil-edit fields (`ChannelField`, `VideoTypeField`, `DeadlineField`, `ClientDeadlineField`) – show the pencil icon always (not hover-only) for touch.
- **Pinned footer:** pass `footer` to `Drawer` containing the primary stage action(s) from `AdvanceStageControl` (move its main buttons into the footer, keep its secondary/confirm UI in the body when expanded). Left text "Next step for you" 13px.
- **Secondary sections** → collapsible `<details>` cards, collapsed by default: *Files on this job*, *Activity*, *Change requests*, *QC review* (open by default when `showQc1Review` and flagged), *Reassign, rush & channel*. Summary row: title 14px/700 + count + chevron.
- **Danger zone** (`ScrapJobControl`): last, collapsed, red title `--bad-text`, border `--bad-bg`.
- Keep order logic and permission gates (`canScrap`, `canReassign`, `isTeamLead`…) exactly as is.
- Drawer width `lg` (672px) stays; full-width on < 640px.

### 3.7 New Edit Jobs wizard – `components/pipeline/NewJobWizard.tsx`
- Modal `size="full"` stays, but constrain to `max-w-[1280px]`; header holds title + stepper; **sticky footer** with Back (left), status text centre ("2 of 4 rows have an editor"), Create N jobs (right).
- `Stepper.tsx`: completed steps = green check circle (`--ok-text` on `--ok-bg`), current = filled primary circle, future = `--bg-pill`; labels 14px/700; step names sentence case ("Select client", "Add edits", "Assign & create").
- **Step 3 bulk bar (`:≈975-1090`):** one bordered panel titled "Apply to all N videos · {client} · fills empty fields only" (14px/700 + 13px). Controls as `Field`s with 12px labels and **36px** inputs: Editor, Video type, Channel, Team deadline, Client deadline, then one `Button variant="secondary"` "Apply" (single button that applies all non-empty bulk values – if the current per-control Apply semantics must stay, keep them but as `Button size="sm"` not `!text-[10px]`).
- **Rows table:** inputs/selects 36px high, 14px; remove every `text-[10px]` and `!px-2 !py-1` overrides (≈25 places, lines 42-1226). Link column shows 13px `--primary-text` truncated link.
- Replace the 61 bare palette classes (`text-purple-400`, `text-emerald-400`, `bg-purple-500/10`…) with tokens (`--primary-text`, `--ok-text`, `--bg-pill`).
- Validation: show per-row error text (13px `--bad-text`) under the offending field, not only a toast.

### 3.8 Users & Roles – `pages/UsersAdminPage.tsx` (`UserRow`, lines ≈358-700)
- Convert the row list to a table with aligned columns: **Person** (Avatar 36 + name 14px/700 + email 12px), **Role** (`Select`, 150px), **Extra access** (`Select`, 150px), **Capacity** (number input 64px + "at a time" 12px), **Status** (pill: Active `--ok-*`, Deactivated `--bad-*`, "Not taking work" mute), **⋯** menu (36px icon button).
- The ⋯ menu contains: Edit details, Reset password, Deactivate / Reactivate (red). Reset-password inline form opens as a small popover or `Modal`, not inline in the row.
- Filters: two segmented controls (role, status with counts) + "Add teammate" `Button` on the right. Remove `PillButton` 10px labels ("Role", "Account status") – use visible text 13px.
- **Delete** the staggered `animate-fade-in-up` / `animationDelay` on rows.
- Keep all permission logic props (`canAdminister`, `canResetPassword`, `isLastActiveOwner`, …) untouched.
- Same table pattern applies to `pages/HrPage.tsx` (Team Directory).

### 3.9 QC – `components/qc/QcQueuePanel.tsx`, `QcRouterPanel.tsx`, `QcQueueTable.tsx`, `QcJobList.tsx`
- `QcQueuePanel:246-279`: replace the five group cards with `TabBar` (same `GROUPS`, `byKey[...].data.total` counts, `setActive`). Delete `iconWrapClass` / `shadow-purple-900/20` / `slate-300` usage.
- `ReviewerStatusCard`: Avatar + name + availability pill + a slim 8px load bar with percentage label (keep existing data).
- Rows reuse the pipeline row styling (Video cell with code + type tag, client, `StageBadge`, round, chevron). Remove stagger animation.
- `QcRouterPanel`: apply the same tokens/cards; replace 10px labels with 12px+; no new behaviour.

### 3.10 Kontent Bot – `pages/ChatPage.tsx`, `components/chat/ChatThread.tsx`, `ConversationList.tsx`
- Single container card (no nested bordered box): header row (daily-usage pill `--warn-bg/--warn-text` "18 of 25 questions used today", "New chat" ghost button), scroll area, suggestion chips, input bar.
- Message text **15px / line-height 1.6** (was 12px). User bubble: solid `--primary`, white text, radius `16 16 4 16`, max 70%. Bot bubble: `--bg-card-hover`, 1px border, radius `16 16 16 4`, max 80%, `Avatar` with sparkle icon.
- Scroll area gets `aria-live="polite"` (and `aria-busy` while `pending`).
- Chips: 32px tall, 13px, radius full. Input: 48px, Send `Button size="lg"`.
- Warning banner: `--warn-bg/--warn-text` (replaces `text-amber-500` on `bg-amber-500/10`).
- `ChartBlock.tsx`, `ToolActivity.tsx`: text ≥ 12px; chart colours already use `--series-*` – keep.

### 3.11 Mobile (< 768px) – pipeline and general
- Pipeline: below `md`, render each job as a **card** instead of the table (same data): title 15px/700 + `StageBadge` (top row), code + type + rush tags, then deadline (coloured) left and Avatar+editor right. Tap → opens `JobDetailPanel` (full-screen). Tabs = horizontally scrollable `TabBar`; filters behind one `Filters` button; sort behind a `Sort` button.
- Minimum touch target 44×44 for tappable controls on mobile.
- Keep the existing iOS 16px input rule in `index.css` (`@media (max-width:767px)`).
- Banner offset fix from 3.1 applies here.

### 3.12 Screens not mocked up – apply the system, no layout changes
Apply tokens + Phase 2 components + "min 12px text" + "no bare palette colours" + `Field` labels to:
`pages/WhatsAppAdminPage.tsx` (58 bare-palette classes), `VoiceNotesAdminPage.tsx` (24), `VideoTypesAdminPage.tsx` (17), `HrPage.tsx`, `PodsPage.tsx` + `components/pods/PodCard.tsx` (status pills → `.st` pills, remove `from-[var(--primary)]` gradient avatar), `PodOnboardingPage.tsx`, `BrandAssetsPage.tsx` + `components/brand/*`, `NotificationsPage.tsx` + `NotificationWatcher/DesktopAlerts`, `components/capacity/TeamCapacityPanel.tsx`, `ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx` (use the Login split layout), `NotFoundPage.tsx`.
- **`TeamCapacityPanel.tsx` lines 125 and 129:** fix garbled characters (`Â·` → `·`, `â€”` → `—`); re-save file as UTF-8. Replace `dark:text-emerald-300` pairs with tokens.

---

## Phase 3b – Every role (added after review of sections 13–18 of the review page)

### 3.13 One `PageHeader`, one `<h1>` per page (all roles)
- `AppLayout`'s header title (`pageTitle`) is the **only `<h1>`**. Delete the eyebrow + `<h1>` + `border-b` block from: `PodsPage.tsx:53-70`, `HrPage.tsx:82-98`, `UsersAdminPage.tsx:~114-125`, `NotificationsPage.tsx:76-101`, `PodOnboardingPage.tsx:~38-45`, `AnalyticsPage.tsx:65-78`, `ChatPage.tsx:~36-45` ("Ask about your ops"), `TeamCapacityPanel.tsx:100`, `BrandAssetsPage.tsx:~65`, `VideoTypesAdminPage.tsx:20`, `VoiceNotesAdminPage`, `WhatsAppAdminPage`. `JobDetailPage.tsx:89` keeps the job title but as `<h2>`.
- New `components/layout/PageHeader.tsx`: props `description?: ReactNode`, `actions?: ReactNode`, `meta?: ReactNode`. Renders one row: description (14px `--text-muted`, max-w 640px) left, actions right (primary `Button` + optional secondary). No title, no eyebrow, no divider line, `mb-5`.
- `pageTitle` map in `AppLayout.tsx` must cover every route (add Brand Kit hub, Notifications, "Edit user details", per-role Pipeline title).
- Fix the editor mismatch: `VIEW_LABELS.pipeline` is "Pipeline Table" but the editor's sidebar item is "My Edit Pipeline". Make the header use the same label as the sidebar item for the current user (`hasRole(user,'ve') && !isLead(user) ? 'My edit pipeline' : 'Pipeline table'`). Same for QC ("My QC queue").
- Role text in header chip: use `roleLabel(user)` from `lib/roles.ts` (already exists) instead of `user.role.toUpperCase()` ("VE", "FO" are database values).

### 3.14 Role colours (`lib/roles.ts` `ROLE_META`)
- Remove `ring` (gradient) and the per-role `badge` colours (`indigo/amber/teal/rose/sky/slate`). They collide with stage colours (teal = editing, amber = QC2, indigo = QC1).
- Every role chip is **neutral**: `Badge` with `bg-[var(--bg-pill)] text-[var(--text-main)]` + the role's `icon` in `--primary`. Avatars use the shared `Avatar` (3.2/2.6), not role gradients.
- Update users of `meta.ring` / `meta.badge`: `UsersAdminPage.tsx`, `HrPage.tsx`, `AddTeammateModal.tsx`, `EditUserDetailsModal.tsx`.

### 3.15 Video Editor home – `DashboardPage.tsx` (view `pipeline` when `hasRole(user,"ve") && !isLead(user)`)
Render a new component `components/pipeline/EditorQueue.tsx` **instead of** the status cards + table. The full table stays reachable via a "View all my jobs as a table" link (`?view=pipeline&all=1` → existing table). Uses the existing `useJobs` hook with `status: "mine"` / `"active"` – **no new endpoints**; grouping is done on the page of rows returned (the editor's own queue is bounded by `max_concurrent_jobs`; if the server total exceeds the page, show "+N more" per `docs/06-frontend-rules.md`).
1. **Slots card:** "Your slots – N of M in use" (M = `user.max_concurrent_jobs`, N = count of active jobs assigned to the user) with M pills (filled/empty) and a green "You can take K more" pill. If M is not on the user payload, omit the pills and keep only the count.
2. **Do now** (stages `editing`, `revisions`), sorted by deadline ascending (overdue first). Each row is a `Card`: left 4px border (`--bad-text` overdue, `--warn-text` due today, neutral otherwise); top line = `StageBadge` + Rush tag + code (mono); title 16px/700; second line `client · channel · video type`; for `revisions` a red line "Round N — sent back with changes" (from `job.round`); right: deadline in 22px Outfit `.num` + date 12px; far right a `Button` ("Start revisions" for `revisions`, "Continue editing" for `editing`, "Open" otherwise) that opens `JobDetailPanel`.
3. **Up next** (`assigned`): same card, secondary button.
4. **With reviewers** (`qc1`, `qc2`, `final`) and **Delivered recently** (`delivered`, last 10): collapsed `<details>` rows with counts.
5. Empty state: "Nothing waiting on you. New videos appear here when your TL assigns them." (14px, neutral icon).

### 3.16 HR – `pages/HrPage.tsx`
- `PageHeader` with description + `Button` "Onboard employee".
- Replace the 8 role tiles (grid `xl:grid-cols-7` with 8 tiles leaves an orphan "Team member" tile on its own row today) with **one stat strip card**: Total employees · Active · Deactivated (from `stats`).
- Role filter = single segmented control with counts from `roleCounts` (`Everyone, Owner, Team Lead, QC, Editor, HR, Other`); status = second segmented control (Active / Deactivated). Delete the duplicate pill row (`PillButton` ×10).
- Replace the flex rows with a **table**: Person (Avatar 36 + name + email) · Role (neutral chip with icon + `roleLabel`) · Status (pill) · actions (`Edit` secondary sm, `Deactivate`/`Reactivate` ghost sm, red for deactivate; keep the `canSwitchOff(me, person)` gate).
- Audit line ("Deactivated {date} by {actor} — "{reason}"") moves under the status pill, **13px** `--text-muted`.
- Remove `animate-fade-in-up` / `animationDelay` on rows. Success note after onboarding stays (`SuccessNote`, 14px).

### 3.17 Client Pods – `PodsPage.tsx`, `PodCard.tsx`, `PodOnboardingPage.tsx`
- `PageHeader` + `Button` "Onboard client"; `TabBar` (All / Active / Paused / Churned with `counts`) replaces the pill row; search 40px.
- `PodCard` becomes **compact**: Avatar (rounded-10) + name + "TL · {name}" + status pill; three stats (Retainer/mo, Members, Channels – channel count from `useAllChannels` as today; members count only if present on the pod payload, otherwise omit); footer buttons "Brand kit" (link) and **"Manage"**. 3-column grid (`lg:grid-cols-3`), no per-card expansion → no height jumps.
- **Manage** opens a `Drawer` (width `lg`) titled with the pod name and a `TabBar`: **Overview** (billing, retainer, TL, status – the current edit form, with `ConfirmDialog` on churn unchanged), **Members** (`MemberList`), **Channels** (`ChannelList`). All existing components/hooks are reused; only the container changes.
- Remove `animationDelay` entrance. Status pills use the shared `.st` pill (`ok` Active, `mute` Paused, `bad` Churned); keep `POD_STATUS_META.blurb` as the `title`.
- Onboarding page: use `Field` components (2.3), single column max-w 640px, sticky footer with the submit `Button size="lg"`.

### 3.18 Brand Kit & Owner settings pages (Brand Kit is used by every role)
- **Delete the hard-coded dark gradient hero** (`linear-gradient(115deg,#201038…)`, `rounded-[1.75rem]`, the 30px decorative ring, `text-cyan-*`) from `BrandKitHub.tsx:11-19`, `BrandAssetsPage.tsx` (~60-70), `VideoTypesAdminPage.tsx:20`, and the equivalents in `VoiceNotesAdminPage.tsx` / `WhatsAppAdminPage.tsx`. They don't follow the theme and are a different design language.
- `BrandKitHub`: `PageHeader` (description + search 40px on the right) then the standard 3-column pod grid: Avatar 44 + status pill, name 17px, one line "Brief · assets · links · history", footer link "Open brand kit ↗". Radius 14 like every card.
- `BrandAssetsPage` (single client): `PageHeader` with client name as the description line's lead + a `TabBar` (Brief, Assets, Links, History – whatever sections exist today); sections are standard cards.
- `VideoTypesAdminPage`: `PageHeader` description + a right-side chip "4 active · 24 / 12 points per day". Info box → quiet banner (`--bg-pill` bg, `--border-color`, info icon `--primary`) – **no cyan**. Left: one **table** (Name + mono key, QC points input 76px, Repeat review (computed), Status pill, Enable/Disable `Button secondary sm`). Right: sticky "Add a video type" card using `Field`s. Remove the coloured 1px stripe per row and the `index % 4` colour array.
- Voice Notes / WhatsApp setup: same pattern – `PageHeader`, quiet banners (`--warn-*` for the credentials/cost warning), sections as standard cards with `Field`s; replace the 58 bare-palette classes in `WhatsAppAdminPage.tsx` with tokens; status chips use `.st` pills.

### 3.19 Notifications – `NotificationsPage.tsx`, `DesktopAlerts.tsx`
- Content width: `max-w-[860px]`, left-aligned in the content area (not `mx-auto max-w-2xl`).
- `TabBar`: All / Unread (with unread count from `data.unread`); "Mark all read" and **"Notification settings"** as secondary `Button`s on the right.
- `DesktopAlerts` moves **behind** "Notification settings" (a `Drawer` or `Modal`); when alerts are **blocked/denied** show a single dismissible `--warn` banner above the list, otherwise nothing.
- Item: 36px icon square using `--ok/--warn/--bad/--primary` tints (replace `TONE_ICON_CLASSES` rose/purple/amber/emerald-400 text colours); title 15px (unread 700 / read 600 `--text-muted`); second line 14px; note quote in a `--bg-card-hover` box 13px (not italic grey); time 12px `--text-dim` (not mono); unread = bold title + one 8px dot. **Remove** the purple row tint and the 2px left border.
- Group headings ("Today", "Yesterday") 13px/700 sentence case.

### 3.20 QC Reviewer / Team Lead / Founder's Office / HR sidebars
- Sidebar content per role stays exactly as `getWorkspaceItems` (no permission change). Visual rules from 3.1 apply. Roles with a single group (QC, VE, HR) omit the group label and show items directly – **do not render an empty/lone "CLIENT WORKSPACE" label**.
- Founder's Office behaves as a TL with Voice Notes (`/admin/voice-notes`) – keep it in the "Admin" group for that role only.
- `staff` role (no system access): the login error for this case must say "Your account doesn't have workspace access. Ask your team lead." instead of the generic invalid-credentials text (server already distinguishes deactivated accounts with a 403 + detail – extend `loginErrorMessage` in `LoginPage.tsx` if the API returns a detail for staff).

---

## Phase 3c – Remaining screens (review page sections 19–24; these replace the one-line notes in 3.12 and 3.18 for these files)

### 3.21 Team Capacity – `components/capacity/TeamCapacityPanel.tsx`
- Delete the hero `<section>` (`:99-101`, h1 "See the work. See the people.") → `PageHeader` with description "Everyone's workload across the client pods you can access."
- Summary: one stat-strip `Card` with 3 cells (Editors / QC reviewers · Assigned videos · Ready for more); no purple/cyan/green icon tones.
- Editors / QC switch: use the shared segmented control (same as pipeline Table/Board), 40px tall, 14px; search = shared 40px search.
- Split the two huge single-line `<article>` blocks (`:125`, `:129`) into `EditorCapacityCard.tsx` and `ReviewerCapacityCard.tsx` (same props/logic; keep `role="button"`, `tabIndex`, Enter/Space handling and `onClick` → `setSelected`).
- Card: Avatar 44 + name 17px/700 + "Video editor · N client pods" 13px + status pill (`Available` = `.st ok`, `Full` = `.st bad`; QC uses `QC_STATUS` text with the same pills). **Slot bar:** one segment per slot (`max_concurrent_jobs`), filled = `open_count`; text "3 of 4 slots" 28px Outfit `.num`, "1 free" 13px/700 (`--ok-text`/`--bad-text`). Footer stats 13px. Keep `QcLoadBar` for QC (points) but 8px with a numeric label.
- Fix mojibake at `:125` and `:129`; replace `dark:text-*` pairs with tokens.

### 3.22 WhatsApp Setup – `pages/WhatsAppAdminPage.tsx` (Owner only)
- `PageHeader` (no hero). **Status card** (replaces `KillSwitch`): 4px left border `--ok-text` when on, `--text-dim` when off; title "WhatsApp messaging is **on**" 18px Outfit; explanatory sentence 13px; the stop/start `Button` (`danger` when stopping). Keep `useUpdateWhatsAppSettings` and the exact copy (it explains the behaviour).
- **Alert banners** (miscategorised, drifted templates, "Not connected to Meta yet"): shared `Banner` component (new `ui/Banner.tsx`): `tone` = `bad | warn | info`, icon, bold title 14px, body 14px `--text-muted`, optional action `Button size="sm"`. Replace `border-rose-500/30 bg-rose-500/10 text-rose-400` etc. with `--bad-bg/--bad-text`, `--warn-bg/--warn-text`.
- Tabs (`TABS` map, `:135-151`) → shared `TabBar` (Connection, Templates, Events, Log, Numbers); show a red count pill on Templates when `miscategorised.length + drifted.length > 0`.
- `ConnectionTab`: stat strip (4 cells; quality rating shows an icon + word, not colour only: Green ✓ / Yellow ! / Red ✕ via `QUALITY_CLASSES` → tokens). Credentials card = list rows with `Set` / `Not set` pills (`.st ok` / `.st bad`). "Send yourself a test" card: `Field` for template, `Button` + secondary `Button`, result line in a tinted box (`--ok-bg` for sent, `--bad-bg` for failed) – keep `testSend.data` / `scheduler.data` text.
- Remove all 58 bare palette classes; text ≥ 12px; no `text-[11px]`.
- Templates / Events / Log / Numbers tabs: tables use `.k-table` styles (2.6), status uses `.st` pills, long error text 14px.

### 3.23 Voice Notes – `pages/VoiceNotesAdminPage.tsx`
- `PageHeader` description + right-aligned video-count chip. Search 40px.
- Table (`.k-table`): Video (title 14px/700 + URL 12px mono truncated) · Notes (`N notes` tag) · Last note · actions (`Open notes` secondary sm, delete icon ghost sm with `aria-label`).
- **Open notes** = `Drawer`: list of notes with player/transcript as today (reuse `VideoRow`'s expanded content, move into the drawer). Delete = shared `ConfirmDialog` ("Delete N notes?" + irreversible warning) instead of the in-row confirm state (`confirmDeleteKey`).
- Empty state via shared `EmptyState` (icon `ri-mic-off-line`, title, one sentence "Install the Chrome extension on Frame.io review pages…" 14px, link to the extension doc if it exists).

### 3.24 Onboard a client & password pages
- `PodOnboardingPage.tsx`: no title block (`PageHeader` only if needed). Two-column layout ≥ 1024px: **form** (max-w 560) | **"What this creates"** side card (3 checklist rows: pod + TL, brand kit, channels/members can be added). Stepper per 3.7 (Client details → Brand kit). Fields use `Field` with labels: *Client name*, *Team lead* (help "Only active Team Leads and Owners can lead a pod."; options `${name} · ${roleLabel}` not `(TL)`), *Billing currency*, *Videos per month (optional)* (the word "optional" in the label). Submit `Button size="lg"` bottom right "Next: brand kit". Step 2 keeps `BrandAssetUploadForm` and "Skip for now" (`Button secondary`).
- `ResetPasswordPage.tsx` and `ForgotPasswordPage.tsx`: reuse the Login split layout (3.4) with a shorter left headline. Fields: New password + Confirm password with show/hide toggles, **live requirements** (≥ 8 chars ✓ / both match ✓) updated on input, mismatch error shown on blur/typing (not only after submit), `autoComplete="new-password"` kept. Success → `navigate("/login")` as today.
- **Copy to confirm with the product owner:** the reset page says "Open the link from your email again", but `lib/roles.ts` documents that there is no email recovery (an Owner/HR resets passwords in-app and shares them out of band, per `HrPage.tsx`). Make the text match whatever is true; do not ship both.

### 3.25 Job detail (full page) – `pages/JobDetailPage.tsx`
- Replace `BACK_LINK` and the border-b title block with a breadcrumb "Pipeline / KM-0412" (13px, link `--primary-text`) and a title row: `<h2>` job title 26px Outfit 700 (keep `EditableTitle`) + `StageBadge` + Rush tag + `RevisionCounter`. (The single `<h1>` is the layout header – 3.13.)
- Layout ≥ 1024px: grid `minmax(0,1fr) 360px`, gap 24. **Left:** status band, details card (3-col `<dl>`), Files (collapsible, open), Activity (timeline list: dot + text 14px + time). **Right (sticky `top: 90px`):** "Your next step" card (primary action `Button size="lg"` + secondary), then collapsed "Reassign, rush & channel" and red "Scrap this job".
- < 1024px: single column in the order status band → next step → details → files → activity → collapsed sections.
- Load-failure state (`loadFailure(error)`): use the shared `ErrorState` (3.26) inside the same grid area; keep "Try again" (`refetch`).
- Reuse `JobDetailContent` parts (split it into `JobStatusBand`, `JobDetailsCard`, `JobActionsCard`, `JobFilesSection`, `JobActivitySection`) so the **drawer** (3.6) and this page render the same pieces in different layouts, as `docs/06-frontend-rules.md` requires.

### 3.26 Shared states – new components in `components/ui/`
- **`Skeleton.tsx`**: `SkeletonRows({rows})`, `SkeletonCards({count})`, base block = 6px radius, `linear-gradient(90deg, var(--border-color), var(--bg-card-hover), var(--border-color))` shimmer (disabled under `prefers-reduced-motion`). Replace every "Loading…" spinner line for list/table/card data (`DashboardPage:1706`, `UsersAdminPage`, `HrPage`, `PodsPage`, `NotificationsPage`, `TeamCapacityPanel`, `VoiceNotesAdminPage`, `WhatsAppAdminPage` tabs…). Keep a tiny inline spinner only for button pending states.
- **`EmptyState.tsx`**: props `icon`, `title` (17px Outfit 700), `description` (14px `--text-muted`), `action?` (`Button`). Centered, padding 36px, icon in a 48px `Avatar`-style circle. Replace the ~15 hand-written empty blocks (Users, HR, Pods, Notifications, Capacity, Voice Notes, pipeline "No jobs match…", QC groups `empty`).
- **`ErrorState.tsx`** (block-level) and keep `ErrorNote` for inline field errors: icon + "Couldn't load {thing}" 16px/700 + one helpful sentence 14px + `Try again` `Button secondary sm` + collapsed "Show details" (the server `detail` string). Role `alert`.
- **`Banner.tsx`** (3.22).
- **404** (`NotFoundPage.tsx`): remove its `<h1>` (use `<h2>`), big "404" Outfit 44px `--primary`, title, the existing mono path line, `Button` "Back to overview" (role-aware: QC → "Back to my queue", VE → "Back to my pipeline", HR → "Back to the directory" using `homeView`).
- **Toasts** (`Toast.tsx`): card with 4px left border in the tone colour, tone icon, 14px/600 text, close button with `aria-label`; container `role="status" aria-live="polite"` (`role="alert"` for errors) – see 2.7.

---

## Phase 4 – Clean-up & checks
1. **Search-and-destroy list** (must be 0 or justified when done): `text-\[10px\]`, `text-\[11px\]`, `md:text-xs`, `hover:-translate`, `border-glow`, `backdrop-blur`, `from-purple-`, `to-indigo-`, `text-(amber|purple|indigo|teal|rose|emerald|sky|slate)-[0-9]`, `bg-(amber|purple|indigo|teal|rose|emerald)-[0-9]+/`, `font-mono` on numbers, `outline-none` without a replacement focus style, `<label … uppercase>` used as a heading.
2. **Contrast:** body text ≥ 4.5:1, large text/icons ≥ 3:1 in **both** themes. Targets already measured: `--text-dim` on white 5.4:1, `--text-muted` on app bg 8.2:1, all stage badges ≥ 4.8:1.
3. **Keyboard:** Tab through Login, Overview, Pipeline (tabs, filters, rows, checkboxes), open/close the job panel and a Modal using only the keyboard; focus ring visible everywhere; Escape closes Modal and Drawer; focus returns to the opener.
4. **Reduced motion:** with OS "reduce motion" on, no entrance animations/transitions.
5. **Responsive:** check 390, 768, 1280, 1440, 1920 px. No horizontal page scroll; Overview/Analytics content capped at 1360px.
6. **Both themes** for every screen in this spec.
7. `npm run build` (runs `tsc -b`) and `npm run lint` pass; existing `tests/matchesSearch.test.mjs` passes.
8. Do **not** change API calls, hooks, permission checks, or the "don't render numbers you don't have" fallbacks.

## Suggested PR order
1. Tokens + reduced motion + focus ring + Tailwind `darkMode` (Phase 1)
2. `Button`, `Input/Select/Field`, `Badge/StageBadge`, `Modal/Drawer` + `useFocusTrap`, `BrandMark`, `Avatar`, `TabBar`, `PageHeader`, table styles (Phase 2 + 3.13)
3. App shell (3.1) + role names/colours (3.13, 3.14) + Login (3.4)
4. Owner / Team Lead: Overview (3.2) + Pipeline (3.3) + mobile cards (3.11)
5. Video Editor home (3.15) + QC queue (3.9)
6. Job panel (3.6) + Wizard (3.7)
7. HR (3.16) + Users (3.8) + Client Pods (3.17)
8. Analytics (3.5), Chat (3.10), Notifications (3.19)
9. Brand Kit + Owner settings pages (3.18)
10. Shared states (3.26) – ideally land this **before** step 4 so every screen can use `Skeleton` / `EmptyState` / `ErrorState` / `Banner` as it is rebuilt
11. Team Capacity (3.21), WhatsApp (3.22), Voice Notes (3.23), Onboarding + password pages (3.24), Job page (3.25), anything left in 3.12 + clean-up checklist (Phase 4)

Test each PR **as each role** (Owner, TL, QC, VE, HR, FO). Use the Owner's "Viewing as (simulation)" picker – it switches the session to that account.

## Evidence behind the changes (measured, light theme)
| Item | Now | Target |
|---|---|---|
| `--text-dim` on white (meta text, 10–11px labels) | 2.54:1 | 5.38:1 |
| `--text-muted` on app background | 4.43:1 | 8.24:1 |
| Stage badges (assigned/qc1/final indigo-400) | 2.64:1 | 5.8–6.7:1 |
| Stage: editing / qc2 / delivered / revisions | 2.27 / 1.99 / 2.27 / 3.23 | 4.86 / 6.36 / 4.91 / 5.66 |
| "Intake"/"Pending QC1" count (amber-400 on white) | 1.67:1 | 5.0–6.4:1 |
| Tiny text (`text-[10px]` / `text-[11px]`) | 121 / 146 uses | 0 |
| Bare Tailwind palette classes in `.tsx` | ≈294 | 0 in touched files |
| Pipeline columns | 11 (`w-max`, 12px) | 9 (`w-full`, 14px) |
| Visible focus styles | 41 `outline-none` vs 17 `focus-visible` | global ring |
