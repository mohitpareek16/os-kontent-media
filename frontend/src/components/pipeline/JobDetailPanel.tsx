import { Link } from "react-router-dom";

import { JobDetailContent } from "@/components/pipeline/JobDetailContent";
import { EditableTitle } from "@/components/pipeline/JobFieldEdit";
import { StageBadge } from "@/components/pipeline/StageBadge";
import { Drawer } from "@/components/ui/Drawer";
import { RushBadge } from "@/components/ui/RushBadge";
import { SkeletonRows } from "@/components/ui/Skeleton";
import type { JobDetail, JobEvent } from "@/types";

interface JobDetailPanelProps {
  job?: JobDetail;
  events?: JobEvent[];
  open: boolean;
  onClose: () => void;
}

/** The inspector that slides in when you click a row in the pipeline.
 * Takes its data as props — the page owns the fetching (docs/06), which is
 * also what lets the full job page render the identical body. */
export function JobDetailPanel({ job, events, open, onClose }: JobDetailPanelProps) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      header={
        job ? (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] font-semibold text-[var(--text-dim)]">{job.code}</span>
              <StageBadge stage={job.stage} />
              <RushBadge rush={job.rush} />
              <Link
                to={`/jobs/${job.id}`}
                className="ml-auto flex items-center gap-1 text-[13px] font-bold text-[var(--primary-text)] hover:underline"
              >
                Open full page <i className="ri-external-link-line" />
              </Link>
            </div>
            {/* Renaming happens here rather than in a form somewhere below,
                because the typo is read here — the header is where anybody
                who can fix it is already looking. */}
            <EditableTitle job={job} className="mt-2">
              <h2 className="min-w-0 text-[22px] font-bold leading-tight tracking-tight text-[var(--text-main)]">
                {job.title}
              </h2>
            </EditableTitle>
            <p className="text-[13px] text-[var(--text-dim)]">{job.pod_name}</p>
          </div>
        ) : (
          <span className="text-sm text-[var(--text-muted)]">Loading job...</span>
        )
      }
    >
      {job ? (
        <JobDetailContent job={job} events={events ?? []} />
      ) : (
        <SkeletonRows rows={4} label="Loading job" />
      )}
    </Drawer>
  );
}
