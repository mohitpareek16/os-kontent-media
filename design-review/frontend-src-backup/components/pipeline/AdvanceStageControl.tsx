import { useState } from "react";

import { BriefGate } from "@/components/pipeline/BriefGate";
import { STAGE_HINTS } from "@/components/pipeline/StageBadge";
import { stageHolderLabel } from "@/components/pipeline/stageHolder";
import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Input } from "@/components/ui/Input";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useToast } from "@/components/ui/Toast";
import { useCurrentUser } from "@/hooks/useAuth";
import { DEADLINE_LABEL, deadlineBuffer, formatFullDate } from "@/lib/format";
import { isAdmin, isLead, leadsAllPods } from "@/lib/roles";
import { useAdvanceJob } from "@/hooks/useJobs";
import { useEditorCapacity, useUsers } from "@/hooks/useUsers";
import { allowedNextStagesFor, awaitingBrief, hasOverrideMoves } from "@/lib/stageTransitions";
import type { JobDetail, Qc1Outcome, Stage } from "@/types";

/** Labelled as the action the person is taking, not as the stage name —
 * "Mark as edited, send for QC" is what an editor is actually doing when
 * the job moves editing → QC1. */
const ACTION_LABELS: Record<Stage, string> = {
  intake: "Back to intake",
  assigned: "Assign to editor",
  editing: "Start editing",
  qc1: "Mark as edited — send for QC",
  qc2: "Pass QC1 — send to QC2",
  revisions: "Send back with changes",
  final: "Clear QC2 — send to final check",
  delivered: "Mark delivered",
};

const ACTION_ICONS: Record<Stage, string> = {
  intake: "ri-arrow-go-back-line",
  assigned: "ri-user-add-line",
  editing: "ri-scissors-cut-line",
  qc1: "ri-send-plane-line",
  qc2: "ri-shield-check-line",
  revisions: "ri-arrow-go-back-line",
  final: "ri-check-double-line",
  delivered: "ri-rocket-line",
};

/** The same two moves read differently on a revision round, and the button is
 * the only place anyone finds out which one they're making. Re-entering the
 * edit bay is "pick the changes up"; leaving it is a re-submission, not a
 * first cut — and from there it always goes back to QC1, never straight to
 * whoever sent it back (docs/05). */
const RESUME_LABEL = "Start on the changes";
const RESUBMIT_LABEL = "Re-submit fixed cut for QC";

/** A send-back returns to the desk that raised it, so the re-submit button
 * says which one — the editor is not "passing QC1", they are handing the fix
 * back to the reviewer who wrote the change list. */
const RESUBMIT_LABELS: Partial<Record<Stage, string>> = {
  qc2: "Re-submit fixed cut to QC2",
  final: "Re-submit fixed cut for the final check",
};

