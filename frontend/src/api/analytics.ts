import type { Job } from "@/types";

import { apiClient } from "./client";

export async function fetchStageDistribution(podId: string) {
  const { data } = await apiClient.get<Record<string, number>>(
    `/pods/${podId}/analytics/stage-distribution`,
  );
  return data;
}

export interface FirstPassRate {
  first_pass_rate: number | null;
  avg_rounds: number | null;
}

export async function fetchFirstPassRate(podId: string) {
  const { data } = await apiClient.get<FirstPassRate>(`/pods/${podId}/analytics/first-pass-rate`);
  return data;
}

export async function fetchAvgRoundsByEditor(podId: string) {
  const { data } = await apiClient.get<Record<string, number>>(
    `/pods/${podId}/analytics/avg-rounds-by-editor`,
  );
  return data;
}

export async function fetchStuckJobs(podId: string) {
  const { data } = await apiClient.get<Job[]>(`/pods/${podId}/analytics/stuck-jobs`);
  return data;
}
