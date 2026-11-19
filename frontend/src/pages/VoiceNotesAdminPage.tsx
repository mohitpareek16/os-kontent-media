import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Drawer } from "@/components/ui/Drawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { SkeletonRows } from "@/components/ui/Skeleton";

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
  const [notesFor, setNotesFor] = useState<VideoSummary | null>(null);
  const [searchInput, setSearchInput] = useState("");
  /* Debounced — typing a name shouldn't be one request per character. */
  const search = useDebouncedValue(searchInput).trim();
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<VideoSummary | null>(null);

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
          className="glass-card p-5 text-left transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-dim)]">
              VIDEOS WITH NOTES
            </span>
            <div className="w-9 h-9 rounded-lg bg-purple-500/15 text-purple-400 flex items-center justify-center text-lg">
              <i className="ri-film-line" />
            </div>
          </div>
          <div className="text-3xl font-bold font-mono mt-2">{totalVideos}</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">Unique Frame.io review links</div>
        </button>

        <button
          type="button"
          onClick={openTable}
          title={openTableHint}
          className="glass-card p-5 text-left transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-dim)]">
              TOTAL VOICE NOTES
            </span>
            <div className="w-9 h-9 rounded-lg bg-cyan-500/15 text-cyan-400 flex items-center justify-center text-lg">
              <i className="ri-mic-line" />
            </div>
          </div>
          <div className="text-3xl font-bold font-mono mt-2">{totalNotes}</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            Across all videos · auto-delete after 60 days
          </div>
        </button>

        {/* Left as a plain card on purpose: 60 days is the retention policy,
            not a count, so there are no rows behind it to open. */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-dim)]">
              RETENTION
            </span>
            <div className="w-9 h-9 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-lg">
              <i className="ri-calendar-check-line" />
            </div>
          </div>
          <div className="text-3xl font-bold font-mono mt-2">60d</div>
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
        <div className="overflow-x-auto">
          <table className="k-table min-w-[720px]">
            <thead>
              <tr>
                <th>Video</th>
                <th className="w-28">Notes</th>
                <th className="w-48">Last note</th>
                <th className="w-64">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.video_key}>
                  <td>
                    <div className="max-w-[420px] truncate font-bold text-[var(--text-main)]">
                      {v.video_title || "Untitled Video"}
                    </div>
                    <div className="max-w-[420px] truncate font-mono text-xs text-[var(--text-dim)]">{v.video_url}</div>
                  </td>
                  <td>
                    <span className="inline-flex h-6 items-center rounded-full bg-[var(--bg-pill)] px-2.5 text-xs font-bold text-[var(--primary-text)]">
                      {v.note_count} note{v.note_count === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td className="text-[var(--text-muted)]">{v.last_note_at ? relativeDate(v.last_note_at) : "—"}</td>
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setNotesFor(v)}>
                        Open notes
                      </Button>
                      <a
                        href={v.video_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-8 items-center gap-1 rounded-lg px-3 text-[13px] font-bold text-[var(--text-muted)] hover:bg-[var(--bg-pill)] hover:text-[var(--text-main)]"
                      >
                        <i className="ri-external-link-line" /> Video
                      </a>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="!text-[var(--bad-text)]"
                        aria-label={`Delete all notes on ${v.video_title || "this video"}`}
                        onClick={() => setDeleting(v)}
                      >
                        <i className="ri-delete-bin-6-line" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isLoading && (
          <div className="p-4">
            <SkeletonRows rows={4} label="Loading voice notes" />
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <EmptyState
            bare
            icon="ri-mic-off-line"
            title={search ? "No videos match that search" : "No voice notes yet"}
            description={
              search
                ? "Try a different part of the URL or title."
                : "Install the Chrome extension on Frame.io review pages to start recording timestamped voice notes."
            }
          />
        )}

        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={totalVideos}
          onPageChange={setPage}
          noun="videos"
          className="border-t border-[var(--border-color)]"
        />
      </div>

      <NotesDrawer video={notesFor} onClose={() => setNotesFor(null)} />
      <DeleteAllDialog video={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

// ── Notes for one video, in the shared side panel ─────────────────────

function NotesDrawer({ video, onClose }: { video: VideoSummary | null; onClose: () => void }) {
  const { data: notes, isLoading } = useVideoNotes(video?.video_key ?? null);
  return (
    <Drawer
      open={video !== null}
      onClose={onClose}
      header={
        <div className="min-w-0">
          <p className="text-[13px] text-[var(--text-dim)]">Voice notes</p>
          <h2 className="truncate text-[22px] font-bold">{video?.video_title || "Untitled Video"}</h2>
          <p className="truncate font-mono text-xs text-[var(--text-dim)]">{video?.video_url}</p>
        </div>
      }
    >
      <div className="space-y-2">
        {isLoading && <SkeletonRows rows={3} label="Loading notes" />}
        {(notes ?? []).map((note) => (
          <NoteRow key={note.id} note={note} />
        ))}
        {notes && notes.length === 0 && (
          <EmptyState bare title="No notes found" description="They may have expired." icon="ri-mic-off-line" />
        )}
      </div>
    </Drawer>
  );
}

// ── Delete every note on a video, behind the shared confirm dialog ────

function DeleteAllDialog({ video, onClose }: { video: VideoSummary | null; onClose: () => void }) {
  const bulkDelete = useBulkDeleteVoiceNotes();
  const { data: notes } = useVideoNotes(video?.video_key ?? null);
  return (
    <ConfirmDialog
      open={video !== null}
      title={`Delete ${video?.note_count ?? 0} note${video?.note_count === 1 ? "" : "s"}?`}
      description={
        <>
          This removes every voice note on <strong>{video?.video_title || "this video"}</strong>. This can't be
          undone.
        </>
      }
      confirmLabel="Delete notes"
      confirmIcon="ri-delete-bin-6-line"
      pending={bulkDelete.isPending}
      error={bulkDelete.error}
      errorFallback="Could not delete those notes."
      onCancel={onClose}
      onConfirm={async () => {
        if (!notes) return;
        await bulkDelete.mutateAsync(notes.map((n) => n.id));
        onClose();
      }}
    />
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
      <span className="text-xs text-[var(--text-dim)] font-mono shrink-0">
        {formatTimestamp(note.duration_seconds)}
      </span>

      {/* Recorded by */}
      <span className="text-xs text-[var(--text-muted)] flex items-start gap-1.5 min-w-[160px]">
        <i className="ri-user-voice-line text-[var(--text-dim)] mt-0.5" />
        <span className="flex flex-col leading-tight">
          <span>{note.recorded_by || "Anonymous"}</span>
          {note.recorded_by_email && (
            <span className="text-xs text-[var(--text-dim)]">{note.recorded_by_email}</span>
          )}
        </span>
      </span>

      {/* Date */}
      <span className="text-xs text-[var(--text-dim)] flex-1">{relativeDate(note.created_at)}</span>

      {/* Expiry */}
      <span
        className={`text-xs font-semibold shrink-0 ${days <= 7 ? "text-rose-400" : "text-[var(--text-dim)]"}`}
      >
        {days}d left
      </span>

      {/* Play */}
      <button
        onClick={togglePlay}
        className={`px-2 py-1 rounded border text-xs font-semibold inline-flex items-center gap-1 transition-colors ${
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
          className="px-2 py-1 rounded border bg-[var(--bg-pill)] border-[var(--border-color)] text-[var(--text-muted)] hover:border-rose-500/30 hover:text-rose-400 transition-colors text-xs font-semibold inline-flex items-center gap-1"
        >
          <i className="ri-delete-bin-line" />
        </button>
      ) : (
        <div className="flex items-center gap-1">
          <button
            onClick={handleDelete}
            disabled={deleteNote.isPending}
            className="px-2 py-1 rounded bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-50"
          >
            {deleteNote.isPending ? "..." : "Del"}
          </button>
          <button
            onClick={() => setConfirmDel(false)}
            className="px-2 py-1 rounded bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-muted)] text-xs font-semibold"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
