import { useState } from "react";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonCards } from "@/components/ui/Skeleton";
import type { Pod } from "@/types";

const STATUS_CLASS: Record<string, string> = {
  active: "bg-[var(--ok-bg)] text-[var(--ok-text)]",
  paused: "bg-[var(--stage-intake-bg)] text-[var(--stage-intake-fg)]",
  churned: "bg-[var(--bad-bg)] text-[var(--bad-text)]",
};

/** Every client's brand kit, one card each. Same page header and card as the
 * rest of the app — this used to be a dark gradient hero in a different
 * design language, with cyan text that ignored the theme. */
export function BrandKitHub({ pods, loading }: { pods: Pod[]; loading?: boolean }) {
  const [search, setSearch] = useState("");
  const visible = pods.filter((pod) => pod.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return (
    <div className="pb-8">
      <PageHeader
        description="Briefs, assets, links, fonts and change history for each client you work with. Only clients you can access appear here."
        actions={
          <div className="relative w-72">
            <i className="ri-search-line pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-[var(--text-dim)]" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a client"
              aria-label="Find a client brand kit"
              className="h-10 w-full rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-input)] pl-10 pr-3 text-sm outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--primary)]"
            />
          </div>
        }
      />

      {loading ? (
        <SkeletonCards count={3} className="h-40" />
      ) : visible.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((pod) => (
            <Link
              key={pod.id}
              to={`/pods/${pod.id}/brand-assets`}
              className="glass-card card-interactive group flex min-h-44 flex-col justify-between gap-4 p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <Avatar name={pod.name} text={pod.name.slice(0, 1).toUpperCase()} size={44} square />
                <Badge className={STATUS_CLASS[pod.status] ?? ""}>
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
                  {pod.status.charAt(0).toUpperCase() + pod.status.slice(1)}
                </Badge>
              </div>
              <div>
                <h3 className="truncate text-[17px] font-bold text-[var(--text-main)]">{pod.name}</h3>
                <p className="mt-0.5 text-[13px] text-[var(--text-dim)]">Brief · assets · links · history</p>
              </div>
              <span className="flex items-center justify-between border-t border-[var(--border-color)] pt-3 text-[13px] font-bold text-[var(--primary-text)]">
                Open brand kit <i className="ri-arrow-right-up-line text-lg" />
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="ri-book-open-line"
          title={pods.length ? "No clients match your search" : "No client pods are available to you yet"}
          description={pods.length ? "Try a different part of the name." : "When a team lead adds you to a client, its brand kit shows up here."}
        />
      )}
    </div>
  );
}
