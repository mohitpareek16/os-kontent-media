import { StageBadge } from "@/components/pipeline/StageBadge";
import { Badge } from "@/components/ui/Badge";
import { ClaimQc2Button } from "@/components/qc/QcRowActions";
import { DEADLINE_TONE_CLASSES, deadlineInfo, formatFullDate } from "@/lib/format";
import { jobRowClass, jobRowTone, TONE_LABELS } from "@/lib/jobRowTone";
import { RushBadge } from "@/components/ui/RushBadge";
import { VIDEO_TYPE_CLASSES, VIDEO_TYPE_ICONS, videoTypeLabel } from "@/lib/videoType";
import { useVideoTypes } from "@/hooks/useVideoTypes";
import type { JobDetail } from "@/types";

/** Round is the pipeline-health signal (docs/05), so it gets a tone, not just
 * a number: 0 is a clean first pass, 3+ is usually a briefing problem. */
function roundBadgeClass(round: number): string {
  if (round >= 3) return "bg-[var(--accent-red-bg)] text-[var(--accent-red)]";
  if (round > 0) return "bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]";
  return "bg-[var(--bg-pill)] text-[var(--text-muted)]";
}

/** The reviewer's queue as a table, with the same columns and the same row
 * tinting as the pipeline table an editor gets.
 *
 * It used to be four stacked lists, each its own card, each with its own
 * heading and hint. A reviewer with work in three of them had to scroll past
 * two to find the third, could not sort or scan down a column, and had no
 * single place that answered "how much is on me". One table under a row of
 * clickable cards answers both, and it is the layout everyone else in the
 * product already knows how to read.
 */
export function QcQueueTable({
  jobs,
  isLoading,
  empty,
  claimable,
  selectedJobId,
  onSelect,
}: {
  jobs: JobDetail[];
  isLoading?: boolean;
  empty: string;
  /** The unrouted group is the one place a row has an action of its own — a
   * reviewer picking up a job routing could not place (docs/05). */
  claimable?: boolean;
  selectedJobId: string | null;
  onSelect: (jobId: string) => void;
}) {
  const { data: videoTypes } = useVideoTypes();
  if (isLoading) {
    return (
      <p className="flex items-center gap-2 p-6 text-sm text-[var(--text-muted)]">
        <i className="ri-loader-4-line animate-spin" /> Loading your queue…
      </p>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="p-10 text-center">
        <i className="ri-inbox-line text-3xl text-[var(--text-dim)]" />
        <p className="mt-2 text-sm font-semibold text-[var(--text-main)]">Nothing here.</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{empty}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-[var(--border-color)] text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
          <tr>
            <th className="p-4">Job</th>
            <th className="p-4">Stage</th>
            <th className="p-4">Deadline</th>
            <th className="p-4">Video type</th>
            <th className="p-4">Client pod</th>
            <th className="p-4">Editor</th>
            <th className="p-4">Rounds</th>
            {claimable && <th className="p-4 text-right">Action</th>}
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const due = deadlineInfo(job.deadline, job.stage);
            return (
              <tr
                key={job.id}
                title={TONE_LABELS[jobRowTone(job)] || undefined}
                onClick={() => onSelect(job.id)}
                className={`cursor-pointer border-b border-[var(--border-color-subtle)] transition-colors hover:bg-[var(--bg-pill)] ${jobRowClass(job)} ${
                  selectedJobId === job.id ? "bg-[var(--bg-pill)]" : ""
                }`}
              >
                <td className="p-4">
                  <span className="block font-semibold text-[var(--text-main)]">{job.title}</span>
                  <span className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-[var(--text-dim)]">
                    {job.code}
                    {job.qc1_flagged_at && (
                      <span className="font-sans font-bold text-[var(--accent-amber)]">
                        <i className="ri-flag-line" /> QC1 flagged
                      </span>
                    )}
                  </span>
                </td>
                <td className="p-4">
                  <StageBadge stage={job.stage} />
                </td>
                <td className="p-4">
                  <span className={`block font-semibold ${DEADLINE_TONE_CLASSES[due.tone]}`}>
                    {due.label}
                  </span>
                  <span className="text-[10px] text-[var(--text-dim)]">
                    {job.deadline ? formatFullDate(job.deadline) : "—"}
                  </span>
                </td>
                <td className="p-4">
                  <span
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold ${VIDEO_TYPE_CLASSES[job.video_type] ?? ""}`}
                  >
                    <i className={VIDEO_TYPE_ICONS[job.video_type] ?? "ri-film-line"} />
                    {videoTypeLabel(job.video_type, videoTypes ?? [])}
                  </span>
                  <RushBadge rush={job.rush} compact />
                </td>
                <td className="p-4 text-[var(--text-muted)]">{job.pod_name}</td>
                <td className="p-4 text-[var(--text-muted)]">
                  {job.editor_name ?? <span className="text-[var(--text-dim)]">No editor yet</span>}
                </td>
                <td className="p-4">
                  <Badge className={roundBadgeClass(job.round)}>
                    {job.round === 0 ? "First pass" : `Round ${job.round}`}
                  </Badge>
                </td>
                {claimable && (
                  /* The claim button is inside a clickable row, so its own
                     click must not also open the panel behind it. */
                  <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <ClaimQc2Button job={job} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
