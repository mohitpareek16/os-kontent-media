import { useVideoTypes } from "@/hooks/useVideoTypes";
import { StageBadge, STAGE_LABELS } from "@/components/pipeline/StageBadge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { RushBadge } from "@/components/ui/RushBadge";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useJobs } from "@/hooks/useJobs";
import { DEADLINE_TONE_CLASSES, deadlineInfo, formatFullDate } from "@/lib/format";
import { videoTypeClass, videoTypeLabel } from "@/lib/videoType";
import type { JobDetail, Stage, User } from "@/types";

/** The editor's own home: what to cut next, and when it is due.
 *
 * An editor used to land on the manager's pipeline — status cards, a filter
 * toolbar and an 11-column table — when the only question they have is "what
 * do I do now?". This groups their own jobs (the server already scopes the
 * list to them) into Do now / Up next / With reviewers, with the deadline as
 * the loudest thing on every row. The full table stays one click away.
 *
 * The groups are cut from one bounded page of the editor's open jobs, which is
 * limited by their `max_concurrent_jobs`; if the server says there are more
 * than the page holds, the header says so instead of implying it is the lot. */
const PAGE = 50;

const DO_NOW: Stage[] = ["editing", "revisions"];
const UP_NEXT: Stage[] = ["assigned"];
const WITH_REVIEWERS: Stage[] = ["qc1", "qc2", "final"];

function byDeadline(a: JobDetail, b: JobDetail) {
  const ad = a.deadline ? new Date(a.deadline).getTime() : Number.POSITIVE_INFINITY;
  const bd = b.deadline ? new Date(b.deadline).getTime() : Number.POSITIVE_INFINITY;
  return ad - bd;
}

