import type { Job, Stage, User } from "@/types";
import { hasRole, leadsAllPods } from "@/lib/roles";

// Mirrors backend/app/services/stage_machine.py — the backend is the real
// enforcement, this only keeps the UI from ever offering an invalid move.
const FORWARD: Partial<Record<Stage, Stage>> = {
  intake: "assigned",
  assigned: "editing",
  editing: "qc1",
  qc1: "qc2",
  qc2: "final",
  final: "delivered",
};
const SEND_BACK_ELIGIBLE: Stage[] = ["qc1", "qc2", "final"];

/** Where a re-cut goes when it leaves the edit bay: back to the desk that
 * asked for the changes, and to QC1 when nobody has sent it back yet.
 * `resubmit_stage()` on the server. */
export function resubmitStage(sentBackFrom: Job["sent_back_from"]): Stage {
  return sentBackFrom && SEND_BACK_ELIGIBLE.includes(sentBackFrom) ? sentBackFrom : "qc1";
}

export function allowedNextStages(stage: Stage, sentBackFrom: Job["sent_back_from"] = null): Stage[] {
  // Back through the edit bay, not straight to QC: a revision round needs a
  // starting gun as well as a finish line, or the time it took is unknowable.
  if (stage === "revisions") return ["editing"];
  if (stage === "delivered") return [];
  if (stage === "editing") return [resubmitStage(sentBackFrom)];
  const forward = FORWARD[stage];
  const next = forward ? [forward] : [];
  return SEND_BACK_ELIGIBLE.includes(stage) ? [...next, "revisions"] : next;
}

/* Whose desk each open stage sits on — `STAGE_OWNER_ROLE` in the same backend
 * module. Every stage before delivery belongs to exactly one role, and that
 * is who the buttons for it are drawn for. */
const STAGE_OWNER_ROLE: Partial<Record<Stage, "tl" | "ve" | "qc">> = {
  intake: "tl",
  assigned: "ve",
  editing: "ve",
  qc1: "tl",
  qc2: "qc",
  revisions: "ve",
  final: "tl",
};

/** Has the hand-off actually happened — an editor *and* a deadline?
 * `is_briefed()` in the backend's stage_machine.py, which is the enforcement.
 *
 * Half a hand-off is not a hand-off: a job with a name on it and no date
 * gives the editor nothing to work against, and it is the TL who has to
 * finish it. Until they do, the job is not the editor's move — no Mine, no
 * purple row, no "Start editing" button. */
export function isBriefed(job: Pick<Job, "assigned_editor_id" | "deadline">): boolean {
  return Boolean(job.assigned_editor_id && job.deadline);
}

/** The job is standing at an editor's stage with half a hand-off — the state
 * this whole rule exists to name. The TL's move, and the only thing that
 * clears it is finishing the brief. */
export function awaitingBrief(job: Job): boolean {
  return STAGE_OWNER_ROLE[job.stage] === "ve" && !isBriefed(job);
}

/** Whose move it is on *this* job: the stage table, plus the exception above.
 * `owner_role_for()` on the server. */
export function ownerRoleFor(job: Job): "tl" | "ve" | "qc" | undefined {
  return awaitingBrief(job) ? "tl" : STAGE_OWNER_ROLE[job.stage];
}

/* The other half of the same rule: which of those moves *this* person may
 * make. Mirrors can_advance() in the same backend module — see the role
 * matrix in docs/04-permissions.md. */
const VE_TRANSITIONS = new Set(["assigned>editing", "revisions>editing"]);
const QC_TRANSITIONS = new Set(["qc2>final", "qc2>revisions"]);

interface StageOptions {
  /** Show a lead every legal move, not only the ones their own desk owns.
   * Off by default: the server lets the Owner and a pod's TL make any move on
   * that pod, and drawing all of them put "Start editing" and "Send to QC2" in
   * front of a TL on work that was sitting with the editor — one stray click
   * and the job had skipped a person, with the TL's name on the record for
   * work they hadn't done. The moves are still there for whoever has to
   * unstick a job; they are behind the override rather than in the way. */
  override?: boolean;
}

export function allowedNextStagesFor(
  job: Job & { tl_id?: string },
  user?: User | null,
  { override = false }: StageOptions = {},
): Stage[] {
  if (!user) return [];
  const next = allowedNextStages(job.stage, job.sent_back_from);
  const pair = (target: Stage) => `${job.stage}>${target}`;

  // The Owner makes any legal move on any pod; a TL only on the pods they
  // lead. Same split as can_advance() on the server — but unless they ask for
  // the override they are only offered the stages their own role holds, which
  // for a lead is intake, QC1 and the final check.
  const ownsStage = STAGE_OWNER_ROLE[job.stage] === "tl";

  if (leadsAllPods(user)) return override || ownsStage ? next : [];

  /* A union, not a switch, because one person can be two of these: an editor
   * who was lent the TL role is the editor on their own cuts and the lead on
   * their own pods, and a `switch (user.role)` would answer with whichever
   * one happens to be their primary and hide the other set of buttons. */
  const moves = new Set<Stage>();

  if (hasRole(user, "tl") && (!job.tl_id || job.tl_id === user.id)) {
    if (override || ownsStage) next.forEach((s) => moves.add(s));
  }
  if (hasRole(user, "qc") && job.qc2_reviewer_id === user.id) {
    next.filter((s) => QC_TRANSITIONS.has(pair(s))).forEach((s) => moves.add(s));
  }
  // No deadline, no hand-off. The server refuses these moves too
  // (`can_advance`); this keeps the button off a job the editor is not meant
  // to have started.
  if (hasRole(user, "ve") && job.assigned_editor_id === user.id && isBriefed(job)) {
    // The way out of the edit bay is wherever the job was sent back from, so
    // it is not a fixed pair like the two ways in.
    const editorMoves =
      job.stage === "editing" ? next : next.filter((s) => VE_TRANSITIONS.has(pair(s)));
    editorMoves.forEach((s) => moves.add(s));
  }

  return next.filter((s) => moves.has(s));
}

/** Whether this person has moves the override would reveal — used to decide
 * whether the toggle is worth drawing at all. */
export function hasOverrideMoves(job: Job & { tl_id?: string }, user?: User | null): boolean {
  return (
    allowedNextStagesFor(job, user, { override: true }).length >
    allowedNextStagesFor(job, user).length
  );
}
