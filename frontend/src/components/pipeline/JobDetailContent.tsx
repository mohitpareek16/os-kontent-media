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
      <span className="block text-xs font-semibold text-[var(--text-dim)]">{label}</span>
      <span className="mt-0.5 block break-words text-sm font-semibold text-[var(--text-main)]">
        {children}
      </span>
    </div>
  );
}

/** A section card. `collapsible` ones are `<details>` rows (summary = title +
 * chevron) so a long panel stays scannable; the rest are plain cards. */
function Section({
  title,
  icon,
  children,
  collapsible = false,
  defaultOpen = false,
  danger = false,
}: {
  title: string;
  icon: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  danger?: boolean;
}) {
  const heading = (
    <span className={`flex items-center gap-2 text-sm font-bold ${danger ? "text-[var(--bad-text)]" : "text-[var(--text-main)]"}`}>
      <i className={`${icon} ${danger ? "" : "text-[var(--primary)]"}`} /> {title}
    </span>
  );
  if (!collapsible) {
    return (
      <section className="glass-card p-4">
        <h3 className="mb-3">{heading}</h3>
        {children}
      </section>
    );
  }
  return (
    <details open={defaultOpen} className={`glass-card group ${danger ? "!border-[var(--bad-bg)]" : ""}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 [&::-webkit-details-marker]:hidden">
        <h3>{heading}</h3>
        <i className="ri-arrow-down-s-line text-lg text-[var(--text-dim)] transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-[var(--border-color-subtle)] p-4">{children}</div>
    </details>
  );
}
/** Everything there is to know about one job, in the order someone working
 * on it needs it: who/when → what to do next → what QC said → where it's
 * been. Shared by the dashboard's side panel and the full job page so the
 * two can't drift apart. */
export function JobDetailContent({
  job,
  events,
  page = false,
}: {
  job: JobDetail;
  events: JobEvent[];
  /** Full-page layout: two columns, with the actions pinned on the right. */
  page?: boolean;
}) {
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

  /* The pieces, so the panel can stack them and the full page can lay them
     out in two columns without the two drifting apart. */
  const banners = (
    <>
      {/* A scrapped job explains itself before anything else — every field
          below it describes work that stopped. A flagged QC1 comes next for
          the same reason. */}
      <ScrappedBanner job={job} />
      <Qc1FlagBanner job={job} />
    </>
  );

  const statusBand = !scrapped && (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-pill)] p-4">
      <p className="text-[15px] font-bold text-[var(--text-main)]">
        {job.stage === "delivered" ? (
          <>Delivered {job.delivered_at ? formatDateTime(job.delivered_at) : ""}</>
        ) : (
          <>
            With {holder}
            {job.round > 0 && ` · round ${job.round}`}
          </>
        )}
      </p>
      <p className="mt-0.5 text-sm text-[var(--text-muted)]">{STAGE_HINTS[job.stage]}</p>
      <p className={`mt-1 text-sm font-bold ${DEADLINE_TONE_CLASSES[deadline.tone]}`}>{deadline.label}</p>
    </div>
  );

  /* The next move: the one thing the person opened this to do. No "next step"
     on a dead project — the server refuses every move on one. */
  const nextStep = !scrapped && (
    <>
      <Section title="Your next step" icon="ri-flashlight-line">
        <AdvanceStageControl job={job} />
      </Section>
      {job.stage === "final" && isTeamLead && <ChecklistToggle job={job} />}
    </>
  );

  const details = (
    <div className={`glass-card grid grid-cols-2 gap-x-6 gap-y-4 p-5 ${page ? "sm:grid-cols-3" : "sm:grid-cols-3"}`}>
      <Field label="Client">{job.pod_name}</Field>
      {/* Channel, video type and deadline carry their own pencil: they are the
          three things a TL corrects on a job that is already moving. */}
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
        <span className={job.round >= 3 ? "text-[var(--bad-text)]" : ""}>{job.round}</span>
      </Field>
      <Field label="Came in">{formatDateTime(job.created_at)}</Field>
      <DeadlineField job={job}>{job.deadline ? formatFullDate(job.deadline) : "None set"}</DeadlineField>
      {/* Renders nothing at all unless you lead this pod — see
          `useLeadsJobPod`. */}
      <ClientDeadlineField job={job} />
    </div>
  );

  /* Two lists, because they belong to two different people: the client's
     footage is the TL's to put here, the cuts are the editor's. */
  const files = (
    <Section title="Files on this job" icon="ri-links-line" collapsible defaultOpen>
      <JobLinksPanel job={job} />
    </Section>
  );

  /* What happened at QC1, for the reviewer who has to trust it. Held back until
     the job has actually been through it. */
  const qc1 = showQc1Review && (
    <Section title="How QC1 went" icon="ri-shield-check-line" collapsible defaultOpen={Boolean(job.qc1_flagged_at)}>
      <Qc1ReviewPanel job={job} />
    </Section>
  );

  const changes = (
    <Section title="Change list & comments" icon="ri-chat-check-line" collapsible defaultOpen>
      <ChangeRequestList jobId={job.id} events={events} />
    </Section>
  );

  /* Reassigning, rush and channel are the three mid-flight corrections a TL
     makes, so they share one collapsed section. Each control renders nothing
     for anyone who cannot use it. */
  const corrections = (canReassign || canRush || canFileChannel) && (
    <Section title="Reassign, rush & channel" icon="ri-user-shared-line" collapsible>
      <div className="space-y-5">
        {canReassign && (
          <div>
            <p className="mb-2 text-[13px] font-bold text-[var(--text-muted)]">Who's on it</p>
            <ReassignEditorControl job={job} />
          </div>
        )}
        {canRush && (
          <div>
            <p className="mb-2 text-[13px] font-bold text-[var(--text-muted)]">How urgent</p>
            <RushControl job={job} />
          </div>
        )}
        {canFileChannel && (
          <div>
            <p className="mb-2 text-[13px] font-bold text-[var(--text-muted)]">Which channel</p>
            <ChannelControl job={job} />
          </div>
        )}
      </div>
    </Section>
  );

  const progress = (
    <Section title="Pipeline progress" icon="ri-route-line" collapsible>
      <JobTimeline job={job} events={events} />
    </Section>
  );

  const activity = (
    <Section title="Activity" icon="ri-history-line" collapsible>
      <ActivityFeed events={events} />
    </Section>
  );

  /* Only for people who can act. Everyone else already has the whole story from
     the banner at the top. */
  const danger = canScrap && (
    <Section
      title={scrapped ? "Scrapped" : "Scrap this job"}
      icon="ri-close-circle-line"
      collapsible
      defaultOpen={scrapped}
      danger
    >
      <ScrapJobControl job={job} />
    </Section>
  );

  if (page) {
    return (
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {banners}
          {statusBand}
          {details}
          {files}
          {qc1}
          {changes}
          {progress}
          {activity}
        </div>
        <div className="space-y-4 lg:sticky lg:top-24">
          {nextStep}
          {corrections}
          {danger}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {banners}
      {statusBand}
      {nextStep}
      {details}
      {files}
      {qc1}
      {changes}
      {corrections}
      {progress}
      {activity}
      {danger}
    </div>
  );
}