import { useEffect, useState } from "react";

import { PageHeader } from "@/components/layout/PageHeader";
import { AddTeammateModal } from "@/components/people/AddTeammateModal";
import { DeactivateModal } from "@/components/people/DeactivateModal";
import { EditUserDetailsModal } from "@/components/people/EditUserDetailsModal";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SuccessNote } from "@/components/ui/ErrorNote";
import { Pagination } from "@/components/ui/Pagination";
import { PillButton } from "@/components/ui/PillButton";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useCurrentUser } from "@/hooks/useAuth";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useUserDirectory, useUserStats } from "@/hooks/useUsers";
import { formatFullDate } from "@/lib/format";
import {
  canSwitchOff,
  creatableRoles,
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
    <div>
      <PageHeader
        description="Everyone on the roster, split by what they do — and the place to onboard the next teammate."
        actions={
          <Button onClick={() => setOnboarding(true)}>
            <i className="ri-user-add-line" /> Onboard employee
          </Button>
        }
      />

      {justAdded && (
        <SuccessNote
          className="mb-4"
          message={`${justAdded} can now log in with the password you set. Share it with them out of band — there is no email invite yet.`}
        />
      )}

      {/* Headcount: one strip. The role split is the filter below, not eight
          more tiles. */}
      <div className="glass-card mb-4 grid grid-cols-3 divide-x divide-[var(--border-color)]">
        {[
          { label: "Total employees", value: stats ? headcount : "—", hint: "All roles" },
          { label: "Active", value: stats ? stats.active : "—", hint: "Can sign in" },
          { label: "Deactivated", value: stats ? stats.inactive : "—", hint: "Kept for history" },
        ].map((cell) => (
          <div key={cell.label} className="p-5">
            <p className="text-[13px] font-semibold text-[var(--text-dim)]">{cell.label}</p>
            <p className="num text-[30px] font-bold leading-tight">{cell.value}</p>
            <p className="text-xs text-[var(--text-dim)]">{cell.hint}</p>
          </div>
        ))}
      </div>

      {/* Everyone, by name */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <i className="ri-search-line pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-[var(--text-dim)]" />
          <input
            type="search"
            aria-label="Search by name or email"
            placeholder="Search by name or email"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-10 w-full rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-input)] pl-10 pr-3 text-sm outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--primary)]"
          />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Role">
          <PillButton active={roleFilter === "all"} onClick={() => setRoleFilter("all")}>
            Everyone <span className="num opacity-70">{stats ? headcount : "—"}</span>
          </PillButton>
          {ROLE_OPTIONS.map((r) => (
            <PillButton key={r} active={roleFilter === r} onClick={() => setRoleFilter(r)} title={ROLE_META[r].blurb}>
              <i className={ROLE_META[r].icon} /> {ROLE_META[r].label}
              <span className="num opacity-70">{roleCounts ? roleCounts[r].total : "—"}</span>
            </PillButton>
          ))}
        </div>
        <div className="flex gap-1.5 sm:ml-auto" role="group" aria-label="Account status">
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

      {isLoading && <SkeletonRows rows={5} label="Loading the roster" />}

      {!isLoading && people.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="k-table min-w-[720px]">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th className="text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => {
                  const meta = ROLE_META[person.role];
                  return (
                    <tr key={person.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <Avatar name={person.name} size={36} />
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 font-bold text-[var(--text-main)]">
                              {person.name}
                              {person.id === me?.id && (
                                <span className="rounded bg-[var(--bg-pill)] px-1.5 py-0.5 text-xs font-bold text-[var(--text-muted)]">
                                  You
                                </span>
                              )}
                            </p>
                            <p className="text-[13px] text-[var(--text-muted)]">{person.email}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Badge>
                          <i className={`${meta.icon} text-[var(--primary)]`} /> {roleLabel(person)}
                        </Badge>
                      </td>
                      <td>
                        {person.is_active ? (
                          <Badge className="bg-[var(--ok-bg)] text-[var(--ok-text)]">
                            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" /> Active
                          </Badge>
                        ) : (
                          <>
                            <Badge className="bg-[var(--bad-bg)] text-[var(--bad-text)]">
                              <i className="ri-forbid-2-line" /> Deactivated
                            </Badge>
                            {/* Who pressed the switch, under the name it was
                                pressed on. A greyed-out row that cannot say how
                                it got that way is the thing this record exists
                                to stop. */}
                            {person.last_status_change && (
                              <p className="mt-1 max-w-xs text-[13px] text-[var(--text-muted)]">
                                Deactivated {formatFullDate(person.last_status_change.created_at)}
                                {person.last_status_change.actor_name
                                  ? ` by ${person.last_status_change.actor_name}`
                                  : ""}
                                {person.last_status_change.reason
                                  ? ` — “${person.last_status_change.reason}”`
                                  : ""}
                              </p>
                            )}
                          </>
                        )}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setEditingDetails(person)}
                            title={`Edit ${person.name}'s details and phone number`}
                          >
                            <i className="ri-edit-line" /> Edit
                          </Button>
                          {/* Shown only where the POST would actually be
                              accepted — same table as the onboarding dropdown
                              reads, so the button and the 403 cannot disagree. */}
                          {canSwitchOff(me, person) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className={person.is_active ? "!text-[var(--bad-text)]" : ""}
                              onClick={() => setSwitching(person)}
                              title={
                                person.is_active
                                  ? `Deactivate ${person.name}`
                                  : `Reactivate ${person.name}`
                              }
                            >
                              {person.is_active ? "Deactivate" : "Reactivate"}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={directory?.total ?? 0}
            onPageChange={setPage}
            noun="employees"
            className="border-t border-[var(--border-color)]"
          />
        </div>
      )}

      {!isLoading && people.length === 0 && (
        <EmptyState
          icon="ri-user-search-line"
          title={headcount > 0 ? "Nobody matches these filters" : "Nobody on the roster yet"}
          description={
            headcount > 0
              ? "Clear the search or switch back to Everyone."
              : "Use Onboard employee to add the first teammate."
          }
        />
      )}

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
