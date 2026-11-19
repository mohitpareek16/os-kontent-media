import { useEffect, useState } from "react";

import { AddTeammateModal } from "@/components/people/AddTeammateModal";
import { DeactivateModal } from "@/components/people/DeactivateModal";
import { EditUserDetailsModal } from "@/components/people/EditUserDetailsModal";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SuccessNote } from "@/components/ui/ErrorNote";
import { Pagination } from "@/components/ui/Pagination";
import { PillButton } from "@/components/ui/PillButton";
import { useCurrentUser } from "@/hooks/useAuth";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useUserDirectory, useUserStats } from "@/hooks/useUsers";
import { formatFullDate } from "@/lib/format";
import {
  canSwitchOff,
  creatableRoles,
  initialsOf,
  roleLabel,
  ROLE_META,
  ROLE_OPTIONS,
} from "@/lib/roles";
import type { Role, User } from "@/types";

const PAGE_SIZE = 25;

/**
 * People-ops' whole surface: how many teammates there are, how that splits by
 * role, who they are by name, and one button to onboard the next one.
 *
 * Deliberately still not a second copy of Users & Roles. There is no capacity
 * box and no role dropdown per row: changing what an existing account *may
 * do* belongs to the admin tier (docs/04-permissions.md), and the server
 * refuses it from an HR token, so offering the control would only produce
 * 403s.
 *
 * HR may edit contact details here, including the number WhatsApp uses.
 * Deactivation is limited to the roles HR may onboard (`creatableRoles`,
 * mirroring `CREATABLE_ROLES` on the server). Role and capacity changes stay
 * with the Owner.
 */
