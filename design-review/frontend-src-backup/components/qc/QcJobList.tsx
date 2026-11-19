import type { ReactNode } from "react";

import { StageBadge } from "@/components/pipeline/StageBadge";
import { Badge } from "@/components/ui/Badge";
import { DEADLINE_TONE_CLASSES, deadlineInfo } from "@/lib/format";
import { jobRowClass, jobRowTone, TONE_LABELS } from "@/lib/jobRowTone";
import type { JobDetail } from "@/types";

/** Round is the pipeline-health signal (docs/05), so it gets a tone, not just
 * a number: 0 is a clean first pass, 3+ is usually a briefing problem. */
function roundBadgeClass(round: number): string {
  if (round >= 3) return "bg-[var(--accent-red-bg)] text-[var(--accent-red)]";
  if (round > 0) return "bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]";
  return "bg-[var(--bg-pill)] text-[var(--text-muted)]";
}

function QcJobRow({
  job,
  onSelect,
  action,
}: {
  job: JobDetail;
  onSelect: (jobId: string) => void;
  action?: ReactNode;
}) {
  const due = deadlineInfo(job.deadline, job.stage);
  return (
    /* The row is a wrapper, not a button: an action control can't be nested
     * inside the button that opens the panel. */
    <div
      title={TONE_LABELS[jobRowTone(job)] || undefined}
      className={`flex items-center gap-2 border-t border-[var(--border-color-subtle)] transition-colors hover:bg-[var(--bg-pill)] ${jobRowClass(job)}`}
    >
      <button
        type="button"
        onClick={() => onSelect(job.id)}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 text-left"
      >
        <span className="w-20 shrink-0 font-mono text-[11px] text-[var(--text-dim)]">{job.code}</span>

        <span className="min-w-[9rem] flex-1 truncate text-sm font-semibold text-[var(--text-main)]">
          {job.title}
        </span>

        <StageBadge stage={job.stage} />

        <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
          <i className="ri-group-line" /> {job.pod_name}
        </span>

        <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
          <i className="ri-scissors-cut-line" /> {job.editor_name ?? "No editor yet"}
        </span>

        <span className={`flex items-center gap-1 text-xs font-semibold ${DEADLINE_TONE_CLASSES[due.tone]}`}>
          <i className="ri-calendar-line" /> {due.label}
        </span>

        <Badge className={roundBadgeClass(job.round)}>
          {job.round === 0 ? "First pass" : `Round ${job.round}`}
        </Badge>

        <i className="ri-arrow-right-s-line text-base text-[var(--text-dim)]" />
      </button>

      {action && <div className="shrink-0 pr-4">{action}</div>}
    </div>
  );
}

interface QcJobListProps {
  title: string;
  icon: string;
  /** One line saying what this group *means* — who is holding the job now. */
  hint: string;
  jobs: JobDetail[];
  /** How many jobs are in this group in total, from the server. The rows are
   * one capped page of them, and the header must state the real number —
   * counting `jobs.length` meant the badge counted the download, not the
   * queue. Falls back to the row count when the caller has no total. */
  total?: number;
  /** Shown in place of rows. Always says what would put a job here. */
  empty: string;
  onSelect: (jobId: string) => void;
  /** Tailwind classes for the header icon chip — the group's accent. */
  accentClass?: string;
  /** Extra copy between the hint and the rows (the unrouted explanation). */
  children?: ReactNode;
  /** Per-row control (claim / assign), rendered beside the row button. */
  rowAction?: (job: JobDetail) => ReactNode;
}

/** A titled group of QC jobs. One row definition shared by the reviewer's own
 * queue and the router's unrouted list, so a job reads the same on both. */
export function QcJobList({
  title,
  icon,
  hint,
  jobs,
  total,
  empty,
  onSelect,
  accentClass = "bg-[var(--bg-pill)] text-[var(--text-muted)]",
  children,
  rowAction,
}: QcJobListProps) {
  const count = total ?? jobs.length;
  return (
    <section className="glass-card overflow-hidden">
      <header className="flex items-start gap-3 px-4 py-3.5">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base ${accentClass}`}>
          <i className={icon} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-[var(--text-main)]">{title}</h3>
            <span className="rounded bg-[var(--bg-pill)] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--text-muted)]">
              {count}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{hint}</p>
          {children}
        </div>
      </header>

      {jobs.length === 0 ? (
        <p className="border-t border-[var(--border-color-subtle)] px-4 py-5 text-xs text-[var(--text-muted)]">
          {empty}
        </p>
      ) : (
        <>
          {jobs.map((job) => (
            <QcJobRow key={job.id} job={job} onSelect={onSelect} action={rowAction?.(job)} />
          ))}
          {count > jobs.length && (
            /* Say so rather than implying the rest don't exist. */
            <p className="border-t border-[var(--border-color-subtle)] px-4 py-3 text-[11px] text-[var(--text-dim)]">
              +{count - jobs.length} more in this group — the pipeline table pages through them.
            </p>
          )}
        </>
      )}
    </section>
  );
}
