import { Link } from "react-router-dom";

import { RevisionCounter } from "@/components/pipeline/RevisionCounter";
import { StageBadge } from "@/components/pipeline/StageBadge";
import type { Job } from "@/types";

interface JobCardProps {
  job: Job;
  /** Given, the row opens the job inspector panel in place instead of
   * navigating away — the same behaviour as a pipeline row. A job you're
   * checking on from a list of stuck jobs is the last thing you want to
   * lose your place for. Without it the row stays a plain link. */
  onSelect?: (jobId: string) => void;
}

export function JobCard({ job, onSelect }: JobCardProps) {
  const className =
    "flex w-full items-center justify-between gap-3 px-1 py-3 text-left transition-colors hover:bg-[var(--bg-pill)]";

  const body = (
    <>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[var(--text-main)]">
          <span className="font-mono text-xs text-[var(--text-dim)]">{job.code}</span> — {job.title}
        </p>
        <RevisionCounter round={job.round} />
      </div>
      <StageBadge stage={job.stage} />
    </>
  );

  if (onSelect) {
    return (
      <button type="button" className={className} onClick={() => onSelect(job.id)}>
        {body}
      </button>
    );
  }

  return (
    <Link to={`/jobs/${job.id}`} className={className}>
      {body}
    </Link>
  );
}
