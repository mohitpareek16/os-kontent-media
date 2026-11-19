import type { Role, User } from "@/types";

/** Account roles, in the order every roster surface lists them — seniority,
 * then the people who do the work, then people-ops, then everyone the
 * pipeline has no word for. Shared so the admin directory and the HR roster
 * can't disagree about what a role is called or which colour it wears.
 *
 * `staff` is last and is never *picked* by name: the onboarding form offers
 * job titles instead and turns the chosen one into `staff` + a `role_title`
 * underneath. It is in this list because the roster still has to count and
 * filter those accounts. */
export const ROLE_OPTIONS: Role[] = ["owner", "fo", "tl", "qc", "ve", "hr", "staff"];

/** Anything that carries a role. Every predicate below takes one of these
 * rather than a bare `Role`, because a bare role cannot answer the question:
 * an editor with a lent TL is `role: "ve"`, and asking about the string alone
 * would say they lead nothing. */
export type RoleHolder = Pick<User, "role"> & { secondary_role?: Role | null };

/** Every role this person holds — their own, plus one lent to them.
 * `effective_roles()` on the server, which is the enforcement. */
export function effectiveRoles(who: RoleHolder | null | undefined): Role[] {
  if (!who) return [];
  return who.secondary_role ? [who.role, who.secondary_role] : [who.role];
}

export function hasRole(who: RoleHolder | null | undefined, ...roles: Role[]): boolean {
  const held = effectiveRoles(who);
  return roles.some((role) => held.includes(role));
}

/** The admin tier: the Owner, and only the Owner. Accounts, roles, password
 * resets, impersonation, the voice-note library.
 *
 * The Founder's Office used to be here. It reaches the work the way everyone
 * else does now — as a TL of the pods it was given. */
export function isAdmin(who: RoleHolder | null | undefined): boolean {
  return hasRole(who, "owner");
}

/** Company-wide reach over the work, with no pod membership required. The
 * Owner alone; HR and the Founder's Office both lost it in the role rework.
 * Kept as its own name because the *question* is different from `isAdmin` —
 * this one is about seeing every pod, that one about administering accounts —
 * even though today they have the same answer. */
export function leadsAllPods(who: RoleHolder | null | undefined): boolean {
  return isAdmin(who);
}

/** Everyone who leads work at all: the Owner, plus anyone holding TL, whether
 * it is their own role or lent. The per-pod narrowing is still `Pod.tl_id`,
 * checked by the server on every route. */
export function isLead(who: RoleHolder | null | undefined): boolean {
  return hasRole(who, "owner", "tl");
}

/** The roles that reach a lead surface, as a list — for `<RequireRole>`,
 * which matches against a person's effective roles. Kept next to the
 * predicate so a role added to one is not missed by the other. */
export const LEAD_ROLES: Role[] = ["owner", "tl"];

/** Roles each account-creating role may hand out, on the onboard form and on
 * a role change. Mirrors `CREATABLE_ROLES` in the backend schema, which
 * enforces it — this only keeps the dropdown from offering a certain 403.
 * An empty list means "this role creates nobody".
 *
 * `staff` rides along wherever it appears: it is what a custom job title is
 * underneath, and refusing HR the ability to onboard a designer would defeat
 * the point of having titles at all. */
const CREATABLE_ROLES: Partial<Record<Role, Role[]>> = {
  owner: ROLE_OPTIONS,
  hr: ["tl", "qc", "ve", "staff"],
};

export function creatableRoles(actor: RoleHolder | null | undefined): Role[] {
  return (actor && CREATABLE_ROLES[actor.role]) || [];
}

/** Whether `actor` may switch `target`'s account off — or back on.
 *
 * **You may switch off only the kinds of account you may create.** One rule,
 * one table, mirroring `require_can_switch_off` on the server, which is what
 * actually enforces it. So HR offboards the TL/QC/VE/staff it onboards and
 * cannot touch an Owner, the Founder's Office or another HR; an Owner may do
 * anyone, subject to the last-active-Owner guard the server keeps.
 *
 * Never yourself. Checked here as well as on the server because a button
 * offering to lock you out of your own session is a mistake worth not being
 * able to make. */
