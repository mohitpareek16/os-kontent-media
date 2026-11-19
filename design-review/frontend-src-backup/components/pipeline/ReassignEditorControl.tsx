import { useState } from "react";

import { STAGE_LABELS } from "@/components/pipeline/StageBadge";
import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useToast } from "@/components/ui/Toast";
import { useCurrentUser } from "@/hooks/useAuth";
import { useReassignJob } from "@/hooks/useJobs";
import { usePodMembers } from "@/hooks/usePods";
import { useEditorCapacity, useUsers } from "@/hooks/useUsers";
import { hasRole, leadsAllPods } from "@/lib/roles";
import type { JobDetail, User } from "@/types";

/** The server's rule, mirrored so the UI doesn't offer a certain 403: handing
 * a job to a different editor is `check_pod_lead` — the pod's own TL, or the
 * Owner on any pod. The editor cannot pass their own job on, and the QC
 * cannot move it off the person they are reviewing (docs/04-permissions.md). */
function canReassign(job: JobDetail, user: User | undefined): boolean {
  if (leadsAllPods(user)) return true;
  return hasRole(user, "tl") && job.tl_id === user?.id;
}

/** And the rule about the *job*: there has to be someone to take it off, the
 * work has to still be live, and a delivered job's editor is history rather
 * than an assignment. Same three refusals the route raises. */
function isReassignable(job: JobDetail): boolean {
  return Boolean(job.assigned_editor_id) && !job.scrapped_at && job.stage !== "delivered";
}

const MIN_REASON = 10;

/** Handing a job to a different editor, mid-flight.
 *
 * The thing this exists for is the reason, not the swap: a TL could already
 * change the name on a job, but the record then said "edited the job" and the
 * question everyone asks afterwards — why did this video change hands, and
 * whose week did it come out of — had no answer anywhere. So the note is
 * mandatory and it lands in the timeline next to the handover, with both
 * names in it.
 *
 * The candidate list is **every active editor with a free slot**, not the
 * pod's own. It used to be the pod's members and that emptied the picker on
 * exactly the jobs that needed it — a one-editor pod has nobody else, so the
 * control opened onto "Pick an editor in this pod..." and nothing under it.
 * The server takes an outsider and puts them on the pod as the handover is
 * made (`ensure_assignable_editor`), so the pod is a consequence of the
 * choice rather than a gate in front of it. Their current load rides along —
 * "who can actually take this" is the question being answered at the moment
 * the list is read, and sending a TL to the capacity page to find out is how
 * the job lands on whoever is top of the alphabet.
 */
export function ReassignEditorControl({ job }: { job: JobDetail }) {
  const { data: user } = useCurrentUser();
  const reassign = useReassignJob(job.id);
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [editorId, setEditorId] = useState("");
  const [reason, setReason] = useState("");

  const allowed = canReassign(job, user);
  // Both queries are lead-only endpoints, and only fetched once the form is
  // actually open — the panel renders on every job, and the picker is read
  // on very few of them.
  const { data: activeUsers } = useUsers({ enabled: allowed && open, includeInactive: false });
  const { data: capacity } = useEditorCapacity({ enabled: allowed && open });

  if (!allowed || !isReassignable(job)) return null;

  // Deactivated accounts are already out (`includeInactive: false`) — the
  // server refuses them, so offering one is offering a 400. Same for an
  // editor at their concurrent limit, which is the one thing still worth
  // filtering on.
  const candidates = (activeUsers ?? [])
    .filter((u) => u.role === "ve" && u.id !== job.assigned_editor_id)
    .filter((u) => !capacity || (capacity.find((c) => c.user_id === u.id)?.free_slots ?? 0) > 0);

  const loadOf = (userId: string) => capacity?.find((c) => c.user_id === userId);
  const currentEditor = job.editor_name ?? "the current editor";
  const chosen = candidates.find((c) => c.id === editorId);
  const tooShort = reason.trim().length < MIN_REASON;

  const close = () => {
    setOpen(false);
    setEditorId("");
    setReason("");
  };

  if (!open) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--primary-light)]"
        >
          <i className="ri-user-shared-line" /> Reassign to another editor
        </button>
        <p className="text-[11px] text-[var(--text-dim)]">
          {currentEditor} has this one. Moving it needs a reason, and both of them are told.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-[color-mix(in_srgb,var(--primary)_28%,transparent)] bg-[var(--bg-pill)] p-4">
      <div>
        <h4 className="text-sm font-bold text-[var(--text-main)]">Hand this job to someone else</h4>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          It stays exactly where it is in the pipeline — {STAGE_LABELS[job.stage] ?? job.stage}
          {job.round > 0 && `, round ${job.round}`} — and only the name on it changes.{" "}
          {currentEditor}, the new editor and the pod TL are all told, and the handover goes on
          the job's record with your reason on it.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
          New editor
        </label>
        <SearchableSelect value={editorId} onChange={setEditorId} placeholder="Pick an editor..." options={[{ value: "", label: "Pick an editor..." }, ...candidates.map((editor) => {
          const load = loadOf(editor.id);
          return { value: editor.id, label: `${editor.name}${load ? ` — ${load.open_count} open · ${load.free_slots} free` : ""}` };
        })]} />
        {candidates.length === 0 && (
          <p className="mt-1 text-[11px] text-[var(--text-dim)]">
            Every editor is at their concurrent limit right now. Wait for a delivery to free a
            slot, or raise someone's limit on the admin screen.
          </p>
        )}
        <p className="mt-1 text-[11px] text-[var(--text-dim)]">
          Anyone can take it. An editor who isn't on this pod yet joins it when you hand it over.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
          Why is it moving?
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Out sick until Monday, week is full, brand needs someone certified on it..."
          className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-dim)] focus:border-[var(--primary)]"
        />
        <p className="mt-1 text-[11px] text-[var(--text-dim)]">
          Goes on the timeline with your name on it. This is the only place the handover is ever
          explained — "capacity" tells the next reader nothing.
        </p>
      </div>

      <ErrorNote error={reassign.error} fallback="Could not reassign this job." />

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={reassign.isPending || !editorId || tooShort}
          onClick={() =>
            reassign.mutate(
              { editorId, reason: reason.trim() },
              {
                onSuccess: close,
                // Stays open with the reason typed — a refusal here is
                // usually "that editor is full", which is fixed by picking
                // someone else, not by starting over.
                onError: (error) => toast.notifyError(error, "Could not reassign this job."),
              },
            )
          }
        >
          <i className="ri-user-shared-line" /> Move to {chosen?.name ?? "the new editor"}
        </Button>
        <Button variant="ghost" onClick={close}>
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

/** Whether the current user may hand this job on — exported so the panel can
 * decide whether to render the section wrapper at all, without a second copy
 * of the rule. */
export function useCanReassign(job: JobDetail): boolean {
  const { data: user } = useCurrentUser();
  return canReassign(job, user) && isReassignable(job);
}
