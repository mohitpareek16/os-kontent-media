import type { JobDetail } from "@/types";

/** What a job row is *saying* at a glance, before you read a word of it.
 *
 * Four states earn a colour, and only four, because a table where every row is
 * tinted is a table with no signal in it:
 *
 * - **scrapped** — dead work. Muted and struck through: present in the record,
 *   out of the flow.
 * - **qc1_flagged** — a reviewer says this one never got a real QC1. Amber,
 *   the colour QC already wears everywhere else in the product.
 * - **delivered** — done, gone to the client. Green.
 * - **mine** — waiting on *you* right now. Kontent purple, the brand's own
 *   primary, because "what do I do next" is the question this product exists
 *   to answer.
 *
 * The order matters and is not alphabetical: a scrapped job may also be
 * delivered-looking or still carry your name, and dead beats both. A flag
 * outranks both `delivered` and `mine` on purpose — a skipped QC1 on a video
 * that has already gone to the client is the case a lead most needs to catch,
 * and it would be exactly the one the green tint hid. The rows it displaces
 * lose no information: the table still prints "Waiting on you" from
 * `is_mine`, and the stage column still says Delivered.
 *
 * One definition, used by the pipeline table, the board cards and the QC
 * lists. The third copy of a colour decision is where the three drift apart
 * (docs/06-frontend-rules.md).
 */
export type JobRowTone = "scrapped" | "qc1_flagged" | "delivered" | "mine" | "none";

export function jobRowTone(job: JobDetail): JobRowTone {
  if (job.scrapped_at) return "scrapped";
  if (job.qc1_flagged_at) return "qc1_flagged";
  if (job.stage === "delivered") return "delivered";
  if (job.is_mine) return "mine";
  return "none";
}

/** Table-row classes. The left border is what survives at a glance down a
 * long table; the tint alone is too subtle at 4% and too loud at 20%. */
const ROW_CLASSES: Record<JobRowTone, string> = {
  scrapped: "bg-[var(--bg-pill)] border-l-2 border-l-[var(--text-dim)] opacity-60",
  qc1_flagged: "bg-[var(--accent-amber-bg)] border-l-2 border-l-[var(--accent-amber)]",
  delivered: "bg-[var(--accent-green-bg)] border-l-2 border-l-[var(--accent-green)]",
  mine: "bg-[var(--primary-glow-subtle)] border-l-2 border-l-[var(--primary)]",
  none: "border-l-2 border-l-transparent",
};

/** Card classes for the board, where rows are boxes rather than stripes — the
 * whole border carries the state instead of one edge. */
const CARD_CLASSES: Record<JobRowTone, string> = {
  scrapped: "bg-[var(--bg-pill)] border-[var(--border-color)] opacity-80",
  qc1_flagged: "bg-[var(--accent-amber-bg)] border-amber-500/40",
  delivered: "bg-[var(--accent-green-bg)] border-emerald-500/30",
  mine: "bg-[var(--primary-glow-subtle)] border-[color-mix(in_srgb,var(--primary)_45%,transparent)]",
  none: "bg-[var(--bg-panel-solid)] border-[var(--border-color-subtle)]",
};

export function jobRowClass(job: JobDetail): string {
  return ROW_CLASSES[jobRowTone(job)];
}

export function jobCardClass(job: JobDetail): string {
  return CARD_CLASSES[jobRowTone(job)];
}

/** The one-word legend a tinted row is claiming, for the key above a table
 * and for `title` text on a row. `none` has nothing to say. */
export const TONE_LABELS: Record<JobRowTone, string> = {
  scrapped: "Scrapped",
  qc1_flagged: "QC1 flagged as not done",
  delivered: "Delivered",
  mine: "Waiting on you",
  none: "",
};
