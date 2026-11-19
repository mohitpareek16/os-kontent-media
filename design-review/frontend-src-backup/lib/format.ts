export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "2 Aug 2026" — for fields where the year matters (deadline, received). */
export function formatFullDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "2 Aug, 4:15 pm" — timeline and activity entries, where the time of day
 * is what tells you whether something moved this morning or last week. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The two words the product uses for the two dates, kept here so every
 * screen says the same one.
 *
 * `job.deadline` is "Deadline" to everybody, lead included. It is the date
 * the work is done to and the only one most people are ever shown, so
 * qualifying it only names a second date they are not being given.
 *
 * `job.client_deadline` is the "Actual deadline" — what the client was
 * really promised — and it reaches a TL and the Owner and nobody else. The
 * server is what enforces that; these are only the words above the boxes. */
export const DEADLINE_LABEL = "Deadline";
export const ACTUAL_DEADLINE_LABEL = "Actual deadline";

export type DeadlineTone = "none" | "ok" | "soon" | "overdue" | "done";

export interface DeadlineInfo {
  label: string;
  tone: DeadlineTone;
  /** Negative once the deadline has passed. Null when there is no deadline. */
  daysLeft: number | null;
}

/** One place that decides what a deadline *means* — "3 days left" vs
 * "Overdue by 2 days" — so the table, the panel and any future alert all
 * say the same thing. A delivered job is never late; it's done. */
export function deadlineInfo(deadline: string | null, stage?: string): DeadlineInfo {
  if (!deadline) return { label: "No deadline", tone: "none", daysLeft: null };

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const due = new Date(`${deadline}T00:00:00`);
  const daysLeft = Math.round((due.getTime() - startOfToday.getTime()) / 86_400_000);

  if (stage === "delivered") return { label: "Delivered", tone: "done", daysLeft };
  if (daysLeft < 0)
    return {
      label: `Overdue by ${Math.abs(daysLeft)} ${Math.abs(daysLeft) === 1 ? "day" : "days"}`,
      tone: "overdue",
      daysLeft,
    };
  if (daysLeft === 0) return { label: "Due today", tone: "soon", daysLeft };
  if (daysLeft === 1) return { label: "Due tomorrow", tone: "soon", daysLeft };
  return { label: `${daysLeft} days left`, tone: daysLeft <= 3 ? "soon" : "ok", daysLeft };
}

/** How much room the pod gave itself — the gap between the date the team
 * works to and the date the client was promised.
 *
 * Only ever rendered to a lead, because only a lead is shown the second date
 * at all (`isLead` in lib/roles.ts). Null when either date is missing, which
 * covers every job created before the two were told apart: no buffer is a
 * fact about the dates, not a buffer of zero.
 */
export function deadlineBuffer(
  teamDeadline: string | null,
  clientDeadline: string | null,
): { days: number; label: string } | null {
  if (!teamDeadline || !clientDeadline) return null;
  const team = new Date(`${teamDeadline}T00:00:00`).getTime();
  const client = new Date(`${clientDeadline}T00:00:00`).getTime();
  const days = Math.round((client - team) / 86_400_000);
  if (days <= 0) return { days, label: "no buffer" };
  return { days, label: `${days} ${days === 1 ? "day" : "days"} of buffer` };
}

export const DEADLINE_TONE_CLASSES: Record<DeadlineTone, string> = {
  none: "text-[var(--text-dim)]",
  ok: "text-[var(--text-muted)]",
  soon: "text-[var(--accent-amber)]",
  overdue: "text-[var(--accent-red)]",
  done: "text-[var(--accent-green)]",
};

/** "2h 14m" / "3d 4h" / "45m" — a span of work, from a count of seconds.
 *
 * Two units at most, largest first: "3d 4h 12m 9s" is a stopwatch reading,
 * and nobody deciding whether a cut took too long needs the seconds. Under a
 * minute stays honest rather than rounding to "0m", because a round that
 * really did take forty seconds is a mis-click worth seeing. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const restMinutes = minutes % 60;
    return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}d ${restHours}h` : `${days}d`;
}

/** "3 days ago" / "just now" — relative age for feed entries. */
export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}
