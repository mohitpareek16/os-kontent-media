import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { useCurrentUser } from "@/hooks/useAuth";
import { useRestoreJob, useScrapJob } from "@/hooks/useJobs";
import { formatDateTime } from "@/lib/format";
import { hasRole, leadsAllPods } from "@/lib/roles";
import type { JobDetail, User } from "@/types";

/** The server's rule, mirrored so the UI doesn't offer a certain 403:
 * scrapping is `check_pod_lead` — the pod's own TL, or the Owner on any pod.
 * An editor or a QC cannot cancel a client commitment; that call belongs to
 * whoever is accountable for the output (docs/04-permissions.md). */
function canScrap(job: JobDetail, user: User | undefined): boolean {
  if (leadsAllPods(user)) return true;
  return hasRole(user, "tl") && job.tl_id === user?.id;
}

const MIN_REASON = 10;

/** Scrapping a project, and undoing it.
 *
 * Deliberately the last thing in the panel and deliberately plain until
 * opened: this is the one control here that ends a client commitment, and a
 * red button sitting next to "Mark delivered" is a mis-click waiting to
 * happen. The reason field is not a formality — it is the whole record of why
 * the work stopped, read months later by someone who wasn't in the call.
 */
export function ScrapJobControl({ job }: { job: JobDetail }) {
  const { data: user } = useCurrentUser();
  const scrap = useScrapJob(job.id);
  const restore = useRestoreJob(job.id);

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const allowed = canScrap(job, user);
  const scrapped = Boolean(job.scrapped_at);

  // Nothing to show a VE or QC on a live job. On a scrapped one everybody
  // sees the record — the banner above explains a job they can no longer act
  // on — and only a lead sees the way back.
  if (!allowed && !scrapped) return null;

  if (scrapped) {
    if (!allowed) return null;
    return (
      <div className="space-y-2">
        <ErrorNote error={restore.error} fallback="Could not restore this project." />
        <Button
          variant="secondary"
          disabled={restore.isPending}
          onClick={() => restore.mutate(undefined)}
        >
          <i className="ri-arrow-go-back-line" /> Restore this project
        </Button>
        <p className="text-xs text-[var(--text-dim)]">
          It comes back at {job.stage === "intake" ? "intake" : `the ${job.stage} stage`}, with its{" "}
          {job.round} revision round{job.round === 1 ? "" : "s"} intact — the work stands where it
          stopped.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-dim)] transition-colors hover:text-[var(--accent-red)]"
      >
        <i className="ri-close-circle-line" /> Scrap this project
      </button>
    );
  }

  const tooShort = reason.trim().length < MIN_REASON;

  return (
    <div className="space-y-3 rounded-xl border border-[color-mix(in_srgb,var(--accent-red)_35%,transparent)] bg-[var(--accent-red-bg)] p-4">
      <div>
        <h4 className="text-sm font-bold text-[var(--text-main)]">Scrap this project</h4>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          It stops counting as work — out of the pipeline, out of everyone's load, out of the
          overdue and first-pass numbers — and stays on the record with your name on it. The
          editor, the QC reviewer and the pod TL are told. It can be restored.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
          Why is it being scrapped?
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Client cancelled the campaign, brief withdrawn, shoot never happened..."
          className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-dim)] focus:border-[var(--primary)]"
        />
        <p className="mt-1 text-[11px] text-[var(--text-dim)]">
          Read months from now by someone who wasn't in the conversation. Name the decision, not
          just the outcome.
        </p>
      </div>

      <ErrorNote error={scrap.error} fallback="Could not scrap this project." />

      <div className="flex flex-wrap gap-2">
        <Button
          variant="danger"
          disabled={scrap.isPending || tooShort}
          onClick={() => scrap.mutate(reason.trim(), { onSuccess: () => setOpen(false) })}
        >
          <i className="ri-close-circle-line" /> Scrap {job.code}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setReason("");
          }}
        >
          Cancel
        </Button>
      </div>

      {tooShort && (
        <p className="text-xs text-[var(--text-dim)]">
          A reason is required — at least {MIN_REASON} characters.
        </p>
      )}
    </div>
  );
}

/** The banner a scrapped job wears at the top of its panel. Separate from the
 * control because everyone who can see the job sees this, including the people
 * who cannot scrap or restore one. */
export function ScrappedBanner({ job }: { job: JobDetail }) {
  if (!job.scrapped_at) return null;
  return (
    <div className="rounded-xl border border-[color-mix(in_srgb,var(--accent-red)_35%,transparent)] bg-[var(--accent-red-bg)] p-4">
      <p className="flex items-center gap-2 text-sm font-bold text-[var(--text-main)]">
        <i className="ri-close-circle-fill text-[var(--accent-red)]" /> This project was scrapped
      </p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        {job.scrapped_by_name ?? "Someone"} scrapped it on {formatDateTime(job.scrapped_at)}, at the{" "}
        {job.stage} stage
        {job.round > 0 && ` after ${job.round} revision round${job.round === 1 ? "" : "s"}`}. No
        further work can be logged against it.
      </p>
      {job.scrap_reason && (
        <p className="mt-2 border-l-2 border-[var(--accent-red)] pl-3 text-sm text-[var(--text-main)]">
          {job.scrap_reason}
        </p>
      )}
    </div>
  );
}

/** Whether the current user may act on scrapping at all — exported so the
 * panel can decide whether to render the section wrapper, without a second
 * copy of the permission rule. */
export function useCanScrap(job: JobDetail): boolean {
  const { data: user } = useCurrentUser();
  return canScrap(job, user);
}
