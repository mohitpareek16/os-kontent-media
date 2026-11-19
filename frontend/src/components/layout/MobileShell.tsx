import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { InstallCard } from "@/components/layout/InstallCard";
import { useUnreadCount } from "@/hooks/useNotifications";
import { useInstall, usePlatform } from "@/hooks/usePlatform";
import type { User } from "@/types";

export interface MobileTab {
  key: string;
  label: string;
  /** Remix icon base name, e.g. "ri-home-5" — `-line` / `-fill` is appended. */
  icon: string;
  to: string;
  /** True when this tab owns the current location. */
  match: (pathname: string, view: string) => boolean;
  badge?: "unread";
}

interface MobileShellProps {
  user: User;
  title: string;
  tabs: MobileTab[];
  canCreateJobs: boolean;
  onSelectPod: (podId: string) => void;
  /** Height of the impersonation banner above everything, if shown. */
  bannerHeight: number;
  /** The client picker the sidebar offers on client-scoped pages. */
  podSelector?: ReactNode;
  children: ReactNode;
}

const DISMISS_KEY = "km_install_dismissed";

/** The phone layout: one scrolling column, a bottom tab bar chosen per role,
 * and the platform's own header — iOS gets a navigation bar with a large title
 * that sits under it, Android a top app bar and a floating "New job" button.
 * Detail screens (a job, a client's brand kit) hide the tab bar and show a back
 * button instead, so the system back gesture and the on-screen one agree. */
