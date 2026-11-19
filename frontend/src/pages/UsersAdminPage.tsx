import { useEffect, useRef, useState } from "react";

import type { UpdateUserPayload } from "@/api/users";
import { PageHeader } from "@/components/layout/PageHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorNote, SuccessNote } from "@/components/ui/ErrorNote";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { PillButton } from "@/components/ui/PillButton";
import { Select } from "@/components/ui/Select";
import { SkeletonRows } from "@/components/ui/Skeleton";
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
    <div className="space-y-5">
      <PageHeader
        description={
          canAdminister(me)
            ? "Edit names and emails, create teammates, manage roles, reset credentials and switch accounts off."
            : "Edit teammate names and login emails."
        }
        actions={
          <>
            <span className="flex h-10 items-center gap-2 rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-card)] px-3 text-[13px] font-semibold text-[var(--text-muted)]">
              <i className="ri-team-line text-[var(--primary)]" />
              <span className="num text-sm font-bold text-[var(--text-main)]">{activeCount}</span>
              active
              {inactiveCount > 0 && (
                <span className="border-l border-[var(--border-color)] pl-2 text-[var(--text-dim)]">
                  {inactiveCount} deactivated
                </span>
              )}
            </span>
            <Button onClick={() => setAdding(true)}>
              <i className="ri-user-add-line" /> Add teammate
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6">
        {/* Directory */}
        <div className="glass-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-color-subtle)] p-4">
            <div className="relative w-full max-w-xs">
              <i className="ri-search-line pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-[var(--text-dim)]" />
              <input
                type="text"
                placeholder="Search by name or email..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="Search by name or email"
                className="h-10 w-full rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-input)] py-2 pl-10 pr-3 text-sm outline-none focus:border-[var(--primary)]"
              />
            </div>
            {/* The role split is the filter: counts come from the roster-wide
                stats, not from the page below. */}
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Role">
              <PillButton active={roleFilter === "all"} onClick={() => setRoleFilter("all")}>
                All
              </PillButton>
              {ROLE_OPTIONS.map((r) => (
                <PillButton
                  key={r}
                  active={roleFilter === r}
                  onClick={() => setRoleFilter(roleFilter === r ? "all" : r)}
                  title={ROLE_META[r].blurb}
                >
                  <i className={ROLE_META[r].icon} /> {ROLE_META[r].label}
                  <span className="num opacity-70">{roleCounts ? roleCounts[r].total : "—"}</span>
                </PillButton>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-color)] px-4 py-2.5">
            <span className="mr-1 text-[13px] font-bold text-[var(--text-muted)]">
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
            <div className="p-4">
              <SkeletonRows rows={5} label="Loading users" />
            </div>
          )}

          {filteredUsers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="k-table min-w-[960px]">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Extra access</th>
                  <th>Capacity</th>
                  <th>Status</th>
                  <th className="w-14">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
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
              </tbody>
            </table>
          </div>
          )}

          {!isLoading && filteredUsers.length === 0 && (
            <EmptyState
              bare
              icon="ri-user-search-line"
              title={activeCount + inactiveCount > 0 ? "No teammates match these filters" : "No accounts yet"}
              description={
                activeCount + inactiveCount > 0
                  ? "Clear the search or switch back to Everyone to see the full directory."
                  : "Add the first teammate with the button above."
              }
            />
          )}

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

/** The "⋯" menu: a small popover pinned to the button with `position: fixed`,
 * so the table's horizontal scroll container cannot clip it. */