export function canSwitchOff(
  actor: RoleHolder | null | undefined,
  target: (RoleHolder & { id?: string }) | null | undefined,
): boolean {
  if (!actor || !target) return false;
  if ("id" in actor && (actor as { id?: string }).id === target.id) return false;
  return creatableRoles(actor).includes(target.role);
}

/** Whether `actor` may change `target`'s account at all — rename, role,
 * password. The Owner, and nobody else: with no email recovery
 * in this product a password reset is a session as that account, and a role
 * change hands out whatever the new role carries. Same rule as
 * `require_can_administer` on the server. */
export function canAdminister(actor: RoleHolder | null | undefined): boolean {
  return isAdmin(actor);
}

/** What to call this person on screen. Their job title if they have one, the
 * role's name otherwise — so a Graphic Designer reads as a Graphic Designer
 * and not as "Staff", which is a database value and not a word about anyone.
 *
 * A lent role is appended rather than replacing anything: "Video Editor · also
 * TL" is two true facts, and the second is the one that explains why they can
 * see a pod nobody expected them to. */
export function roleLabel(who: (RoleHolder & { role_title?: string | null }) | null | undefined): string {
  if (!who) return "";
  const base = who.role_title || ROLE_META[who.role].label;
  return who.secondary_role ? `${base} · also ${ROLE_META[who.secondary_role].label}` : base;
}

export interface RoleMeta {
  label: string;
  /** One line on what the role is accountable for — the tiles are read by
   * people who don't live in the pipeline, so "VE" alone means nothing. */
  blurb: string;
  icon: string;
  badge: string;
  ring: string;
  dot: string;
}

export const ROLE_META: Record<Role, RoleMeta> = {
  owner: {
    label: "Owner",
    blurb: "Runs the workspace",
    icon: "ri-vip-crown-2-fill",
    badge: "bg-[var(--primary-glow-subtle)] text-[var(--primary-light)]",
    ring: "from-[var(--primary)] to-fuchsia-600",
    dot: "bg-[var(--primary)]",
  },
  tl: {
    label: "Team Lead",
    blurb: "Owns pods and delivery",
    icon: "ri-user-star-fill",
    badge: "bg-indigo-500/10 text-indigo-400",
    ring: "from-indigo-500 to-indigo-700",
    dot: "bg-indigo-500",
  },
  qc: {
    label: "QC Reviewer",
    blurb: "Reviews before delivery",
    icon: "ri-shield-check-fill",
    badge: "bg-amber-500/10 text-amber-500",
    ring: "from-amber-500 to-amber-700",
    dot: "bg-amber-500",
  },
  ve: {
    label: "Video Editor",
    blurb: "Cuts the work",
    icon: "ri-movie-2-fill",
    badge: "bg-teal-500/10 text-teal-500",
    ring: "from-teal-500 to-teal-700",
    dot: "bg-teal-500",
  },
  hr: {
    label: "HR",
    blurb: "Onboards the team and keeps the roster",
    icon: "ri-shake-hands-fill",
    badge: "bg-rose-500/10 text-rose-400",
    ring: "from-rose-500 to-rose-700",
    dot: "bg-rose-500",
  },
  fo: {
    label: "Founder's Office",
    blurb: "Runs the pods it is given",
    icon: "ri-compass-3-fill",
    badge: "bg-sky-500/10 text-sky-400",
    ring: "from-sky-500 to-blue-700",
    dot: "bg-sky-500",
  },
  staff: {
    label: "Team member",
    blurb: "A job title, and no system access",
    icon: "ri-user-3-fill",
    badge: "bg-slate-500/10 text-slate-400",
    ring: "from-slate-500 to-slate-700",
    dot: "bg-slate-500",
  },
};

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Whether `actor` may set a new password for `target`. The Owner may reset
 * anyone; HR only the kinds of account it may create (and not its own).
 * Mirrors the check in `POST /users/{id}/reset-password`, which enforces it. */
export function canResetPassword(
  actor: RoleHolder | null | undefined,
  target: (RoleHolder & { id?: string }) | null | undefined,
): boolean {
  if (!actor || !target) return false;
  if (isAdmin(actor)) return true;
  return canSwitchOff(actor, target);
}
