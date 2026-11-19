import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createUser,
  deactivateUser,
  fetchCapacity,
  fetchCapacityOpenJobs,
  fetchEditorCapacity,
  fetchOpenWork,
  fetchOwnQcLoad,
  fetchQcLoad,
  fetchRoleTitles,
  fetchUserStats,
  fetchUsers,
  fetchVELoad,
  reactivateUser,
  resetPassword,
  setOwnAvailability,
  updateUser,
  type CreateUserPayload,
  type FetchUsersParams,
  type UpdateUserPayload,
} from "@/api/users";

/** How many accounts a *picker* will offer. Pickers are dropdowns over the
 * roster — an agency roster, not a mailing list — so one page covers them.
 * The directory screen pages properly; this is the one place a bounded
 * "give me everyone" is the honest request. */
const PICKER_PAGE_SIZE = 200;

/** `GET /users` is owner/TL/HR-only (docs/04), so callers that render for
 * every role must gate this — a QC or VE mounting it just collects a 403.
 *
 * `includeInactive: false` asks the server to leave out deactivated
 * teammates, for pickers that hand out work; the admin directory wants them
 * (greyed out), so that's the default. It's part of the query key — the two
 * results are different lists, not the same list filtered.
 *
 * Returns a plain array: every caller here is a picker that wants the whole
 * (bounded) roster. The paged directory is `useUserDirectory` below. */
export function useUsers(options: { enabled?: boolean; includeInactive?: boolean } = {}) {
  const includeInactive = options.includeInactive ?? true;
  return useQuery({
    queryKey: ["users", { includeInactive }],
    queryFn: () =>
      fetchUsers({ include_inactive: includeInactive, page_size: PICKER_PAGE_SIZE }).then(
        (page) => page.items,
      ),
    enabled: options.enabled ?? true,
  });
}

/** The account directory: one filtered, sorted page and the count behind it.
 * Distinct from `useUsers` because it is a different question — "the rows for
 * these filters", not "everyone I could pick". */
export function useUserDirectory(params: FetchUsersParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["users", "directory", params],
    queryFn: () => fetchUsers(params),
    // Without this the table blanks out on every keystroke and page turn.
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

/** Whole-roster totals for the tiles above the directory. */
export function useUserStats(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["users", "stats"],
    queryFn: fetchUserStats,
    enabled: options.enabled ?? true,
  });
}

/** Accounts the "viewing as" picker can switch to.
 *
 * Fetched as the real Owner, so it keeps working while they are already
 * simulating someone — under the session token this call is made by, say, a
 * VE, and the directory is owner/TL-only, so the picker used to go empty the
 * moment you used it. Deactivated accounts are left out: you cannot hold a
 * session as one. */
export function useImpersonationTargets(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["users", "impersonation-targets"],
    queryFn: () =>
      fetchUsers({ status: "active", page_size: PICKER_PAGE_SIZE }, { asAdmin: true }).then(
        (page) => page.items,
      ),
    enabled: options.enabled ?? true,
  });
}

export function useCapacity() {
  return useQuery({ queryKey: ["capacity"], queryFn: fetchCapacity });
}

export function useCapacityOpenJobs() {
  return useQuery({ queryKey: ["jobs", "capacity-open"], queryFn: fetchCapacityOpenJobs, refetchInterval: 30_000 });
}

export function useVELoad() {
  return useQuery({ queryKey: ["ve-load"], queryFn: fetchVELoad });
}

/** Lead-only, like every capacity read (docs/04) — `enabled` is for callers
 * that only need it once a picker is opened, rather than on every render of
 * the panel they live in. */
export function useEditorCapacity(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["editor-capacity"],
    queryFn: fetchEditorCapacity,
    enabled: options.enabled ?? true,
    refetchInterval: 30_000,
  });
}

export function useQcLoad() {
  return useQuery({ queryKey: ["qc-load"], queryFn: fetchQcLoad, refetchInterval: 30_000 });
}

/** The caller's own QC load — the one row a reviewer may read about
 * themselves, since the team-wide list is owner/TL-only. */
export function useOwnQcLoad(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["qc-load", "me"],
    queryFn: fetchOwnQcLoad,
    enabled: options.enabled ?? true,
  });
}

/** Titles somebody already chose. Only whoever may onboard can read them, so
 * the query is off by default and switched on by the form that needs it. */
export function useRoleTitles(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["role-titles"],
    queryFn: fetchRoleTitles,
    enabled: options.enabled ?? true,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateUserPayload) => createUser(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      // A new title may have been coined on the way past.
      queryClient.invalidateQueries({ queryKey: ["role-titles"] });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, payload }: { userId: string; payload: UpdateUserPayload }) =>
      updateUser(userId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["qc-load"] });
      queryClient.invalidateQueries({ queryKey: ["editor-capacity"] });
      // A phone edit changes who WhatsApp can reach.
      queryClient.invalidateQueries({ queryKey: ["whatsapp", "numbers"] });
    },
  });
}

/** Toggling your own routing availability updates both "me" and any QC load
 * view that shows it. */
export function useSetOwnAvailability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (available: boolean) => setOwnAvailability(available),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["qc-load"] });
    },
  });
}

/** Switching an account off (or back on). Invalidates the same queries the
 * admin update does — the roster, and the two load views that only count
 * active people. */
export function useSetAccountActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      active,
      reason,
    }: {
      userId: string;
      active: boolean;
      reason?: string;
    }) => (active ? reactivateUser(userId, reason) : deactivateUser(userId, reason)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["user-stats"] });
      queryClient.invalidateQueries({ queryKey: ["qc-load"] });
      queryClient.invalidateQueries({ queryKey: ["editor-capacity"] });
    },
  });
}

/** What the person still holds. Only fetched once the confirm dialog is
 * actually open — it is a question about one row, asked at the moment it
 * matters, not a column on the directory. */
export function useOpenWork(userId: string | null) {
  return useQuery({
    queryKey: ["open-work", userId],
    queryFn: () => fetchOpenWork(userId!),
    enabled: Boolean(userId),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ userId, newPassword }: { userId: string; newPassword: string }) =>
      resetPassword(userId, newPassword),
  });
}
