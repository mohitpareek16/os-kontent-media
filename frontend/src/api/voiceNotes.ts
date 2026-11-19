import type { Page } from "@/types";

import { apiClient } from "./client";

export interface VoiceNoteRead {
  id: string;
  video_url: string;
  video_key: string;
  video_title: string | null;
  timestamp_seconds: number;
  duration_seconds: number;
  audio_filename: string;
  recorded_by: string | null;
  recorded_by_email: string | null;
  created_at: string;
  expires_at: string;
}

export interface VideoSummary {
  /** What identifies the video. Frame.io gives the same asset a different URL
   * depending on whether the reviewer was signed in, so the raw URL listed one
   * cut as two rows. */
  video_key: string;
  /** The link from the most recent note — what the Open button points at. */
  video_url: string;
  video_title: string | null;
  note_count: number;
  last_note_at: string | null;
}

export interface FetchVideosParams {
  search?: string;
  sort_by?: "last_note_at" | "note_count" | "video_title" | "video_url";
  sort_dir?: "asc" | "desc";
  page?: number;
  page_size?: number;
}

/** `total_notes` counts notes across every matching video, so the KPI card
 * above the table doesn't shrink when you turn to page 2. */
export interface PaginatedVideos extends Page<VideoSummary> {
  total_notes: number;
}

/** Admin: one page of the videos that have voice notes. Searched and paged
 * server-side — this table grows with every recording the extension makes. */
export async function fetchVoiceNoteVideos(
  params: FetchVideosParams = {},
): Promise<PaginatedVideos> {
  const { data } = await apiClient.get<PaginatedVideos>("/voice-notes/admin/videos", { params });
  return data;
}

/** Admin: list all notes for a specific video (key base64-encoded). */
export async function fetchVideoNotes(videoKey: string): Promise<VoiceNoteRead[]> {
  const encoded = btoa(videoKey);
  // Use URL-safe base64 for the path segment.
  const safe = encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const { data } = await apiClient.get<VoiceNoteRead[]>(
    `/voice-notes/admin/videos/${safe}/notes`,
  );
  return data;
}

/** Admin: delete a single voice note. */
export async function deleteVoiceNote(noteId: string): Promise<void> {
  await apiClient.delete(`/voice-notes/${noteId}`);
}

/** Admin: bulk delete multiple voice notes. */
export async function bulkDeleteVoiceNotes(noteIds: string[]): Promise<void> {
  await apiClient.delete("/voice-notes/admin/bulk-delete", { data: noteIds });
}

/** Build the full audio stream URL for playback in the admin panel. */
export function audioUrl(noteId: string): string {
  return `/api/voice-notes/${noteId}/audio`;
}
