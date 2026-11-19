import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { DesktopAlerts } from "@/components/notifications/DesktopAlerts";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Pagination } from "@/components/ui/Pagination";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { TabBar } from "@/components/ui/TabBar";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/hooks/useNotifications";
import { formatDateTime, formatFullDate } from "@/lib/format";
import { describeNotification, TONE_ICON_CLASSES } from "@/lib/notificationText";
import type { Notification } from "@/types";

function startOfDay(iso: string): number {
  const date = new Date(iso);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** "Today" / "Yesterday" / "2 Aug 2026" — a fifty-row inbox with no breaks
 * reads as one wall; the day tells you what's still worth acting on. */
function dayLabel(iso: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - startOfDay(iso)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return formatFullDate(iso);
}

function groupByDay(notifications: Notification[]) {
  const groups: { key: number; label: string; items: Notification[] }[] = [];
  for (const n of notifications) {
    const key = startOfDay(n.created_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(n);
    else groups.push({ key, label: dayLabel(n.created_at), items: [n] });
  }
  return groups;
}

const PAGE_SIZE = 25;

export default function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  /* Debounced — typing a name shouldn't be one request per character. */
  const search = useDebouncedValue(searchInput).trim();
  const [page, setPage] = useState(1);
  const [searchParams] = useSearchParams();
  const [settingsOpen, setSettingsOpen] = useState(() => searchParams.get("settings") === "1");

  useEffect(() => {
    setPage(1);
  }, [unreadOnly, search]);

  const { data, isLoading, isError, error } = useNotifications({
    unread_only: unreadOnly || undefined,
    search: search || undefined,
    page,
    page_size: PAGE_SIZE,
  });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const notifications = data?.items ?? [];
  /* The server's count, over the whole inbox — not this page's rows. */
  const unread = data?.unread ?? 0;
  const groups = groupByDay(notifications);

  return (
    <div className="max-w-[860px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <TabBar
          aria-label="Inbox"
          className="min-w-[180px] border-b-0"
          value={unreadOnly ? "unread" : "all"}
          onChange={(key) => setUnreadOnly(key === "unread")}
          tabs={[
            { key: "all", label: "All", count: unreadOnly ? null : data?.total ?? null },
            { key: "unread", label: "Unread", count: unread },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
            <i className="ri-settings-3-line" /> Notification settings
          </Button>
          {unread > 0 && (
            <Button
              variant="secondary"
              disabled={markAllRead.isPending}
              /* One request for the whole inbox. This used to fire a POST per
                 loaded row, so anything past the first page stayed unread. */
              onClick={() => markAllRead.mutate()}
            >
              <i className="ri-check-double-line" /> Mark all read
            </Button>
          )}
        </div>
      </div>

      <div className="relative mb-5 max-w-md">
        <i className="ri-search-line pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-[var(--text-dim)]" />
        <input
          type="search"
          aria-label="Search notifications by job title or code"
          placeholder="Search by job title or code"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-10 w-full rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-input)] pl-10 pr-3 text-sm outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--primary)]"
        />
      </div>

      {isLoading && <SkeletonRows rows={5} label="Loading notifications" />}

      {isError && <ErrorState what="your inbox" error={error} />}

      {groups.map((group) => (
        <section key={group.key} className="mb-5" aria-label={group.label}>
          <h2 className="mb-2 px-1 text-[13px] font-bold text-[var(--text-muted)]">{group.label}</h2>
          <div className="glass-card divide-y divide-[var(--border-color-subtle)] overflow-hidden">
            {group.items.map((n) => {
              const { headline, icon, tone } = describeNotification(n);
              const isUnread = !n.read_at;
              const noteLine = n.note?.trim().split("\n")[0];

              return (
                <Link
                  key={n.id}
                  to={n.pod_id && !n.job_id ? `/pods/${n.pod_id}/brand-assets?history=1` : `/jobs/${n.job_id}`}
                  onClick={() => {
                    if (isUnread) markRead.mutate(n.id);
                  }}
                  className="flex items-start gap-3.5 px-[18px] py-3.5 transition-colors hover:bg-[var(--bg-card-hover)]"
                >
                  <span
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-lg ${TONE_ICON_CLASSES[tone]}`}
                  >
                    <i className={icon} />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-[15px] ${
                        isUnread ? "font-bold text-[var(--text-main)]" : "font-semibold text-[var(--text-muted)]"
                      }`}
                    >
                      {headline}
                    </span>
                    <span className="mt-0.5 block text-sm text-[var(--text-muted)]">
                      {n.job_title} <span className="text-[var(--text-dim)]">· {n.pod_name}</span>
                    </span>
                    {noteLine && (
                      <span className="mt-1.5 block rounded-lg bg-[var(--bg-card-hover)] px-3 py-2 text-[13px] text-[var(--text-muted)]">
                        “{noteLine}”
                      </span>
                    )}
                  </span>

                  <span className="flex shrink-0 items-center gap-2 pt-1 text-xs text-[var(--text-dim)]">
                    <span title={formatDateTime(n.created_at)}>
                      {new Date(n.created_at).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                    {isUnread ? (
                      <span
                        className="h-2 w-2 rounded-full bg-[var(--primary)]"
                        role="img"
                        aria-label="Unread"
                      />
                    ) : (
                      <span className="w-2" aria-hidden />
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}

      {!isLoading && !isError && notifications.length === 0 && (
        <EmptyState
          icon="ri-inbox-line"
          title={search || unreadOnly ? "Nothing matches that" : "You're all caught up"}
          description={
            search || unreadOnly
              ? "Clear the search or switch back to All to see the rest of your inbox."
              : "Jobs landing with you, change lists and comments on your work all show up here."
          }
        />
      )}

      {(data?.total ?? 0) > 0 && (
        <div className="glass-card">
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={data?.total ?? 0}
            onPageChange={setPage}
            noun="notifications"
          />
        </div>
      )}

      <Drawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        width="md"
        header={<h2 className="text-[22px] font-bold">Notification settings</h2>}
      >
        <DesktopAlerts />
      </Drawer>
    </div>
  );
}
