import { QcJobList } from "@/components/qc/QcJobList";
import { AssignReviewerSelect, ClaimQc2Button } from "@/components/qc/QcRowActions";
import type { JobDetail, QcLoad } from "@/types";

interface UnroutedJobsCardProps {
  jobs: JobDetail[];
  /** Total unrouted jobs, from the server — the rows are one capped page. */
  total?: number;
  onSelect: (jobId: string) => void;
  /** Why routing gave up this time, when we can tell from the QC load —
   * "everyone unavailable" and "everyone at the cap" are different problems
   * with different fixes. Owner/TL only; a QC can't read the load table. */
  reason?: string;
  /** A QC looking at their own queue: every row gets a Claim button. */
  claimable?: boolean;
  /** A lead looking at the router: every row gets a reviewer picker. */
  reviewers?: QcLoad[];
}

/** QC2 jobs `route_qc2` could not place. They belong to nobody, so they have
 * to be shown somewhere or they sit invisible forever (docs/05) — the same
 * card on the reviewer's queue and on the router page, each with the way out
 * of the hole that viewer actually has. */
export function UnroutedJobsCard({
  jobs,
  total,
  onSelect,
  reason,
  claimable,
  reviewers,
}: UnroutedJobsCardProps) {
  const rowAction = claimable
    ? (job: JobDetail) => <ClaimQc2Button job={job} />
    : reviewers
      ? (job: JobDetail) => <AssignReviewerSelect job={job} reviewers={reviewers} />
      : undefined;

  return (
    <QcJobList
      title="Unrouted — nobody has these"
      icon="ri-error-warning-line"
      hint={
        claimable
          ? "At QC2 with no reviewer attached. Claim one and it stays yours for every later round — QC2 is sticky."
          : "At QC2 with no reviewer attached. Nobody is reviewing them until someone is put on them."
      }
      accentClass="bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]"
      jobs={jobs}
      total={total}
      empty="Nothing unrouted. Every QC2 job you can see has a reviewer on it."
      onSelect={onSelect}
      rowAction={rowAction}
    >
      {jobs.length > 0 && (
        <div className="mt-1.5 space-y-1 rounded-lg border border-[color-mix(in_srgb,var(--accent-amber)_25%,transparent)] bg-[var(--accent-amber-bg)] px-2.5 py-1.5 text-xs text-[var(--text-muted)]">
          <p>
            <i className="ri-information-line mr-1 text-[var(--accent-amber)]" />
            {reason ??
              "Auto-routing could not place these: every reviewer was either off duty or had already spent their points for the day when the job arrived."}
          </p>
          <p className="text-[var(--text-dim)]">
            Routing doesn't come back for them later — it only runs as a job enters QC2, so one of these needs picking
            up by hand. The points budget is daily, so a job left here is reachable again tomorrow morning.
          </p>
        </div>
      )}
    </QcJobList>
  );
}
