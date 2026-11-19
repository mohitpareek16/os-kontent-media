import type { ReactNode } from "react";

import { ActivityFeed } from "@/components/pipeline/ActivityFeed";
import { AdvanceStageControl } from "@/components/pipeline/AdvanceStageControl";
import { ChangeRequestList } from "@/components/pipeline/ChangeRequestList";
import { ChannelControl, useCanFileChannel } from "@/components/pipeline/ChannelControl";
import { ChecklistToggle } from "@/components/pipeline/ChecklistToggle";
import {
  ChannelField,
  ClientDeadlineField,
  DeadlineField,
  VideoTypeField,
} from "@/components/pipeline/JobFieldEdit";
import { JobLinksPanel } from "@/components/pipeline/JobLinksPanel";
import { JobTimeline } from "@/components/pipeline/JobTimeline";
import { Qc1FlagBanner, Qc1ReviewPanel } from "@/components/pipeline/Qc1ReviewPanel";
import {
  ReassignEditorControl,
  useCanReassign,
} from "@/components/pipeline/ReassignEditorControl";
import { RushControl, useCanRush } from "@/components/pipeline/RushControl";
import { ScrapJobControl, ScrappedBanner, useCanScrap } from "@/components/pipeline/ScrapJobControl";
import { STAGE_HINTS } from "@/components/pipeline/StageBadge";
import { stageHolderLabel } from "@/components/pipeline/stageHolder";
import { useCurrentUser } from "@/hooks/useAuth";
import { isLead } from "@/lib/roles";
import { DEADLINE_TONE_CLASSES, deadlineInfo, formatDateTime, formatFullDate } from "@/lib/format";
import { RushBadge } from "@/components/ui/RushBadge";
import { VIDEO_TYPE_ICONS, videoTypeLabel } from "@/lib/videoType";
import { useVideoTypes } from "@/hooks/useVideoTypes";
import type { JobDetail, JobEvent } from "@/types";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
        {label}
      </span>
      <span className="mt-0.5 block truncate text-sm font-semibold text-[var(--text-main)]">
        {children}
      </span>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return (
    <section className="glass-card p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-[var(--text-main)]">
        <i className={`${icon} text-[var(--primary)]`} /> {title}
      </h3>
      {children}
    </section>
  );
}

/** Everything there is to know about one job, in the order someone working
 * on it needs it: who/when → what to do next → what QC said → where it's
 * been. Shared by the dashboard's side panel and the full job page so the
 * two can't drift apart. */
