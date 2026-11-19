import { apiClient } from "./client";
import type { VideoTypeConfig } from "@/types";

export async function fetchVideoTypes() {
  const { data } = await apiClient.get<VideoTypeConfig[]>("/video-types");
  return data;
}

export async function addVideoType(payload: Pick<VideoTypeConfig, "key" | "label" | "qc_points">) {
  const { data } = await apiClient.post<VideoTypeConfig>("/video-types", payload);
  return data;
}

export async function updateVideoType(key: string, payload: Partial<Pick<VideoTypeConfig, "label" | "qc_points" | "enabled">>) {
  const { data } = await apiClient.patch<VideoTypeConfig>(`/video-types/${key}`, payload);
  return data;
}
