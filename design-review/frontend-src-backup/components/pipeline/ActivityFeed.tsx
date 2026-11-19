import { STAGE_LABELS } from "@/components/pipeline/StageBadge";
import { formatDateTime, formatFullDate, timeAgo } from "@/lib/format";
import type { JobEvent, Stage } from "@/types";

const EVENT_LABELS: Record<string, string> = {
  intake: "Job created",
  stage_changed: "Moved",
  changes_raised: "Raised changes",
  note_added: "Left a note",
  job_updated: "Edited the job",
  job_reassigned: "Reassigned the job",
  job_scrapped: "Scrapped the project",
  job_restored: "Restored the project",
  qc2_claimed: "Claimed QC2",
  qc1_flag_raised: "Flagged QC1 as not done",
  qc1_flag_cleared: "Cleared the QC1 flag",
};

const EVENT_ICONS: Record<string, string> = {
  intake: "ri-add-circle-line",
  stage_changed: "ri-arrow-right-line",
  changes_raised: "ri-error-warning-line",
  note_added: "ri-chat-1-line",
  job_updated: "ri-pencil-line",
  job_reassigned: "ri-user-shared-line",
  job_scrapped: "ri-close-circle-line",
  job_restored: "ri-arrow-go-back-line",
  qc2_claimed: "ri-user-follow-line",
  qc1_flag_raised: "ri-flag-2-line",
  qc1_flag_cleared: "ri-flag-off-line",
};

/** `job_updated` payloads are keyed by the field that changed — the log has
 * to name the field in the words the UI uses, not the column name. */
const FIELD_LABELS: Record<string, string> = {
  title: "title",
  weight: "weight",
  deadline: "deadline",
  /* Only ever present in a lead's copy of the feed — the server strips this
     key for everyone else (`services/access.py::redact_event_payload`), so an
     editor's timeline has no gap in it, just one fewer line. */
  client_deadline: "actual deadline",
  frame_link: "working file link",
  assigned_editor_id: "editor",
  video_type: "video type",
  rush: "rush",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function formatFieldValue(field: string, raw: unknown): string {
  const value = raw === null || raw === undefined ? "None" : String(raw);
  if (value === "None" || value === "") return "not set";
  // Ids are noise in a feed — the change itself is the news, and the names
  // are on the job above. Same for a long URL.
  if (field === "assigned_editor_id") return "someone else";
  if (field === "frame_link") return "a new link";
  // The server writes Python booleans into the payload, so this reads
  // "rush False → True" without it — a sentence in two languages.
  if (field === "rush") return value === "True" ? "on" : "off";
  if (ISO_DATE.test(value)) return formatFullDate(value);
  return value;
}

/** "deadline 5 Aug 2026 → 8 Aug 2026 · weight standard → heavy" */
function describeUpdate(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .map(([field, change]) => {
      const label = FIELD_LABELS[field] ?? field.replace(/_/g, " ");
      if (change && typeof change === "object" && "to" in (change as Record<string, unknown>)) {
        const { from, to } = change as { from?: unknown; to?: unknown };
        return `${label} ${formatFieldValue(field, from)} → ${formatFieldValue(field, to)}`;
      }
      return label;
    })
    .join(" · ");
}

/** Which event types render their detail line as plain prose rather than as
 * something somebody typed in quotes. */
const UNQUOTED_DETAIL = ["job_updated", "job_reassigned"];

/** "Abhishek → Ram · “out sick until Monday”" — who it moved between, then
 * why. Both names are read off the payload rather than resolved against the
 * job: by the time anyone reads this the job has usually moved on again, and
 * one of the two accounts may have been deactivated. */
function describeReassign(payload: Record<string, unknown>): string {
  const from = typeof payload.from_editor_name === "string" ? payload.from_editor_name : "someone";
  const to = typeof payload.to_editor_name === "string" ? payload.to_editor_name : "someone else";
  const why = firstLine(payload);
  return why ? `${from} → ${to} · “${why}”` : `${from} → ${to}`;
}

/** First line of a note, so the feed says what was said without turning into
 * the change list. The full text lives in the thread above. */
function firstLine(payload: Record<string, unknown>): string | null {
  // A scrap carries `reason` where a comment carries `note`. Same shape of
  // thing to a reader — what someone typed — so it reads the same way here.
  const text = payload.note ?? payload.reason;
  if (typeof text !== "string" || text.trim().length === 0) return null;
  return text.trim().split("\n")[0];
}

export function ActivityFeed({ events }: { events: JobEvent[] }) {
  if (events.length === 0)
    return (
      <p className="text-sm text-[var(--text-dim)]">
        Nothing logged on this job yet — every move, note and edit shows up here.
      </p>
    );

  return (
    <ul className="space-y-1">
      {events
        .slice()
        .reverse()
        .map((event) => {
          const stage = event.payload.stage as Stage | undefined;
          // A scrap is the same shade of bad news as a send-back, and its
          // reason reads exactly like a change list — same treatment for both.
          const isChange =
            event.event_type === "changes_raised" ||
            event.event_type === "job_scrapped" ||
            event.event_type === "qc1_flag_raised";
          const detail =
            event.event_type === "job_updated"
              ? describeUpdate(event.payload)
              : event.event_type === "job_reassigned"
                ? describeReassign(event.payload)
                : [
                      "changes_raised",
                      "note_added",
                      "job_scrapped",
                      "job_restored",
                      "qc1_flag_raised",
                      "qc1_flag_cleared",
                    ].includes(event.event_type)
                  ? firstLine(event.payload)
                  : null;

          return (
            <li
              key={event.id}
              className="flex items-start justify-between gap-3 border-l-2 border-[var(--border-color)] py-1.5 pl-3 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[var(--text-main)]">
                  <i
                    className={`${EVENT_ICONS[event.event_type] ?? "ri-record-circle-line"} mr-1.5 ${
                      isChange ? "text-[var(--accent-red)]" : "text-[var(--text-dim)]"
                    }`}
                  />
                  <span className="font-semibold">{event.actor_name ?? "Someone"}</span>{" "}
                  {EVENT_LABELS[event.event_type] ?? event.event_type.replace(/_/g, " ")}
                  {event.event_type === "stage_changed" && stage && (
                    <span className="text-[var(--primary-light)]">
                      {" "}
                      → {STAGE_LABELS[stage] ?? stage}
                    </span>
                  )}
                  {event.event_type === "job_reassigned" && (
                    <span className="text-[var(--primary-light)]">
                      {" "}
                      → {String(event.payload.to_editor_name ?? "another editor")}
                    </span>
                  )}
                </span>
                {detail && (
                  <span
                    className="mt-0.5 block truncate pl-[22px] text-xs text-[var(--text-muted)]"
                    title={detail}
                  >
                    {UNQUOTED_DETAIL.includes(event.event_type) ? detail : `“${detail}”`}
                  </span>
                )}
              </span>
              <span
                className="shrink-0 font-mono text-xs text-[var(--text-dim)]"
                title={formatDateTime(event.created_at)}
              >
                {timeAgo(event.created_at)}
              </span>
            </li>
          );
        })}
    </ul>
  );
}
