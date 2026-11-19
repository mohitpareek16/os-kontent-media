import { useEffect, useRef, useState } from "react";

import type { User } from "@/types";

interface ProfileMenuProps {
  user: User;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onLogout: () => void;
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
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
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const initials = initialsOf(user.name);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] py-1 pl-1 pr-2 transition-all hover:border-[var(--primary)]"
      >
        <span className="avatar-circle h-7 w-7 rounded-md text-[11px]">{initials}</span>
        <i
          className={`ri-arrow-down-s-line text-sm text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="glass-card animate-fade-in-up absolute right-0 top-[calc(100%+8px)] z-50 w-64 overflow-hidden !p-0">
          <div className="flex items-center gap-3 border-b border-[var(--border-color-subtle)] p-3.5">
            <span className="avatar-circle h-10 w-10 rounded-lg text-sm">{initials}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-[var(--text-main)]">{user.name}</p>
              <p className="truncate text-xs text-[var(--text-muted)]">{user.email}</p>
            </div>
          </div>

          {/* No Notifications row: the bell sits in the header beside this
              menu, where its unread count is visible without opening
              anything. A second entry point would be two places to keep in
              agreement about one number. */}
          <div className="p-1.5">
            <button
              onClick={onToggleTheme}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold text-[var(--text-main)] transition-colors hover:bg-[var(--bg-pill)]"
            >
              <span className="flex items-center gap-2">
                <i className={theme === "dark" ? "ri-moon-clear-fill text-purple-400" : "ri-sun-line text-amber-500"} />
                Appearance
              </span>
              <span className="rounded bg-[var(--bg-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--text-dim)]">
                {theme}
              </span>
            </button>
          </div>

          <div className="border-t border-[var(--border-color-subtle)] p-1.5">
            <button
              onClick={onLogout}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-[var(--accent-red)] transition-colors hover:bg-[var(--accent-red-bg)]"
            >
              <i className="ri-logout-box-r-line" /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
