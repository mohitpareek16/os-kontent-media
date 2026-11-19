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

/* One hue per stage (text on tint, all >= 4.8:1 — see --stage-* in
 * index.css). Written out in full so Tailwind can see every class. */
const STAGE_CLASSES: Record<Stage, string> = {
  intake: "bg-[var(--stage-intake-bg)] text-[var(--stage-intake-fg)]",
  assigned: "bg-[var(--stage-assigned-bg)] text-[var(--stage-assigned-fg)]",
  editing: "bg-[var(--stage-editing-bg)] text-[var(--stage-editing-fg)]",
  qc1: "bg-[var(--stage-qc1-bg)] text-[var(--stage-qc1-fg)]",
  qc2: "bg-[var(--stage-qc2-bg)] text-[var(--stage-qc2-fg)]",
  revisions: "bg-[var(--stage-revisions-bg)] text-[var(--stage-revisions-fg)]",
  final: "bg-[var(--stage-final-bg)] text-[var(--stage-final-fg)]",
  delivered: "bg-[var(--stage-delivered-bg)] text-[var(--stage-delivered-fg)]",
};

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <Badge className={STAGE_CLASSES[stage]}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {STAGE_LABELS[stage]}
    </Badge>
  );
}

// Solid-fill versions of the stage hues for bars/charts, taken from the
// validated --series-* palette so charts and badges never invent colours.
export const STAGE_BAR_COLORS: Record<Stage, string> = {
  intake: "bg-[var(--text-dim)]",
  assigned: "bg-[var(--series-7)]",
  editing: "bg-[var(--series-3)]",
  qc1: "bg-[var(--series-1)]",
  qc2: "bg-[var(--series-4)]",
  revisions: "bg-[var(--series-8)]",
  final: "bg-[var(--series-2)]",
  delivered: "bg-[var(--series-6)]",
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
