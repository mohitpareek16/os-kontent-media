import type {
  CapacityJob,
  EditorCapacity,
  EmploymentType,
  RoleTitle,
  Page,
  QcLoad,
  Role,
  OpenWork,
  User,
  UserCapacity,
  UserDirectoryStats,
  VELoad,
} from "@/types";

import { adminApiClient, apiClient } from "./client";

export interface FetchUsersParams {
  search?: string;
  role?: Role;
  status?: "all" | "active" | "inactive";
  /** Deactivated teammates are included by default so the admin directory
   * can show them; pickers that hand out work should pass false. */
  include_inactive?: boolean;
  sort_by?: "name" | "email" | "role" | "max_concurrent_jobs" | "created_at";
  sort_dir?: "asc" | "desc";
  page?: number;
  page_size?: number;
}

export interface FetchUsersOptions {
  /** Send as the real signed-in Owner rather than as whoever they are
   * currently simulating — the "viewing as" picker needs the directory, and
   * the directory is owner/TL/HR-only, so mid-impersonation it would 403. */
  asAdmin?: boolean;
}

export async function fetchUsers(params: FetchUsersParams = {}, options: FetchUsersOptions = {}) {
  const client = options.asAdmin ? adminApiClient : apiClient;
  const { data } = await client.get<Page<User>>("/users", { params });
  return data;
}

/** Whole-roster totals for the tiles above the directory — deliberately not
 * derived from a page, so they don't shift as you type in the search box. */
export async function fetchUserStats() {
  const { data } = await apiClient.get<UserDirectoryStats>("/users/stats");
  return data;
}

export interface UpdateUserPayload {
  name?: string;
  email?: string;
  phone?: string | null;
  role?: Role;
  role_title?: string;
  role_title_id?: string;
  secondary_role?: Role;
  /** Sent explicitly to take a lent role back, since an omitted field means
   * "leave it alone". */
  clear_secondary_role?: boolean;
  max_concurrent_jobs?: number;
  /** Full day or half day. Only a QC reviewer's routing reads it — it decides
   * their daily QC2 points budget (24 or 12), which is derived and never
   * stored per account. */
  employment_type?: EmploymentType;
  available?: boolean;
  is_active?: boolean;
}

/** Owner account admin; HR may edit name and email only through this route. */
export async function updateUser(userId: string, payload: UpdateUserPayload) {
  const { data } = await apiClient.patch<User>(`/users/${userId}`, payload);
  return data;
}

/** Offboard somebody — Owner or HR, for the roles that caller may onboard
 * (`require_can_switch_off` on the server).
 *
 * Its own endpoint rather than a field on `updateUser`: that one also changes
 * roles and lends the TL secondary, and HR holds this power and not those. */
export async function deactivateUser(userId: string, reason?: string) {
  const { data } = await apiClient.post<User>(`/users/${userId}/deactivate`, {
    reason: reason?.trim() || null,
  });
  return data;
}

export async function reactivateUser(userId: string, reason?: string) {
  const { data } = await apiClient.post<User>(`/users/${userId}/reactivate`, {
    reason: reason?.trim() || null,
  });
  return data;
}

/** What is still on their plate. Read by the confirm dialog, because
 * deactivating somebody does not reassign a single thing they hold. */
export async function fetchOpenWork(userId: string) {
  const { data } = await apiClient.get<OpenWork>(`/users/${userId}/open-work`);
  return data;
}

/** Self-service routing toggle (owner/tl/qc — see docs/04-permissions.md). */
export async function setOwnAvailability(available: boolean) {
  const { data } = await apiClient.patch<User>("/users/me/availability", { available });
  return data;
}

export async function fetchMe() {
  const { data } = await apiClient.get<User>("/users/me");
  return data;
}

export async function fetchCapacity() {
  const { data } = await apiClient.get<UserCapacity[]>("/users/capacity");
  return data;
}

export async function fetchCapacityOpenJobs() {
  const { data } = await apiClient.get<CapacityJob[]>("/users/capacity/open-jobs");
  return data;
}

export async function fetchVELoad() {
  const { data } = await apiClient.get<VELoad[]>("/users/ve-load");
  return data;
}

export async function fetchEditorCapacity() {
  const { data } = await apiClient.get<EditorCapacity[]>("/users/editor-capacity");
  return data;
}

export async function fetchQcLoad() {
  const { data } = await apiClient.get<QcLoad[]>("/users/qc-load");
  return data;
}

/** A reviewer's own load against the routing cap. The team-wide list above
 * is owner/TL-only — this is the one row a QC may read about themselves. */
export async function fetchOwnQcLoad() {
  const { data } = await apiClient.get<QcLoad>("/users/me/qc-load");
  return data;
}

export interface CreateUserPayload {
  name: string;
  email: string;
  password: string;
  role: string;
  phone?: string;
  /** A custom job title, on a `staff` account. Send `role_title` to
   * create-or-reuse one by name, or `role_title_id` to pick an existing one;
   * the server refuses either alongside a built-in role. */
  role_title?: string;
  role_title_id?: string;
  /** Powers lent on top of `role` — only `"tl"` is legal. */
  secondary_role?: Role;
  /** Asked at onboarding for QC accounts, where it decides the day's points
   * budget from the first job routed to them. */
  employment_type?: EmploymentType;
}

export async function createUser(payload: CreateUserPayload) {
  const { data } = await apiClient.post<User>("/users", payload);
  return data;
}

/** The job titles the roster already knows, for the onboarding dropdown —
 * so the tenth designer is filed under the same word as the first. */
export async function fetchRoleTitles() {
  const { data } = await apiClient.get<RoleTitle[]>("/users/role-titles");
  return data;
}

export async function resetPassword(userId: string, newPassword: string) {
  await apiClient.post(`/users/${userId}/reset-password`, { new_password: newPassword });
}
