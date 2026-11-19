import { useState, useEffect, useRef } from "react";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { BrandMark } from "@/components/layout/BrandMark";
import { DemoNotice } from "@/components/layout/DemoNotice";
import { MobileShell } from "@/components/layout/MobileShell";
import type { MobileTab } from "@/components/layout/MobileShell";
import type { MoreItem } from "@/pages/MorePage";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { NotificationWatcher } from "@/components/notifications/NotificationWatcher";
import { Button } from "@/components/ui/Button";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useCurrentUser, useImpersonate, useLogout, useStopImpersonating } from "@/hooks/useAuth";
import { usePods } from "@/hooks/usePods";
import { useImpersonationTargets } from "@/hooks/useUsers";
import { hasRole, isAdmin, isLead, roleLabel } from "@/lib/roles";
import type { User } from "@/types";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  /** "client" pages show data for one selected pod/client; "common" pages
   * roll up across all of them and don't need the pod selector. */
  scope: "client" | "common";
}

const VIEW_LABELS: Record<string, string> = {
  overview: "Overview",
  pipeline: "Pipeline Table",
  qcteam: "QC Auto-Router",
  qcqueue: "My QC Queue",
  capacity: "Team Capacity",
  bot: "WhatsApp Bot",
  brandkit: "Brand Kit",
};

const ROUTE_TITLES: Array<[string, string]> = [
  ["/bot", "Kontent Bot"],
  ["/pods/new", "Onboard Client"],
  ["/pods", "Client Pods"],
  ["/admin/voice-notes", "Voice Notes"],
  ["/admin/users", "Users & Roles"],
  ["/admin/whatsapp", "WhatsApp Setup"],
  ["/admin/video-types", "Video Types"],
  ["/hr", "Team Directory"],
  ["/analytics", "Analytics"],
  ["/notifications", "Notifications"],
  ["/more", "More"],
];

