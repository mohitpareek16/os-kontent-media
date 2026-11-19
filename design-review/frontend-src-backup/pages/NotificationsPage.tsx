import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { DesktopAlerts } from "@/components/notifications/DesktopAlerts";
import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Pagination } from "@/components/ui/Pagination";
import { PillButton } from "@/components/ui/PillButton";
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
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border-color)] pb-5">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--primary-light)]">
            <i className="ri-notification-3-line" /> Inbox
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-extrabold tracking-tight text-[var(--text-main)]">
            Notifications
            {unread > 0 && (
              <span className="rounded-full bg-[var(--primary)] px-2 py-0.5 text-xs font-bold text-white">
                {unread} new
              </span>
            )}
          </h1>
        </div>
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

      {/* Above the filters, because it is a setting about the inbox rather
          than a way of reading it — and because somebody who came here after
          missing a hand-off should hit it first. */}
      <DesktopAlerts />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <i className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
          <input
            type="text"
            placeholder="Search by job title or code..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] py-2 pl-9 pr-3 text-xs outline-none focus:border-[var(--primary)]"
          />
        </div>
        <PillButton active={!unreadOnly} onClick={() => setUnreadOnly(false)}>
          All
        </PillButton>
        <PillButton active={unreadOnly} onClick={() => setUnreadOnly(true)}>
          Unread only
        </PillButton>
      </div>

      {isLoading && (
        <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <i className="ri-loader-4-line animate-spin" /> Loading...
        </p>
      )}

      {isError && (
        <ErrorNote error={error} fallback="Could not load your inbox. Refresh to try again." />
      )}

      {groups.map((group) => (
        <div key={group.key} className="space-y-2">
          <p className="px-1 text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
            {group.label}
          </p>
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
                  className={`flex items-start gap-3 border-l-2 px-4 py-3.5 transition-colors hover:bg-[var(--bg-pill)] ${
                    isUnread
                      ? "border-l-[var(--primary)] bg-[var(--primary-glow-subtle)]"
                      : "border-l-transparent"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${TONE_ICON_CLASSES[tone]}`}
                  >
                    <i className={icon} />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-sm ${
                        isUnread
                          ? "font-bold text-[var(--text-main)]"
                          : "font-medium text-[var(--text-muted)]"
                      }`}
                    >
                      {headline}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">
                      {n.job_title} <span className="text-[var(--text-dim)]">· {n.pod_name}</span>
                    </span>
                    {noteLine && (
                      <span className="mt-1 block truncate text-xs italic text-[var(--text-dim)]">
                        “{noteLine}”
                      </span>
                    )}
                  </span>

                  <span className="flex shrink-0 items-center gap-2 pt-0.5">
                    <span
                      className="font-mono text-[11px] text-[var(--text-dim)]"
                      title={formatDateTime(n.created_at)}
                    >
                      {new Date(n.created_at).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                    {isUnread && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--primary)]" />
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}

      {!isLoading && !isError && notifications.length === 0 && (
        <div className="glass-card p-10 text-center">
          <i className="ri-inbox-line text-3xl text-[var(--text-dim)]" />
          <p className="mt-2 text-sm font-semibold text-[var(--text-main)]">
            {search || unreadOnly ? "Nothing matches that" : "You're all caught up"}
          </p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {search || unreadOnly
              ? "Clear the search or switch back to All to see the rest of your inbox."
              : "Jobs landing with you, change lists and comments on your work all show up here."}
          </p>
        </div>
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
    </div>
  );
}
