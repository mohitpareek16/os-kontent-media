import { useEffect, useState } from "react";

import type { UpdateUserPayload } from "@/api/users";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorNote, SuccessNote } from "@/components/ui/ErrorNote";
import { Input } from "@/components/ui/Input";
import { Pagination } from "@/components/ui/Pagination";
import { PillButton } from "@/components/ui/PillButton";
import { Select } from "@/components/ui/Select";
import { useCurrentUser } from "@/hooks/useAuth";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  useResetPassword,
  useUpdateUser,
  useUserDirectory,
  useUserStats,
} from "@/hooks/useUsers";
import { AddTeammateModal } from "@/components/people/AddTeammateModal";
import { EditUserDetailsModal } from "@/components/people/EditUserDetailsModal";
import { dailyBudgetLabel, QC2_DAILY_POINTS } from "@/lib/qc2";
import { canAdminister, canResetPassword, creatableRoles, initialsOf, ROLE_META, ROLE_OPTIONS } from "@/lib/roles";
import type { EmploymentType, Role, User } from "@/types";

type StatusFilter = "all" | "active" | "inactive";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Deactivated" },
];

/** Which row a mutation result belongs to — one `useUpdateUser()` serves the
 * whole directory, so the message has to be pinned to the row that caused it
 * rather than shown against every account at once. */
interface RowNotice {
  userId: string;
  error?: unknown;
  message?: string;
}

const PAGE_SIZE = 25;

