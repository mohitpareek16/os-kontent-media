import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  addPodMember,
  createChannel,
  createPod,
  fetchAllChannels,
  fetchPodChannels,
  fetchPodMembers,
  fetchPods,
  removePodMember,
  updateChannel,
  updatePod,
  type CreatePodPayload,
  type FetchPodsParams,
  type UpdateChannelPayload,
  type UpdatePodPayload,
} from "@/api/pods";

/** A client roster, not a feed — one page covers every picker and switcher. */
const PICKER_PAGE_SIZE = 200;

/** Every pod this person can see, as a plain array — for the sidebar
 * switcher and the pod pickers. The paged, filtered list is `usePodList`. */
export function usePods() {
  return useQuery({
    queryKey: ["pods"],
    queryFn: () => fetchPods({ page_size: PICKER_PAGE_SIZE }).then((page) => page.items),
  });
}

/** One filtered page of pods, plus the status-tab counts behind it. */
export function usePodList(params: FetchPodsParams) {
  return useQuery({
    queryKey: ["pods", "list", params],
    queryFn: () => fetchPods(params),
    placeholderData: keepPreviousData,
  });
}

export function usePodMembers(podId: string | null) {
  return useQuery({
    queryKey: ["pods", podId, "members"],
    queryFn: () => fetchPodMembers(podId as string),
    enabled: Boolean(podId),
  });
}

export function useCreatePod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreatePodPayload) => createPod(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pods"] }),
  });
}

export function useUpdatePod(podId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdatePodPayload) => updatePod(podId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pods"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export function useAddPodMember(podId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, podRole }: { userId: string; podRole: string }) =>
      addPodMember(podId, userId, podRole),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pods", podId, "members"] }),
  });
}

export function useRemovePodMember(podId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => removePodMember(podId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pods", podId, "members"] }),
  });
}

/** A client's channels — Dhan HQ, AAD, lwdhan. Readable by any pod member, so
 * an editor's board filter and a TL's picker are the same query. Archived ones
 * are left out: they still name old work but have no business in a dropdown. */
export function usePodChannels(podId: string | null | undefined) {
  return useQuery({
    queryKey: ["pods", podId, "channels"],
    queryFn: () => fetchPodChannels(podId as string),
    enabled: Boolean(podId),
  });
}

/** Every channel across every client this person can see, each carrying its
 * `pod_name`. The pipeline table's resting state is *All Clients*, and a
 * channel filter that only exists once you pick one client is missing from the
 * exact view a lead spends their day in. */
export function useAllChannels(enabled = true) {
  return useQuery({
    queryKey: ["pods", "channels", "all"],
    queryFn: fetchAllChannels,
    enabled,
  });
}

/** Both channel lists, after one of them changes: the client's own and the
 * cross-client one the pipeline filter runs on. Missing the second is how a
 * channel created from the wizard is instantly pickable per row and still
 * absent from the filter on the table behind it. */
function invalidateChannels(queryClient: ReturnType<typeof useQueryClient>, podId: string) {
  queryClient.invalidateQueries({ queryKey: ["pods", podId, "channels"] });
  queryClient.invalidateQueries({ queryKey: ["pods", "channels", "all"] });
  // Jobs too: a channel arriving mid-session has to reach the chips and the
  // filter on the board behind the dialog, not only the picker in front.
  queryClient.invalidateQueries({ queryKey: ["jobs"] });
}

export function useCreateChannel(podId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createChannel(podId, name),
    onSuccess: () => invalidateChannels(queryClient, podId),
  });
}

export function useUpdateChannel(podId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, ...payload }: UpdateChannelPayload & { channelId: string }) =>
      updateChannel(podId, channelId, payload),
    onSuccess: () => invalidateChannels(queryClient, podId),
  });
}
