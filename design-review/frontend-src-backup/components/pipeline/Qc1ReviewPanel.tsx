import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { useToast } from "@/components/ui/Toast";
import { useCurrentUser } from "@/hooks/useAuth";
import { useClearQc1Flag, useFlagQc1, useQc1Pass } from "@/hooks/useJobs";
import { formatDateTime, formatDuration } from "@/lib/format";
import { hasRole, leadsAllPods } from "@/lib/roles";
import type { JobDetail, Qc1Outcome, Qc1Pass, User } from "@/types";

/** The server's rule, mirrored so the UI doesn't offer a certain 403: the QC2
 * reviewer this job is routed to, plus the company-wide tier auditing after
 * the fact (`services/qc1_review.py::may_flag_qc1`).
 *
 * Not the pod TL — QC1 is their own review, and marking your own homework is
 * the failure this feature exists to catch. Not the editor either: they have
 * the most to gain from discrediting a review of their own cut. */
function canFlag(job: JobDetail, user: User | undefined): boolean {
  if (leadsAllPods(user)) return true;
  return hasRole(user, "qc") && job.qc2_reviewer_id === user?.id;
}

const MIN_REASON = 10;

/** Long enough that a pass this quick is worth a second look. Not a rule and
 * not enforced anywhere — the server stores no threshold and refuses nothing
 * on it. It only decides whether this panel says "worth a look" out loud,
 * because a reviewer scanning a queue shouldn't have to do arithmetic on two
 * timestamps to notice. */
const QUICK_PASS_SECONDS = 120;

/** What the TL said they were doing, for the two QC1 buttons. */
const OUTCOME_LABEL: Record<Qc1Outcome, string> = {
  approved: "Approved — nothing raised",
  comments_added: "Comments left on Frame.io",
};

/** Did this look like a review, or like a rubber stamp?
 *
 * Two facts and no more: it went through fast, and nobody said anything.
 * Neither is proof — a TL who watched the cut being made has nothing to add
 * and clears it in seconds, quite legitimately — which is why this only
 * *prompts*, and a person makes the call.
 *
 * A pass marked "comments added" is never prompted on. The comments live on
 * Frame.io and this database cannot count them, so the zero here is an
 * artefact of where the team writes things down rather than evidence of
 * anything — and accusing somebody on the strength of it is the one outcome
 * this panel must not produce. */
function looksUnreviewed(pass: Qc1Pass): boolean {
  if (pass.outcome === "comments_added") return false;
  return pass.comments === 0 && pass.seconds !== null && pass.seconds < QUICK_PASS_SECONDS;
}

/** How QC1 went, and the flag if it didn't.
 *
 * The QC2 reviewer is the first person who can tell that a cut was waved
 * through — they are reading it now, un-reviewed — and before this the only
 * thing they could do about it was mention it in a chat nobody logs. So the
 * evidence is on the panel, and the flag is one click away from it.
 */