function RowMenu({
  label,
  items,
}: {
  label: string;
  items: { label: string; icon: string; onClick: () => void; danger?: boolean; disabled?: boolean; title?: string }[];
}) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [pos]);

  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        aria-label={label}
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          setPos(rect ? { top: rect.bottom + 4, right: window.innerWidth - rect.right } : null);
        }}
        className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-card)] text-lg text-[var(--text-muted)] hover:border-[var(--primary)]"
      >
        <i className="ri-more-2-fill" />
      </button>
      {pos && (
        <div
          role="menu"
          style={{ position: "fixed", top: pos.top, right: pos.right }}
          onMouseDown={(e) => e.stopPropagation()}
          className="z-[70] w-56 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-1.5 shadow-[var(--shadow-pop)]"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                setPos(null);
                item.onClick();
              }}
              className={`flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                item.danger
                  ? "text-[var(--bad-text)] hover:bg-[var(--bad-bg)]"
                  : "text-[var(--text-main)] hover:bg-[var(--bg-card-hover)]"
              }`}
            >
              <i className={`${item.icon} text-lg`} /> {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** One teammate as a table row: person, role, extra access, capacity, status,
 * and a "⋯" menu for the rarely-used and destructive actions. The fields save
 * on change exactly as before — only the layout is different. */
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

  const editable = user.is_active && canAdminister;

  const menuItems: { label: string; icon: string; onClick: () => void; danger?: boolean; disabled?: boolean; title?: string }[] = [];
  if (canEditDetails) menuItems.push({ label: "Edit details", icon: "ri-edit-line", onClick: onEditDetails, disabled: pending });
  if (user.is_active && canResetPassword) {
    menuItems.push({
      label: "Reset password",
      icon: "ri-key-2-line",
      onClick: () => setResetting(true),
      title: "Set a new password for this teammate",
    });
  }
  if (canAdminister) {
    if (user.is_active) {
      menuItems.push({
        label: "Deactivate account",
        icon: "ri-forbid-2-line",
        onClick: onDeactivate,
        danger: true,
        disabled: pending || isSelf,
        title: isSelf ? "You cannot deactivate your own account." : "Switch this account off — they can no longer log in.",
      });
    } else {
      menuItems.push({ label: "Reactivate account", icon: "ri-refresh-line", onClick: onReactivate, disabled: pending });
    }
  }

  return (
    <>
      <tr data-row-index={index} className={user.is_active ? "" : "opacity-70"}>
        <td>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Avatar name={user.name} size={36} />
              {user.is_active && (
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--bg-card)] ${
                    user.available ? "bg-[var(--ok-text)]" : "bg-[var(--text-dim)]"
                  }`}
                  title={user.available ? "Taking new work" : "Not taking new work"}
                />
              )}
            </div>
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-bold text-[var(--text-main)]">
                {user.name}
                {isSelf && (
                  <span className="rounded bg-[var(--bg-pill)] px-1.5 py-0.5 text-xs font-bold text-[var(--text-muted)]">
                    You
                  </span>
                )}
              </p>
              <p className="text-[13px] text-[var(--text-muted)]">
                {user.email}
                {user.role_title && <> · <span className="font-semibold">{user.role_title}</span></>}
              </p>
            </div>
          </div>
        </td>

        {/* Role: a dropdown for an account this admin may change, otherwise
            the role stated as a chip — a deactivated account has nothing to
            edit, and one this admin may not administer would only collect
            403s. */}
        <td>
          {editable ? (
            <div className="w-40" title="Change what this account can do across the workspace.">
              <Select
                value={user.role}
                disabled={pending || isLastActiveOwner}
                aria-label={`Role for ${user.name}`}
                onChange={(e) => onChangeRole(e.target.value as Role)}
                className="!h-9 !text-sm"
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
          ) : (
            <Badge>
              <i className={`${meta.icon} text-[var(--primary)]`} /> {ROLE_META[user.role].label}
            </Badge>
          )}
        </td>

        {/* Lending the TL role. Its own control rather than a second entry in
            the role dropdown, because it is a different question: not "what is
            this person" but "what else may they run". A TL reaches only the
            pods they are given, so this is additive and revocable — see
            docs/04. */}
        <td>
          {editable ? (
            <div className="w-40" title="Also give them Team Lead powers, on the pods they are given.">
              <Select
                value={user.secondary_role ?? ""}
                disabled={pending || user.role === "tl" || user.role === "owner"}
                aria-label={`Extra access for ${user.name}`}
                onChange={(e) => onChangeSecondary((e.target.value || null) as Role | null)}
                className="!h-9 !text-sm"
              >
                <option value="">No extra access</option>
                <option value="tl">Also TL</option>
              </Select>
            </div>
          ) : (
            <span className="text-[var(--text-dim)]">{user.secondary_role ? "Also TL" : "—"}</span>
          )}
        </td>

        <td>
          {editable ? (
            <div className="flex flex-col gap-1.5">
              <div
                className="flex items-center gap-1.5"
                title="How many videos this teammate can hold at once. A slot frees up when one is delivered; assignment past the limit is refused."
              >
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
                  className="num h-9 w-16 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-center text-sm font-bold text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                  aria-label={`Videos ${user.name} can hold at a time`}
                />
                <span className="text-xs text-[var(--text-dim)]">at a time</span>
                {capacityChanged && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={commitCapacity}
                    className="text-lg text-[var(--primary)] hover:text-[var(--primary-hover)]"
                    aria-label="Save the limit"
                  >
                    <i className="ri-check-line" />
                  </button>
                )}
              </div>

              {/* Only on QC accounts. Employment type sits on every row in the
                  database because the admin screen edits one row at a time, but
                  it decides exactly one thing — a reviewer's daily QC2 points
                  budget — and offering it on an editor would imply it changes
                  something for them. */}
              {user.role === "qc" && (
                <div
                  className="flex items-center gap-1.5"
                  title="A QC reviewer's day has 24 full-time or 12 part-time points. Video type prices are set by the owner."
                >
                  <Select
                    value={user.employment_type}
                    disabled={pending}
                    aria-label={`Working day for ${user.name}`}
                    onChange={(e) => onChangeEmployment(e.target.value as EmploymentType)}
                    className="!h-9 !w-32 !text-sm"
                  >
                    <option value="full_time">Full-time</option>
                    <option value="part_time">Part-time</option>
                  </Select>
                  {/* Read-only, and derived — the budget is computed from the
                      type on the server (`routing.CAPACITY`), never stored per
                      account. */}
                  <span className="num text-xs font-bold text-[var(--text-dim)]">
                    {QC2_DAILY_POINTS[user.employment_type]} pts/day
                  </span>
                </div>
              )}
            </div>
          ) : (
            <span className="num text-[var(--text-muted)]">{user.max_concurrent_jobs}</span>
          )}
        </td>

        <td>
          {user.is_active ? (
            <Badge className="bg-[var(--ok-bg)] text-[var(--ok-text)]">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" /> Active
            </Badge>
          ) : (
            <Badge className="bg-[var(--bad-bg)] text-[var(--bad-text)]">
              <i className="ri-forbid-2-line" /> Deactivated
            </Badge>
          )}
        </td>

        <td>
          <RowMenu label={`Actions for ${user.name}`} items={menuItems} />
          {resetting && (
            <Modal
              open
              title={`Reset password for ${user.name}`}
              onClose={() => {
                setResetting(false);
                setNewPassword("");
              }}
            >
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  onResetPassword(newPassword, () => {
                    setResetting(false);
                    setNewPassword("");
                  });
                }}
              >
                <Field label="New password" htmlFor={`reset-${user.id}`} help="At least 8 characters. Share it with them out of band.">
                  <Input
                    id={`reset-${user.id}`}
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={8}
                    autoComplete="new-password"
                    autoFocus
                    required
                  />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setResetting(false);
                      setNewPassword("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isResetPending}>
                    <i className="ri-key-2-line" /> Set password
                  </Button>
                </div>
              </form>
            </Modal>
          )}
        </td>
      </tr>

      {((isLastActiveOwner && canAdminister && user.is_active) || notice?.error != null || notice?.message) && (
        <tr>
          <td colSpan={6} className="!border-t-0 !py-2">
            {isLastActiveOwner && canAdminister && user.is_active && (
              <p className="flex items-center gap-1.5 text-[13px] text-[var(--text-dim)]">
                <i className="ri-lock-line" /> The last active Owner can't be demoted — promote someone else first.
              </p>
            )}
            {notice?.error != null && (
              <ErrorNote error={notice.error} fallback="That change was rejected." className="mt-1" />
            )}
            {notice?.message && !notice.error && <SuccessNote message={notice.message} className="mt-1" />}
          </td>
        </tr>
      )}
    </>
  );
}
