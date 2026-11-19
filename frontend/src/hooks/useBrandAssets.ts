import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  downloadBrandAsset,
  fetchBrandAssets,
  uploadBrandAsset,
  fetchBrandLinks,
  fetchBrandKitHistory,
  addBrandLink,
  updateBrandLink,
  removeBrandLink,
  type BrandLinkPayload,
  type UploadBrandAssetPayload,
} from "@/api/brandAssets";

export function useBrandAssets(podId: string | null) {
  return useQuery({
    queryKey: ["brand-assets", podId],
    queryFn: () => fetchBrandAssets(podId as string),
    enabled: Boolean(podId),
  });
}

/** Opens an asset in a new tab. Not a query — it's an action, and the blob
 * URL is revoked once the browser has it. */
export function useDownloadBrandAsset(podId: string) {
  return useMutation({
    mutationFn: (assetId: string) => downloadBrandAsset(podId, assetId),
    onSuccess: ({ url }) => {
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  });
}

export function useUploadBrandAsset(podId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Omit<UploadBrandAssetPayload, "podId">) =>
      uploadBrandAsset({ ...payload, podId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brand-assets", podId] });
      queryClient.invalidateQueries({ queryKey: ["brand-kit-history", podId] });
    },
  });
}

export function useBrandLinks(podId: string | null) {
  return useQuery({ queryKey: ["brand-links", podId], queryFn: () => fetchBrandLinks(podId as string), enabled: Boolean(podId) });
}

export function useBrandKitHistory(podId: string | null) {
  return useInfiniteQuery({
    queryKey: ["brand-kit-history", podId],
    queryFn: ({ pageParam }) => fetchBrandKitHistory(podId as string, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => last.length === 50 ? pages.length * 50 : undefined,
    enabled: Boolean(podId),
  });
}

export function useBrandLinkActions(podId: string) {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["brand-links", podId] });
    queryClient.invalidateQueries({ queryKey: ["brand-kit-history", podId] });
  };
  return {
    add: useMutation({ mutationFn: (payload: BrandLinkPayload) => addBrandLink(podId, payload), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, payload }: { id: string; payload: BrandLinkPayload }) => updateBrandLink(podId, id, payload), onSuccess: refresh }),
    remove: useMutation({ mutationFn: ({ id, note }: { id: string; note?: string }) => removeBrandLink(podId, id, note), onSuccess: refresh }),
  };
}
