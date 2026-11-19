import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Input } from "@/components/ui/Input";
import { useUpdateJob } from "@/hooks/useJobs";
import { DEADLINE_LABEL, deadlineBuffer, formatFullDate } from "@/lib/format";
import type { JobDetail } from "@/types";

/** What the "next step" box says on a job that reached an editor's stage
 * without a deadline on it (`awaitingBrief`).
 *
 * Nobody was being told anything before: the editor got a live "Start
 * editing" button on a job with no date, and the TL — who is the only person
 * who can fix it — saw the job sitting quietly in Assigned looking done with.
 * So this says the same fact to both, and gives the lead the one field that
 * clears it rather than sending them off to find a form.
 */
export function BriefGate({
  job,
  canFix,
  tlName,
  isAssignedEditor,
}: {
  job: JobDetail;
  canFix: boolean;
  tlName: string;
  /** The editor whose name is on the job reads a different sentence from
   * anyone else looking at it: for them this is "not yours yet". */
  isAssignedEditor: boolean;
}) {
  const update = useUpdateJob(job.id);
  const [deadline, setDeadline] = useState("");
  const buffer = deadlineBuffer(deadline || null, job.client_deadline);

  if (!canFix) {
    return (
      <p className="flex items-start gap-2 text-sm text-[var(--text-muted)]">
        <i className="ri-calendar-close-line mt-0.5 text-[var(--accent-amber)]" />
        <span>
          {isAssignedEditor ? (
            <>
              Not on your plate yet — this one has no deadline.{" "}
              <strong className="text-[var(--text-main)]">{tlName}</strong> sets one, and then it
              comes to you. Nothing to start against no date.
            </>
          ) : (
            <>
              No deadline on this job yet, so it hasn't gone to the editor.{" "}
              <strong className="text-[var(--text-main)]">{tlName}</strong> has to set one first.
            </>
          )}
        </span>
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 text-sm text-[var(--text-muted)]">
        <i className="ri-calendar-close-line mt-0.5 text-[var(--accent-amber)]" />
        <span>
          {job.editor_name ? (
            <>
              <strong className="text-[var(--text-main)]">{job.editor_name}</strong> is on this one
              but cannot start it: there is no deadline.
            </>
          ) : (
            <>This one has no editor and no deadline on it yet.</>
          )}{" "}
          It stays with you until there is.
        </span>
      </p>

      <div>
        <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
          {DEADLINE_LABEL}
        </label>
        {/* The actual deadline, if this job carries one — the same line the
            hand-off panel shows, for the same reason: the buffer is a
            decision, and it cannot be made against a date you have to go and
            look up. Only a lead's payload carries the field, and only a lead
            reaches this branch. */}
        {job.client_deadline && (
          <p className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-[var(--bg-pill)] px-2.5 py-1.5 text-[11px] text-[var(--text-muted)]">
            <i className="ri-flag-line text-[var(--primary-light)]" />
            Client wants this by{" "}
            <strong className="text-[var(--text-main)]">
              {formatFullDate(job.client_deadline)}
            </strong>
          </p>
        )}
        <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        {buffer && (
          <p
            className={`mt-1 text-[11px] ${
              buffer.days <= 0 ? "text-[var(--accent-amber)]" : "text-[var(--text-dim)]"
            }`}
          >
            {buffer.days <= 0
              ? "No room left between this and the client's date."
              : `Leaves you ${buffer.label.replace(" of buffer", " of room")}.`}
          </p>
        )}
      </div>

      <ErrorNote error={update.error} fallback="Could not set the deadline." />

      <Button
        disabled={!deadline || update.isPending}
        onClick={() => update.mutate({ deadline }, { onSuccess: () => setDeadline("") })}
      >
        <i className="ri-calendar-check-line" /> Set the deadline — hand it over
      </Button>
    </div>
  );
}
