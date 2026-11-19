import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import { POD_STATUS_META, PodCard } from "@/components/pods/PodCard";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { SkeletonCards } from "@/components/ui/Skeleton";
import { TabBar } from "@/components/ui/TabBar";
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
    <div>
      <PageHeader
        description="Rosters, TLs, retainers and brand kits for each client — and keep the status honest when one pauses or churns."
        actions={
          <Link to="/pods/new">
            <Button>
              <i className="ri-add-line" /> Onboard client
            </Button>
          </Link>
        }
      />

      <TabBar
        aria-label="Pod status"
        value={statusFilter}
        onChange={setStatusFilter}
        tabs={STATUS_TABS.map((tab) => ({
          key: tab,
          label: tab === "all" ? "All pods" : POD_STATUS_META[tab].label,
          count: counts ? counts[tab] : null,
        }))}
      />

      <div className="my-4">
        <div className="relative max-w-sm">
          <i className="ri-search-line pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-[var(--text-dim)]" />
          <input
            type="search"
            aria-label="Search client pods"
            placeholder="Search clients"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-10 w-full rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-input)] pl-10 pr-3 text-sm outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--primary)]"
          />
        </div>
      </div>

      {isLoading && <SkeletonCards count={3} className="h-48" />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visiblePods.map((pod) => (
          <PodCard
            key={pod.id}
            pod={pod}
            tl={users?.find((u) => u.id === pod.tl_id)}
            canManage={Boolean(isOwner || (me && pod.tl_id === me.id))}
            isOwner={Boolean(isOwner)}
            tlOptions={tlOptions}
          />
        ))}
      </div>

      {!isLoading && visiblePods.length === 0 && (
        <EmptyState
          icon="ri-group-line"
          title={
            counts?.all === 0 && !search
              ? "No client pods yet"
              : search
                ? "No pods match that search"
                : `No ${statusFilter} pods`
          }
          description={
            counts?.all === 0 && !search
              ? "Onboarding a client creates their pod, its TL and the first brand kit in one pass."
              : "Clear the search or switch to All pods to see the rest of the roster."
          }
        />
      )}

      {(podPage?.total ?? 0) > PAGE_SIZE && (
        <div className="glass-card mt-4">
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
