import type {
  Job,
  JobDetail,
  JobEvent,
  JobLink,
  JobLinkKind,
  JobSortField,
  JobStatusCounts,
  JobStatusFilter,
  PaginatedJobs,
  Qc1Outcome,
  Qc1Pass,
  Stage,
  VideoType,
  Weight,
  WorkspaceOverview,
} from "@/types";

import { apiClient } from "./client";

/** Every filter the pipeline table offers. All of them are resolved in SQL —
 * nothing here is a hint the browser then re-applies. */
export interface JobFilters {
  pod_id?: string;
  status?: JobStatusFilter;
  search?: string;
  /** Repeatable — `?stage=qc1&stage=qc2`. */
  stage?: Stage[];
  weight?: Weight[];
  video_type?: VideoType[];
  editor_id?: string;
  reviewer_id?: string;
  /** No editor at all. Not expressible as an id, hence its own flag. */
  unassigned?: boolean;
  /** Sitting at QC2 with nobody reviewing it. */
  unrouted?: boolean;
  deadline_from?: string;
  deadline_to?: string;
  no_deadline?: boolean;
  /** Independent of `status`: `false` drops cancelled projects, `true` keeps
   * only them. For callers that pick their own stages and so can't express it
   * through the status tab — the QC queue asks for `all` because its last
   * group is delivered work. */
  scrapped?: boolean;
  /** Only jobs whose QC1 a reviewer has flagged as never done. Cuts across
   * every status rather than being one: a skipped QC1 on a video that has
   * since shipped is the case worth seeing most. */
  qc1_flagged?: boolean;
  /** Only jobs marked urgent. Cuts across every status for the same reason
   * `qc1_flagged` does — "what did we call urgent this week" is a question
   * about the whole board, and a rush job that shipped is worth looking back
   * at most. */
  rush?: boolean;
  /** One of the client's channels. */
  channel_id?: string;
  /** Everything not filed under a channel yet — which is every job created
   * before channels existed, and the list a TL works through. Not expressible
   * as an id, hence its own flag. */
  no_channel?: boolean;
}

export interface FetchJobsParams extends JobFilters {
  sort_by?: JobSortField;
  sort_dir?: "asc" | "desc";
  page?: number;
  page_size?: number;
}

export async function fetchJobs(params: FetchJobsParams = {}) {
  const { data } = await apiClient.get<PaginatedJobs>("/jobs", { params });
  return data;
}

export async function fetchJob(jobId: string) {
  const { data } = await apiClient.get<JobDetail>(`/jobs/${jobId}`);
  return data;
}

/** The status cards take the same filters as the table they sit on top of —
 * a card counting a wider set than the rows beneath it is simply wrong. */
export type FetchJobStatsParams = Omit<JobFilters, "status">;

export async function fetchJobStats(params: FetchJobStatsParams = {}) {
  const { data } = await apiClient.get<JobStatusCounts>("/jobs/stats", { params });
  return data;
}

/** The Overview screen's KPI tiles and pod cards, counted in SQL. It used to
 * reduce a 1000-row job fetch in the browser, so every number was right only
 * up to that limit. */
export async function fetchWorkspaceOverview() {
  const { data } = await apiClient.get<WorkspaceOverview>("/jobs/overview");
  return data;
}

export interface CreateJobPayload {
  title: string;
  pod_id: string;
  channel_id?: string | null;
  weight?: Weight;
  video_type?: VideoType;
  rush?: boolean;
  deadline?: string | null;
  client_deadline?: string | null;
  /** What the client sent. Raw by definition at intake — nobody has cut
   * anything yet — so these go on the job's raw list, never on the column the
   * editor's cut lives on. */
  raw_links?: JobLinkInput[];
}

export async function createJob(payload: CreateJobPayload) {
  const { data } = await apiClient.post<Job>("/jobs", payload);
  return data;
}

export interface AdvanceJobPayload {
  stage: string;
  frame_link?: string | null;
  assigned_editor_id?: string | null;
  /** Set with the editor on the assigning move — a hand-off is a name *and* a
   * date, and half of one leaves the job on the TL's plate (`isBriefed`). */
  deadline?: string | null;
  client_deadline?: string | null;
  /** Hand-off note; on a send-back this is the QC change list the editor
   * reads on the way back round the loop. Stored as a JobEvent. */
  note?: string | null;
  /** Only meaningful on the QC1 → QC2 move: whether the TL passed the cut
   * with nothing to raise, or having left their comments on Frame.io. The
   * server defaults it to `approved` and ignores it everywhere else. */
  qc1_outcome?: Qc1Outcome;
}

export async function advanceJob(jobId: string, payload: AdvanceJobPayload) {
  const { data } = await apiClient.post<JobDetail>(`/jobs/${jobId}/advance`, payload);
  return data;
}

export interface UpdateJobPayload {
  title?: string;
  weight?: Weight;
  video_type?: VideoType;
  rush?: boolean;
  channel_id?: string;
  deadline?: string | null;
  client_deadline?: string | null;
  /** Refused by the server: links live on the job's own lists now — use
   * `addJobLink`. Kept on the type so nothing sends it by accident. */
  frame_link?: never;
  assigned_editor_id?: string | null;
  qc2_reviewer_id?: string | null;
  clear_deadline?: boolean;
  clear_client_deadline?: boolean;
  clear_frame_link?: never;
  clear_editor?: boolean;
  clear_channel?: boolean;
}

/** Edit the job itself — title, deadline, weight, link, editor. Distinct
 * from advancing its stage. Owner / pod TL only, enforced server-side. */
export async function updateJob(jobId: string, payload: UpdateJobPayload) {
  const { data } = await apiClient.patch<JobDetail>(`/jobs/${jobId}`, payload);
  return data;
}

