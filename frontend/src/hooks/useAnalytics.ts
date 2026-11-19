import { useQuery } from "@tanstack/react-query";

import {
  fetchAvgRoundsByEditor,
  fetchFirstPassRate,
  fetchStageDistribution,
  fetchStuckJobs,
} from "@/api/analytics";

export function useStageDistribution(podId: string | null) {
  return useQuery({
    queryKey: ["analytics", podId, "stage-distribution"],
    queryFn: () => fetchStageDistribution(podId as string),
    enabled: Boolean(podId),
  });
}

export function useFirstPassRate(podId: string | null) {
  return useQuery({
    queryKey: ["analytics", podId, "first-pass-rate"],
    queryFn: () => fetchFirstPassRate(podId as string),
    enabled: Boolean(podId),
  });
}

export function useAvgRoundsByEditor(podId: string | null) {
  return useQuery({
    queryKey: ["analytics", podId, "avg-rounds-by-editor"],
    queryFn: () => fetchAvgRoundsByEditor(podId as string),
    enabled: Boolean(podId),
  });
}

export function useStuckJobs(podId: string | null) {
  return useQuery({
    queryKey: ["analytics", podId, "stuck-jobs"],
    queryFn: () => fetchStuckJobs(podId as string),
    enabled: Boolean(podId),
  });
}