export function AdvanceStageControl({ job }: { job: JobDetail }) {
  const { data: user } = useCurrentUser();
  const advance = useAdvanceJob(job.id);
  const toast = useToast();
  const canAssign = isLead(user);
  // Who may finish the hand-off: the same authority the server checks on
  // `PATCH /jobs/{id}` — the pod's own TL, or the company-wide tier.
  const canFixBrief = canAssign && (leadsAllPods(user) || !job.tl_id || job.tl_id === user?.id);
  // Active accounts only: a deactivated editor was still in this list, and
  // picking one produced a 400 from the server with nothing on screen to
  // explain it. Same guard `ReassignEditorControl` already uses.
  const { data: users } = useUsers({ enabled: canAssign, includeInactive: false });
  const { data: capacity } = useEditorCapacity({ enabled: canAssign });
  // Whoever still has a slot under their cap. A full editor is left out
  // rather than shown and refused on save — see `ensure_assignable_editor`.
  const freeSlots = new Map(capacity?.map((c) => [c.user_id, c.free_slots]) ?? []);
  const editors = (users?.filter((u) => u.role === "ve") ?? []).filter(
    (u) => !capacity || (freeSlots.get(u.id) ?? 0) > 0,
  );
  const everyEditorIsFull = Boolean(capacity?.length) && editors.length === 0;

  /* Deliberately empty rather than seeded from `job.frame_link`. The box asks
   * for the editor's review link, and pre-filling it with whatever link the
   * job already carries — at intake, the client's raw folder — meant an editor
   * who pasted nothing still looked like they had submitted a cut, and one who
   * pasted something was editing a field they never asked to open. */
  const [frameLink, setFrameLink] = useState("");
  const [editorId, setEditorId] = useState("");
  const [deadline, setDeadline] = useState(job.deadline ?? "");
  /* How much room the date in the box leaves against the promise. Recomputed
     as it is typed, from the draft rather than from the saved job, because
     the number is only useful while the choice is still being made. */
  const buffer = deadlineBuffer(deadline || null, job.client_deadline);
  const [note, setNote] = useState("");
  const [sendingBack, setSendingBack] = useState(false);
  const [override, setOverride] = useState(false);
  /* Starting an edit needs nothing typed, so the fields for it start folded
   * away behind a link — see the `startingEdit` branch below. */
  const [showExtras, setShowExtras] = useState(false);

  const nextStages = allowedNextStagesFor(job, user, { override });
  const overrideAvailable = isAdmin(user) && hasOverrideMoves(job, user);

  /* An admin can still take a move that isn't theirs — a job stuck on
   * somebody who is unreachable has to be movable — but only by saying so
   * first. Hidden by default, and never offered to a TL. */
  const overrideToggle = overrideAvailable ? (
    <button
      type="button"
      onClick={() => setOverride((on) => !on)}
      className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-dim)] transition-colors hover:text-[var(--text-muted)]"
    >
      <i className={override ? "ri-lock-unlock-line" : "ri-lock-line"} />
      {override ? "Hide the moves that aren't yours" : "Admin override — move it anyway"}
    </button>
  ) : null;

  /* Half a hand-off — an editor's stage with no deadline on the job. Its own
   * box rather than the generic "nothing for you to do here", because there
   * *is* something to do and exactly one person can do it (docs/05). */
  if (awaitingBrief(job) && nextStages.length === 0) {
    return (
      <div className="space-y-2">
        <BriefGate
          job={job}
          canFix={canFixBrief}
          tlName={stageHolderLabel(job)}
          isAssignedEditor={job.assigned_editor_id === user?.id}
        />
        {overrideToggle}
      </div>
    );
  }

  if (nextStages.length === 0) {
    const holder = stageHolderLabel(job);
    return (
      <div className="space-y-2">
        <p className="flex items-start gap-2 text-sm text-[var(--text-muted)]">
          <i
            className={`mt-0.5 ${job.stage === "delivered" ? "ri-checkbox-circle-fill text-[var(--accent-green)]" : "ri-time-line text-[var(--text-dim)]"}`}
          />
          <span>
            {STAGE_HINTS[job.stage]}
            {job.stage !== "delivered" && (
              <>
                {" "}
                Nothing for you to do here — it sits with{" "}
                <strong className="text-[var(--text-main)]">{holder}</strong>. You can still leave a
                comment below.
              </>
            )}
          </span>
        </p>
        {overrideToggle}
      </div>
    );
  }

  const forwardStages = nextStages.filter((s) => s !== "revisions");
  const canSendBack = nextStages.includes("revisions");
  const needsEditor = nextStages.includes("assigned");
  const resumingChanges = job.stage === "revisions";
  const isResubmit = job.stage === "editing" && job.round > 0;

  const actionLabel = (stage: Stage) => {
    if (stage === "editing" && resumingChanges) return RESUME_LABEL;
    // Leaving the edit bay goes back to whoever asked for the changes, so the
    // button has to name them — "Pass QC1" is the TL's label for a move the
    // editor is making, and to the wrong desk.
    if (job.stage === "editing" && stage !== "qc1") return RESUBMIT_LABELS[stage] ?? RESUBMIT_LABEL;
    if (stage === "qc1" && isResubmit) return RESUBMIT_LABEL;
    return ACTION_LABELS[stage];
  };

  const actionIcon = (stage: Stage) =>
    job.stage === "editing" ? ACTION_ICONS.qc1 : ACTION_ICONS[stage];

  // The stage machine only ever offers one forward move, so the note on a
  // forward transition has exactly one reader: whoever the job lands with.
  // Say their name on the label — "optional note" tells you nothing about
  // whether it's worth writing.
  const forwardStage = forwardStages[0];
  const forwardReader = !forwardStage
    ? null
    : forwardStage === "assigned"
      ? (editors.find((e) => e.id === editorId)?.name ?? "the editor you pick")
      : stageHolderLabel(job, forwardStage);
  // A VE starting their own edit, or a TL delivering their own pod's job, is
  // the "next person" — don't tell them to write a note to themselves.
  const readerIsSelf = Boolean(user?.name && forwardReader === user.name);
  const sendBackReader = job.editor_name ?? "the editor";

  const submit = (stage: Stage, qc1Outcome?: Qc1Outcome) =>
    advance.mutate(
      {
        stage,
        frame_link: frameLink.trim() || undefined,
        assigned_editor_id: stage === "assigned" ? editorId : undefined,
        deadline: stage === "assigned" ? deadline || undefined : undefined,
        note: note.trim() || undefined,
        qc1_outcome: qc1Outcome,
      },
      {
        onSuccess: () => {
          setNote("");
          setSendingBack(false);
        },
        // The panel keeps the note and the link so the move can be retried
        // once whatever the server objected to is fixed.
        onError: (error) => toast.notifyError(error, "Could not move the job."),
      },
    );

  /* The one move that needs nothing typed into it. An editor picking a job up
   * has no cut to link and nobody to write to yet — both of those belong to
   * the move *out* of the edit bay — so the button leads and the fields fold
   * away behind it. They are still one click away for the rare start that does
   * have something to say. */
  const startingEdit =
    !sendingBack && !canSendBack && forwardStages.length === 1 && forwardStage === "editing";

  const frameLinkField = (
    <div>
      <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
        Frame.io / working file link
      </label>
      <Input
        placeholder="https://f.io/..."
        value={frameLink}
        onChange={(e) => setFrameLink(e.target.value)}
      />
    </div>
  );

  /* A note rides along with *every* move, not only a send-back — a TL passing
   * QC1 forward had no way to say why until now. */
  const noteField =
    sendingBack || forwardStage ? (
      <div>
        <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
          {sendingBack ? (
            <>Change list for {sendBackReader}</>
          ) : readerIsSelf ? (
            <>Note on the job (optional)</>
          ) : (
            <>Note for {forwardReader} (optional)</>
          )}
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={sendingBack ? 4 : 2}
          autoFocus={sendingBack}
          placeholder={
            sendingBack
              ? "What needs to change? Timestamps help — 0:14 lower third off-brand, 0:42 audio dips..."
              : readerIsSelf
                ? "Anything worth putting on the record as you move this"
                : `Anything ${forwardReader} should know before they pick this up`
          }
          className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-dim)] focus:border-[var(--primary)]"
        />
        {!sendingBack && (
          <p className="mt-1 text-[11px] text-[var(--text-dim)]">
            {readerIsSelf ? (
              <>Goes on the change list below with your name on it — everyone on the job sees it.</>
            ) : (
              <>
                Goes on the change list below with your name on it, and is the first thing{" "}
                {forwardReader} sees on the job.
              </>
            )}
          </p>
        )}
      </div>
    ) : null;

  if (startingEdit) {
    return (
      <div className="space-y-3">
        <ErrorNote
          error={advance.error}
          fallback="Could not move the job — the server rejected that transition."
        />

        <Button disabled={advance.isPending} onClick={() => submit("editing")}>
          <i className={actionIcon("editing")} />
          {actionLabel("editing")}
        </Button>

        <button
          type="button"
          onClick={() => setShowExtras((on) => !on)}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-dim)] transition-colors hover:text-[var(--text-muted)]"
        >
          <i className={showExtras ? "ri-subtract-line" : "ri-add-line"} />
          {showExtras ? "Hide the note and link" : "Add a note or link"}
        </button>

        {showExtras && (
          <div className="space-y-3">
            {frameLinkField}
            {noteField}
          </div>
        )}

        {overrideToggle}
      </div>
    );
  }

  /* ---------------------------------------------------------------- QC1
   * QC1 has two endings that both go forward, and the product used to offer
   * one button for them: "Pass QC1 — send to QC2", sitting next to a
   * send-back of equal weight. That drew the desk wrong. Roughly 98 in 100
   * cuts go forward, and the interesting question about the ones that do is
   * not *whether* they passed but whether anybody actually watched them —
   * which is exactly what the QC2 reviewer downstream cannot tell
   * (`services/qc1_review.py`).
   *
   * So the forward move is split in two, and the comments are not collected
   * here: this team writes them on Frame.io, as voice notes against
   * timestamps, and mirroring them into a textarea would be asking for the
   * same thing twice and getting two versions of it (docs/03). The button
   * records that they exist. The send-back is still one click, just no longer
   * shouting at the 98%.
   */
  if (job.stage === "qc1" && forwardStages.includes("qc2")) {
    return (
      <div className="space-y-3">
        <ErrorNote
          error={advance.error}
          fallback="Could not move the job — the server rejected that transition."
        />

        {sendingBack ? (
          <>
            {noteField}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                disabled={advance.isPending || note.trim().length === 0}
                onClick={() => submit("revisions")}
              >
                <i className="ri-arrow-go-back-line" /> Send back to {sendBackReader}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setSendingBack(false);
                  setNote("");
                }}
              >
                Cancel
              </Button>
            </div>
            {note.trim().length === 0 && (
              <p className="text-xs text-[var(--text-dim)]">
                A send-back needs a change list — the editor picks the job up from this note.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Button disabled={advance.isPending} onClick={() => submit("qc2", "approved")}>
                <i className="ri-shield-check-line" /> QC1 Approved
              </Button>
              <Button
                variant="secondary"
                disabled={advance.isPending}
                onClick={() => submit("qc2", "comments_added")}
              >
                <i className="ri-chat-3-line" /> QC1 Comments Added
              </Button>
            </div>

            <p className="text-[11px] text-[var(--text-dim)]">
              Both send the cut on to QC2. Pick <strong>Comments added</strong> when you have left
              notes on Frame.io — it is the only way QC2 can tell a reviewed cut from a waved-through
              one, and it keeps a real review off the flag list.
            </p>

            {/* Folded away rather than removed: a hand-off line to the QC2
                reviewer is worth having, and roughly nobody writes one. */}
            <button
              type="button"
              onClick={() => setShowExtras((on) => !on)}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-dim)] transition-colors hover:text-[var(--text-muted)]"
            >
              <i className={showExtras ? "ri-subtract-line" : "ri-add-line"} />
              {showExtras ? "Hide the note" : `Add a note for ${forwardReader}`}
            </button>

            {showExtras && noteField}

            {/* The 2%. A text link, not a third button: it is the rare move,
                and drawing it as an equal reads as an equally likely one. */}
            {canSendBack && (
              <button
                type="button"
                onClick={() => setSendingBack(true)}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-dim)] transition-colors hover:text-[var(--accent-red)]"
              >
                <i className="ri-arrow-go-back-line" /> Send back to {sendBackReader} instead
              </button>
            )}
          </>
        )}

        {overrideToggle}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {frameLinkField}

      {needsEditor && everyEditorIsFull && (
        <p className="flex items-start gap-1.5 rounded-lg bg-[var(--accent-amber-bg)] px-3 py-2 text-xs font-medium text-[var(--accent-amber)]">
          <i className="ri-user-forbid-line mt-px" />
          Every editor is at their limit right now — this one waits in intake until somebody
          delivers.
        </p>
      )}

      {needsEditor && !everyEditorIsFull && (
        <>
          <SearchableSelect value={editorId} onChange={setEditorId} placeholder="Assign to editor..." options={[{ value: "", label: "Assign to editor..." }, ...editors.map((editor) => ({ value: editor.id, label: `${editor.name}${capacity ? ` — ${freeSlots.get(editor.id) ?? 0} free` : ""}` }))]} />
          {/* Both halves of the hand-off in one move. Assigning without a
              date used to look finished and wasn't: the job sat in the
              editor's queue with "No deadline" where the date goes and
              nobody owning the gap (`isBriefed`). */}
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
              {DEADLINE_LABEL}
            </label>
            {/* The actual deadline, read-only, right above the box where
                the working date is chosen. Choosing a buffer is the whole
                point of the pair, and it is not a decision anybody can make
                from memory of a brief they read last week. Present only when
                the job carries one and only in a lead's payload, so it simply
                does not render for anyone else. */}
            {job.client_deadline && (
              <p className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-[var(--bg-pill)] px-2.5 py-1.5 text-[11px] text-[var(--text-muted)]">
                <i className="ri-flag-line text-[var(--primary-light)]" />
                Client wants this by{" "}
                <strong className="text-[var(--text-main)]">
                  {formatFullDate(job.client_deadline)}
                </strong>
              </p>
            )}
            <Input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-[var(--text-dim)]">
              This is the date the editor sees. They can't start until it's set — without it
              the job stays with you.
            </p>
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
        </>
      )}

      {noteField}

      <ErrorNote
        error={advance.error}
        fallback="Could not move the job — the server rejected that transition."
      />

      <div className="flex flex-wrap gap-2">
        {!sendingBack &&
          forwardStages.map((stage) => (
            <Button
              key={stage}
              disabled={advance.isPending || (stage === "assigned" && (!editorId || !deadline))}
              onClick={() => submit(stage)}
            >
              <i className={actionIcon(stage)} />
              {actionLabel(stage)}
            </Button>
          ))}

        {canSendBack && !sendingBack && (
          <Button variant="secondary" onClick={() => setSendingBack(true)}>
            <i className={ACTION_ICONS.revisions} /> {ACTION_LABELS.revisions}
          </Button>
        )}

        {sendingBack && (
          <>
            <Button
              variant="danger"
              disabled={advance.isPending || note.trim().length === 0}
              onClick={() => submit("revisions")}
            >
              <i className="ri-arrow-go-back-line" /> Send back to {sendBackReader}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setSendingBack(false);
                setNote("");
              }}
            >
              Cancel
            </Button>
          </>
        )}
      </div>

      {sendingBack && note.trim().length === 0 && (
        <p className="text-xs text-[var(--text-dim)]">
          A send-back needs a change list — the editor picks the job up from this note.
        </p>
      )}

      {override && (
        <p className="flex items-start gap-1.5 text-[11px] text-[var(--accent-amber)]">
          <i className="ri-lock-unlock-line mt-px" />
          These moves belong to {stageHolderLabel(job)}. Making one puts your name on the record
          for it.
        </p>
      )}
      {overrideToggle}
    </div>
  );
}