export function EditorQueue({
  user,
  onSelect,
  onViewAll,
}: {
  user: User;
  onSelect: (jobId: string) => void;
  onViewAll: () => void;
}) {
  const { data: videoTypes } = useVideoTypes();
  const open = useJobs(
    { status: "active", editor_id: user.id, sort_by: "deadline", sort_dir: "asc", page: 1, page_size: PAGE },
    { refetchInterval: 30_000 },
  );
  const delivered = useJobs(
    { status: "delivered", editor_id: user.id, sort_by: "deadline", sort_dir: "desc", page: 1, page_size: 10 },
    { refetchInterval: 60_000 },
  );

  const jobs = open.data?.items ?? [];
  const inStages = (stages: Stage[]) => jobs.filter((j) => stages.includes(j.stage)).sort(byDeadline);
  const doNow = inStages(DO_NOW);
  const upNext = inStages(UP_NEXT);
  const withReviewers = inStages(WITH_REVIEWERS);

  const slots = user.max_concurrent_jobs;
  const used = open.data?.total ?? 0;
  const free = Math.max(0, slots - used);

  const row = (j: JobDetail, primary: boolean) => {
    const due = deadlineInfo(j.deadline, j.stage);
    const accent =
      due.tone === "overdue"
        ? "border-l-[var(--bad-text)]"
        : due.tone === "soon"
          ? "border-l-[var(--warn-text)]"
          : "border-l-[var(--border-color)]";
    const action = j.stage === "revisions" ? "Start revisions" : j.stage === "editing" ? "Continue editing" : "Open";
    return (
      <div
        key={j.id}
        className={`glass-card flex flex-wrap items-center gap-x-5 gap-y-3 border-l-4 px-5 py-4 ${accent}`}
      >
        <div className="min-w-0 flex-1 basis-64">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <StageBadge stage={j.stage} />
            <RushBadge rush={j.rush} />
            <span className="font-mono text-xs text-[var(--text-dim)]">{j.code}</span>
          </div>
          <p className="text-base font-bold text-[var(--text-main)]">{j.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-[var(--text-dim)]">
            {j.pod_name} · {j.channel_name ?? "Not filed"}
            <span className={`inline-flex h-5 items-center rounded-md px-1.5 text-xs font-bold ${videoTypeClass(j.video_type)}`}>
              {videoTypeLabel(j.video_type, videoTypes ?? [])}
            </span>
          </p>
          {j.stage === "revisions" && (
            <p className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-[var(--bad-text)]">
              <i className="ri-arrow-go-back-line" /> Round {j.round} — sent back with changes
            </p>
          )}
        </div>
        <div className="text-right">
          <p className={`num text-[22px] font-bold ${DEADLINE_TONE_CLASSES[due.tone]}`}>{due.label}</p>
          <p className="text-xs text-[var(--text-dim)]">{j.deadline ? formatFullDate(j.deadline) : "No deadline"}</p>
        </div>
        <Button variant={primary ? "primary" : "secondary"} onClick={() => onSelect(j.id)}>
          {action} <i className="ri-arrow-right-line" />
        </Button>
      </div>
    );
  };

  if (open.isLoading) return <SkeletonRows rows={4} label="Loading your queue" />;
  if (open.isError) {
    return <ErrorState what="your queue" error={open.error} onRetry={() => void open.refetch()} />;
  }

  return (
    <div className="space-y-7">
      {/* Slots */}
      <div className="glass-card flex flex-wrap items-center gap-x-6 gap-y-3 p-5">
        <div>
          <p className="text-[13px] font-semibold text-[var(--text-dim)]">Your slots</p>
          <p className="num text-[28px] font-bold leading-tight">
            {used}{" "}
            <span className="text-base font-semibold text-[var(--text-dim)]">
              of {slots} in use
            </span>
          </p>
        </div>
        {slots > 0 && slots <= 12 && (
          <div className="flex gap-1.5" role="img" aria-label={`${used} of ${slots} slots in use`}>
            {Array.from({ length: slots }, (_, i) => (
              <span
                key={i}
                className={`h-2.5 w-7 rounded-full ${i < used ? "bg-[var(--primary)]" : "bg-[var(--border-color)]"}`}
              />
            ))}
          </div>
        )}
        <span className="flex-1" />
        <span
          className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-bold ${
            free > 0 ? "bg-[var(--ok-bg)] text-[var(--ok-text)]" : "bg-[var(--bad-bg)] text-[var(--bad-text)]"
          }`}
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          {free > 0 ? `You can take ${free} more video${free === 1 ? "" : "s"}` : "You're at capacity"}
        </span>
      </div>

      {used > jobs.length && (
        <p className="text-[13px] text-[var(--text-dim)]">
          Showing the {jobs.length} soonest-due of {used} open videos.
        </p>
      )}

      <section aria-labelledby="eq-donow">
        <h2 id="eq-donow" className="mb-2.5 text-sm font-bold text-[var(--text-muted)]">
          Do now{" "}
          <span className="font-medium text-[var(--text-dim)]">
            · {doNow.length} video{doNow.length === 1 ? "" : "s"}, soonest deadline first
          </span>
        </h2>
        {doNow.length > 0 ? (
          <div className="space-y-3">{doNow.map((j, i) => row(j, i === 0))}</div>
        ) : (
          <EmptyState
            icon="ri-checkbox-circle-line"
            title="Nothing waiting on you"
            description="New videos appear here when your TL assigns them."
          />
        )}
      </section>

      {upNext.length > 0 && (
        <section aria-labelledby="eq-next">
          <h2 id="eq-next" className="mb-2.5 text-sm font-bold text-[var(--text-muted)]">
            Up next <span className="font-medium text-[var(--text-dim)]">· assigned, not started</span>
          </h2>
          <div className="space-y-3">{upNext.map((j) => row(j, false))}</div>
        </section>
      )}

      {withReviewers.length > 0 && (
        <details className="glass-card group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 [&::-webkit-details-marker]:hidden">
            <span className="text-sm font-bold">
              With reviewers{" "}
              <span className="font-medium text-[var(--text-dim)]">
                · {withReviewers.length} video{withReviewers.length === 1 ? "" : "s"}
              </span>
            </span>
            <i className="ri-arrow-down-s-line text-lg text-[var(--text-dim)] transition-transform group-open:rotate-180" />
          </summary>
          <div className="divide-y divide-[var(--border-color-subtle)] border-t border-[var(--border-color)]">
            {withReviewers.map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => onSelect(j.id)}
                className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-[var(--bg-card-hover)]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{j.title}</span>
                  <span className="text-xs text-[var(--text-dim)]">
                    {j.pod_name} · {STAGE_LABELS[j.stage]}
                  </span>
                </span>
                <StageBadge stage={j.stage} />
              </button>
            ))}
          </div>
        </details>
      )}

      {(delivered.data?.total ?? 0) > 0 && (
        <details className="glass-card group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 [&::-webkit-details-marker]:hidden">
            <span className="text-sm font-bold">
              Delivered recently{" "}
              <span className="font-medium text-[var(--text-dim)]">· {delivered.data?.total} videos</span>
            </span>
            <i className="ri-arrow-down-s-line text-lg text-[var(--text-dim)] transition-transform group-open:rotate-180" />
          </summary>
          <div className="divide-y divide-[var(--border-color-subtle)] border-t border-[var(--border-color)]">
            {(delivered.data?.items ?? []).map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => onSelect(j.id)}
                className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-[var(--bg-card-hover)]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{j.title}</span>
                  <span className="text-xs text-[var(--text-dim)]">{j.pod_name}</span>
                </span>
                <StageBadge stage={j.stage} />
              </button>
            ))}
          </div>
        </details>
      )}

      <button
        type="button"
        onClick={onViewAll}
        className="text-sm font-bold text-[var(--primary-text)] hover:underline"
      >
        View all my jobs as a table <i className="ri-arrow-right-line" />
      </button>
    </div>
  );
}
