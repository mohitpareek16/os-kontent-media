import { isAxiosError } from "axios";
import { Link, useParams } from "react-router-dom";

import { JobDetailContent } from "@/components/pipeline/JobDetailContent";
import { EditableTitle } from "@/components/pipeline/JobFieldEdit";
import { RevisionCounter } from "@/components/pipeline/RevisionCounter";
import { StageBadge } from "@/components/pipeline/StageBadge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { RushBadge } from "@/components/ui/RushBadge";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useJob, useJobEvents } from "@/hooks/useJobs";

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

  if (isLoading) return <SkeletonRows rows={5} label="Loading job" />;

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
        <EmptyState
          icon={failure.icon}
          title={failure.title}
          description={failure.body}
          action={
            <div className="flex justify-center gap-2">
              {isError && (
                <Button variant="secondary" onClick={() => void refetch()}>
                  <i className="ri-refresh-line" /> Try again
                </Button>
              )}
              <Link to="/?view=pipeline">
                <Button variant={isError ? "ghost" : "secondary"}>Back to pipeline</Button>
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        {/* Breadcrumb — the layout header already carries this page's <h1>. */}
        <nav aria-label="Breadcrumb" className="mb-2 text-[13px] text-[var(--text-dim)]">
          <Link to="/?view=pipeline" className="font-bold text-[var(--primary-text)] hover:underline">
            Pipeline
          </Link>{" "}
          / <span className="font-mono">{job.code}</span>
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <EditableTitle job={job}>
            <h2 className="text-[26px] font-bold leading-tight tracking-tight text-[var(--text-main)]">
              {job.title}
            </h2>
          </EditableTitle>
          <StageBadge stage={job.stage} />
          <RushBadge rush={job.rush} />
          <RevisionCounter round={job.round} />
        </div>
      </div>

      <JobDetailContent job={job} events={events ?? []} page />
    </div>
  );
}
