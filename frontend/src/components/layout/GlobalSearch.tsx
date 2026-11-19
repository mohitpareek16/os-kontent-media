import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { StageBadge } from "@/components/pipeline/StageBadge";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { MIN_QUERY_LENGTH, useGlobalSearch } from "@/hooks/useSearch";
import { ROLE_META, hasRole, initialsOf, isLead } from "@/lib/roles";
import type {
  SearchChannelHit,
  SearchJobHit,
  SearchJobMatch,
  SearchPersonHit,
  SearchPodHit,
  User,
} from "@/types";

/** One flattened, navigable row. The kinds are rendered in groups but arrowed
 * through as a single list — a keyboard user moves down past the last job into
 * the first client without noticing the seam. */
type Row =
  | { kind: "job"; to: string; hit: SearchJobHit }
  | { kind: "pod"; to: string; hit: SearchPodHit }
  | { kind: "channel"; to: string; hit: SearchChannelHit }
  | { kind: "person"; to: string; hit: SearchPersonHit };

/** Why a job is in the list when the thing you typed is nowhere on it.
 *
 * Searching "dhan" now answers with Dhan's videos, not only with videos whose
 * *title* says Dhan — which is what people meant all along, and is also
 * indistinguishable from a broken search unless the row says so. */
const MATCH_LABEL: Record<SearchJobMatch, string | null> = {
  job: null,
  pod: "client",
  channel: "channel",
  editor: "editor",
  tl: "pod TL",
  reviewer: "QC reviewer",
};

/** Where a person's result takes you: their work, not a profile page — this
 * product has no profile page, and "show me what Aditya is on" is the actual
 * question behind typing a teammate's name.
 *
 * - A **VE** lands on the pipeline table filtered to them. The table's editor
 *   dropdown is the control that shows it, and it is lead-only, which is why
 *   the whole People group is too.
 * - **Anyone else** lands on the team directory, if the searcher may see it
 *   (`/hr` is HR and the Owner, see App.tsx). A TL searching another TL has
 *   nowhere to be sent, so that row is dropped rather than rendered as a
 *   click that does nothing.
 */
function personTarget(person: SearchPersonHit, viewer: User): string | null {
  if (person.role === "ve") return `/?view=pipeline&editor=${person.id}`;
  if (hasRole(viewer, "hr", "owner")) return "/hr";
  return null;
}

interface GlobalSearchProps {
  user: User;
  /** The pod selector lives in the layout, so opening a client's pipeline
   * means setting it — same hand-off the Overview's pod cards use. */
  onSelectPod: (podId: string) => void;
}

