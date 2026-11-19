import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { roleLabel } from "@/lib/roles";
import type { User } from "@/types";

interface ProfileMenuProps {
  user: User;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onLogout: () => void;
}

export function ProfileMenu({ user, theme, onToggleTheme, onLogout }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const dark = theme === "dark";

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.name}`}
        className="flex h-10 items-center gap-1 rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-card)] pl-1.5 pr-2 transition-colors hover:border-[var(--primary)]"
      >
        <Avatar name={user.name} size={28} />
        <i
          className={`ri-arrow-down-s-line text-base text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-72 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-[var(--shadow-pop)] animate-fade-in-up"
        >
          <div className="flex items-center gap-3 border-b border-[var(--border-color)] p-4">
            <Avatar name={user.name} size={40} />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-[var(--text-main)]">{user.name}</p>
              <p className="truncate text-[13px] text-[var(--text-muted)]">{user.email}</p>
              <p className="text-xs font-semibold text-[var(--primary-text)]">{roleLabel(user)}</p>
            </div>
          </div>

          {/* No Notifications row: the bell sits in the header beside this
              menu, where its unread count is visible without opening
              anything. A second entry point would be two places to keep in
              agreement about one number. */}
          <div className="p-1.5">
            <button
              role="menuitemcheckbox"
              aria-checked={dark}
              onClick={onToggleTheme}
              className="flex h-10 w-full items-center justify-between rounded-lg px-2.5 text-sm font-semibold text-[var(--text-main)] transition-colors hover:bg-[var(--bg-card-hover)]"
            >
              <span className="flex items-center gap-2.5">
                <i className={`${dark ? "ri-moon-clear-line" : "ri-sun-line"} text-lg text-[var(--text-muted)]`} />
                Dark mode
              </span>
              <span
                aria-hidden="true"
                className={`relative h-5 w-9 rounded-full transition-colors ${dark ? "bg-[var(--primary)]" : "bg-[var(--border-color)]"}`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${dark ? "left-[18px]" : "left-0.5"}`}
                />
              </span>
            </button>
          </div>

          <div className="border-t border-[var(--border-color)] p-1.5">
            <button
              role="menuitem"
              onClick={onLogout}
              className="flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm font-semibold text-[var(--bad-text)] transition-colors hover:bg-[var(--bad-bg)]"
            >
              <i className="ri-logout-box-r-line text-lg" /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