export function JobDetailContent({ job, events }: { job: JobDetail; events: JobEvent[] }) {
  const { data: videoTypes } = useVideoTypes();
  const { data: user } = useCurrentUser();
  const deadline = deadlineInfo(job.deadline, job.stage);
  const holder = stageHolderLabel(job);
  const isTeamLead = isLead(user);
  const canScrap = useCanScrap(job);
  const canReassign = useCanReassign(job);
  const canRush = useCanRush(job);
  const canFileChannel = useCanFileChannel(job);
  const scrapped = Boolean(job.scrapped_at);
  /* A job at QC2 or past it has been through QC1 by definition; anything
   * already flagged shows it wherever it has since got to. */
  const showQc1Review =
    Boolean(job.qc1_flagged_at) || ["qc2", "final", "delivered"].includes(job.stage);

  return (
    <div className="space-y-4">
      {/* A scrapped job explains itself before anything else on the panel —
          every field below it describes work that stopped. A flagged QC1 comes
          next for the same reason: every field under it reads differently
          once you know nobody checked this cut. */}
      <ScrappedBanner job={job} />
      <Qc1FlagBanner job={job} />

      {/* Where it is right now */}
      {!scrapped && (
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--primary)_28%,transparent)] bg-[var(--bg-pill)] p-4">
          <p className="text-sm text-[var(--text-main)]">{STAGE_HINTS[job.stage]}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {job.stage === "delivered" ? (
              <>Delivered {job.delivered_at ? formatDateTime(job.delivered_at) : ""}</>
            ) : (
              <>
                Currently with <strong className="text-[var(--text-main)]">{holder}</strong>
                {job.round > 0 && ` · round ${job.round}`}
              </>
            )}
          </p>
        </div>
      )}

      {/* Who, what, when */}
      <div className="glass-card grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
        <Field label="Client pod">{job.pod_name}</Field>
        {/* Channel, video type and deadline carry their own pencil: they are
            the three things a TL corrects on a job that is already moving, and
            they used to mean scrolling past the whole panel to a section at the
            bottom — or, for the video type, having no way to do it at all. */}
        <ChannelField job={job} />
        <Field label="Editor">{job.editor_name ?? "Not assigned"}</Field>
        <Field label="QC reviewer">{job.qc2_reviewer_name ?? "Not routed yet"}</Field>
        <Field label="Pod TL">{job.tl_name ?? "—"}</Field>
        <VideoTypeField job={job}>
          <span className="inline-flex items-center gap-1.5">
            <i className={VIDEO_TYPE_ICONS[job.video_type] ?? "ri-film-line"} />
            {videoTypeLabel(job.video_type, videoTypes ?? [])}
            <RushBadge rush={job.rush} />
          </span>
        </VideoTypeField>
        <Field label="Revision rounds">
          <span className={job.round >= 3 ? "text-[var(--accent-red)]" : ""}>{job.round}</span>
        </Field>
        <Field label="Came in">{formatDateTime(job.created_at)}</Field>
        <DeadlineField job={job}>
          {job.deadline ? formatFullDate(job.deadline) : "None set"}
        </DeadlineField>
        {/* Renders nothing at all unless you lead this pod — see
            `useLeadsJobPod`. The server has already left the field out of an
            editor's payload; this keeps the grid from carrying an empty cell
            where the promise would be. */}
        <ClientDeadlineField job={job} />
        <Field label="Status">
          <span className={DEADLINE_TONE_CLASSES[deadline.tone]}>{deadline.label}</span>
        </Field>
      </div>

      {/* The files. Two lists, because they belong to two different people:
          the client's footage is the TL's to put here, the cuts are the
          editor's. One field used to be both, and whichever was written last
          was what everyone saw. */}
      <Section title="Files on this job" icon="ri-links-line">
        <JobLinksPanel job={job} />
      </Section>

      {job.stage === "final" && isTeamLead && !scrapped && <ChecklistToggle job={job} />}

      {/* No "next step" on a dead project — the server refuses every move on
          one, and offering the buttons anyway is just a 400 waiting to be
          clicked. */}
      {!scrapped && (
        <Section title="Your next step" icon="ri-flashlight-line">
          <AdvanceStageControl job={job} />
        </Section>
      )}

      {/* Next to the stage controls, not down in the danger zone: handing a
          stuck job to somebody who can actually cut it is ordinary pod
          management, and the TL looking for it has just read "Currently with
          Abhishek" three inches above. */}
      {canReassign && (
        <Section title="Who's on it" icon="ri-user-shared-line">
          <ReassignEditorControl job={job} />
        </Section>
      )}

      {/* Next to the other two mid-flight corrections a TL makes — who is on
          it, and how urgent it is. A client escalating a job that is already
          moving is the normal way this flag arrives. `RushControl` renders
          nothing for anyone who cannot set it. */}
      {canRush && (
        <Section title="How urgent" icon="ri-flashlight-line">
          <RushControl job={job} />
        </Section>
      )}

      {/* Filing the backlog is the main use of this, not creation: every job
          older than the channels table has none, on purpose. */}
      {canFileChannel && (
        <Section title="Which channel" icon="ri-play-list-2-line">
          <ChannelControl job={job} />
        </Section>
      )}

      {/* What happened at QC1, for the reviewer who has to trust it. Held
          back until the job has actually been through it — on a cut still in
          the edit bay there is nothing to report and the section would just be
          a box saying so. */}
      {showQc1Review && (
        <Section title="How QC1 went" icon="ri-shield-check-line">
          <Qc1ReviewPanel job={job} />
        </Section>
      )}

      <Section title="Change list & comments" icon="ri-chat-check-line">
        <ChangeRequestList jobId={job.id} events={events} />
      </Section>

      <Section title="Pipeline progress" icon="ri-route-line">
        <JobTimeline job={job} events={events} />
      </Section>

      <Section title="Activity" icon="ri-history-line">
        <ActivityFeed events={events} />
      </Section>

      {/* Only for people who can act. Everyone else already has the whole
          story from the banner at the top, and an empty section box under it
          is a control that looks broken rather than absent. */}
      {canScrap && (
        <Section title={scrapped ? "Scrapped" : "Danger zone"} icon="ri-close-circle-line">
          <ScrapJobControl job={job} />
        </Section>
      )}
    </div>
  );
}
