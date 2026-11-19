import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addVideoType, fetchVideoTypes, updateVideoType } from "@/api/videoTypes";

export function useVideoTypes() {
  return useQuery({ queryKey: ["video-types"], queryFn: fetchVideoTypes, staleTime: 60_000 });
}

export function useVideoTypeActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["video-types"] });
  return {
    add: useMutation({ mutationFn: addVideoType, onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ key, changes }: { key: string; changes: Parameters<typeof updateVideoType>[1] }) => updateVideoType(key, changes), onSuccess: refresh }),
  };
}
