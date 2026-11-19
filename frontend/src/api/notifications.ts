import type { Notification, Page } from "@/types";

import { apiClient } from "./client";

export interface FetchNotificationsParams {
  unread_only?: boolean;
  event_type?: string;
  search?: string;
  page?: number;
  page_size?: number;
}

/** `unread` counts the whole inbox, not this page — the bell reads it. It
 * used to be derived from whatever the first fifty rows happened to hold, so
 * a busy inbox under-reported and the count capped out at 50. */
export interface PaginatedNotifications extends Page<Notification> {
  unread: number;
}

export async function fetchNotifications(params: FetchNotificationsParams = {}) {
  const { data } = await apiClient.get<PaginatedNotifications>("/notifications", { params });
  return data;
}

export async function markNotificationRead(id: string) {
  await apiClient.post(`/notifications/${id}/read`);
}

/** One request for the whole inbox. "Mark all read" used to fire a POST per
 * loaded row, which both hammered the API and left everything past the first
 * page unread. */
export async function markAllNotificationsRead() {
  await apiClient.post("/notifications/read-all");
}


/* ---------------------------------------------------------------------------
   Desktop push
   ------------------------------------------------------------------------ */

/** What `PushManager.subscribe()` gives us, flattened the way the server
 * takes it. */
export interface PushSubscriptionPayload {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string;
}

export interface PushKey {
  /** The application server's VAPID public key. Public by definition. */
  public_key: string;
  /** False when this deployment has no keys yet — the UI then says so rather
   * than raising a browser permission prompt it cannot use. */
  enabled: boolean;
}

export async function fetchPushKey() {
  const { data } = await apiClient.get<PushKey>("/notifications/push/key");
  return data;
}

export async function subscribeToPush(payload: PushSubscriptionPayload) {
  await apiClient.post("/notifications/push/subscribe", payload);
}

export async function unsubscribeFromPush(payload: PushSubscriptionPayload) {
  await apiClient.post("/notifications/push/unsubscribe", payload);
}

export interface PushTestResult {
  /** How many of this person's browsers it went to. Zero is the useful
   * answer when nothing is heard — the subscription never registered. */
  sent_to: number;
  delay_seconds: number;
}

/** Fire a test alert at the caller's own browsers, after a delay — so the
 * window can be minimised first, which is the only state worth testing. */
export async function sendTestPush(delaySeconds = 5) {
  const { data } = await apiClient.post<PushTestResult>(
    `/notifications/push/test?delay_seconds=${delaySeconds}`,
  );
  return data;
}