export function AppLayout() {
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const impersonate = useImpersonate();
  const stopImpersonating = useStopImpersonating();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  /* Stored choice first; otherwise follow the OS setting (was: always light). */
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const stored = localStorage.getItem("km_theme");
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  const [selectedPodId, setSelectedPodId] = useState<string>("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem("km_nav_admin") !== "closed";
    } catch {
      return true;
    }
  });

  useEffect(() => setMobileNavOpen(false), [location.pathname, location.search]);

  const isImpersonating = Boolean(localStorage.getItem("admin_token"));

  /* The impersonation banner is fixed and its text can wrap on a phone, so
   * the offset under it is measured rather than a hard-coded `pt-8`. */
  const bannerRef = useRef<HTMLDivElement>(null);
  const [bannerH, setBannerH] = useState(0);
  useEffect(() => {
    if (!isImpersonating || !bannerRef.current) {
      setBannerH(0);
      return;
    }
    const el = bannerRef.current;
    const measure = () => setBannerH(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isImpersonating, user]);

  /* Sync Theme */
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("km_theme", theme);
  }, [theme]);

  /* Pods for the sidebar selector. Same hook (and cache key) as every other
   * pod picker — this had its own hand-rolled useQuery, which is exactly how
   * two callers of one endpoint drift apart. */
  const { data: pods } = usePods();

  /* Accounts the "viewing as" picker offers. Fetched as the real Owner, so
   * it keeps working *while* impersonating — the directory is owner/TL-only,
   * and mid-simulation the session token belongs to whoever is being
   * simulated, so this used to come back empty (or 403) exactly when it was
   * needed. Deactivated accounts are left out: you can't hold a session as
   * one. */
  const { data: allUsers } = useImpersonationTargets({
    enabled: Boolean(user && (isAdmin(user) || isImpersonating)),
  });

  /** Empty selectedPodId means "All" — no pod filter applied downstream. */
  const activePod = selectedPodId ? pods?.find((p) => p.id === selectedPodId) : undefined;

  /** The sidebar, assembled from every role this person holds rather than
   * looked up by their primary one.
   *
   * It used to be a `Record<Role, NavItem[]>`, which cannot describe an
   * editor who also runs two client pods: they would get the editor's single
   * link and none of the lead workspace they were handed the TL role for.
   * So each block is claimed by a predicate, they are concatenated in
   * seniority order, and duplicates are dropped by `to` — one nav for one
   * person, however many hats they wear. */
  const getWorkspaceItems = (who: User): NavItem[] => {
    const brandKitTo = activePod ? `/pods/${activePod.id}/brand-assets` : "/?view=brandkit";
    /* What the Owner runs: the whole company, plus the two router views that
     * only make sense above a single pod. */
    const ownerItems: NavItem[] = [
      { to: "/", label: "Overview", icon: "ri-dashboard-3-line", scope: "common" },
      { to: "/?view=capacity", label: "Team Capacity", icon: "ri-team-line", scope: "common" },
      { to: "/analytics", label: "Analytics", icon: "ri-bar-chart-fill", scope: "common" },
      { to: "/bot", label: "Kontent Bot", icon: "ri-sparkling-2-line", scope: "common" },
      { to: "/?view=bot", label: "WhatsApp Bot", icon: "ri-whatsapp-line", scope: "common" },
      { to: "/?view=pipeline", label: "Pipeline Table", icon: "ri-table-line", scope: "client" },
      { to: "/?view=qcteam", label: "QC Auto-Router", icon: "ri-cpu-line", scope: "client" },
      { to: brandKitTo, label: "Brand Kit", icon: "ri-book-open-line", scope: "client" },
    ];
    /* The lead workspace: what a TL runs on their own pods — whether TL is
     * their role or one lent to them. */
    const leadItems: NavItem[] = [
      { to: "/", label: "Overview", icon: "ri-dashboard-3-line", scope: "common" },
      { to: "/?view=capacity", label: "Team Capacity", icon: "ri-team-line", scope: "common" },
      { to: "/analytics", label: "Analytics", icon: "ri-bar-chart-fill", scope: "common" },
      { to: "/bot", label: "Kontent Bot", icon: "ri-sparkling-2-line", scope: "common" },
      { to: "/pods/new", label: "Onboard Client", icon: "ri-add-box-line", scope: "common" },
      { to: "/pods", label: "Client Pods", icon: "ri-group-line", scope: "common" },
      { to: "/?view=pipeline", label: "Pipeline Table", icon: "ri-table-line", scope: "client" },
      { to: brandKitTo, label: "Brand Kit", icon: "ri-book-open-line", scope: "client" },
    ];
    const blocks: [boolean, NavItem[]][] = [
      [isAdmin(who), ownerItems],
      [!isAdmin(who) && hasRole(who, "tl"), leadItems],
      [
        hasRole(who, "qc"),
        [
          { to: "/?view=qcqueue", label: "QC Queue", icon: "ri-checkbox-multiple-line", scope: "common" },
          { to: brandKitTo, label: "Brand Kit", icon: "ri-book-open-line", scope: "client" },
        ],
      ],
      [
        hasRole(who, "ve"),
        [
          { to: "/?view=pipeline", label: "My Edit Pipeline", icon: "ri-table-line", scope: "client" },
          { to: brandKitTo, label: "Brand Kit", icon: "ri-book-open-line", scope: "client" },
        ],
      ],
      // People-ops' one surface, and the only one an HR has unless somebody
      // hands them a pod.
      [
        hasRole(who, "hr"),
        [
          { to: "/hr", label: "Team Directory", icon: "ri-team-line", scope: "common" },
          { to: "/admin/users", label: "Edit user details", icon: "ri-user-settings-line", scope: "common" },
        ],
      ],
    ];

    const seen = new Set<string>();
    return blocks
      .filter(([claimed]) => claimed)
      .flatMap(([, items]) => items)
      .filter((item) => !seen.has(item.to) && seen.add(item.to));
  };

  const adminNavItems: NavItem[] = [
    { to: "/pods/new", label: "Onboard Client", icon: "ri-add-box-line", scope: "common" },
    { to: "/pods", label: "Client Pods", icon: "ri-group-line", scope: "common" },
    { to: "/admin/users", label: "Users & Roles", icon: "ri-user-settings-line", scope: "common" },
    { to: "/admin/video-types", label: "Video Types & Points", icon: "ri-film-line", scope: "common" },
    { to: "/admin/voice-notes", label: "Voice Notes", icon: "ri-mic-line", scope: "common" },
    { to: "/admin/whatsapp", label: "WhatsApp Setup", icon: "ri-plug-line", scope: "common" },
  ];

  const workspaceItems = user ? getWorkspaceItems(user) : [];
  const commonItems = workspaceItems.filter((i) => i.scope === "common");
  const clientItems = workspaceItems.filter((i) => i.scope === "client");
  const adminItems = isAdmin(user) ? adminNavItems : [];

  const isItemActive = (item: NavItem) => `${location.pathname}${location.search}` === item.to;

  const currentView = searchParams.get("view") || "overview";
  /* An editor's sidebar says "My Edit Pipeline", so the title must too. */
  const isEditorOnly = hasRole(user, "ve") && !isLead(user);
  const pageTitle = (() => {
    if (location.pathname === "/") {
      if (isEditorOnly && (currentView === "pipeline" || currentView === "overview")) {
        return "My Edit Pipeline";
      }
      return VIEW_LABELS[currentView] ?? "Overview";
    }
    if (location.pathname.startsWith("/jobs/")) return "Job Detail";
    if (location.pathname.includes("/brand-assets")) return "Brand Kit";
    const match = ROUTE_TITLES.find(
      ([path]) => location.pathname === path || location.pathname.startsWith(`${path}/`),
    );
    if (match) return match[1];
    return "Kontent Media";
  })();

  /** Only client-scoped views need "which pod am I looking at" context —
   * common views already roll up across every pod, so showing the
   * selector there would imply a filter that isn't actually applied. */
  const isClientScopedRoute =
    location.pathname.includes("/brand-assets") ||
    (location.pathname === "/" && ["pipeline", "qcteam"].includes(currentView));
  const showPodSelector = isClientScopedRoute && Boolean(pods && pods.length > 0);

  const canCreateJobs = isLead(user);

  /* Active = tinted background, primary text and a 3px bar on the left edge
   * (was a dark purple→indigo gradient, the heaviest thing on screen). */
  const renderNavLink = (item: NavItem) => {
    const active = isItemActive(item);
    return (
      <Link
        key={item.to}
        to={item.to}
        aria-current={active ? "page" : undefined}
        className={`relative flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm font-semibold transition-colors ${
          active
            ? "bg-[var(--bg-pill)] text-[var(--primary-text)] before:absolute before:-left-3 before:bottom-2 before:top-2 before:w-[3px] before:rounded-r before:bg-[var(--primary)]"
            : "text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-main)]"
        }`}
      >
        <i className={`${item.icon} text-lg ${active ? "text-[var(--primary)]" : "text-[var(--text-dim)]"}`} />
        <span>{item.label}</span>
      </Link>
    );
  };

  const groupLabelClass = "px-2.5 pb-1.5 pt-4 text-xs font-bold text-[var(--text-dim)]";

  /* ---- Phone layout ---------------------------------------------------
   * Below 768px the sidebar is replaced by a bottom tab bar chosen per role.
   * The tabs are built from the same role predicates as the sidebar, so a role
   * never sees a tab for a page it cannot open; every other page the sidebar
   * would have listed goes under "More". */
  const isMobile = useIsMobile();
  const view = currentView;
  const homeTab: MobileTab = { key: "home", label: "Home", icon: "ri-home-5", to: "/", match: (p, v) => p === "/" && (v === "" || v === "overview") };
  const pipelineTab: MobileTab = { key: "pipeline", label: "Pipeline", icon: "ri-stack", to: "/?view=pipeline", match: (p, v) => p === "/" && (v === "pipeline" || v === "qcteam") };
  const queueTab: MobileTab = { key: "myqueue", label: "My queue", icon: "ri-scissors-cut", to: "/?view=pipeline", match: (p, v) => p === "/" && (v === "" || v === "overview" || v === "pipeline") };
  const qcTab: MobileTab = { key: "qcqueue", label: "Queue", icon: "ri-shield-check", to: "/?view=qcqueue", match: (p, v) => p === "/" && (v === "" || v === "overview" || v === "qcqueue") };
  const inboxTab: MobileTab = { key: "inbox", label: "Inbox", icon: "ri-notification-3", to: "/notifications", match: (p) => p === "/notifications", badge: "unread" };
  const capacityTab: MobileTab = { key: "capacity", label: "Capacity", icon: "ri-team", to: "/?view=capacity", match: (p, v) => p === "/" && v === "capacity" };
  const brandTab: MobileTab = { key: "brand", label: "Brand kits", icon: "ri-book-open", to: "/?view=brandkit", match: (p, v) => (p === "/" && v === "brandkit") || p.includes("/brand-assets") };
  const directoryTab: MobileTab = { key: "directory", label: "Directory", icon: "ri-team", to: "/hr", match: (p) => p === "/hr" };
  const moreTab: MobileTab = { key: "more", label: "More", icon: "ri-apps", to: "/more", match: (p) => p === "/more" };
  const mobileTabs: MobileTab[] = !user
    ? [homeTab, moreTab]
    : isLead(user)
      ? [homeTab, pipelineTab, inboxTab, capacityTab, moreTab]
      : hasRole(user, "qc")
        ? [qcTab, inboxTab, brandTab, moreTab]
        : hasRole(user, "ve")
          ? [queueTab, inboxTab, brandTab, moreTab]
          : hasRole(user, "hr")
            ? [directoryTab, inboxTab, moreTab]
            : [homeTab, inboxTab, moreTab];

  const tabTargets = new Set(mobileTabs.map((tab) => tab.to));
  const hasBrandTab = mobileTabs.some((tab) => tab.key === "brand");
  const seenMore = new Set<string>();
  const moreItems: MoreItem[] = [...workspaceItems, ...adminItems]
    .filter((item) => !tabTargets.has(item.to) && !(hasBrandTab && item.label === "Brand Kit"))
    .filter((item) => !seenMore.has(item.to) && seenMore.add(item.to))
    .map(({ to, label, icon }) => ({ to, label, icon }));

  const impersonationBanner = isImpersonating && user && (
    <div
      ref={bannerRef}
      role="status"
      className="fixed left-0 right-0 top-0 z-[60] flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--warn-text)] bg-[var(--warn-bg)] px-4 py-2 text-[13px] text-[var(--warn-text)] md:px-6"
      style={{ paddingTop: "max(0.5rem, var(--safe-top))" }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <i className="ri-eye-line shrink-0 text-base" />
        <span className="font-bold">Simulation active.</span>
        <span className="min-w-0">
          Viewing as <strong>{user.name}</strong> ({roleLabel(user)}) — {user.email}
        </span>
      </div>
      <Button variant="secondary" size="sm" onClick={stopImpersonating}>
        <i className="ri-arrow-left-line" /> Stop simulating
      </Button>
    </div>
  );

  const outletContext = {
    selectedPodId,
    activePod,
    setSelectedPodId,
    user,
    theme,
    onToggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
    onLogout: logout,
    moreItems,
  };

  if (isMobile && user) {
    return (
      <>
        <NotificationWatcher />
        {impersonationBanner}
        <MobileShell
          user={user}
          title={pageTitle}
          tabs={mobileTabs}
          canCreateJobs={canCreateJobs}
          onSelectPod={setSelectedPodId}
          bannerHeight={isImpersonating ? bannerH : 0}
          podSelector={
            showPodSelector ? (
              <SearchableSelect value={selectedPodId} onChange={setSelectedPodId} placeholder="All clients" aria-label="Active pod or client" options={[{ value: "", label: "All clients" }, ...pods!.map((p) => ({ value: p.id, label: p.name }))]} />
            ) : undefined
          }
        >
          <Outlet context={outletContext} />
        </MobileShell>
      </>
    );
  }

  return (
    <div className="flex min-h-screen bg-[var(--bg-app)] text-[var(--text-main)]">

      {/* Renders nothing. It polls the unread inbox and raises each new
          notification as a toast that has to be crossed off, with a sound —
          the point being to reach somebody who is looking at the pipeline
          table rather than at their inbox. Mounted here so it runs on every
          screen, and only for a signed-in session. */}
      {user && <NotificationWatcher />}

      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      )}

      {/* Top Impersonation Active Banner */}
      {impersonationBanner}

      {/* Sidebar Navigation */}
      <aside
        style={isImpersonating ? { paddingTop: bannerH } : undefined}
        className={`fixed top-0 bottom-0 left-0 z-50 flex w-[248px] flex-col border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] transition-transform md:translate-x-0 ${mobileNavOpen ? "translate-x-0" : "-translate-x-full"}`}
      >

        {/* Sidebar Header with Official Logo */}
        <div className="border-b border-[var(--border-color)] px-5 py-[18px]">
          <Link to="/" aria-label="Kontent Media — home" onClick={() => setMobileNavOpen(false)} className="inline-flex select-none">
            <BrandMark />
          </Link>

          {/* The "Frame.io" and "Meta API" status pills that used to sit here
              advertised integrations that didn't exist. Frame.io stays a
              manual pasted link permanently (see docs/08). WhatsApp now does
              exist (docs/13) and still has no pill here: live-looking status
              in permanent chrome is read as fact, and this one has a real
              answer with a quality rating and a webhook clock behind it —
              Admin → WhatsApp Setup. */}
        </div>

        {/* Pod Selector — only shown on pages that actually filter by one client */}
        {showPodSelector && (
          <div className="border-b border-[var(--border-color)] p-4">
            <p className="mb-1.5 text-xs font-bold text-[var(--text-dim)]">Active client</p>
            <SearchableSelect value={selectedPodId} onChange={setSelectedPodId} placeholder="All" aria-label="Active pod or client" options={[{ value: "", label: "All" }, ...pods!.map((p) => ({ value: p.id, label: p.name }))]} />
          </div>
        )}

        {/* Sidebar Nav Links */}
        <nav onClick={() => setMobileNavOpen(false)} aria-label="Main" className="flex-1 space-y-1 overflow-y-auto p-3">
          {/* A role with a single group (QC, editor, HR) gets the links
              without a lone group heading. */}
          {commonItems.length > 0 && (
            <>
              {(clientItems.length > 0 || adminItems.length > 0) && (
                <p className={`${groupLabelClass} !pt-1`}>Company-wide</p>
              )}
              {commonItems.map(renderNavLink)}
            </>
          )}

          {clientItems.length > 0 && (
            <>
              {(commonItems.length > 0 || adminItems.length > 0) && (
                <p className={groupLabelClass}>Client workspace</p>
              )}
              {clientItems.map(renderNavLink)}
            </>
          )}

          {adminItems.length > 0 && (
            <>
              <button
                type="button"
                aria-expanded={adminOpen}
                onClick={() => {
                  const next = !adminOpen;
                  setAdminOpen(next);
                  try {
                    localStorage.setItem("km_nav_admin", next ? "open" : "closed");
                  } catch {
                    /* private mode — the toggle still works for this visit */
                  }
                }}
                className={`${groupLabelClass} flex w-full items-center justify-between`}
              >
                Admin
                <i className={adminOpen ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} />
              </button>
              {adminOpen && adminItems.map(renderNavLink)}
            </>
          )}
        </nav>

        <DemoNotice className="mx-3 mt-2" />
        {/* Sidebar Footer: Impersonation */}
        {(isAdmin(user) || isImpersonating) && allUsers && (
          <div className="m-3 rounded-[10px] border border-dashed border-[var(--border-color)] bg-[var(--bg-card-hover)] p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-[var(--text-dim)]">
              <i className="ri-eye-line" /> Viewing as (simulation)
            </p>
            <SearchableSelect value={user?.id || ""} onChange={(targetId) => { if (targetId && targetId !== user?.id) impersonate.mutate(targetId); }} placeholder="Viewing as" aria-label="Viewing as simulation" options={allUsers.map((u) => ({ value: u.id, label: `${u.name} — ${roleLabel(u)}` }))} />
          </div>
        )}
      </aside>

      {/* Main Workspace Area */}
      <main
        style={isImpersonating ? { paddingTop: bannerH } : undefined}
        className="ml-0 flex min-w-0 flex-1 flex-col md:ml-[248px]"
      >

        {/* Top Navbar Header — carries the page's single <h1> */}
        <header
          style={isImpersonating ? { top: bannerH } : undefined}
          className="sticky top-0 z-30 flex min-h-[68px] flex-wrap items-center justify-between gap-3 border-b border-[var(--border-color)] bg-[var(--bg-header)] px-4 py-3 md:px-8 md:py-0"
        >
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Open navigation"
              onClick={() => setMobileNavOpen(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-card)] text-xl md:hidden"
            >
              <i className="ri-menu-line" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate font-[var(--font-display)] text-[22px] font-bold leading-tight tracking-tight">{pageTitle}</h1>
              <p className="flex items-center gap-2 text-[13px] text-[var(--text-dim)]">
                {showPodSelector && activePod ? `${activePod.name} workspace` : "All clients"}
                {user && (
                  <span className="inline-flex h-[22px] items-center rounded-full bg-[var(--bg-pill)] px-2 text-xs font-bold text-[var(--primary-text)]">
                    {roleLabel(user)}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center justify-end gap-2 md:w-auto md:flex-nowrap md:gap-3">
            {user && (
              <div className="order-last w-full md:order-none md:w-auto">
                <GlobalSearch user={user} onSelectPod={setSelectedPodId} />
              </div>
            )}

            {canCreateJobs && (
              <Button onClick={() => navigate("/?newJob=1")}>
                <i className="ri-add-line" /> New edit job
              </Button>
            )}

            {/* The inbox is one click from every screen rather than two
                clicks down a menu — it is the thing people come back to the
                tab for. Its badge is counted over the whole inbox by the
                server, not off a page of rows. */}
            {user && <NotificationBell />}

            {user && (
              <ProfileMenu
                user={user}
                theme={theme}
                onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
                onLogout={logout}
              />
            )}
          </div>
        </header>

        {/* Content Outlet Body */}
        <div className="min-w-0 flex-1 p-4 md:p-8">
          {/* `setSelectedPodId` is exposed so a page can hand the user off to a
              pod-filtered view (Overview's pod cards → the pipeline table)
              without a second, competing pod selector. */}
          <Outlet context={outletContext} />
        </div>
      </main>
    </div>
  );
}
