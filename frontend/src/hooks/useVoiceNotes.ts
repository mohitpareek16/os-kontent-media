import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  bulkDeleteVoiceNotes,
  deleteVoiceNote,
  fetchVideoNotes,
  fetchVoiceNoteVideos,
  type FetchVideosParams,
} from "@/api/voiceNotes";

/** One searched, sorted page of the videos that have voice notes, plus the
 * totals the KPI cards show. This table grows with every recording the
 * extension makes, so none of that can be a client-side filter. */
export function useVoiceNoteVideos(params: FetchVideosParams = {}) {
  return useQuery({
    queryKey: ["voice-note-videos", params],
    queryFn: () => fetchVoiceNoteVideos(params),
    placeholderData: keepPreviousData,
  });
}

/** All notes for a specific video, addressed by its canonical key — the same
 * asset reached through a share link and a project link is one video. */
export function useVideoNotes(videoKey: string | null) {
  return useQuery({
    queryKey: ["voice-notes", videoKey],
    queryFn: () => fetchVideoNotes(videoKey!),
    enabled: Boolean(videoKey),
  });
}

/** Delete a single note, then refresh both the video list and note list. */
export function useDeleteVoiceNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteVoiceNote,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["voice-note-videos"] });
      qc.invalidateQueries({ queryKey: ["voice-notes"] });
    },
  });
}

/** Bulk delete notes, then refresh. */
export function useBulkDeleteVoiceNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: bulkDeleteVoiceNotes,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["voice-note-videos"] });
      qc.invalidateQueries({ queryKey: ["voice-notes"] });
    },
  });
}