export default function HrPage() {
  const { data: me } = useCurrentUser();
  const [onboarding, setOnboarding] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  /* Debounced — typing a name shouldn't be one request per character. */
  const search = useDebouncedValue(searchInput).trim();
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  /* Deactivated accounts are in the list by default, greyed out — pretending
     a leaver never existed is how a roster starts disagreeing with itself.
     The filter is for the two moments you want one or the other alone. */
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(1);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  /* The row whose on/off switch is being confirmed. Null closes the dialog. */
  const [switching, setSwitching] = useState<User | null>(null);
  const [editingDetails, setEditingDetails] = useState<User | null>(null);

  useEffect(() => {
    setPage(1);
  }, [search, roleFilter, statusFilter]);

  /* Whole-roster totals, counted server-side. Not derived from the page
   * below, so the headline number doesn't drop to 25 when you page. */
  const { data: stats } = useUserStats();
  const { data: directory, isLoading } = useUserDirectory({
    search: search || undefined,
    role: roleFilter === "all" ? undefined : roleFilter,
    status: statusFilter,
    page,
    page_size: PAGE_SIZE,
    sort_by: "name",
  });

  const people = directory?.items ?? [];
  const roleCounts = stats?.by_role;
  const headcount = (stats?.active ?? 0) + (stats?.inactive ?? 0);

  return (
    <div className="space-y-6">
      {/* Page header + the one action HR has */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border-color)] pb-5">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--primary-light)]">
            <i className="ri-shake-hands-line" /> People Ops
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[var(--text-main)]">
            Team Directory
          </h1>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Everyone on the roster, split by what they do — and the place to onboard the next
            teammate.
          </p>
        </div>
        <Button onClick={() => setOnboarding(true)}>
          <i className="ri-user-add-line" /> Onboard employee
        </Button>
      </div>

      {justAdded && (
        <SuccessNote
          message={`${justAdded} can now log in with the password you set. Share it with them out of band — there is no email invite yet.`}
        />
      )}

      {/* Headcount, then the split behind it */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-7">
        {/* Clears the role filter rather than setting one — it is the "all" of
            the seven tiles beside it, and the only tile that didn't do
            anything when the rest did. */}
        <button
          type="button"
          onClick={() => setRoleFilter("all")}
          title="Show everyone in the list below"
          className={`glass-card animate-fade-in-up p-4 text-left transition-all hover:-translate-y-0.5 ${
            roleFilter === "all" ? "border-glow border-[var(--primary)]" : ""
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
              Total employees
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--primary)] to-indigo-700 text-sm text-white shadow-sm">
              <i className="ri-team-fill" />
            </div>
          </div>
          <div className="mt-2 font-mono text-2xl font-extrabold text-[var(--text-main)]">
            {stats ? headcount : "—"}
          </div>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-dim)]">
            {stats && stats.inactive > 0 ? `${stats.active} active` : "all active"}
          </p>
        </button>

        {ROLE_OPTIONS.map((r, i) => {
          const meta = ROLE_META[r];
          return (
            <button
              key={r}
              type="button"
              onClick={() => setRoleFilter(roleFilter === r ? "all" : r)}
              title={`${meta.blurb} — click to filter the list below`}
              className={`glass-card animate-fade-in-up p-4 text-left transition-all hover:-translate-y-0.5 ${
                roleFilter === r ? "border-glow border-[var(--primary)]" : ""
              }`}
              style={{ animationDelay: `${(i + 1) * 60}ms` }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
                  {meta.label}
                </span>
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${meta.ring} text-sm text-white shadow-sm`}
                >
                  <i className={meta.icon} />
                </div>
              </div>
              <div className="mt-2 font-mono text-2xl font-extrabold text-[var(--text-main)]">
                {roleCounts ? roleCounts[r].total : "—"}
              </div>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-dim)]">
                {roleCounts && roleCounts[r].inactive > 0
                  ? `${roleCounts[r].inactive} deactivated`
                  : meta.blurb}
              </p>
            </button>
          );
        })}
      </div>

      {/* Everyone, by name */}
      <div className="glass-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-color-subtle)] p-4">
          <div className="relative w-full max-w-xs">
            <i className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] py-2 pl-9 pr-3 text-xs outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <PillButton active={roleFilter === "all"} onClick={() => setRoleFilter("all")}>
              Everyone
            </PillButton>
            {ROLE_OPTIONS.map((r) => (
              <PillButton key={r} active={roleFilter === r} onClick={() => setRoleFilter(r)}>
                {ROLE_META[r].label}
              </PillButton>
            ))}
            {/* Separate from the role pills, and after them: "Deactivated" is
                not an eighth role, it is a second axis. */}
            <span className="mx-1 self-center text-[var(--border-color)]">|</span>
            <PillButton
              active={statusFilter === "active"}
              onClick={() => setStatusFilter(statusFilter === "active" ? "all" : "active")}
            >
              Active only
            </PillButton>
            <PillButton
              active={statusFilter === "inactive"}
              onClick={() => setStatusFilter(statusFilter === "inactive" ? "all" : "inactive")}
            >
              Deactivated
            </PillButton>
          </div>
        </div>

        {isLoading && (
          <p className="flex items-center gap-2 p-6 text-sm text-[var(--text-muted)]">
            <i className="ri-loader-4-line animate-spin" /> Loading the roster...
          </p>
        )}

        <div className="divide-y divide-[var(--border-color-subtle)]">
          {people.map((person, i) => {
            const meta = ROLE_META[person.role];
            return (
              <div
                key={person.id}
                className={`animate-fade-in-up flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${
                  person.is_active ? "" : "opacity-55"
                }`}
                style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`avatar-circle h-10 w-10 rounded-xl text-sm ${
                      person.is_active
                        ? `bg-gradient-to-br ${meta.ring}`
                        : "bg-[var(--text-dim)] bg-none saturate-0"
                    }`}
                  >
                    {initialsOf(person.name)}
                  </span>
                  <div>
                    <p className="flex items-center gap-2 text-sm font-bold text-[var(--text-main)]">
                      {person.name}
                      {person.id === me?.id && (
                        <span className="rounded bg-[var(--bg-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--text-dim)]">
                          You
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">{person.email}</p>
                    {/* Who pressed the switch, under the name it was pressed
                        on. A greyed-out row that cannot say how it got that
                        way is the thing this record exists to stop. */}
                    {!person.is_active && person.last_status_change && (
                      <p className="mt-0.5 text-[11px] text-[var(--text-dim)]">
                        Deactivated {formatFullDate(person.last_status_change.created_at)}
                        {person.last_status_change.actor_name
                          ? ` by ${person.last_status_change.actor_name}`
                          : ""}
                        {person.last_status_change.reason
                          ? ` — “${person.last_status_change.reason}”`
                          : ""}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    className="!px-2 !py-1 !text-xs"
                    onClick={() => setEditingDetails(person)}
                    title={`Edit ${person.name}'s details and phone number`}
                  >
                    <i className="ri-edit-line" /> Edit details
                  </Button>
                  {!person.is_active && (
                    <Badge className="bg-[var(--accent-red-bg)] text-[var(--accent-red)]">
                      <i className="ri-forbid-2-line" /> Deactivated
                    </Badge>
                  )}
                  <Badge className={meta.badge}>
                    <i className={meta.icon} /> {roleLabel(person)}
                  </Badge>
                  {/* Shown only where the POST would actually be accepted —
                      same table as the onboarding dropdown reads, so the
                      button and the 403 cannot disagree. */}
                  {canSwitchOff(me, person) && (
                    <Button
                      variant="ghost"
                      className="!px-2 !py-1 !text-xs"
                      onClick={() => setSwitching(person)}
                      title={
                        person.is_active
                          ? `Deactivate ${person.name}`
                          : `Reactivate ${person.name}`
                      }
                    >
                      <i
                        className={person.is_active ? "ri-forbid-2-line" : "ri-user-follow-line"}
                      />
                      {person.is_active ? "Deactivate" : "Reactivate"}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}

          {!isLoading && people.length === 0 && (
            <div className="p-10 text-center">
              <i className="ri-user-search-line text-3xl text-[var(--text-dim)]" />
              <p className="mt-2 text-sm font-semibold text-[var(--text-main)]">
                {headcount > 0 ? "Nobody matches these filters." : "Nobody on the roster yet."}
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {headcount > 0
                  ? "Clear the search or switch back to Everyone."
                  : "Use Onboard employee to add the first teammate."}
              </p>
            </div>
          )}
        </div>

        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={directory?.total ?? 0}
          onPageChange={setPage}
          noun="employees"
          className="border-t border-[var(--border-color-subtle)]"
        />
      </div>

      <DeactivateModal person={switching} onClose={() => setSwitching(null)} />

      {editingDetails && (
        <EditUserDetailsModal key={editingDetails.id} user={editingDetails} onClose={() => setEditingDetails(null)} />
      )}

      <AddTeammateModal
        open={onboarding}
        /* Whoever is looking: an Owner can create any role, HR only the roles
         * that do the work. The server enforces the same table, so this just
         * keeps the dropdown from offering a guaranteed 403. */
        roles={creatableRoles(me)}
        title="Onboard employee"
        submitLabel="Add employee"
        onClose={() => setOnboarding(false)}
        onCreated={(created) => {
          setJustAdded(created.name);
          setOnboarding(false);
        }}
      />
    </div>
  );
}