export default function UsersAdminPage() {
  const { data: me } = useCurrentUser();
  const resetPassword = useResetPassword();
  const updateUser = useUpdateUser();

  /** The same role choices the server allows this caller to onboard. */
  const assignableRoles = creatableRoles(me);

  const [adding, setAdding] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  /* Debounced — typing a name shouldn't be one request per character. */
  const search = useDebouncedValue(searchInput).trim();
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<RowNotice | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState<User | null>(null);
  const [editingDetails, setEditingDetails] = useState<User | null>(null);
  const canEditDetails = me?.role === "owner" || me?.role === "hr";

  useEffect(() => {
    setPage(1);
  }, [search, roleFilter, statusFilter]);

  /* Search, role and status are query params, not a `.filter()` over a
   * downloaded roster — the directory only ever holds one page. */
  const { data: directory, isLoading } = useUserDirectory({
    search: search || undefined,
    role: roleFilter === "all" ? undefined : roleFilter,
    status: statusFilter,
    page,
    page_size: PAGE_SIZE,
  });
  /* Roster-wide totals for the tiles. Deliberately a separate query: derived
   * from the page they would jump around every time you typed. */
  const { data: stats } = useUserStats();

  const filteredUsers = directory?.items ?? [];
  const activeCount = stats?.active ?? 0;
  const inactiveCount = stats?.inactive ?? 0;
  const roleCounts = stats?.by_role;

  /** Demoting or deactivating the only Owner left would lock everyone out of
   * user admin — the server refuses it, so the UI shouldn't offer it. This
   * reads the roster-wide count, not the page: on page 2 of the directory
   * the old check saw zero Owners and locked every Owner row on screen. */
  const activeOwners = roleCounts ? roleCounts.owner.total - roleCounts.owner.inactive : 0;

  function saveUser(user: User, payload: UpdateUserPayload, message: string, onDone?: () => void) {
    setPendingId(user.id);
    setNotice(null);
    updateUser.mutate(
      { userId: user.id, payload },
      {
        onSuccess: () => {
          setNotice({ userId: user.id, message });
          onDone?.();
        },
        onError: (error) => setNotice({ userId: user.id, error }),
        onSettled: () => setPendingId(null),
      },
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border-color)] pb-5">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--primary-light)]">
            <i className="ri-shield-user-line" /> Admin Panel
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[var(--text-main)]">Users &amp; Roles</h1>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            {canAdminister(me)
              ? "Edit names and emails, create teammates, manage roles, reset credentials and switch accounts off."
              : "Edit teammate names and login emails."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => setAdding(true)}>
            <i className="ri-user-add-line" /> Add teammate
          </Button>
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">
            <i className="ri-team-line text-[var(--primary)]" />
            <span className="font-mono text-sm font-bold text-[var(--text-main)]">{activeCount}</span>
            active
            {inactiveCount > 0 && (
              <span className="border-l border-[var(--border-color-subtle)] pl-2 text-[var(--text-dim)]">
                {inactiveCount} deactivated
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Role Breakdown Stat Tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-7">
        {/* Each tile is the filter it counts — the same tiles on the HR
            directory already were, and two identical-looking cards where only
            one does anything reads as one of them being broken. */}
        {ROLE_OPTIONS.map((r, i) => {
          const meta = ROLE_META[r];
          return (
            <button
              key={r}
              type="button"
              onClick={() => setRoleFilter(roleFilter === r ? "all" : r)}
              title={`Filter the directory below to ${meta.label}`}
              className={`glass-card animate-fade-in-up p-4 text-left transition-all hover:-translate-y-0.5 ${
                roleFilter === r ? "border-glow border-[var(--primary)]" : ""
              }`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
                  {meta.label}
                </span>
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${meta.ring} text-sm text-white shadow-sm`}>
                  <i className={meta.icon} />
                </div>
              </div>
              <div className="mt-2 font-mono text-2xl font-extrabold text-[var(--text-main)]">
                {roleCounts ? roleCounts[r].total : "—"}
              </div>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-dim)]">
                {roleCounts && roleCounts[r].inactive > 0
                  ? `${roleCounts[r].inactive} deactivated`
                  : "all active"}
              </p>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Directory */}
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
                All
              </PillButton>
              {ROLE_OPTIONS.map((r) => (
                <PillButton key={r} active={roleFilter === r} onClick={() => setRoleFilter(r)}>
                  {r.toUpperCase()}
                </PillButton>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-color-subtle)] px-4 py-2.5">
            <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
              Account status
            </span>
            {STATUS_FILTERS.map((f) => (
              <PillButton
                key={f.value}
                active={statusFilter === f.value}
                onClick={() => setStatusFilter(f.value)}
              >
                {f.label}
              </PillButton>
            ))}
          </div>

          {isLoading && (
            <p className="flex items-center gap-2 p-6 text-sm text-[var(--text-muted)]">
              <i className="ri-loader-4-line animate-spin" /> Loading users...
            </p>
          )}

          <div className="divide-y divide-[var(--border-color-subtle)]">
            {filteredUsers.map((user, i) => (
              <UserRow
                key={user.id}
                user={user}
                index={i}
                isSelf={user.id === me?.id}
                isLastActiveOwner={user.role === "owner" && user.is_active && activeOwners <= 1}
                canAdminister={canAdminister(me)}
                canResetPassword={canResetPassword(me, user)}
                canEditDetails={canEditDetails}
                onEditDetails={() => setEditingDetails(user)}
                roleOptions={assignableRoles}
                notice={notice?.userId === user.id ? notice : null}
                pending={pendingId === user.id && updateUser.isPending}
                onChangeRole={(nextRole) =>
                  saveUser(user, { role: nextRole }, `Role changed to ${ROLE_META[nextRole].label}.`)
                }
                onChangeSecondary={(nextRole) =>
                  saveUser(
                    user,
                    nextRole
                      ? { secondary_role: nextRole }
                      : { clear_secondary_role: true },
                    nextRole
                      ? `${user.name} is now also a Team Lead — give them a pod to lead.`
                      : "Team Lead access taken back.",
                  )
                }
                onChangeCapacity={(capacity) =>
                  saveUser(
                    user,
                    { max_concurrent_jobs: capacity },
                    `${user.name} can now hold ${capacity} video(s) at a time.`,
                  )
                }
                onChangeEmployment={(employmentType) =>
                  saveUser(
                    user,
                    { employment_type: employmentType },
                    `${user.name}: ${dailyBudgetLabel(employmentType)}.`,
                  )
                }
                onDeactivate={() => setDeactivating(user)}
                onReactivate={() => saveUser(user, { is_active: true }, "Account reactivated.")}
                onResetPassword={(newPassword, done) =>
                  resetPassword.mutate(
                    { userId: user.id, newPassword },
                    {
                      onSuccess: () => {
                        setNotice({ userId: user.id, message: "Password reset." });
                        done();
                      },
                      onError: (error) => setNotice({ userId: user.id, error }),
                    },
                  )
                }
                isResetPending={resetPassword.isPending}
              />
            ))}

            {!isLoading && filteredUsers.length === 0 && (
              <div className="p-10 text-center">
                <i className="ri-user-search-line text-3xl text-[var(--text-dim)]" />
                <p className="mt-2 text-sm font-semibold text-[var(--text-main)]">
                  {activeCount + inactiveCount > 0
                    ? "No teammates match these filters."
                    : "No accounts yet."}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {activeCount + inactiveCount > 0
                    ? "Clear the search or switch back to Everyone to see the full directory."
                    : "Create the first teammate with the form on the left."}
                </p>
              </div>
            )}
          </div>

          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={directory?.total ?? 0}
            onPageChange={setPage}
            noun="teammates"
            className="border-t border-[var(--border-color-subtle)]"
          />
        </div>
      </div>

      <AddTeammateModal
        open={adding}
        roles={assignableRoles}
        onClose={() => setAdding(false)}
        onCreated={(created) => {
          setNotice({ userId: created.id, message: `${created.name} added.` });
          setAdding(false);
        }}
      />

      {editingDetails && (
        <EditUserDetailsModal key={editingDetails.id} user={editingDetails} onClose={() => setEditingDetails(null)} />
      )}

      <ConfirmDialog
        open={Boolean(deactivating)}
        title={`Deactivate ${deactivating?.name ?? ""}?`}
        description={
          <>
            They will be signed out and can no longer log in. Nothing is deleted — every job, QC score
            and event they touched keeps pointing at their account, and they stay visible here as
            deactivated. You can switch them back on at any time.
          </>
        }
        confirmLabel="Deactivate account"
        confirmIcon="ri-forbid-2-line"
        pending={updateUser.isPending}
        error={notice?.userId === deactivating?.id ? notice?.error : null}
        errorFallback="Could not deactivate that account."
        onCancel={() => setDeactivating(null)}
        onConfirm={() => {
          if (!deactivating) return;
          saveUser(deactivating, { is_active: false }, "Account deactivated.", () =>
            setDeactivating(null),
          );
        }}
      />
    </div>
  );
}

interface UserRowProps {
  user: User;
  index: number;
  isSelf: boolean;
  isLastActiveOwner: boolean;
  /** False when the signed-in admin may not touch this account at all. Every
   * control on the row is read-only then, because the server refuses all of
   * them. */
  canAdminister: boolean;
  /** Owner: anyone. HR: the roles it onboards, never itself. */
  canResetPassword: boolean;
  canEditDetails: boolean;
  onEditDetails: () => void;
  /** Roles the signed-in admin may assign, plus the row's current one so the
   * dropdown can show what it is today. */
  roleOptions: Role[];
  notice: RowNotice | null;
  pending: boolean;
  onChangeRole: (role: Role) => void;
  onChangeSecondary: (role: Role | null) => void;
  onChangeCapacity: (capacity: number) => void;
  onChangeEmployment: (employmentType: EmploymentType) => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  onResetPassword: (newPassword: string, done: () => void) => void;
  isResetPending: boolean;
}

function UserRow({
  user,
  index,
  isSelf,
  isLastActiveOwner,
  canAdminister,
  canResetPassword,
  canEditDetails,
  onEditDetails,
  roleOptions,
  notice,
  pending,
  onChangeRole,
  onChangeSecondary,
  onChangeCapacity,
  onChangeEmployment,
  onDeactivate,
  onReactivate,
  onResetPassword,
  isResetPending,
}: UserRowProps) {
  const meta = ROLE_META[user.role];
  const [resetting, setResetting] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [capacity, setCapacity] = useState(String(user.max_concurrent_jobs));

  const capacityChanged = capacity !== "" && Number(capacity) !== user.max_concurrent_jobs;

  function commitCapacity() {
    if (!capacityChanged) {
      setCapacity(String(user.max_concurrent_jobs));
      return;
    }
    onChangeCapacity(Number(capacity));
  }

  return (
    <div
      className={`animate-fade-in-up px-4 py-3.5 transition-colors ${
        user.is_active
          ? "hover:bg-[var(--bg-pill)]"
          : "bg-[color-mix(in_srgb,var(--bg-pill)_40%,transparent)]"
      }`}
      style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={`flex items-center gap-3 ${user.is_active ? "" : "opacity-55"}`}>
          <div className="relative">
            <span
              className={`avatar-circle h-10 w-10 rounded-xl text-sm ${
                user.is_active
                  ? `bg-gradient-to-br ${meta.ring}`
                  : "bg-[var(--text-dim)] bg-none saturate-0"
              }`}
            >
              {initialsOf(user.name)}
            </span>
            {user.is_active && (
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--bg-card)] ${
                  user.available ? "bg-[var(--accent-green)]" : "bg-[var(--text-dim)]"
                }`}
                title={user.available ? "Taking new work" : "Not taking new work"}
              />
            )}
          </div>
          <div>
            <p className="flex items-center gap-2 text-sm font-bold text-[var(--text-main)]">
              {user.name}
              {isSelf && (
                <span className="rounded bg-[var(--bg-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--text-dim)]">
                  You
                </span>
              )}
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              {user.email}
              {user.role_title && (
                <>
                  {" · "}
                  <span className="font-semibold text-[var(--text-muted)]">{user.role_title}</span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {canEditDetails && (
            <Button variant="secondary" onClick={onEditDetails} disabled={pending} className="text-xs">
              <i className="ri-edit-line" /> Edit details
            </Button>
          )}
          {!user.is_active && (
            <Badge className="bg-[var(--accent-red-bg)] text-[var(--accent-red)]">
              <i className="ri-forbid-2-line" /> Deactivated
            </Badge>
          )}

          {/* Editable row: the role dropdown and capacity box. Otherwise the
              role is stated as a badge — a deactivated account has nothing to
              edit, and an account this admin may not administer would only
              collect 403s. */}
          {user.is_active && canAdminister ? (
            <>
              <div className="w-[150px]" title="Change what this account can do across the workspace.">
                <Select
                  value={user.role}
                  disabled={pending || isLastActiveOwner}
                  onChange={(e) => onChangeRole(e.target.value as Role)}
                >
                  {/* The row's own role is always listed even when this admin
                      couldn't assign it — a select whose value isn't among its
                      options renders blank, which reads as "no role". */}
                  {[...new Set([user.role, ...roleOptions])].map((r) => (
                    <option key={r} value={r}>
                      {ROLE_META[r].label}
                    </option>
                  ))}
                </Select>
              </div>

              {/* Lending the TL role. Its own control rather than a second
                  entry in the role dropdown, because it is a different
                  question: not "what is this person" but "what else may they
                  run". A TL reaches only the pods they are given, so this is
                  additive and revocable — see docs/04. */}
              <div className="w-[150px]" title="Also give them Team Lead powers, on the pods they are given.">
                <Select
                  value={user.secondary_role ?? ""}
                  disabled={pending || user.role === "tl" || user.role === "owner"}
                  onChange={(e) =>
                    onChangeSecondary((e.target.value || null) as Role | null)
                  }
                >
                  <option value="">No extra access</option>
                  <option value="tl">Also TL</option>
                </Select>
              </div>

              <div
                className="flex items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-2.5"
                title="How many videos this teammate can hold at once. A slot frees up when one is delivered; assignment past the limit is refused."
              >
                <i className="ri-speed-up-line text-xs text-[var(--text-dim)]" />
                <input
                  type="number"
                  min={0}
                  max={999}
                  value={capacity}
                  disabled={pending}
                  onChange={(e) => setCapacity(e.target.value)}
                  onBlur={commitCapacity}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitCapacity();
                    }
                    if (e.key === "Escape") setCapacity(String(user.max_concurrent_jobs));
                  }}
                  className="w-11 bg-transparent text-center font-mono text-xs font-bold text-[var(--text-main)] outline-none"
                  aria-label={`Videos ${user.name} can hold at a time`}
                />
                <span className="text-[10px] font-semibold uppercase text-[var(--text-dim)]">at a time</span>
                {capacityChanged && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={commitCapacity}
                    className="text-[var(--primary)] hover:text-[var(--primary-light)]"
                    aria-label="Save the limit"
                  >
                    <i className="ri-check-line" />
                  </button>
                )}
              </div>

              {/* Only on QC accounts. Employment type sits on every row in the
                  database because the admin screen edits one row at a time,
                  but it decides exactly one thing — a reviewer's daily QC2
                  points budget — and offering it on an editor would imply it
                  changes something for them. */}
              {user.role === "qc" && (
                <div
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-1.5"
                  title="A QC reviewer's day has 24 full-time or 12 part-time points. Video type prices are set by the owner."
                >
                  <i className="ri-time-line text-xs text-[var(--text-dim)]" />
                  <Select
                    value={user.employment_type}
                    disabled={pending}
                    aria-label={`Working day for ${user.name}`}
                    onChange={(e) => onChangeEmployment(e.target.value as EmploymentType)}
                    className="!py-0.5 text-xs"
                  >
                    <option value="full_time">Full-time</option>
                    <option value="part_time">Part-time</option>
                  </Select>
                  {/* Read-only, and derived — the budget is computed from the
                      type on the server (`routing.CAPACITY`), never stored per
                      account. Showing it as a second editable field would be
                      the same number typed twice, and they would drift. */}
                  <span className="font-mono text-[10px] font-bold text-[var(--text-dim)]">
                    {QC2_DAILY_POINTS[user.employment_type]} pts/day
                  </span>
                </div>
              )}
            </>
          ) : (
            <Badge className={meta.badge}>
              <i className={meta.icon} /> {ROLE_META[user.role].label}
            </Badge>
          )}

          {user.is_active && canResetPassword &&
            (resetting ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  onResetPassword(newPassword, () => {
                    setResetting(false);
                    setNewPassword("");
                  });
                }}
              >
                <Input
                  type="password"
                  placeholder="New password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                  className="w-40 py-1.5"
                  autoFocus
                  required
                />
                <Button type="submit" disabled={isResetPending} className="px-2.5 py-1.5">
                  <i className="ri-check-line" />
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setResetting(false);
                    setNewPassword("");
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-dim)] hover:bg-[var(--bg-pill)] hover:text-[var(--text-main)]"
                >
                  <i className="ri-close-line" />
                </button>
              </form>
            ) : (
              <Button
                variant="secondary"
                onClick={() => setResetting(true)}
                className="text-xs"
                title="Set a new password for this teammate"
              >
                <i className="ri-key-2-line" /> Reset password
              </Button>
            ))}

          {!canAdminister ? null : user.is_active ? (
            <Button
              variant="ghost"
              disabled={pending || isSelf}
              onClick={onDeactivate}
              title={
                isSelf
                  ? "You cannot deactivate your own account."
                  : "Switch this account off — they can no longer log in."
              }
              className="text-xs hover:bg-[var(--accent-red-bg)]"
            >
              <span className="flex items-center gap-1.5 text-[var(--accent-red)]">
                <i className="ri-forbid-2-line" /> Deactivate
              </span>
            </Button>
          ) : (
            <Button variant="secondary" disabled={pending} onClick={onReactivate} className="text-xs">
              {pending ? (
                <>
                  <i className="ri-loader-4-line animate-spin" /> Working...
                </>
              ) : (
                <>
                  <i className="ri-refresh-line" /> Reactivate
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {isLastActiveOwner && canAdminister && user.is_active && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--text-dim)]">
          <i className="ri-lock-line" /> The last active Owner can't be demoted — promote someone else
          first.
        </p>
      )}

      {notice?.error != null && (
        <ErrorNote error={notice.error} fallback="That change was rejected." className="mt-2" />
      )}
      {notice?.message && !notice.error && <SuccessNote message={notice.message} className="mt-2" />}
    </div>
  );
}
