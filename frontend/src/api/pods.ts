import type { Channel, Page, Pod, PodMember, PodStatus, PodStatusCounts } from "@/types";

import { apiClient } from "./client";

export interface FetchPodsParams {
  search?: string;
  status?: PodStatus | "all";
  sort_by?: "name" | "status" | "created_at";
  sort_dir?: "asc" | "desc";
  page?: number;
  page_size?: number;
}

/** `counts` ignores the status filter on purpose: a tab reading 0 for every
 * status except the selected one tells you nothing about where to go next. */
export interface PaginatedPods extends Page<Pod> {
  counts: PodStatusCounts;
}

export async function fetchPods(params: FetchPodsParams = {}) {
  const { data } = await apiClient.get<PaginatedPods>("/pods", { params });
  return data;
}

export async function fetchPodMembers(podId: string) {
  const { data } = await apiClient.get<PodMember[]>(`/pods/${podId}/members`);
  return data;
}

export interface CreatePodPayload {
  name: string;
  tl_id: string;
  status?: PodStatus;
  billing_currency?: string;
  retainer_volume?: number | null;
}

export async function createPod(payload: CreatePodPayload) {
  const { data } = await apiClient.post<Pod>("/pods", payload);
  return data;
}

export interface UpdatePodPayload {
  name?: string;
  status?: PodStatus;
  billing_currency?: string;
  retainer_volume?: number | null;
  /** Owner-only — handing the pod to a different TL. */
  tl_id?: string;
}

export async function updatePod(podId: string, payload: UpdatePodPayload) {
  const { data } = await apiClient.patch<Pod>(`/pods/${podId}`, payload);
  return data;
}

export async function addPodMember(podId: string, userId: string, podRole: string) {
  await apiClient.post(`/pods/${podId}/members`, { user_id: userId, pod_role: podRole });
}

export async function removePodMember(podId: string, userId: string) {
  await apiClient.delete(`/pods/${podId}/members/${userId}`);
}

/** A client's channels. Readable by any pod member — an editor sees the
 * channel on their own job and filters their board by it — but only the TL
 * and the Owner may add or rename one. */
export async function fetchPodChannels(podId: string, includeArchived = false) {
  const { data } = await apiClient.get<Channel[]>(`/pods/${podId}/channels`, {
    params: includeArchived ? { include_archived: true } : undefined,
  });
  return data;
}

/** Every channel this person can see, across all their clients, each carrying
 * its `pod_name`. What the pipeline table's channel filter runs on when the
 * client selector is on *All Clients* — the per-pod list has nothing to answer
 * there, so the filter used to disappear on the one screen that needed it. */
export async function fetchAllChannels() {
  const { data } = await apiClient.get<Channel[]>("/pods/channels");
  return data;
}

export async function createChannel(podId: string, name: string) {
  const { data } = await apiClient.post<Channel>(`/pods/${podId}/channels`, { name });
  return data;
}

export interface UpdateChannelPayload {
  name?: string;
  /** Retire it, or bring it back. There is no delete — a channel that named
   * real work has to go on naming it. */
  archived?: boolean;
}

export async function updateChannel(
  podId: string,
  channelId: string,
  payload: UpdateChannelPayload,
) {
  const { data } = await apiClient.patch<Channel>(
    `/pods/${podId}/channels/${channelId}`,
    payload,
  );
  return data;
}
