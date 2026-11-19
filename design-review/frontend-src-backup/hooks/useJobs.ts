import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  addJobLink,
  addJobNote,
  advanceJob,
  bulkFileUnderChannel,
  bulkRetryQc2Assignment,
  claimQc2,
  clearQc1Flag,
  createJob,
  createJobsBatch,
  fetchJob,
  fetchJobEvents,
  fetchJobLinks,
  fetchJobs,
  fetchJobStats,
  fetchQc1Pass,
  fetchWorkspaceOverview,
  flagQc1,
  reassignJob,
  removeJobLink,
  restoreJob,
  scrapJob,
  updateChecklist,
  updateJob,
  type AdvanceJobPayload,
  type BulkChannelPayload,
  type ChecklistPayload,
  type CreateJobPayload,
  type CreateJobsBatchPayload,
  type FetchJobsParams,
  type FetchJobStatsParams,
  type JobLinkInput,
  type UpdateJobPayload,
} from "@/api/jobs";
import type { JobLinkKind } from "@/types";

/** `refetchInterval` is passed through because job lists otherwise never
 * update — a QC or editor sat looking at a stale queue until they reloaded.
 * Notifications already poll at 30s; work queues should match. */
interface JobQueryOptions {
  enabled?: boolean;
  refetchInterval?: number | false;
}

export function useJobs(params: FetchJobsParams = {}, options: JobQueryOptions = {}) {
  return useQuery({
    queryKey: ["jobs", params],
    queryFn: () => fetchJobs(params),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval,
  });
}

/** Load a board column ten jobs at a time, without the list endpoint's
 * page-size ceiling becoming a limit on how far the user can browse. */
export function useBoardJobs(params: FetchJobsParams, options: JobQueryOptions = {}) {
  const pageSize = 10;
  return useInfiniteQuery({
    queryKey: ["jobs", "board", params],
    queryFn: ({ pageParam }) => fetchJobs({ ...params, page: pageParam, page_size: pageSize }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) =>
      pages.length * pageSize < lastPage.total ? pages.length + 1 : undefined,
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval,
  });
}

export function useJobStats(params: FetchJobStatsParams = {}, options: JobQueryOptions = {}) {
  return useQuery({
    queryKey: ["jobs", "stats", params],
    queryFn: () => fetchJobStats(params),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval,
  });
}

/** The Overview screen's tiles and pod cards — one query, counted in SQL. */
export function useWorkspaceOverview(options: JobQueryOptions = {}) {
  return useQuery({
    queryKey: ["jobs", "overview"],
    queryFn: fetchWorkspaceOverview,
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval,
  });
}

export function useJob(jobId: string | null) {
  return useQuery({
    queryKey: ["jobs", "detail", jobId],
    queryFn: () => fetchJob(jobId as string),
    enabled: Boolean(jobId),
  });
}

export function useJobEvents(jobId: string | null) {
  return useQuery({
    queryKey: ["jobs", jobId, "events"],
    queryFn: () => fetchJobEvents(jobId as string),
    enabled: Boolean(jobId),
  });
}

/** How the latest QC1 review went. Keyed under the job like its events are,
 * so raising a flag or moving the stage refreshes it along with everything
 * else on the panel. */
export function useQc1Pass(jobId: string | null) {
  return useQuery({
    queryKey: ["jobs", jobId, "qc1-pass"],
    queryFn: () => fetchQc1Pass(jobId as string),
    enabled: Boolean(jobId),
  });
}

/** Raising and clearing the QC1 flag. Both change the job's row tint in every
 * list, land in the timeline and notify somebody, so the job cache and the
 * notifications both go. */
export function useFlagQc1(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => flagQc1(jobId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useClearQc1Flag(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason?: string) => clearQc1Flag(jobId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useCreateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateJobPayload) => createJob(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useCreateJobsBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateJobsBatchPayload) => createJobsBatch(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

/** Filing a whole selection under one channel — the backlog move. Invalidates
 * the pod channel lists too: their `job_count` is what a TL reads before
 * retiring a channel, and twenty jobs arriving under it changes that number. */
export function useBulkFileUnderChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: BulkChannelPayload) => bulkFileUnderChannel(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["pods"] });
    },
  });
}

export function useBulkRetryQc2Assignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: bulkRetryQc2Assignment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useAdvanceJob(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AdvanceJobPayload) => advanceJob(jobId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["jobs", jobId, "events"] });
    },
  });
}

export function useUpdateChecklist(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ChecklistPayload) => updateChecklist(jobId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useUpdateJob(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateJobPayload) => updateJob(jobId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

/** A QC taking an unrouted job. Invalidates the whole job cache because it
 * moves the job between two lists on the same screen. */
export function useClaimQc2(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => claimQc2(jobId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

/** Handing the job to a different editor. It leaves one person's Mine tab
 * and lands in another's, and both of them plus the TL get told — so the job
 * lists, the events and the notifications all go. */
export function useReassignJob(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ editorId, reason }: { editorId: string; reason: string }) =>
      reassignJob(jobId, editorId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

/** Scrapping and restoring both move the job between every status tab at
 * once — out of Active and Mine, into Scrapped, and back — so the whole job
 * cache goes, along with the notifications the scrap just sent. */
export function useScrapJob(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => scrapJob(jobId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useRestoreJob(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason?: string) => restoreJob(jobId, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useAddJobNote(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note: string) => addJobNote(jobId, note),
    onSuccess: () => {
      // The note is an event, and it may also have produced a notification.
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

/** Every link on a job — the raw material the TL put there and the cuts the
 * editor did. Its own query rather than a field on the job: the job row is
 * fetched by every list on every screen, and the links are read on one. */
export function useJobLinks(jobId: string | null) {
  return useQuery({
    queryKey: ["jobs", jobId, "links"],
    queryFn: () => fetchJobLinks(jobId as string),
    enabled: Boolean(jobId),
  });
}

export function useAddJobLink(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: JobLinkInput & { kind: JobLinkKind }) => addJobLink(jobId, payload),
    // The job too, not just its links: `frame_link` follows the newest cut, so
    // adding one changes the row icon and the panel's header as well.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useRemoveJobLink(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => removeJobLink(jobId, linkId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
}
