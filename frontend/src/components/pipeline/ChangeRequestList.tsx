import { useState } from "react";

import { STAGE_LABELS } from "@/components/pipeline/StageBadge";
import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { useAddJobNote } from "@/hooks/useJobs";
import { formatDateTime } from "@/lib/format";
import type { JobEvent, Stage } from "@/types";

// A handover's reason is written by a person, for the people on the job, and
// belongs in the thread with everything else somebody typed — the feed below
// only ever shows its first line. It carries `reason` rather than `note`,
// same as a scrap does.
const NOTE_EVENTS = ["changes_raised", "note_added", "job_reassigned"];

export function hasNotes(events: JobEvent[]): boolean {
  return events.some((e) => NOTE_EVENTS.includes(e.event_type));
}

/** Everything a human wrote on this job, oldest first, with a box to add to
 * it. Notes ride on the append-only JobEvent log (there is no Comment table
 * — docs/03), so this is a view over the feed filtered to the entries people
 * typed: QC change lists, hand-off notes, and standalone comments.
 *
 * Order is chronological — newest last — because it reads as a conversation:
 * a send-back and the reply to it belong next to each other in the order they
 * happened, and the compose box then sits directly under the message you are
 * answering. The reverse-chronological view of *everything* is the
 * ActivityFeed further down the page. */
export function ChangeRequestList({ jobId, events }: { jobId: string; events: JobEvent[] }) {
  const addNote = useAddJobNote(jobId);
  const [draft, setDraft] = useState("");

  const notes = events.filter((e) => NOTE_EVENTS.includes(e.event_type));

  const post = () => {
    const text = draft.trim();
    if (!text || addNote.isPending) return;
    addNote.mutate(text, { onSuccess: () => setDraft("") });
  };

  return (
    <div className="space-y-3">
      {notes.length === 0 ? (
        <p className="text-sm text-[var(--text-dim)]">
          Nothing written on this job yet — no change requests, a clean run so far. Start the thread
          below.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {notes.map((event, index) => {
            const isChangeRequest = event.event_type === "changes_raised";
            const isHandover = event.event_type === "job_reassigned";
            const from = event.payload.from_stage as Stage | undefined;
            const at = event.payload.stage as Stage | undefined;
            const round = event.payload.round;
            // The last thing said is the live one — and if that's a change
            // list, it's what the editor is working from right now.
            const isLatest = index === notes.length - 1;

            return (
              <li
                key={event.id}
                className={`rounded-lg border p-3 ${
                  isChangeRequest
                    ? "border-[color-mix(in_srgb,var(--accent-red)_30%,transparent)] bg-[var(--accent-red-bg)]"
                    : "border-[var(--border-color)] bg-[var(--bg-card)]"
                } ${isLatest && isChangeRequest ? "ring-1 ring-[color-mix(in_srgb,var(--accent-red)_35%,transparent)]" : ""}`}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`font-bold ${isChangeRequest ? "text-[var(--accent-red)]" : "text-[var(--text-main)]"}`}
                  >
                    <i
                      className={
                        isChangeRequest
                          ? "ri-error-warning-line"
                          : isHandover
                            ? "ri-user-shared-line"
                            : "ri-chat-1-line"
                      }
                    />{" "}
                    {isChangeRequest
                      ? "Changes requested"
                      : isHandover
                        ? `Handed to ${String(event.payload.to_editor_name ?? "another editor")}`
                        : "Note"}
                  </span>
                  {isHandover && (
                    <span className="text-[var(--text-muted)]">
                      from {String(event.payload.from_editor_name ?? "the previous editor")}
                    </span>
                  )}
                  {(from ?? at) && (
                    <span className="text-[var(--text-muted)]">
                      at {STAGE_LABELS[(from ?? at) as Stage] ?? (from ?? at)}
                    </span>
                  )}
                  {typeof round === "number" && round > 0 && (
                    <span className="font-mono text-[var(--text-dim)]">round {round}</span>
                  )}
                  <span className="ml-auto font-mono text-xs text-[var(--text-dim)]">
                    {event.actor_name ?? "Someone"} · {formatDateTime(event.created_at)}
                  </span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-[var(--text-main)]">
                  {String(event.payload.note ?? event.payload.reason ?? "")}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {/* Compose — a comment that doesn't move the job. Any role that can
          open the job can write here (docs/04): a VE mid-edit flagging a
          missing asset, a QC asking a question before deciding. */}
      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-3">
        <label className="mb-1 block text-xs font-bold text-[var(--text-dim)]">
          Add a comment
        </label>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post();
          }}
          rows={2}
          placeholder="Ask a question, flag something, or leave context — without moving the job."
          className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-dim)] focus:border-[var(--primary)]"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[var(--text-dim)]">
            Whoever the job is with right now gets notified. ⌘/Ctrl + Enter to post.
          </p>
          <Button disabled={addNote.isPending || draft.trim().length === 0} onClick={post}>
            <i className={addNote.isPending ? "ri-loader-4-line animate-spin" : "ri-send-plane-line"} />
            {addNote.isPending ? "Posting..." : "Post comment"}
          </Button>
        </div>
        <ErrorNote
          className="mt-2"
          error={addNote.error}
          fallback="Could not post that comment — nothing was saved, try again."
        />
      </div>
    </div>
  );
}
