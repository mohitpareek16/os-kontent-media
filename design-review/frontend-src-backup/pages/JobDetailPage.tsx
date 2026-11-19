import { isAxiosError } from "axios";
import { Link, useParams } from "react-router-dom";

import { JobDetailContent } from "@/components/pipeline/JobDetailContent";
import { EditableTitle } from "@/components/pipeline/JobFieldEdit";
import { RevisionCounter } from "@/components/pipeline/RevisionCounter";
import { StageBadge } from "@/components/pipeline/StageBadge";
import { Button } from "@/components/ui/Button";
import { useJob, useJobEvents } from "@/hooks/useJobs";

const BACK_LINK = (
  <Link
    to="/?view=pipeline"
    className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--primary-light)]"
  >
    <i className="ri-arrow-left-line" /> Back to pipeline
  </Link>
);

/** A stale link, a job in someone else's pod, or a dead API all used to look
 * identical: "Loading..." forever. Each one gets its own answer now. */
function loadFailure(error: unknown): { icon: string; title: string; body: string } {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (status === 404)
    return {
      icon: "ri-file-search-line",
      title: "That job doesn't exist",
      body: "The link may be out of date, or the job was removed. Check the pipeline for the current list.",
    };
  if (status === 403)
    return {
      icon: "ri-lock-2-line",
      title: "You don't have access to this job",
      body: "It belongs to a pod you're not on. Ask that pod's TL to add you if you need it.",
    };
  return {
    icon: "ri-wifi-off-line",
    title: "Couldn't load this job",
    body: "The server didn't answer. Check your connection and try again.",
  };
}

export default function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { data: job, isLoading, isError, error, refetch } = useJob(jobId ?? null);
  const { data: events } = useJobEvents(jobId ?? null);

  if (isLoading)
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <i className="ri-loader-4-line animate-spin" /> Loading...
      </p>
    );

  if (isError || !job) {
    const failure = isError
      ? loadFailure(error)
      : {
          icon: "ri-file-search-line",
          title: "No job to show",
          body: "This link doesn't point at a job. Head back to the pipeline and pick one.",
        };

    return (
      <div className="mx-auto max-w-3xl">
        {BACK_LINK}
        <div className="glass-card p-10 text-center">
          <i className={`${failure.icon} text-3xl text-[var(--accent-red)]`} />
          <h1 className="mt-3 text-lg font-extrabold tracking-tight text-[var(--text-main)]">
            {failure.title}
          </h1>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-[var(--text-muted)]">{failure.body}</p>
          {isError && (
            <Button variant="secondary" className="mt-4" onClick={() => void refetch()}>
              <i className="ri-refresh-line" /> Try again
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="border-b border-[var(--border-color)] pb-5">
        {BACK_LINK}
        <div className="flex flex-wrap items-center gap-3">
          <EditableTitle job={job}>
            <h1 className="text-2xl font-extrabold tracking-tight text-[var(--text-main)]">
              <span className="font-mono text-lg text-[var(--text-dim)]">{job.code}</span> —{" "}
              {job.title}
            </h1>
          </EditableTitle>
          <StageBadge stage={job.stage} />
          <RevisionCounter round={job.round} />
        </div>
      </div>

      <JobDetailContent job={job} events={events ?? []} />
    </div>
  );
}
