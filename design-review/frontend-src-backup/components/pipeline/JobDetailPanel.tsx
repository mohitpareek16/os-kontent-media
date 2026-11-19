import { Link } from "react-router-dom";

import { JobDetailContent } from "@/components/pipeline/JobDetailContent";
import { EditableTitle } from "@/components/pipeline/JobFieldEdit";
import { StageBadge } from "@/components/pipeline/StageBadge";
import { Drawer } from "@/components/ui/Drawer";
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
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-[var(--text-dim)]">{job.code}</span>
              <StageBadge stage={job.stage} />
              <Link
                to={`/jobs/${job.id}`}
                className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--primary-light)]"
              >
                Full page <i className="ri-external-link-line" />
              </Link>
            </div>
            {/* Renaming happens here rather than in a form somewhere below,
                because the typo is read here — the header is where anybody
                who can fix it is already looking. */}
            <EditableTitle job={job} className="mt-1">
              <h2 className="min-w-0 truncate text-base font-extrabold tracking-tight text-[var(--text-main)]">
                {job.title}
              </h2>
            </EditableTitle>
            <p className="text-xs text-[var(--text-muted)]">{job.pod_name}</p>
          </div>
        ) : (
          <span className="text-sm text-[var(--text-muted)]">Loading job...</span>
        )
      }
    >
      {job ? (
        <JobDetailContent job={job} events={events ?? []} />
      ) : (
        <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <i className="ri-loader-4-line animate-spin" /> Loading job...
        </p>
      )}
    </Drawer>
  );
}