export function MobileShell({
  user,
  title,
  tabs,
  canCreateJobs,
  onSelectPod,
  bannerHeight,
  podSelector,
  children,
}: MobileShellProps) {
  const platform = usePlatform();
  const ios = platform === "ios";
  const location = useLocation();
  const navigate = useNavigate();
  const unread = useUnreadCount();
  const install = useInstall();
  const [searchOpen, setSearchOpen] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  const view = new URLSearchParams(location.search).get("view") ?? "";
  const activeTab = tabs.find((tab) => tab.match(location.pathname, view));
  /* Tab roots show the tab bar; everything else is a pushed screen. */
  const isRoot = Boolean(activeTab) || location.pathname === "/more";
  const onPipeline = activeTab?.key === "pipeline";

  useEffect(() => setSearchOpen(false), [location.pathname, location.search]);

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(tabs[0]?.to ?? "/");
  };

  const dismissInstall = () => {
    setInstallDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode — hides for this visit only */
    }
  };

  const showInstall =
    isRoot && !installDismissed && !install.installed && (install.canPrompt || install.needsManualSteps);

  const tabBarSpace = isRoot ? "calc(var(--tabbar-h) + var(--safe-bottom) + 16px)" : "calc(var(--safe-bottom) + 24px)";

  const searchButton = (
    <button
      type="button"
      aria-label={searchOpen ? "Close search" : "Search"}
      aria-expanded={searchOpen}
      onClick={() => setSearchOpen((v) => !v)}
      className="flex h-11 w-11 items-center justify-center rounded-full text-[22px] text-[var(--primary-text)]"
    >
      <i className={searchOpen ? "ri-close-line" : "ri-search-line"} />
    </button>
  );
  const newJobButton = canCreateJobs && ios && onPipeline && (
    <button
      type="button"
      aria-label="New edit job"
      onClick={() => navigate("/?newJob=1")}
      className="flex h-11 w-11 items-center justify-center rounded-full text-[26px] text-[var(--primary-text)]"
    >
      <i className="ri-add-line" />
    </button>
  );

  return (
    <div
      className="flex min-h-[100dvh] flex-col bg-[var(--bg-app)] text-[var(--text-main)]"
      style={{ paddingTop: bannerHeight }}
    >
      {/* Header */}
      <header
        className="sticky z-30 border-b border-[var(--border-color)] bg-[var(--bg-header)]"
        style={{ top: bannerHeight, paddingTop: "var(--safe-top)" }}
      >
        <div className={`flex items-center gap-1 px-2 ${ios ? "h-11" : "h-16"}`}>
          {!isRoot && (
            <button
              type="button"
              aria-label="Back"
              onClick={goBack}
              className="flex h-11 w-11 items-center justify-center rounded-full text-[26px] text-[var(--primary-text)]"
            >
              <i className={ios ? "ri-arrow-left-s-line" : "ri-arrow-left-line"} />
            </button>
          )}

          {ios ? (
            <>
              {!isRoot ? (
                <h1 className="flex-1 truncate text-center text-[17px] font-bold">{title}</h1>
              ) : (
                <span className="flex-1" />
              )}
              {isRoot && newJobButton}
              {searchButton}
              {!isRoot && <span className="w-11" aria-hidden />}
            </>
          ) : (
            <>
              <h1 className={`flex-1 truncate text-[22px] font-semibold ${isRoot ? "pl-2" : ""}`}>{title}</h1>
              {searchButton}
            </>
          )}
        </div>
        {ios && isRoot && (
          <h1 className="px-4 pb-2 font-[var(--font-display)] text-[32px] font-bold leading-tight tracking-tight">
            {title}
          </h1>
        )}
        {searchOpen && (
          <div className="px-3 pb-3">
            <GlobalSearch user={user} onSelectPod={onSelectPod} />
          </div>
        )}
      </header>

      {/* Content */}
      <main className="min-w-0 flex-1 px-4 pt-4" style={{ paddingBottom: tabBarSpace }}>
        {showInstall && (
          <div className="mb-4">
            <InstallCard onDismiss={dismissInstall} />
          </div>
        )}
        {podSelector && (
          <div className="mb-4">
            <p className="mb-1.5 text-xs font-bold text-[var(--text-dim)]">Active client</p>
            {podSelector}
          </div>
        )}
        {children}
      </main>

      {/* Android: extended FAB for the one thing a lead creates */}
      {!ios && canCreateJobs && onPipeline && (
        <button
          type="button"
          onClick={() => navigate("/?newJob=1")}
          className="fixed right-4 z-40 flex h-14 items-center gap-2 rounded-2xl bg-[var(--primary)] px-5 font-bold text-white shadow-[var(--shadow-pop)]"
          style={{ bottom: "calc(var(--tabbar-h) + var(--safe-bottom) + 16px)" }}
        >
          <i className="ri-add-line text-xl" /> New job
        </button>
      )}

      {/* Bottom tab bar */}
      {isRoot && (
        <nav
          aria-label="Main"
          className={`fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--border-color)] ${
            ios ? "bg-[color-mix(in_srgb,var(--bg-card)_94%,transparent)]" : "bg-[var(--bg-pill)]"
          }`}
          style={{ paddingBottom: "var(--safe-bottom)" }}
        >
          {tabs.map((tab) => {
            const active = tab === activeTab || (tab.key === "more" && location.pathname === "/more");
            const count = tab.badge === "unread" ? unread : 0;
            return (
              <Link
                key={tab.key}
                to={tab.to}
                aria-current={active ? "page" : undefined}
                aria-label={count > 0 ? `${tab.label}, ${count} unread` : tab.label}
                className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 ${
                  active ? "text-[var(--primary-text)]" : "text-[var(--text-dim)]"
                }`}
                style={{ minHeight: "var(--tabbar-h)" }}
              >
                {ios ? (
                  <i className={`${tab.icon}${active ? "-fill" : "-line"} text-[26px] leading-none`} />
                ) : (
                  <span
                    className={`flex h-8 w-16 items-center justify-center rounded-full text-2xl ${
                      active ? "bg-[var(--bg-pill)]" : ""
                    }`}
                  >
                    <i className={`${tab.icon}${active ? "-fill" : "-line"}`} />
                  </span>
                )}
                <span className={`text-[11px] leading-none ${active ? "font-bold" : "font-semibold"}`}>
                  {tab.label}
                </span>
                {count > 0 && (
                  <span className="num absolute left-[56%] top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#B91C1C] px-1 text-[11px] font-bold text-white">
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
