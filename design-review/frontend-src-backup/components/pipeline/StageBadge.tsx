import { Badge } from "@/components/ui/Badge";
import type { Stage } from "@/types";

const STAGE_LABELS: Record<Stage, string> = {
  intake: "Intake",
  assigned: "Assigned",
  editing: "Editing",
  qc1: "QC 1",
  qc2: "QC 2",
  revisions: "Revisions",
  final: "Final check",
  delivered: "Delivered",
};

const STAGE_CLASSES: Record<Stage, string> = {
  intake: "bg-[var(--bg-pill)] text-[var(--text-muted)]",
  assigned: "bg-indigo-500/10 text-indigo-400",
  editing: "bg-teal-500/10 text-teal-500",
  qc1: "bg-indigo-500/10 text-indigo-400",
  qc2: "bg-amber-500/10 text-amber-500",
  revisions: "bg-[var(--accent-red-bg)] text-[var(--accent-red)]",
  final: "bg-indigo-500/10 text-indigo-400",
  delivered: "bg-[var(--accent-green-bg)] text-[var(--accent-green)]",
};

export function StageBadge({ stage }: { stage: Stage }) {
  return <Badge className={STAGE_CLASSES[stage]}>{STAGE_LABELS[stage]}</Badge>;
}

// Solid-fill versions of the same per-stage hues, for bars/charts — one
// color decision per stage, shared everywhere instead of redefined per chart.
export const STAGE_BAR_COLORS: Record<Stage, string> = {
  intake: "bg-gray-400",
  assigned: "bg-indigo-500",
  editing: "bg-teal-500",
  qc1: "bg-indigo-500",
  qc2: "bg-amber-500",
  revisions: "bg-rose-500",
  final: "bg-indigo-500",
  delivered: "bg-emerald-500",
};

/* The stage vocabulary lives here, next to the labels, so the board columns,
 * the timeline and the panel all describe a stage the same way instead of
 * each file inventing its own wording. Mirrors the stage table in
 * docs/05-pipeline-and-routing.md. */
export const STAGE_SEQUENCE: Stage[] = [
  "intake",
  "assigned",
  "editing",
  "qc1",
  "qc2",
  "revisions",
  "final",
  "delivered",
];

/* Whose move it is at each stage — mirrors STAGE_OWNER_ROLE in the backend's
 * services/stage_machine.py, which is what the Mine tab is counted with.
 *
 * `assigned` is the editor's, not the TL's: the TL has already made their
 * move by assigning it, and the next thing that has to happen is the editor
 * starting the cut. It read "TL" here while the stage hint underneath said
 * "waiting for them to start", and the panel would tell a QC that a job sat
 * with the pod TL when it was sitting with an editor who hadn't begun. */
export const STAGE_OWNERS: Record<Stage, "TL" | "VE" | "QC"> = {
  intake: "TL",
  assigned: "VE",
  editing: "VE",
  qc1: "TL",
  qc2: "QC",
  revisions: "VE",
  final: "TL",
  delivered: "TL",
};

/** What is actually happening to the job right now, in a line.
 *
 * Each one leads with the stage's own name, because the line underneath it on
 * the panel already says who is holding the job. "Editor is cutting the
 * video" over "Currently with Ravi Prakash Swami" read as a claim about what
 * Ravi was doing at that moment, which the system does not know — all it
 * knows is that somebody pressed Start editing. */
export const STAGE_HINTS: Record<Stage, string> = {
  intake: "Intake — brief is in, no editor picked yet.",
  assigned: "Assigned — waiting for the editor to start.",
  editing: "Editing.",
  qc1: "QC1 — first-pass review with the pod TL.",
  qc2: "QC2 — second-pass review with the QC team.",
  revisions: "Revisions — back with the editor for the change list.",
  final: "Final check — last look by the TL before the client sees it.",
  delivered: "Delivered to the client.",
};

export { STAGE_LABELS };
