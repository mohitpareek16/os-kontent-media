import { Link, useOutletContext } from "react-router-dom";

import { DemoNotice } from "@/components/layout/DemoNotice";
import { InstallCard } from "@/components/layout/InstallCard";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { roleLabel } from "@/lib/roles";
import type { User } from "@/types";

export interface MoreItem {
  to: string;
  label: string;
  icon: string;
}

/** What AppLayout hands every page through `<Outlet context>`. `More` is the
 * only page that needs most of it (the phone layout has no sidebar, so the
 * secondary pages, the theme switch and sign-out live here). */
export interface ShellContext {
  selectedPodId: string;
  setSelectedPodId: (podId: string) => void;
  user?: User;
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
  onLogout?: () => void;
  moreItems?: MoreItem[];
}

function Row({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex min-h-[52px] items-center gap-3.5 border-t border-[var(--border-color-subtle)] px-4 first:border-t-0 ${className}`}>
      {children}
    </div>
  );
}

/** Phone-only home for everything that used to crowd the sidebar: the profile,
 * the dark-mode switch, notification settings, the other pages this role may
 * open, and Sign out. On a desktop-width window it is simply a page too. */
export default function MorePage() {
  const ctx = useOutletContext<ShellContext>();
  const { user, theme, onToggleTheme, onLogout, moreItems = [] } = ctx ?? ({} as ShellContext);
  const dark = theme === "dark";

  return (
    <div className="mx-auto max-w-xl space-y-5">
      {user && (
        <div className="glass-card flex items-center gap-4 p-4">
          <Avatar name={user.name} size={56} />
          <div className="min-w-0">
            <p className="truncate font-[var(--font-display)] text-lg font-bold">{user.name}</p>
            <p className="truncate text-sm text-[var(--text-muted)]">{user.email}</p>
            <Badge className="mt-1 bg-[var(--bg-pill)] text-[var(--primary-text)]">{roleLabel(user)}</Badge>
          </div>
        </div>
      )}

      <DemoNotice />
      <InstallCard />

      <section aria-labelledby="more-prefs">
        <h2 id="more-prefs" className="mb-2 px-1 text-[13px] font-bold text-[var(--text-muted)]">
          Preferences
        </h2>
        <div className="glass-card overflow-hidden">
          <Row>
            <i className="ri-moon-line text-[22px] text-[var(--text-dim)]" />
            <span className="flex-1 font-semibold">Dark mode</span>
            <button
              type="button"
              role="switch"
              aria-checked={dark}
              aria-label="Dark mode"
              onClick={onToggleTheme}
              className={`relative h-7 w-12 rounded-full transition-colors ${dark ? "bg-[var(--primary)]" : "bg-[var(--border-color)]"}`}
            >
              <span
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${dark ? "left-[22px]" : "left-0.5"}`}
              />
            </button>
          </Row>
          <Link to="/notifications?settings=1" className="block">
            <Row>
              <i className="ri-notification-badge-line text-[22px] text-[var(--text-dim)]" />
              <span className="flex-1 font-semibold">Notification settings</span>
              <i className="ri-arrow-right-s-line text-xl text-[var(--text-dim)]" />
            </Row>
          </Link>
        </div>
      </section>

      {moreItems.length > 0 && (
        <section aria-labelledby="more-ws">
          <h2 id="more-ws" className="mb-2 px-1 text-[13px] font-bold text-[var(--text-muted)]">
            Workspace
          </h2>
          <div className="glass-card overflow-hidden">
            {moreItems.map((item) => (
              <Link key={item.to} to={item.to} className="block">
                <Row>
                  <i className={`${item.icon} text-[22px] text-[var(--text-dim)]`} />
                  <span className="flex-1 font-semibold">{item.label}</span>
                  <i className="ri-arrow-right-s-line text-xl text-[var(--text-dim)]" />
                </Row>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="glass-card overflow-hidden">
        <button type="button" onClick={onLogout} className="block w-full text-left">
          <Row className="text-[var(--bad-text)]">
            <i className="ri-logout-box-r-line text-[22px]" />
            <span className="font-semibold">Sign out</span>
          </Row>
        </button>
      </div>
    </div>
  );
}
