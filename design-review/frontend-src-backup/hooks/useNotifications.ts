import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type FetchNotificationsParams,
} from "@/api/notifications";

/** One page of the inbox. Filtering and paging are the server's — the page
 * also carries the whole inbox's unread count, so the bell doesn't need the
 * rows at all.
 *
 * `refetchInterval` is a parameter rather than a constant because one caller
 * genuinely needs a different one: the toast watcher is the only surface
 * where the delay *is* the feature, so it polls faster than the 30s
 * everything else settles for. */
export function useNotifications(
  params: FetchNotificationsParams = {},
  { refetchInterval = 30_000 }: { refetchInterval?: number } = {},
) {
  return useQuery({
    queryKey: ["notifications", params],
    queryFn: () => fetchNotifications(params),
    placeholderData: keepPreviousData,
    refetchInterval,
  });
}

/** The params the toast watcher polls with. The bell reads the same query
 * rather than one of its own: the count rides along with any page of the
 * inbox, so two subscriptions to the same key is one request that both of
 * them share — and the badge then ticks over at the same moment the toast
 * pops, instead of up to half a minute later. */
export const UNREAD_WATCH_PARAMS: FetchNotificationsParams = {
  unread_only: true,
  page_size: 20,
};

/** Just the badge number, counted over the whole inbox by the server. */
export function useUnreadCount() {
  const { data } = useNotifications(UNREAD_WATCH_PARAMS);
  return data?.unread ?? 0;
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

/** Clears the whole inbox in one request, including anything past the page
 * currently on screen. */
export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
