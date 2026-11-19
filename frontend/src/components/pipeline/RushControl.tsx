import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { useToast } from "@/components/ui/Toast";
import { useCurrentUser } from "@/hooks/useAuth";
import { useUpdateJob } from "@/hooks/useJobs";
import { hasRole, leadsAllPods } from "@/lib/roles";
import type { JobDetail, User } from "@/types";

/** The server's rule, mirrored so the UI doesn't offer a certain 403:
 * `PATCH /jobs/{id}` is `check_pod_lead` — the pod's own TL, or the Owner on
 * any pod. */
function canRush(job: JobDetail, user: User | undefined): boolean {
  if (leadsAllPods(user)) return true;
  return hasRole(user, "tl") && job.tl_id === user?.id;
}

/** And the rule about the *job*: a scrapped project takes no edits at all
 * (`_require_live`), and there is nothing left to hurry about one that has
 * already shipped. */
function isRushable(job: JobDetail): boolean {
  return !job.scrapped_at && job.stage !== "delivered";
}

/** Whether the panel should draw a section around this at all — an empty
 * box with a heading reads as a control that is broken rather than absent. */
export function useCanRush(job: JobDetail): boolean {
  const { data: user } = useCurrentUser();
  return canRush(job, user) && isRushable(job);
}

/** Marking work urgent after it is already moving.
 *
 * This is how a rush job actually arrives: not at intake, but on a Tuesday
 * afternoon when the client escalates something already in the pipeline. The
 * flag could only be set at creation before this, so the TL's only options
 * were to tell people in chat — which nothing downstream can read — or to
 * scrap the job and re-create it.
 *
 * The wording is deliberate about what the flag buys, because the word
 * "rush" promises much more than it delivers: QC2 routing may place the job
 * on a reviewer who is out of points, up to 125% of their day
 * (docs/12-qc2-load-model.md). It does not sort a queue, does not jump one,
 * and does not change what the review costs. Left unexplained it becomes the
 * flag on every job, at which point it means nothing at all.
 */
export function RushControl({ job }: { job: JobDetail }) {
  const { data: user } = useCurrentUser();
  const update = useUpdateJob(job.id);
  const toast = useToast();

  if (!canRush(job, user) || !isRushable(job)) return null;

  const toggle = () =>
    update.mutate(
      { rush: !job.rush },
      {
        onError: (error) =>
          toast.notifyError(error, `Could not turn rush ${job.rush ? "off" : "on"}.`),
      },
    );

  return (
    <div className="space-y-2">
      <p className="text-sm text-[var(--text-muted)]">
        {job.rush ? (
          <>
            Marked urgent. Everyone on the job sees it, and QC2 routing may place this on a
            reviewer who is already out of points — up to 125% of their day — rather than leave
            it waiting for somebody to free up.
          </>
        ) : (
          <>
            An ordinary job. Mark it rush when a client escalates one that is already moving: QC2
            routing may then place it on a reviewer who is out of points, up to 125% of their day.
            It does not jump a queue and does not change what the review costs.
          </>
        )}
      </p>

      <ErrorNote error={update.error} fallback="Could not change the rush flag." />

      <Button
        variant={job.rush ? "secondary" : "primary"}
        disabled={update.isPending}
        onClick={toggle}
      >
        <i className={job.rush ? "ri-flashlight-line" : "ri-flashlight-fill"} />
        {job.rush ? "Remove the rush flag" : "Mark this job rush"}
      </Button>

      {/* Says what pressing it does *now*, not only what it means: a job that
          is already sitting at QC2 with nobody on it gets a routing attempt on
          the spot, which is the whole reason a TL reaches for this mid-week. */}
      {!job.rush && job.stage === "qc2" && !job.qc2_reviewer_id && (
        <p className="flex items-start gap-1.5 text-xs text-[var(--text-dim)]">
          <i className="ri-user-search-line mt-0.5" />
          This one is waiting for a reviewer right now — marking it rush re-runs the routing
          immediately, and it lands on the least-loaded reviewer if it fits inside their 125%.
        </p>
      )}

      <p className="text-xs text-[var(--text-dim)]">
        Goes on the record with your name on it — "who called this urgent" is the first question
        asked when somebody ends the day over their budget.
      </p>
    </div>
  );
}
