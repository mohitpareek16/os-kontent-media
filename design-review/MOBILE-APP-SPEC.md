# Kontent OS – Mobile app spec (iOS + Android)

Visual reference: `design-review/mobile-app.html` (iOS and Android phone frames, light/dark). Builds on the desktop
redesign (`FRONTEND-REDESIGN-SPEC.md`): same tokens, components and role rules. Nothing here changes the API.

## Approach
One React codebase, delivered as an **installable web app (PWA)**; optionally wrapped with **Capacitor** for App Store /
Google Play later. Below 768px the desktop sidebar layout is replaced by a `MobileShell`; desktop is untouched.

## 1. Installable web app (do first)
- `frontend/public/manifest.webmanifest`: name "Kontent OS", short_name "Kontent", `display: "standalone"`,
  `start_url: "/"`, `theme_color` + `background_color` (`#7F00FF` / `#F7F6FB`), icons 192, 512 and a maskable 512.
- `frontend/index.html`: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`,
  `<link rel="manifest">`, `<meta name="theme-color" media="(prefers-color-scheme: light|dark)">`,
  `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style=default`, `apple-touch-icon` (180px).
- Safe areas: CSS vars `--safe-top/bottom/left/right = env(safe-area-inset-*)`; header, bottom bar, sheets and the pinned
  action bar pad with them. Use `100dvh` (not `100vh`) for full-height layouts.
- Existing `public/sw.js` keeps push. iPhone: Share → Add to Home Screen; web push needs iOS 16.4+ and the installed app.
- Prevent rubber-band/zoom problems: `overscroll-behavior-y: contain` on scrollers, keep inputs ≥ 16px (already in
  `index.css`), `touch-action: manipulation` on buttons.

## 2. MobileShell (`components/layout/MobileShell.tsx`)
- Switch: `useMediaQuery("(max-width: 767px)")` in `AppLayout`; render `MobileShell` instead of sidebar + header.
- **Platform chrome** from `usePlatform()` (`"ios" | "android"` via `navigator.userAgent` / `navigator.standalone`):
  - **iOS:** 44px nav bar (back "‹ Parent" left, actions right), large title (32px Outfit 700) that collapses to a small
    title on scroll, translucent bottom tab bar 49px + home-indicator inset, tint = `--primary`.
  - **Android:** 64px top app bar (title 22px, actions right), Material bottom navigation 80px with a 64×32 pill behind the
    active icon, extended FAB "New job" for leads on Pipeline.
- **Bottom navigation by role** (icons Remix; filled icon when active, count badge on Inbox from `useUnreadCount`):
  - Owner / TL / FO-as-TL: Home (`/`) · Pipeline (`/?view=pipeline`) · Inbox (`/notifications`) · Capacity
    (`/?view=capacity`) · More
  - Video editor: My queue · Inbox · Brand kits · More
  - QC reviewer: Queue (`/?view=qcqueue`) · Inbox · Brand kits · More
  - HR: Directory (`/hr`) · Inbox · More
  - Built from the same `getWorkspaceItems` permissions as the sidebar – never show a tab the role can't open.
- **More** (`/more`, new): profile card (avatar, name, email, role chip), Dark mode switch, Notification settings, then
  the remaining nav items (Analytics, Kontent Bot, Brand kits, Client pods, Users & roles, Video types, Voice notes,
  WhatsApp setup – only those the role may see), Sign out.
- Detail screens (job, brand kit, pod) **hide the tab bar**, show a back button (iOS "‹ Pipeline", Android arrow) and use
  the browser history so swipe-back / system-back work. The job's primary action pins in a bottom action bar.
- Pull-to-refresh on list screens (react-query `refetch`), 30s polling stays.

## 3. Mobile screens (content = desktop redesign, re-laid-out)
Text ≥ 15px body, 12px minimum meta, touch targets ≥ 44px (Android 48px), 16px side gutters.
- **Login:** logo, "Welcome back", labelled 52px fields, 54px primary button, helper line. No brand panel.
- **Home (lead):** "Needs your attention" – On my plate (full width, 44px number), Overdue + Unassigned (half width);
  "Pipeline health" as horizontally scrolling stat cards; "Client pods" cards with distribution bar, most overdue first.
- **Pipeline:** search field, status chips with counts (scroll), Filters chip → bottom sheet, List | Board segmented control.
  List = job cards (title, stage pill, code, type, Rush, client, deadline in bold + assignee avatar; 4px left stripe for
  "waiting on you" / flagged). Board = stage chips with server totals, one column of cards at a time (already implemented as
  the `narrow` board in `DashboardPage`). FAB "New job" (Android) / "+" in nav bar (iOS) opens the wizard as a full-screen
  step flow (one step per screen, sticky footer).
- **My queue (editor):** `EditorQueue` as-is, with slots card, "Do now" cards each with a full-width primary button.
- **QC queue:** availability switch card, group chips with counts, job cards.
- **Job detail:** status pills + title, "with {holder}" band, key-value rows (label left, value right), collapsible rows
  (Files, Change list, Activity, Reassign/rush/channel, Scrap) that open as pushed screens or accordions, pinned action bar
  (secondary + primary).
- **Inbox:** grouped list (Today/Yesterday), icon square, bold title + one dot for unread, swipe to mark read.
- **Capacity / Pods / Users / HR / Analytics / Brand kits:** cards (no tables), same card anatomy as the desktop cards;
  tables become `<dl>` rows; any "Manage" drawer becomes a full-screen sheet.
- **Sheets:** bottom sheet with grabber (iOS 24px radius / Android 28px), drag to dismiss, backdrop tap closes, focus
  trapped (reuse `useFocusTrap`). Replace `Drawer` with a bottom sheet below 768px (same props).
- **Dark mode** follows the OS by default (already in `AppLayout`), switch in More.

## 4. Shared pieces to add
`usePlatform`, `useMediaQuery`, `MobileShell`, `BottomTabBar` (iOS/Android variants), `MobileHeader` (large title / app
bar), `BottomSheet`, `JobCard` (mobile card, reused by list, board and queues), `PullToRefresh`, `SafeArea` utilities.

## 5. Optional: store apps with Capacitor
`npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android`, `npx cap init`, point `webDir` at `dist`.
Add: native push (APNs/FCM replacing web push), biometric unlock, haptics, status-bar style. Needs Xcode (macOS) for iOS
and Android Studio for Android, developer accounts and store review – a separate project from the PWA.

## 6. Suggested order
1. PWA basics (manifest, meta, safe areas, icons). 2. `usePlatform` + `MobileShell` + bottom nav + More. 3. Pipeline list
cards + filter sheet + job detail with pinned action bar. 4. Home, My queue, QC queue, Inbox. 5. Remaining pages as cards.
6. Pull-to-refresh, swipe actions, polish; test on a real iPhone and Android phone, light + dark, with the Owner's
"Viewing as" picker for each role.