export function GlobalSearch({ user, onSelectPod }: GlobalSearchProps) {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = useDebouncedValue(input);
  const { data, isFetching } = useGlobalSearch(query);

  /* The server echoes the query it answered. Requests race — a slower one for
   * "ac" can land after "acme" — so a response for anything but what is in
   * the box now is treated as still-loading rather than drawn as the answer. */
  const isCurrent = data?.query.trim() === query.trim();
  const results = isCurrent ? data : undefined;

  const tooShort = input.trim().length < MIN_QUERY_LENGTH;
  const showPeople = isLead(user);

  const rows: Row[] = useMemo(() => {
    if (!results) return [];
    const jobs: Row[] = results.jobs.map((hit) => ({ kind: "job", to: `/jobs/${hit.id}`, hit }));
    const pods: Row[] = results.pods.map((hit) => ({
      kind: "pod",
      to: "/?view=pipeline",
      hit,
    }));
    /* A channel opens the pipeline table already filtered to it. The table
     * reads `channel` off the URL, so this is one navigation rather than
     * "open the client, now find the dropdown, now pick the channel". */
    const channels: Row[] = results.channels.map((hit) => ({
      kind: "channel",
      to: `/?view=pipeline&status=all&channel=${hit.id}`,
      hit,
    }));
    const people: Row[] = showPeople
      ? results.people.flatMap((hit) => {
          const to = personTarget(hit, user);
          return to ? [{ kind: "person" as const, to, hit }] : [];
        })
      : [];
    return [...jobs, ...pods, ...channels, ...people];
  }, [results, user, showPeople]);

  /* A new set of results always starts on the first row — leaving the cursor
   * at index 4 while the list shrank to two is how Enter opens the wrong
   * thing. */
  useEffect(() => {
    setActiveIndex(0);
  }, [rows]);

  /* Cmd/Ctrl+K from anywhere in the app. The one shortcut worth a global
   * listener: search is reachable from every screen, and reaching for the
   * mouse to start typing is the thing a search box is meant to save. */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const dismiss = () => {
    setOpen(false);
    setInput("");
    inputRef.current?.blur();
  };

  const openRow = (row: Row) => {
    /* A client or channel result opens that client's pipeline, which means
     * setting the layout's pod selector as well as the view — otherwise the
     * table says "All Clients" while claiming to be filtered. */
    if (row.kind === "pod") onSelectPod(row.hit.id);
    if (row.kind === "channel") onSelectPod(row.hit.pod_id);
    navigate(row.to);
    dismiss();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      dismiss();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!rows.length) return;
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
      return;
    }
    if (e.key === "Enter" && rows[activeIndex]) {
      e.preventDefault();
      openRow(rows[activeIndex]);
    }
  };

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
  const showPanel = open && input.trim().length > 0;

  /* Rows are grouped for the eye and flat for the keyboard, so each group
   * needs to know where it started in the flat list. */
  const jobRows = rows.filter((r) => r.kind === "job");
  const podRows = rows.filter((r) => r.kind === "pod");
  const channelRows = rows.filter((r) => r.kind === "channel");
  const personRows = rows.filter((r) => r.kind === "person");

  const renderRow = (row: Row, index: number) => {
    const active = index === activeIndex;
    const base = `flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
      active ? "bg-[var(--bg-pill)]" : "hover:bg-[var(--bg-pill)]"
    }`;
    return (
      <button
        key={`${row.kind}-${row.hit.id}`}
        type="button"
        /* Mouse and keyboard drive the same cursor — hovering one row while
         * the highlight sits on another is two competing selections, and
         * Enter would open the one you are not pointing at. */
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => openRow(row)}
        className={base}
      >
        {row.kind === "job" && (
          <>
            <i className="ri-film-line shrink-0 text-base text-[var(--text-dim)]" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-xs font-bold text-[var(--text-main)]">
                  {row.hit.title}
                </span>
                {row.hit.scrapped_at && (
                  <span className="shrink-0 rounded bg-[var(--accent-red-bg)] px-1.5 py-0.5 text-xs font-bold uppercase text-[var(--accent-red)]">
                    Scrapped
                  </span>
                )}
              </span>
              <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">
                {[
                  row.hit.code,
                  row.hit.pod_name,
                  row.hit.channel_name,
                  row.hit.editor_name,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {/* Only when the match came in through a relation. On a title
                  hit this line would state the obvious. */}
              {MATCH_LABEL[row.hit.matched_on] && (
                <span className="mt-0.5 block truncate text-xs font-semibold text-[var(--primary-light)]">
                  matched on {MATCH_LABEL[row.hit.matched_on]}
                </span>
              )}
            </span>
            <span className="shrink-0">
              <StageBadge stage={row.hit.stage} />
            </span>
          </>
        )}

        {row.kind === "pod" && (
          <>
            <i className="ri-group-line shrink-0 text-base text-[var(--text-dim)]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-bold text-[var(--text-main)]">
                {row.hit.name}
              </span>
              <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">
                {[
                  row.hit.tl_name ? `TL ${row.hit.tl_name}` : null,
                  `${row.hit.open_jobs} open`,
                  `${row.hit.channels} channel${row.hit.channels === 1 ? "" : "s"}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold uppercase ${
                row.hit.status === "active"
                  ? "bg-[var(--accent-green-bg)] text-[var(--accent-green)]"
                  : "bg-[var(--bg-pill)] text-[var(--text-dim)]"
              }`}
            >
              {row.hit.status}
            </span>
          </>
        )}

        {row.kind === "channel" && (
          <>
            <i className="ri-play-list-2-line shrink-0 text-base text-[var(--text-dim)]" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-xs font-bold text-[var(--text-main)]">
                  {row.hit.name}
                </span>
                {row.hit.archived && (
                  <span className="shrink-0 rounded bg-[var(--bg-pill)] px-1.5 py-0.5 text-xs font-bold uppercase text-[var(--text-dim)]">
                    Archived
                  </span>
                )}
              </span>
              <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">
                {row.hit.pod_name} · {row.hit.open_jobs} open
              </span>
            </span>
          </>
        )}

        {row.kind === "person" && (
          <>
            <span className="avatar-circle h-7 w-7 shrink-0 rounded-md text-xs">
              {initialsOf(row.hit.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-xs font-bold text-[var(--text-main)]">
                  {row.hit.name}
                </span>
                {!row.hit.is_active && (
                  <span className="shrink-0 rounded bg-[var(--bg-pill)] px-1.5 py-0.5 text-xs font-bold uppercase text-[var(--text-dim)]">
                    Left
                  </span>
                )}
              </span>
              {/* Which clients, and how much live work — the two things you
                  are actually checking when you type a teammate's name. The
                  email is the fallback for a person in no pod you can see. */}
              <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">
                {row.hit.pods.length ? row.hit.pods.join(", ") : row.hit.email}
                {row.hit.open_jobs > 0 && (
                  <span className="text-[var(--text-dim)]"> · {row.hit.open_jobs} on their plate</span>
                )}
              </span>
            </span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold uppercase ${ROLE_META[row.hit.role].badge}`}
            >
              {ROLE_META[row.hit.role].label}
            </span>
          </>
        )}
      </button>
    );
  };

  const renderGroup = (label: string, groupRows: Row[], offset: number) =>
    groupRows.length > 0 && (
      <div className="p-1.5">
        <p className="px-2.5 pb-1 pt-1 text-xs font-bold text-[var(--text-dim)]">
          {label}
        </p>
        {groupRows.map((row, i) => renderRow(row, offset + i))}
      </div>
    );

  return (
    <div className="relative w-full md:w-auto" ref={containerRef}>
      <i className="ri-search-2-line pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-[var(--text-dim)]" />
      <input
        ref={inputRef}
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search jobs, clients, channels, people..."
        aria-label="Search jobs, clients, channels and people"
        className="h-10 w-full md:w-[340px] rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-input)] pl-10 pr-16 text-sm text-[var(--text-main)] outline-none transition-all placeholder:text-[var(--text-dim)] focus:border-[var(--primary)]"
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-[var(--border-color)] bg-[var(--bg-pill)] px-1.5 py-0.5 text-xs font-bold text-[var(--text-dim)]">
        {isMac ? "⌘K" : "Ctrl K"}
      </span>

      {showPanel && (
        <div className="glass-card animate-fade-in-up absolute right-0 top-[calc(100%+8px)] z-50 max-h-[70vh] w-full md:w-[520px] overflow-y-auto !p-0">
          {tooShort ? (
            <p className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
              Keep typing — {MIN_QUERY_LENGTH} characters minimum.
            </p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
              {isFetching || !results ? (
                <>
                  <i className="ri-loader-4-line mr-1.5 inline-block animate-spin" />
                  Searching…
                </>
              ) : (
                <>
                  Nothing matches{" "}
                  <span className="font-bold text-[var(--text-main)]">“{query.trim()}”</span> — no
                  job, client, channel or teammate.
                </>
              )}
            </p>
          ) : (
            <>
              {renderGroup("Jobs", jobRows, 0)}
              {renderGroup("Clients", podRows, jobRows.length)}
              {renderGroup("Channels", channelRows, jobRows.length + podRows.length)}
              {renderGroup(
                "People",
                personRows,
                jobRows.length + podRows.length + channelRows.length,
              )}
              <div className="flex items-center justify-between border-t border-[var(--border-color-subtle)] px-3 py-2 text-xs text-[var(--text-dim)]">
                <span>↑↓ to move · ↵ to open · esc to close</span>
                {isFetching && <i className="ri-loader-4-line animate-spin" />}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