/** Hand a job in flight to a different editor. The reason is mandatory and
 * lands in the timeline as a `job_reassigned` event — the stage doesn't move,
 * only the name on the job. Pod TL / admin only, enforced server-side. */
export async function reassignJob(jobId: string, editorId: string, reason: string) {
  const { data } = await apiClient.post<JobDetail>(`/jobs/${jobId}/reassign`, {
    editor_id: editorId,
    reason,
  });
  return data;
}

/** A QC picks up a job routing couldn't place. Without this an unrouted job
 * was permanently stuck — see docs/05. */
export async function claimQc2(jobId: string) {
  const { data } = await apiClient.post<JobDetail>(`/jobs/${jobId}/claim-qc2`);
  return data;
}

/** Cancel a project before delivery. The reason is mandatory and is kept on
 * the job and in its event log. Pod TL / HR / admin only, enforced server-side. */
export async function scrapJob(jobId: string, reason: string) {
  const { data } = await apiClient.post<JobDetail>(`/jobs/${jobId}/scrap`, { reason });
  return data;
}

/** Undo a scrap. The job returns at the stage it died at, rounds intact. */
export async function restoreJob(jobId: string, reason?: string) {
  const { data } = await apiClient.post<JobDetail>(`/jobs/${jobId}/restore`, {
    reason: reason?.trim() || null,
  });
  return data;
}

/** How the latest QC1 review went — who cleared it, how long it sat there,
 * whether anything was said. Null when the job has never been through QC1.
 * Derived from the event log server-side, never stored. */
export async function fetchQc1Pass(jobId: string) {
  const { data } = await apiClient.get<Qc1Pass | null>(`/jobs/${jobId}/qc1-pass`);
  return data;
}

/** The QC2 reviewer putting on the record that QC1 never really happened.
 * The reason is mandatory; the stage and round don't move. QC2 reviewer or
 * admin only, enforced server-side. */
export async function flagQc1(jobId: string, reason: string) {
  const { data } = await apiClient.post<JobDetail>(`/jobs/${jobId}/qc1-flag`, { reason });
  return data;
}

/** Withdrawing a flag (the reviewer who raised it) or dismissing one (an
 * admin). Both stay in the event log — only the job's own columns clear. */
export async function clearQc1Flag(jobId: string, reason?: string) {
  const { data } = await apiClient.post<JobDetail>(`/jobs/${jobId}/qc1-flag/clear`, {
    reason: reason?.trim() || null,
  });
  return data;
}

/** A comment that doesn't move the job. Whoever owns the current stage gets
 * notified. */
export async function addJobNote(jobId: string, note: string) {
  const { data } = await apiClient.post<JobEvent>(`/jobs/${jobId}/notes`, { note });
  return data;
}

export interface ChecklistPayload {
  client_sheet_ok?: boolean;
  ops_tracker_ok?: boolean;
}

export async function updateChecklist(jobId: string, payload: ChecklistPayload) {
  const { data } = await apiClient.patch<Job>(`/jobs/${jobId}/checklist`, payload);
  return data;
}

export async function fetchJobEvents(jobId: string) {
  const { data } = await apiClient.get<JobEvent[]>(`/jobs/${jobId}/events`);
  return data;
}

export interface BatchJobItem {
  title: string;
  channel_id?: string | null;
  weight?: Weight;
  video_type?: VideoType;
  rush?: boolean;
  /** The client's material. Raw at intake, always — see `CreateJobPayload`. */
  raw_links?: JobLinkInput[];
  deadline?: string | null;
  client_deadline?: string | null;
  assigned_editor_id?: string | null;
}

export interface CreateJobsBatchPayload {
  pod_id: string;
  jobs: BatchJobItem[];
}

export async function createJobsBatch(payload: CreateJobsBatchPayload) {
  const { data } = await apiClient.post<Job[]>("/jobs/batch", payload);
  return data;
}

export interface BulkChannelPayload {
  job_ids: string[];
  /** `null` unfiles the selection. A channel belongs to one client, so a
   * selection spanning two of them can only be unfiled — the server says so
   * rather than guessing which client's channel was meant. */
  channel_id: string | null;
}

/** How many rows actually moved. A job already filed under that channel is
 * left alone rather than given an event saying nothing changed. */
export interface BulkChannelResult {
  updated: number;
  unchanged: number;
}

export async function bulkFileUnderChannel(payload: BulkChannelPayload) {
  const { data } = await apiClient.post<BulkChannelResult>("/jobs/bulk-channel", payload);
  return data;
}

export interface BulkRetryQc2Result {
  assigned: number;
  no_capacity: number;
  skipped: number;
}

export async function bulkRetryQc2Assignment(jobIds: string[]) {
  const { data } = await apiClient.post<BulkRetryQc2Result>("/jobs/bulk-retry-qc2", {
    job_ids: jobIds,
  });
  return data;
}

export interface JobLinkInput {
  url: string;
  title?: string | null;
}

/** Every link on a job, raw and video. Same read rule as the job itself. */
export async function fetchJobLinks(jobId: string) {
  const { data } = await apiClient.get<JobLink[]>(`/jobs/${jobId}/links`);
  return data;
}

/** Raw material is the TL's to add, the cut is the editor's — the server
 * decides, and answers 403 with which of the two it was. */
export async function addJobLink(
  jobId: string,
  payload: JobLinkInput & { kind: JobLinkKind },
) {
  const { data } = await apiClient.post<JobLink>(`/jobs/${jobId}/links`, payload);
  return data;
}

export async function removeJobLink(jobId: string, linkId: string) {
  await apiClient.delete(`/jobs/${jobId}/links/${linkId}`);
}
