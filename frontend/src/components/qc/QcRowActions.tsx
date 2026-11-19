import { Button } from "@/components/ui/Button";
import { apiErrorMessage } from "@/components/ui/ErrorNote";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useClaimQc2, useUpdateJob } from "@/hooks/useJobs";
import { useVideoTypes } from "@/hooks/useVideoTypes";
import type { JobDetail, QcLoad } from "@/types";

/** Row-height error line. The full `ErrorNote` block would push every other
 * row around, but the server `detail` is the whole point — two reviewers
 * racing for the same job is the realistic failure and it says so. */
function RowError({ error, fallback }: { error: unknown; fallback: string }) {
  if (!error) return null;
  return (
    <span role="alert" className="max-w-[15rem] text-right text-xs font-medium text-[var(--accent-red)]">
      {apiErrorMessage(error, fallback)}
    </span>
  );
}

/** A QC taking an unrouted job. One mutation per row, so the hook lives in
 * the row control rather than the list. */
export function ClaimQc2Button({ job }: { job: JobDetail }) {
  const claim = useClaimQc2(job.id);
  return (
    <div className="flex flex-col items-end gap-1">
      {/* No size overrides: Tailwind can't be relied on to resolve a `px-2.5`
          against the component's own `px-3.5`, so the primitive's size wins
          either way — better to use it than to fight it. */}
      <Button variant="secondary" onClick={() => claim.mutate()} disabled={claim.isPending}>
        <i className="ri-user-add-line" /> {claim.isPending ? "Claiming..." : "Claim"}
      </Button>
      <RowError error={claim.error} fallback="Could not claim this job." />
    </div>
  );
}

/** The lead's side of the same problem: hand an unrouted job to a named
 * reviewer.
 *
 * Every name is offered, including people with no room — naming a reviewer by
 * hand *is* the override, and the server does not refuse it on load. What the
 * option says is what it will cost them, so the override is made with the
 * number in front of you rather than after the fact. */
export function AssignReviewerSelect({ job, reviewers }: { job: JobDetail; reviewers: QcLoad[] }) {
  const update = useUpdateJob(job.id);
  const { data: videoTypes } = useVideoTypes();
  const cost = videoTypes?.find((type) => type.key === job.video_type)?.qc_points;

  return (
    <div className="flex flex-col items-end gap-1">
      <SearchableSelect
        value=""
        aria-label={`Assign a QC2 reviewer to ${job.code}`}
        disabled={update.isPending || reviewers.length === 0 || cost == null}
        onChange={(id) => { if (id) update.mutate({ qc2_reviewer_id: id }); }}
        className="w-64"
        placeholder={update.isPending ? "Assigning..." : cost == null ? "Loading video points..." : `Assign a reviewer... (costs ${cost} pt${cost === 1 ? "" : "s"})`}
        options={reviewers.map((r) => {
          const fits = cost != null && r.points_left >= cost;
          const blockedPodcast = job.video_type === "podcast" && !r.can_take_podcast;
          return { value: r.user_id, label: `${r.name} — ${r.points_left} of ${r.capacity} left${r.employment_type === "part_time" ? " · PT" : ""}${r.available ? "" : " · off duty"}${blockedPodcast ? " · already has today's podcast" : fits ? "" : " · would go over"}` };
        })}
      />
      <RowError error={update.error} fallback="Could not assign that reviewer." />
    </div>
  );
}
