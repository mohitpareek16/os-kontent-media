import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { POD_STATUS_META, PodCard } from "@/components/pods/PodCard";
import { Pagination } from "@/components/ui/Pagination";
import { PillButton } from "@/components/ui/PillButton";
import { useCurrentUser } from "@/hooks/useAuth";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePodList } from "@/hooks/usePods";
import { useUsers } from "@/hooks/useUsers";
import type { PodStatus } from "@/types";
import { hasRole, isAdmin } from "@/lib/roles";

const STATUS_TABS: (PodStatus | "all")[] = ["all", "active", "paused", "churned"];

const PAGE_SIZE = 24;

export default function PodsPage() {
  const { data: users } = useUsers();
  const { data: me } = useCurrentUser();

  const [statusFilter, setStatusFilter] = useState<PodStatus | "all">("all");
  const [searchInput, setSearchInput] = useState("");
  /* Debounced — typing a name shouldn't be one request per character. */
  const search = useDebouncedValue(searchInput).trim();
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, search]);

  /* Status and search are query params. `counts` comes back with the page
   * and ignores the status filter, so the tabs still say where to go next. */
  const { data: podPage, isLoading } = usePodList({
    status: statusFilter,
    search: search || undefined,
    page,
    page_size: PAGE_SIZE,
  });
  const visiblePods = podPage?.items ?? [];
  const counts = podPage?.counts;

  const isOwner = isAdmin(me);
  /** Only a TL or Owner account can lead a pod, and only an active one — the
   * server rejects anything else with a 400. */
  const tlOptions = useMemo(
    () => users?.filter((u) => u.is_active && (hasRole(u, "tl") || isAdmin(u))) ?? [],
    [users],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border-color)] pb-5">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--primary-light)]">
            <i className="ri-group-line" /> Client Pods
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[var(--text-main)]">Client Pods</h1>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Manage rosters, TLs, retainers and brand kits per client — and keep the status honest when
            one pauses or churns.
          </p>
        </div>
        <Link
          to="/pods/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--primary-hover)] px-3.5 py-2 text-sm font-semibold text-white shadow-md shadow-[var(--primary-glow-subtle)] transition-all hover:-translate-y-0.5 hover:shadow-lg"
        >
          <i className="ri-add-box-line" /> Onboard client
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <i className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
          <input
            type="text"
            placeholder="Search client pods..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] py-2 pl-9 pr-3 text-xs outline-none focus:border-[var(--primary)]"
          />
        </div>
        {STATUS_TABS.map((tab) => (
          <PillButton
            key={tab}
            active={statusFilter === tab}
            onClick={() => setStatusFilter(tab)}
          >
            {tab !== "all" && <i className={POD_STATUS_META[tab].icon} />}
            {tab === "all" ? "All pods" : POD_STATUS_META[tab].label}
            <span className="font-mono opacity-70">{counts ? counts[tab] : "—"}</span>
          </PillButton>
        ))}
      </div>

      {isLoading && (
        <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <i className="ri-loader-4-line animate-spin" /> Loading pods...
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {visiblePods.map((pod, i) => (
          <div key={pod.id} className="animate-fade-in-up" style={{ animationDelay: `${i * 50}ms` }}>
            <PodCard
              pod={pod}
              tl={users?.find((u) => u.id === pod.tl_id)}
              canManage={Boolean(isOwner || (me && pod.tl_id === me.id))}
              isOwner={Boolean(isOwner)}
              tlOptions={tlOptions}
            />
          </div>
        ))}
      </div>

      {!isLoading && visiblePods.length === 0 && (
        <div className="glass-card p-10 text-center">
          <i className="ri-group-line text-3xl text-[var(--text-dim)]" />
          <p className="mt-2 text-sm font-semibold text-[var(--text-main)]">
            {counts?.all === 0 && !search
              ? "No client pods yet."
              : search
                ? "No pods match that search."
                : `No ${statusFilter} pods.`}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {counts?.all === 0 && !search
              ? "Onboarding a client creates their pod, its TL and the first brand kit in one pass."
              : "Clear the search or switch to All pods to see the rest of the roster."}
          </p>
        </div>
      )}

      {(podPage?.total ?? 0) > PAGE_SIZE && (
        <div className="glass-card">
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={podPage?.total ?? 0}
            onPageChange={setPage}
            noun="pods"
          />
        </div>
      )}
    </div>
  );
}
