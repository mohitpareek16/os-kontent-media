import type { BrandAsset, BrandAssetType } from "@/types";

import { apiClient } from "./client";

export async function fetchBrandAssets(podId: string) {
  const assets: BrandAsset[] = [];
  for (;;) {
    const { data } = await apiClient.get<BrandAsset[]>(`/pods/${podId}/brand-assets`, { params: { limit: 500, offset: assets.length } });
    assets.push(...data);
    if (data.length < 500) return assets;
  }
}

/** Fetches the file through the API (which checks pod membership) and hands
 * back an object URL. A plain <a href> can't be used — the download route
 * needs the Authorization header like every other call. */
export async function downloadBrandAsset(podId: string, assetId: string) {
  const response = await apiClient.get<Blob>(`/pods/${podId}/brand-assets/${assetId}/download`, {
    responseType: "blob",
  });
  const disposition = String(response.headers["content-disposition"] ?? "");
  const match = disposition.match(/filename="?([^"]+)"?/);
  return { url: URL.createObjectURL(response.data), filename: match?.[1] ?? "download" };
}

export interface UploadBrandAssetPayload {
  podId: string;
  type: BrandAssetType;
  title: string;
  file: File;
  note?: string;
}

export async function uploadBrandAsset({ podId, type, title, file, note }: UploadBrandAssetPayload) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<BrandAsset>(
    `/pods/${podId}/brand-assets?type=${type}&title=${encodeURIComponent(title)}&note=${encodeURIComponent(note ?? "")}`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data;
}

export type BrandLinkCategory = "website" | "assets" | "reference" | "font" | "other";

export interface BrandLink {
  id: string;
  pod_id: string;
  title: string;
  url: string;
  category: BrandLinkCategory;
  created_at: string;
}

export interface BrandKitEvent {
  id: string;
  action: string;
  title: string;
  before: Record<string, string | number> | null;
  after: Record<string, string | number> | null;
  note: string | null;
  actor_name: string;
  created_at: string;
}

export type BrandLinkPayload = Pick<BrandLink, "title" | "url" | "category"> & { note?: string };

export async function fetchBrandLinks(podId: string) {
  const { data } = await apiClient.get<BrandLink[]>(`/pods/${podId}/brand-assets/links`);
  return data;
}

export async function addBrandLink(podId: string, payload: BrandLinkPayload) {
  const { data } = await apiClient.post<BrandLink>(`/pods/${podId}/brand-assets/links`, payload);
  return data;
}

export async function updateBrandLink(podId: string, id: string, payload: BrandLinkPayload) {
  const { data } = await apiClient.put<BrandLink>(`/pods/${podId}/brand-assets/links/${id}`, payload);
  return data;
}

export async function removeBrandLink(podId: string, id: string, note?: string) {
  await apiClient.delete(`/pods/${podId}/brand-assets/links/${id}`, { data: { note } });
}

export async function fetchBrandKitHistory(podId: string, offset = 0) {
  const { data } = await apiClient.get<BrandKitEvent[]>(`/pods/${podId}/brand-assets/history`, { params: { offset, limit: 50 } });
  return data;
}
