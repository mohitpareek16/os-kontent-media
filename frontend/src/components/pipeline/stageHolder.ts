import { STAGE_OWNERS } from "@/components/pipeline/StageBadge";
import { isBriefed } from "@/lib/stageTransitions";
import type { JobDetail, Stage } from "@/types";

/** What to call the owning role when nobody is resolved into the seat yet —
 * a job at QC2 with no reviewer routed still has to be described to someone. */
const OWNER_FALLBACK: Record<"TL" | "VE" | "QC", string> = {
  TL: "the pod TL",
  VE: "the editor",
  QC: "the QC team",
};

/** The person a job sits with at `stage` — i.e. whoever a note written now
 * will actually be read by. Named in one place because the panel header, the
 * stage control and the note label all have to agree about who that is;
 * three copies of this `if` had already started to appear. */
export function stageHolderName(job: JobDetail, stage: Stage = job.stage): string | null {
  if (stage === "qc2") return job.qc2_reviewer_name;
  return holderRole(job, stage) === "VE" ? job.editor_name : job.tl_name;
}

/** Same thing, but always printable: falls back to the role. */
export function stageHolderLabel(job: JobDetail, stage: Stage = job.stage): string {
  return stageHolderName(job, stage) ?? OWNER_FALLBACK[holderRole(job, stage)];
}

/** The owning role for this job at this stage. `STAGE_OWNERS` with the
 * hand-off exception folded in: a job at an editor's stage that never got a
 * deadline is still sitting with the TL, whatever the stage column says, and
 * every sentence naming who has it has to agree (`isBriefed`). */
function holderRole(job: JobDetail, stage: Stage): "TL" | "VE" | "QC" {
  const owner = STAGE_OWNERS[stage];
  return owner === "VE" && stage === job.stage && !isBriefed(job) ? "TL" : owner;
}
