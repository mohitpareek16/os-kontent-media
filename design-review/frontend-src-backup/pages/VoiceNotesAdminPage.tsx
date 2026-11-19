import { useEffect, useRef, useState } from "react";

import { Pagination } from "@/components/ui/Pagination";

import { audioUrl } from "@/api/voiceNotes";
import type { VoiceNoteRead, VideoSummary } from "@/api/voiceNotes";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  useBulkDeleteVoiceNotes,
  useDeleteVoiceNote,
  useVideoNotes,
  useVoiceNoteVideos,
} from "@/hooks/useVoiceNotes";

/* m:ss.mmm — the note is pinned to a frame, not to a second, and the
 * extension already captures `video.currentTime` at full precision. */
function formatTimestamp(seconds: number): string {
  const total = Math.max(0, seconds || 0);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const ms = Math.floor((total % 1) * 1000);
  return `${m}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
}

function relativeDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function daysUntilExpiry(expiresAt: string): number {
  const now = Date.now();
  const exp = new Date(expiresAt).getTime();
  return Math.max(0, Math.ceil((exp - now) / (1000 * 60 * 60 * 24)));
}

const PAGE_SIZE = 25;

export default function VoiceNotesAdminPage() {
  const tableRef = useRef<HTMLDivElement | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  /* Debounced — typing a name shouldn't be one request per character. */
  const search = useDebouncedValue(searchInput).trim();
  const [page, setPage] = useState(1);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [search]);

  /* Searched and paged by the server. This table grows with every recording
   * the extension makes, so pulling all of it to filter in the browser gets
   * slower every day it's used. */
  const { data, isLoading } = useVoiceNoteVideos({
    search: search || undefined,
    page,
    page_size: PAGE_SIZE,
  });

  const filtered = data?.items ?? [];
  /* Counted over every matching video, so the cards don't shrink on page 2. */
  const totalNotes = data?.total_notes ?? 0;
  const totalVideos = data?.total ?? 0;

  /* Both count cards count the table below them, so both open it — clearing
   * the search first, because while one is on the cards are counting the
   * matches and "show me these" means all of them. */
  const openTable = () => {
    setSearchInput("");
    setPage(1);
    tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const openTableHint = search ? "Click to clear the search" : "Click to jump to the list";

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <button
          type="button"
          onClick={openTable}
          title={openTableHint}
          className="glass-card p-5 text-left transition-all hover:-translate-y-0.5"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
              VIDEOS WITH NOTES
            </span>
            <div className="w-9 h-9 rounded-lg bg-purple-500/15 text-purple-400 flex items-center justify-center text-lg">
              <i className="ri-film-line" />
            </div>
          </div>
          <div className="text-3xl font-extrabold font-mono mt-2">{totalVideos}</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">Unique Frame.io review links</div>
        </button>

        <button
          type="button"
          onClick={openTable}
          title={openTableHint}
          className="glass-card p-5 text-left transition-all hover:-translate-y-0.5"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
              TOTAL VOICE NOTES
            </span>
            <div className="w-9 h-9 rounded-lg bg-cyan-500/15 text-cyan-400 flex items-center justify-center text-lg">
              <i className="ri-mic-line" />
            </div>
          </div>
          <div className="text-3xl font-extrabold font-mono mt-2">{totalNotes}</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            Across all videos · auto-delete after 60 days
          </div>
        </button>

        {/* Left as a plain card on purpose: 60 days is the retention policy,
            not a count, so there are no rows behind it to open. */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
              RETENTION
            </span>
            <div className="w-9 h-9 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-lg">
              <i className="ri-calendar-check-line" />
            </div>
          </div>
          <div className="text-3xl font-extrabold font-mono mt-2">60d</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            Notes auto-expire and are cleaned daily
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <i className="ri-search-line absolute left-3 top-2.5 text-[var(--text-dim)]" />
          <input
            type="text"
            placeholder="Search by video URL or title..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
          />
        </div>
        <span className="text-xs text-[var(--text-muted)]">
          {totalVideos} video{totalVideos !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Videos Table */}
      <div ref={tableRef} className="glass-card overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--border-color)] text-[var(--text-dim)] font-bold uppercase tracking-wider">
              <th className="p-4 w-8" />
              <th className="p-4">Video</th>
              <th className="p-4">Notes</th>
              <th className="p-4">Last Note</th>
              <th className="p-4 w-32 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => (
              <VideoRow
                key={v.video_key}
                video={v}
                isExpanded={expandedKey === v.video_key}
                onToggle={() => setExpandedKey(expandedKey === v.video_key ? null : v.video_key)}
                confirmDelete={confirmDeleteKey === v.video_key}
                onConfirmDelete={() => setConfirmDeleteKey(v.video_key)}
                onCancelDelete={() => setConfirmDeleteKey(null)}
              />
            ))}

            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="p-12 text-center">
                  <div className="flex flex-col items-center gap-3 text-[var(--text-muted)]">
                    <i className="ri-mic-off-line text-4xl text-[var(--text-dim)]" />
                    <span className="text-sm font-semibold">
                      {search ? "No videos match that search" : "No voice notes yet"}
                    </span>
                    <span className="text-[11px] max-w-xs leading-relaxed">
                      {search
                        ? "Try a different part of the URL or title."
                        : "Install the Chrome extension on Frame.io review pages to start recording timestamped voice notes."}
                    </span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={totalVideos}
          onPageChange={setPage}
          noun="videos"
          className="border-t border-[var(--border-color-subtle)]"
        />
      </div>

      {isLoading && (
        <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <i className="ri-loader-4-line animate-spin" /> Loading voice notes...
        </p>
      )}
    </div>
  );
}

// ── Video row with expandable notes ─────────────────────────────────

function VideoRow({
  video,
  isExpanded,
  onToggle,
  confirmDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  video: VideoSummary;
  isExpanded: boolean;
  onToggle: () => void;
  confirmDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const bulkDelete = useBulkDeleteVoiceNotes();
  const { data: notes } = useVideoNotes(isExpanded ? video.video_key : null);

  const handleDeleteAll = async () => {
    if (!notes) return;
    const ids = notes.map((n) => n.id);
    await bulkDelete.mutateAsync(ids);
    onCancelDelete();
  };

  return (
    <>
      <tr
        onClick={onToggle}
        className={`border-b border-[var(--border-color-subtle)] hover:bg-[var(--bg-pill)] cursor-pointer transition-colors ${
          isExpanded ? "bg-[var(--bg-pill)]" : ""
        }`}
      >
        <td className="p-4 text-[var(--text-dim)]">
          <i className={isExpanded ? "ri-arrow-down-s-line text-base" : "ri-arrow-right-s-line text-base"} />
        </td>
        <td className="p-4">
          <div className="font-bold text-[var(--text-main)] truncate max-w-[400px]">
            {video.video_title || "Untitled Video"}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--text-dim)] truncate max-w-[400px] font-mono">
            {video.video_url}
          </div>
        </td>
        <td className="p-4">
          <span className="px-2 py-0.5 rounded bg-purple-500/15 text-purple-400 font-bold font-mono text-xs">
            {video.note_count}
          </span>
        </td>
        <td className="p-4 text-[var(--text-muted)]">
          {video.last_note_at ? relativeDate(video.last_note_at) : "—"}
        </td>
        <td className="p-4 text-right">
          <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
            <a
              href={video.video_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1 rounded bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-muted)] hover:border-[var(--primary)] hover:text-[var(--primary-light)] transition-colors text-[11px] font-semibold inline-flex items-center gap-1"
            >
              <i className="ri-external-link-line" /> Open
            </a>
            {!confirmDelete ? (
              <button
                onClick={onConfirmDelete}
                className="px-2.5 py-1 rounded bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-muted)] hover:border-rose-500/40 hover:text-rose-400 transition-colors text-[11px] font-semibold inline-flex items-center gap-1"
              >
                <i className="ri-delete-bin-6-line" /> Delete All
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleDeleteAll}
                  disabled={bulkDelete.isPending}
                  className="px-2.5 py-1 rounded bg-rose-600 text-white text-[11px] font-semibold hover:bg-rose-700 transition-colors disabled:opacity-50"
                >
                  {bulkDelete.isPending ? "Deleting..." : "Confirm"}
                </button>
                <button
                  onClick={onCancelDelete}
                  className="px-2.5 py-1 rounded bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-muted)] text-[11px] font-semibold"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded: individual notes */}
      {isExpanded && notes && (
        <tr>
          <td colSpan={5} className="p-0 bg-[rgba(124,58,237,0.03)]">
            <div className="px-6 py-3 space-y-2">
              {notes.map((note) => (
                <NoteRow key={note.id} note={note} />
              ))}
              {notes.length === 0 && (
                <p className="text-xs text-[var(--text-muted)] py-4 text-center">
                  No notes found (they may have expired)
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Individual note row ──────────────────────────────────────────────

function NoteRow({ note }: { note: VoiceNoteRead }) {
  const deleteNote = useDeleteVoiceNote();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const togglePlay = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(audioUrl(note.id));
      audioRef.current.onended = () => setIsPlaying(false);
    }
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleDelete = async () => {
    await deleteNote.mutateAsync(note.id);
    setConfirmDel(false);
  };

  const days = daysUntilExpiry(note.expires_at);

  return (
    <div className="flex items-center gap-4 px-4 py-3 bg-[var(--bg-card)] border border-[var(--border-color-subtle)] rounded-lg hover:border-[var(--border-color)] transition-colors">
      {/* Timestamp badge */}
      <span className="px-2.5 py-1 rounded-md bg-purple-500/15 text-purple-400 font-bold font-mono text-xs flex items-center gap-1.5 shrink-0">
        <i className="ri-play-mini-fill" />
        {formatTimestamp(note.timestamp_seconds)}
      </span>

      {/* Duration */}
      <span className="text-[11px] text-[var(--text-dim)] font-mono shrink-0">
        {formatTimestamp(note.duration_seconds)}
      </span>

      {/* Recorded by */}
      <span className="text-xs text-[var(--text-muted)] flex items-start gap-1.5 min-w-[160px]">
        <i className="ri-user-voice-line text-[var(--text-dim)] mt-0.5" />
        <span className="flex flex-col leading-tight">
          <span>{note.recorded_by || "Anonymous"}</span>
          {note.recorded_by_email && (
            <span className="text-[10px] text-[var(--text-dim)]">{note.recorded_by_email}</span>
          )}
        </span>
      </span>

      {/* Date */}
      <span className="text-[10px] text-[var(--text-dim)] flex-1">{relativeDate(note.created_at)}</span>

      {/* Expiry */}
      <span
        className={`text-[10px] font-semibold shrink-0 ${days <= 7 ? "text-rose-400" : "text-[var(--text-dim)]"}`}
      >
        {days}d left
      </span>

      {/* Play */}
      <button
        onClick={togglePlay}
        className={`px-2 py-1 rounded border text-[11px] font-semibold inline-flex items-center gap-1 transition-colors ${
          isPlaying
            ? "bg-purple-600/20 border-purple-500/30 text-purple-300"
            : "bg-[var(--bg-pill)] border-[var(--border-color)] text-[var(--text-muted)] hover:border-purple-500/30 hover:text-purple-300"
        }`}
      >
        <i className={isPlaying ? "ri-pause-fill" : "ri-play-fill"} />
        {isPlaying ? "Pause" : "Play"}
      </button>

      {/* Delete */}
      {!confirmDel ? (
        <button
          onClick={() => setConfirmDel(true)}
          className="px-2 py-1 rounded border bg-[var(--bg-pill)] border-[var(--border-color)] text-[var(--text-muted)] hover:border-rose-500/30 hover:text-rose-400 transition-colors text-[11px] font-semibold inline-flex items-center gap-1"
        >
          <i className="ri-delete-bin-line" />
        </button>
      ) : (
        <div className="flex items-center gap-1">
          <button
            onClick={handleDelete}
            disabled={deleteNote.isPending}
            className="px-2 py-1 rounded bg-rose-600 text-white text-[10px] font-semibold hover:bg-rose-700 disabled:opacity-50"
          >
            {deleteNote.isPending ? "..." : "Del"}
          </button>
          <button
            onClick={() => setConfirmDel(false)}
            className="px-2 py-1 rounded bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-muted)] text-[10px] font-semibold"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
