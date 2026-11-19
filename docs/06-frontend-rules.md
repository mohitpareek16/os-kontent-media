# Frontend rules (React)

These are binding conventions, not suggestions. The single biggest risk on a
React codebase this size is silent duplication — the same job-status badge or
fetch-and-cache logic rewritten five times across five screens. Every rule
below exists to prevent that.

## The core rule

**Before writing a new component or hook, check if one already exists that
can be reused or extended.** If you're about to copy-paste JSX or fetch logic
from one file into another, stop — extract it instead. Two near-identical
20-line blocks are a component/hook that hasn't been extracted yet, not two
features.

## Folder structure

```
src/
  api/              # one file per resource — raw fetch calls, typed request/response
    jobs.ts
    pods.ts
    users.ts
  hooks/            # wraps api/ with React Query — this is what components call
    useJobs.ts
    usePods.ts
    useAuth.ts
  components/
    ui/             # generic, domain-blind primitives: Button, Badge, Modal, Table, Avatar
    pipeline/       # job/stage-specific: StageBadge, JobCard, RevisionCounter
    pods/           # PodSwitcher, PodCard, CapacityBar
    analytics/       # charts, stat tiles
  pages/            # route-level components, compose hooks + components — no business logic here
  lib/              # pure utility functions (date formatting, scoring math mirrors, etc.)
  types/            # shared TS types, generated or hand-kept in sync with backend schemas
```

A component that starts feeling specific to one page but might be needed
elsewhere goes in the closest domain folder (`pipeline/`, `pods/`,
`analytics/`), not duplicated. A component that's genuinely domain-blind
(no knowledge of "job" or "pod") goes in `ui/`.

## Components

- **One concept, one component.** `StageBadge`, `RoleChip`, `RoundCounter` —
  anything rendered in more than one place gets pulled out the *first* time
  it's about to be reused, not the third.
- **Presentational components take props, not fetch data themselves.** Data
  fetching lives in hooks, called from `pages/`, passed down as props. This is
  what keeps a component reusable in a different context later — a
  `JobCard` that fetches its own job by ID can't be reused in a list that
  already has the data.
- **No inline style duplication.** Shared visual language (role colors, stage
  colors, spacing) lives in Tailwind config / a small `theme.ts`, not repeated
  className strings across files. If you're typing the same `bg-indigo-100
  text-indigo-800` string in a third file, that's a variant of an existing
  component, not new markup.

## Hooks

- **All server state goes through React Query** (`useQuery`/`useMutation`),
  wrapped in a domain hook — `useJobs(podId)`, `useAssignJob()`,
  `useDeliverJob()`. Components never call `fetch`/`axios` directly.
- **Shared logic that isn't server state** (form validation, the QC scoring
  display mirror, permission checks) becomes a hook the moment it's needed in
  a second place — `usePermission(action)`, `useJobRouting()`.
- **Don't create a hook for something used exactly once with no reuse in
  sight.** Extraction is for duplication, not for its own sake — see the
  no-premature-abstraction rule in the general engineering conventions.

## State management

- Server state: React Query, cached by resource key (`['jobs', podId]`,
  `['pods']`) — invalidate the specific key on mutation, don't refetch
  everything.
- Client-only UI state (modal open, selected pod in the switcher): local
  `useState` or a small Zustand store if it needs to be shared across
  distant components. No Redux — unjustified complexity at this scale.

## Theming

Every colour comes from a CSS custom property (`var(--text-main)`,
`var(--bg-card)`, `var(--primary)`, `var(--accent-red)`…), defined once in
`index.css` for both themes. The theme is a `data-theme` attribute on
`<html>`. A hardcoded hex or a bare Tailwind colour that only reads on one
background is a bug in the other theme — and nobody notices, because the
person who wrote it only ever looked at one.

## Don't render numbers you don't have

Placeholder values that look like data are worse than an empty state: a
hardcoded "100% first-pass" or "0 overdue" on a dashboard is read as a fact
and acted on. If the API doesn't provide it yet, show an em dash, or don't
show the tile. The same goes for screens that claim a Phase 2 integration is
"active" — say what isn't built yet and link to the doc.

## Lists are the server's job

A screen never downloads a list to filter, sort, count or paginate it. Every
one of those is a query param, and the page it gets back carries the `total`
behind it (see [Backend rules](07-backend-rules.md) § API design).

This is not a performance rule, it is a correctness one. A `.filter()` over a
fetched page silently answers a *different* question than the user asked:
"the matches among the rows we happened to download". That is how the pipeline
table came to say "Page 1 / 1" over a slice of a 1000-row fetch, how a QC
queue stopped showing work past its 500th job without saying so, and how the
notification bell capped its unread badge at the page size.

- One page per screen. `Pagination` (`components/ui/Pagination.tsx`) is the
  only pager — it renders the numbers the server sent and reports clicks.
- Debounce search inputs (300ms) and use react-query's `keepPreviousData`, so
  the table doesn't blank out between pages.
- A count in a header or tile must come from the server, not from
  `items.length`. If a view deliberately shows fewer rows than exist (a board
  column, a queue group), say `+N more` — never let a capped list read as the
  whole set.
- `useX` hooks that back a *picker* may ask for one bounded page and hand back
  a plain array; hooks that back a *table* return the page envelope. They are
  different questions, so they are different hooks.

## Session expiry

`api/client.ts` is the only place that knows about auth failures: a 401
clears the session and redirects to login. Without it, an expired token left
the app looking signed-in while every request silently failed, because route
protection only checked that a token *string* existed in localStorage.

## Consistency checks before opening a PR

- Did I duplicate a fetch call that already exists in `api/` or `hooks/`?
- Did I duplicate JSX that already exists as a component in `components/`?
- Does this component fetch its own data when it could take props instead?
- Is this a generic UI primitive that belongs in `ui/`, not buried in a
  feature folder where the next person won't find it?
