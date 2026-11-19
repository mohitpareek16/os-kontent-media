import { STAGE_LABELS, STAGE_OWNERS, STAGE_SEQUENCE } from "@/components/pipeline/StageBadge";
import { formatDateTime } from "@/lib/format";
import type { Job, JobEvent, Stage } from "@/types";

const OWNER_CLASSES: Record<"TL" | "VE" | "QC", string> = {
  TL: "bg-indigo-500/10 text-indigo-400",
  VE: "bg-teal-500/10 text-teal-500",
  QC: "bg-amber-500/10 text-amber-500",
};

/** When the job entered a stage, and who put it there. */
interface StageEntry {
  at: string;
  actor: string | null;
}

/** When the job last entered each stage and who moved it, read off the
 * append-only event log. Later events overwrite earlier ones on purpose:
 * after a send-back, "QC1" should show the most recent time it landed there
 * — and the person who sent it there that time, not the first time. */
function lastEnteredAt(job: Job, events: JobEvent[]): Partial<Record<Stage, StageEntry>> {
  const entered: Partial<Record<Stage, StageEntry>> = {};
  const intake = events.find((e) => e.event_type === "intake");
  entered.intake = {
    at: intake?.created_at ?? job.created_at,
    actor: intake?.actor_name ?? null,
  };

  for (const event of events) {
    if (event.event_type !== "stage_changed") continue;
    const stage = event.payload.stage;
    if (typeof stage === "string")
      entered[stage as Stage] = { at: event.created_at, actor: event.actor_name };
  }
  return entered;
}

/** The pipeline as a ladder: where the job has been, who moved it each step,
 * where it is, what's still ahead of it. The chronological "what happened"
 * view is the ActivityFeed — this one answers "how far along is this". */
export function JobTimeline({ job, events }: { job: Job; events: JobEvent[] }) {
  const entered = lastEnteredAt(job, events);

  return (
    <ol className="relative space-y-0">
      {STAGE_SEQUENCE.map((stage, index) => {
        const entry = entered[stage];
        const isCurrent = job.stage === stage;
        const isDone = Boolean(entry) && !isCurrent;
        const isLast = index === STAGE_SEQUENCE.length - 1;
        const isRevisionsLoop = stage === "revisions" && job.round > 0;
        // Who is credited depends on the step: intake is authored, every
        // other stage is entered because somebody upstream pushed it there.
        const credit = entry?.actor
          ? stage === "intake"
            ? `Created by ${entry.actor}`
            : `Moved to ${STAGE_LABELS[stage]} by ${entry.actor}`
          : null;

        return (
          <li key={stage} className="flex gap-3">
            {/* Rail */}
            <div className="flex w-5 shrink-0 flex-col items-center">
              <span
                className={`mt-1 flex h-4 w-4 items-center justify-center rounded-full border-2 text-[8px] ${
                  isCurrent
                    ? "border-[var(--primary)] bg-[var(--primary)] text-white shadow-[0_0_0_4px_var(--primary-glow-subtle)]"
                    : isDone
                      ? "border-[var(--accent-green)] bg-[var(--accent-green)] text-white"
                      : "border-[var(--border-color)] bg-[var(--bg-card)]"
                }`}
              >
                {isDone && <i className="ri-check-line" />}
              </span>
              {!isLast && (
                <span
                  className={`w-px flex-1 ${isDone ? "bg-[color-mix(in_srgb,var(--accent-green)_45%,transparent)]" : "bg-[var(--border-color)]"}`}
                />
              )}
            </div>

            {/* Row */}
            <div className={`flex flex-1 items-start justify-between gap-3 pb-4 ${isLast ? "pb-0" : ""}`}>
              <div className="min-w-0">
                <p
                  className={`text-sm font-semibold ${
                    isCurrent
                      ? "text-[var(--primary-light)]"
                      : isDone
                        ? "text-[var(--text-main)]"
                        : "text-[var(--text-dim)]"
                  }`}
                >
                  {STAGE_LABELS[stage]}
                  {isRevisionsLoop && (
                    <span className="ml-1.5 font-mono text-xs text-[var(--accent-red)]">
                      ×{job.round}
                    </span>
                  )}
                  {isCurrent && (
                    <span className="ml-2 rounded bg-[var(--primary-glow-subtle)] px-1.5 py-0.5 text-xs font-bold text-[var(--primary-light)]">
                      Here now
                    </span>
                  )}
                </p>
                <span
                  className={`mt-1 inline-block rounded px-1.5 py-0.5 text-xs font-bold ${OWNER_CLASSES[STAGE_OWNERS[stage]]}`}
                >
                  {STAGE_OWNERS[stage]}
                </span>
              </div>

              {/* When, and by whom — blank for stages the job hasn't reached. */}
              <div className="min-w-0 max-w-[45%] shrink-0 pt-0.5 text-right" title={credit ?? undefined}>
                <span className="block font-mono text-xs text-[var(--text-dim)]">
                  {entry ? formatDateTime(entry.at) : "—"}
                </span>
                {entry && (
                  <span
                    className={`mt-0.5 block truncate text-xs ${
                      entry.actor ? "text-[var(--text-muted)]" : "text-[var(--text-dim)] italic"
                    }`}
                  >
                    {entry.actor ? (
                      <>
                        <i className="ri-user-line mr-1 text-[var(--text-dim)]" />
                        {entry.actor}
                      </>
                    ) : (
                      "system"
                    )}
                  </span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