export function Qc1ReviewPanel({ job }: { job: JobDetail }) {
  const { data: user } = useCurrentUser();
  const { data: pass, isLoading } = useQc1Pass(job.id);
  const flag = useFlagQc1(job.id);
  const clear = useClearQc1Flag(job.id);
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const allowed = canFlag(job, user);
  const flagged = Boolean(job.qc1_flagged_at);
  // The person who cleared QC1 cannot flag their own pass — the server
  // refuses it, so the button is not offered.
  const ownPass = pass?.cleared_by_id === user?.id;

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <i className="ri-loader-4-line animate-spin" /> Reading the log...
      </p>
    );
  }

  if (!pass) {
    return (
      <p className="text-sm text-[var(--text-dim)]">
        This job hasn't been through QC1 yet — there's nothing to show until the pod TL passes it
        to QC2.
      </p>
    );
  }

  const quiet = looksUnreviewed(pass);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Cleared by" value={pass.cleared_by_name ?? "Someone"} />
        <Stat label="When" value={formatDateTime(pass.cleared_at)} />
        <Stat
          label="Sat at QC1 for"
          // Never "0s" from a missing entry event: an unknown duration
          // rendered as an instant one is the exact accusation this panel is
          // used to make (docs/06: don't render numbers you don't have).
          value={pass.seconds === null ? "Not on the log" : formatDuration(pass.seconds)}
          tone={pass.seconds !== null && pass.seconds < QUICK_PASS_SECONDS ? "warn" : undefined}
        />
        <Stat
          label="Notes left here"
          value={pass.comments === 0 ? "None" : String(pass.comments)}
          tone={pass.comments === 0 && pass.outcome !== "comments_added" ? "warn" : undefined}
        />
      </div>

      <div className="min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
          How it was passed
        </span>
        <span className="mt-0.5 block text-sm font-semibold text-[var(--text-main)]">
          {pass.outcome ? (
            <span className="inline-flex items-center gap-1.5">
              <i
                className={
                  pass.outcome === "comments_added"
                    ? "ri-chat-3-line text-[var(--primary-light)]"
                    : "ri-shield-check-line text-[var(--accent-green)]"
                }
              />
              {OUTCOME_LABEL[pass.outcome]}
            </span>
          ) : (
            /* Passed before the two buttons existed. Not "approved" — that is
               a claim the log cannot support, and this panel is read in
               arguments. */
            <span className="text-[var(--text-dim)]">Not recorded — passed before this was asked</span>
          )}
        </span>
      </div>

      <p className="text-[11px] text-[var(--text-dim)]">
        Elapsed time between the cut arriving at QC1 and being passed on, and anything said while it
        was there — including the note attached to the hand-off. Comments written on Frame.io are
        not counted here; the line above is the only record that they exist. Round {pass.round}.
      </p>

      {flagged ? (
        <div className="space-y-2 rounded-xl border border-[color-mix(in_srgb,var(--accent-amber)_40%,transparent)] bg-[var(--accent-amber-bg)] p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-[var(--text-main)]">
            <i className="ri-flag-2-fill text-[var(--accent-amber)]" /> QC1 flagged as not done
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            {job.qc1_flagged_by_name ?? "A reviewer"} raised this on{" "}
            {formatDateTime(job.qc1_flagged_at)} against{" "}
            {job.qc1_flag_tl_name ?? "whoever cleared QC1"}. They and the pod TL were told.
          </p>
          {job.qc1_flag_reason && (
            <p className="border-l-2 border-[var(--accent-amber)] pl-3 text-sm text-[var(--text-main)]">
              {job.qc1_flag_reason}
            </p>
          )}
          {/* Whoever raised it may withdraw it; an admin may dismiss it. The
              TL it names cannot make it go away, which is the point. */}
          {(leadsAllPods(user) || job.qc1_flagged_by_id === user?.id) && (
            <div className="space-y-2 pt-1">
              <ErrorNote error={clear.error} fallback="Could not clear this flag." />
              <Button
                variant="secondary"
                disabled={clear.isPending}
                onClick={() =>
                  clear.mutate(undefined, {
                    onError: (error) => toast.notifyError(error, "Could not clear this flag."),
                  })
                }
              >
                <i className="ri-arrow-go-back-line" />{" "}
                {job.qc1_flagged_by_id === user?.id ? "Withdraw this flag" : "Dismiss this flag"}
              </Button>
              <p className="text-[11px] text-[var(--text-dim)]">
                The job stops being tinted, and both the flag and the clearing stay in the timeline —
                "raised and withdrawn an hour later" is worth being able to read.
              </p>
            </div>
          )}
        </div>
      ) : (
        allowed &&
        !ownPass &&
        !job.scrapped_at && (
          <>
            {quiet && !open && (
              <p className="rounded-lg border border-[color-mix(in_srgb,var(--accent-amber)_30%,transparent)] bg-[var(--accent-amber-bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
                Passed in {formatDuration(pass.seconds ?? 0)} with nothing said. That's usually a
                cut that went straight through — but not always, so it's your call.
              </p>
            )}

            {!open ? (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-dim)] transition-colors hover:text-[var(--accent-amber)]"
              >
                <i className="ri-flag-2-line" /> Flag: QC1 wasn't done
              </button>
            ) : (
              <div className="space-y-3 rounded-xl border border-[color-mix(in_srgb,var(--accent-amber)_40%,transparent)] bg-[var(--accent-amber-bg)] p-4">
                <div>
                  <h4 className="text-sm font-bold text-[var(--text-main)]">
                    Flag this QC1 as not done
                  </h4>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {pass.cleared_by_name ?? "Whoever cleared it"} and the pod TL are told, and the
                    job is marked on every list until it's cleared. Nothing about the job itself
                    moves — carry on with your QC2 review as normal.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
                    What did you find?
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    autoFocus
                    placeholder="Passed in 30 seconds with no notes — the hook is still 4:5, the do-not list says 9:16..."
                    className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-dim)] focus:border-[var(--primary)]"
                  />
                  <p className="mt-1 text-[11px] text-[var(--text-dim)]">
                    This names a colleague, so name what you found. Something they can answer beats
                    "QC1 not done".
                  </p>
                </div>

                <ErrorNote error={flag.error} fallback="Could not raise this flag." />

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    disabled={flag.isPending || reason.trim().length < MIN_REASON}
                    onClick={() =>
                      flag.mutate(reason.trim(), {
                        onSuccess: () => {
                          setOpen(false);
                          setReason("");
                        },
                        // The form stays open with the reason intact — it took
                        // effort to write and is the whole substance of a flag.
                        onError: (error) =>
                          toast.notifyError(error, "Could not raise this flag."),
                      })
                    }
                  >
                    <i className="ri-flag-2-line" /> Raise the flag
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

                {reason.trim().length < MIN_REASON && (
                  <p className="text-xs text-[var(--text-dim)]">
                    A reason is required — at least {MIN_REASON} characters.
                  </p>
                )}
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
        {label}
      </span>
      <span
        className={`mt-0.5 block truncate text-sm font-semibold ${
          tone === "warn" ? "text-[var(--accent-amber)]" : "text-[var(--text-main)]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/** The banner a flagged job wears at the top of its panel, above everything
 * else on it — same treatment as a scrapped one, and for the same reason:
 * every field below it is being read in a different light once you know
 * nobody checked this cut. Separate from the panel because everyone who can
 * see the job sees this, including the people who cannot raise or clear one. */
export function Qc1FlagBanner({ job }: { job: JobDetail }) {
  if (!job.qc1_flagged_at) return null;
  return (
    <div className="rounded-xl border border-[color-mix(in_srgb,var(--accent-amber)_40%,transparent)] bg-[var(--accent-amber-bg)] p-4">
      <p className="flex items-center gap-2 text-sm font-bold text-[var(--text-main)]">
        <i className="ri-flag-2-fill text-[var(--accent-amber)]" /> QC1 was flagged as not done
      </p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        {job.qc1_flagged_by_name ?? "A QC reviewer"} says this cut went past QC1 without a review
        {job.qc1_flag_tl_name ? `, by ${job.qc1_flag_tl_name}` : ""} —{" "}
        {formatDateTime(job.qc1_flagged_at)}.
      </p>
      {job.qc1_flag_reason && (
        <p className="mt-2 border-l-2 border-[var(--accent-amber)] pl-3 text-sm text-[var(--text-main)]">
          {job.qc1_flag_reason}
        </p>
      )}
    </div>
  );
}
