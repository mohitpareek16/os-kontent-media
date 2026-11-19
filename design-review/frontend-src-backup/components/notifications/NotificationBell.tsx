import { Link } from "react-router-dom";

import { useUnreadCount } from "@/hooks/useNotifications";

export function NotificationBell() {
  /* Counted by the server over the whole inbox. Deriving it from a page of
   * rows meant the badge silently stopped past that page's worth of unread. */
  const unreadCount = useUnreadCount();

  return (
    <Link
      to="/notifications"
      className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-base text-[var(--text-muted)] transition-all hover:border-[var(--primary)] hover:text-[var(--primary)]"
    >
      <i className="ri-notification-3-line" />
      {unreadCount > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-red)] px-1 text-[10px] font-bold text-white shadow-sm">
          {unreadCount}
        </span>
      )}
    </Link>
  );
}
