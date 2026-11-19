import { useState, useEffect } from "react";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { NotificationWatcher } from "@/components/notifications/NotificationWatcher";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useCurrentUser, useImpersonate, useLogout, useStopImpersonating } from "@/hooks/useAuth";
import { usePods } from "@/hooks/usePods";
import { useImpersonationTargets } from "@/hooks/useUsers";
import { hasRole, isAdmin, isLead } from "@/lib/roles";
import type { Role, User } from "@/types";

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
];

export function AppLayout() {
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const impersonate = useImpersonate();
  const stopImpersonating = useStopImpersonating();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [theme, setTheme] = useState<"dark" | "light">(() => {
    return (localStorage.getItem("km_theme") as "dark" | "light") || "light";
  });

  const [selectedPodId, setSelectedPodId] = useState<string>("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => setMobileNavOpen(false), [location.pathname, location.search]);

  const isImpersonating = Boolean(localStorage.getItem("admin_token"));

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
  const pageTitle = (() => {
    if (location.pathname === "/") return VIEW_LABELS[currentView] ?? "Overview";
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

  const renderNavLink = (item: NavItem) => (
    <Link
      key={item.to}
      to={item.to}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm md:text-xs font-semibold transition-all ${
        isItemActive(item)
          ? "bg-gradient-to-r from-purple-700 to-indigo-800 text-white shadow-lg shadow-purple-900/40"
          : "text-[var(--text-muted)] hover:bg-[var(--bg-pill)] hover:text-[var(--text-main)]"
      }`}
    >
      <i className={`${item.icon} text-base`} />
      <span>{item.label}</span>
    </Link>
  );

  return (
    <div className="flex min-h-screen bg-[var(--bg-app)] text-[var(--text-main)] transition-colors duration-300">

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
      {isImpersonating && user && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-purple-900 via-indigo-900 to-purple-950 px-6 py-2 text-xs text-purple-100 border-b border-purple-500/30 flex items-center justify-between shadow-2xl">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="font-bold text-white tracking-wide">ADMIN IMPERSONATION MODE ACTIVE:</span>
            <span>Viewing session as <strong>{user.name}</strong> ({user.role.toUpperCase()}) — {user.email}</span>
          </div>
          <button
            onClick={stopImpersonating}
            className="rounded bg-purple-600/80 hover:bg-purple-600 px-3 py-1 text-xs font-semibold text-white transition-all border border-purple-400/40 shadow"
          >
            ← Stop Impersonating (Return to Admin)
          </button>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className={`fixed top-0 bottom-0 left-0 z-50 w-[250px] bg-[var(--bg-sidebar)] border-r border-[var(--border-color)] backdrop-blur-md flex flex-col transition-transform md:translate-x-0 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'} ${isImpersonating ? 'pt-8' : ''}`}>

        {/* Sidebar Header with Official Logo */}
        <div className="p-5 border-b border-[var(--border-color-subtle)]">
          <Link to="/" onClick={() => setMobileNavOpen(false)} className="flex items-center gap-0.5 select-none group">
            <span className="logo-big-k">K</span>
            <div className="logo-text-stack">
              <span className="logo-ontent">ontent</span>
              <span className="logo-media">Media</span>
            </div>
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
          <div className="p-4 border-b border-[var(--border-color-subtle)]">
            <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)] mb-1.5 block">
              ACTIVE POD / CLIENT
            </label>
            <SearchableSelect value={selectedPodId} onChange={setSelectedPodId} placeholder="All" aria-label="Active pod or client" options={[{ value: "", label: "All" }, ...pods!.map((p) => ({ value: p.id, label: p.name }))]} />
          </div>
        )}

        {/* Sidebar Nav Links */}
        <nav onClick={() => setMobileNavOpen(false)} className="flex-1 p-3 space-y-1 overflow-y-auto">
          {commonItems.length > 0 && (
            <>
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)] px-3 mb-1 block">
                COMPANY-WIDE
              </label>
              {commonItems.map(renderNavLink)}
            </>
          )}

          {clientItems.length > 0 && (
            <>
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)] px-3 mb-1 mt-4 block">
                CLIENT WORKSPACE
              </label>
              {clientItems.map(renderNavLink)}
            </>
          )}

          {adminItems.length > 0 && (
            <>
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)] px-3 mb-1 mt-4 block">
                ADMIN
              </label>
              {adminItems.map(renderNavLink)}
            </>
          )}
        </nav>

        {/* Sidebar Footer: Impersonation */}
        <div className="p-3 border-t border-[var(--border-color-subtle)] space-y-3">
          {/* Role Impersonate Selector (Viewing as) */}
          {(isAdmin(user) || isImpersonating) && allUsers && (
            <div className="bg-[var(--bg-card)] border border-[var(--border-color-subtle)] rounded-lg p-2.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)] mb-1 block">
                VIEWING AS (SIMULATION)
              </label>
              <SearchableSelect value={user?.id || ""} onChange={(targetId) => { if (targetId && targetId !== user?.id) impersonate.mutate(targetId); }} placeholder="Viewing as" aria-label="Viewing as simulation" options={allUsers.map((u) => ({ value: u.id, label: `${u.name} — ${u.role.toUpperCase()}` }))} />
            </div>
          )}
        </div>
      </aside>

      {/* Main Workspace Area */}
      <main className={`flex-1 ml-0 md:ml-[250px] flex flex-col min-w-0 ${isImpersonating ? 'pt-8' : ''}`}>

        {/* Top Navbar Header */}
        <header className="min-h-[72px] bg-[var(--bg-header)] border-b border-[var(--border-color)] backdrop-blur-md px-4 py-3 md:px-8 md:py-0 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-30">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Open navigation"
              onClick={() => setMobileNavOpen(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-lg md:hidden"
            >
              <i className="ri-menu-line" />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg font-extrabold tracking-tight">{pageTitle}</h1>
              <p className="text-xs text-[var(--text-muted)]">
                {showPodSelector && activePod ? `${activePod.name} Workspace` : "All Clients"} · Role:{" "}
                <span className="font-bold text-[var(--primary-light)]">{user?.role.toUpperCase()}</span>
              </p>
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center justify-end gap-2 md:w-auto md:flex-nowrap md:gap-4">
            {user && (
              <div className="order-last w-full md:order-none md:w-auto">
                <GlobalSearch user={user} onSelectPod={setSelectedPodId} />
              </div>
            )}

            {canCreateJobs && (
              <button
                onClick={() => navigate("/?newJob=1")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--primary-hover)] px-3.5 py-2 text-xs font-bold text-white shadow-md shadow-[var(--primary-glow-subtle)] transition-all hover:-translate-y-0.5 hover:shadow-lg"
              >
                <i className="ri-add-line" /> New Edit Job
              </button>
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
        <div className="p-4 md:p-8 flex-1 min-w-0">
          {/* `setSelectedPodId` is exposed so a page can hand the user off to a
              pod-filtered view (Overview's pod cards → the pipeline table)
              without a second, competing pod selector. */}
          <Outlet context={{ selectedPodId, activePod, setSelectedPodId }} />
        </div>
      </main>
    </div>
  );
}
