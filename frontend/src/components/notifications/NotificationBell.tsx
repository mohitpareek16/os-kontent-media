import { Link } from "react-router-dom";

import { useUnreadCount } from "@/hooks/useNotifications";

export function NotificationBell() {
  /* Counted by the server over the whole inbox. Deriving it from a page of
   * rows meant the badge silently stopped past that page's worth of unread. */
  const unreadCount = useUnreadCount();

  return (
    <Link
      to="/notifications"
      aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
      className="relative flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-card)] text-lg text-[var(--text-muted)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary-text)]"
    >
      <i className="ri-notification-3-line" />
      {unreadCount > 0 && (
        <span className="num absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#B91C1C] px-1 text-xs font-bold text-white">
          {unreadCount}
        </span>
      )}
    </Link>
  );
}
