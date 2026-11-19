import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";

import { TeamCapacityPanel } from "@/components/capacity/TeamCapacityPanel";
import { BrandKitHub } from "@/components/brand/BrandKitHub";
import { EditorQueue } from "@/components/pipeline/EditorQueue";
import { JobDetailPanel } from "@/components/pipeline/JobDetailPanel";
import { NewJobWizard } from "@/components/pipeline/NewJobWizard";
import { NewChannelInline } from "@/components/pods/NewChannelInline";
import {
  StageBadge,
  STAGE_LABELS,
  STAGE_OWNERS,
  STAGE_SEQUENCE,
} from "@/components/pipeline/StageBadge";
import { QcQueuePanel } from "@/components/qc/QcQueuePanel";
import { QcRouterPanel } from "@/components/qc/QcRouterPanel";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { FilterMenu } from "@/components/ui/FilterMenu";
import { Pagination } from "@/components/ui/Pagination";
import { RushBadge } from "@/components/ui/RushBadge";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { Segmented, TabBar } from "@/components/ui/TabBar";
import { SkeletonCards, SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useCurrentUser } from "@/hooks/useAuth";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useFillViewportHeight } from "@/hooks/useFillViewportHeight";
import {
  useBulkFileUnderChannel,
  useBulkRetryQc2Assignment,
  useBoardJobs,
  useJob,
  useJobEvents,
  useJobs,
  useJobStats,
  useUpdateJob,
  useWorkspaceOverview,
} from "@/hooks/useJobs";
import { useAllChannels, usePods } from "@/hooks/usePods";
import { useUsers } from "@/hooks/useUsers";
import { useVideoTypes } from "@/hooks/useVideoTypes";
import {
  DEADLINE_CHIP_CLASSES,
  DEADLINE_CHIP_ICONS,
  DEADLINE_TONE_CLASSES,
  deadlineBuffer,
  deadlineInfo,
  formatFullDate,
  timeAgo,
} from "@/lib/format";
import { jobCardClass, jobRowClass, jobRowTone, TONE_LABELS } from "@/lib/jobRowTone";
import {
  VIDEO_TYPE_CLASSES,
  VIDEO_TYPE_ICONS,
  videoTypeClass,
  videoTypeLabel,
} from "@/lib/videoType";
import { hasRole, isLead, leadsAllPods } from "@/lib/roles";
import type {
  Channel,
  JobDetail,
  JobSortField,
  JobStatusFilter,
  PodStatus,
  Role,
  Stage,
  User, VideoType } from "@/types";
import type { JobFilters } from "@/api/jobs";

type ViewTab =
  | "overview"
  | "pipeline"
  | "qcteam"
  | "qcqueue"
  | "capacity"
  | "bot"
  | "brandkit";
const VALID_VIEWS: ViewTab[] = [
  "overview",
  "pipeline",
  "qcteam",
  "qcqueue",
  "capacity",
  "bot",
  "brandkit",
];

/** Which view a role lands on with no `?view=` — a QC's home is their own
 * queue, not the owner's company overview (docs/04: "own queue only"). */
function homeView(user: User | undefined): ViewTab {
  // Leads first: somebody who is both an editor and a TL of their own pods
  // lands on the overview, because that is the view that spans both.
  if (isLead(user)) return "overview";
  if (hasRole(user, "qc")) return "qcqueue";
  if (hasRole(user, "ve")) return "pipeline";
  return "overview";
}

/** Two views are role-shaped: the router is the owner/TL side of QC2, the
 * queue is the reviewer's side. Land anyone who asks for the wrong one on
 * the view that is actually theirs instead of a 403 from the API. */
function resolveView(requested: ViewTab | null, user: User | undefined): ViewTab {
  if (!requested) return homeView(user);
  if (requested === "qcteam" && !isLead(user)) return homeView(user);
  if (requested === "qcqueue" && !hasRole(user, "qc", "owner", "tl")) return homeView(user);
  return requested;
}

/** Placeholder views for things that genuinely aren't built yet. Phase 2 is
 * a plan, not a promise the UI should imply is already wired up. */
const PHASE_2_VIEWS: Record<string, { title: string; icon: string; body: string; doc: string }> = {
  bot: {
    title: "WhatsApp notifications aren't connected yet",
    icon: "ri-whatsapp-line",
    body: "Phase 2 sends stage hand-offs and stuck-round alerts to WhatsApp, inside Meta's 24-hour reply window with approved templates outside it. Until then, every notification lands in the in-app inbox, and there is no message log or cost data to show here.",
    doc: "docs/09-integrations-future.md",
  },
};

/** The status tabs, in the order they're offered.
 *
 * `mine` is dropped for the company-wide tier: Owner, Founder's Office and HR
 * lead every pod in the product but are almost never anyone's `Pod.tl_id`, so
 * their Mine would be a tab that says 0 forever. A permanent zero reads as a
 * broken feature, not as an answer — see `mine_clauses` on the server for what
 * the number means for everyone else. */
const ALL_STATUS_FILTERS: JobStatusFilter[] = [
  "all",
  "intake",
  "active",
  "overdue",
  "mine",
  "delivered",
  "scrapped",
  "flagged",
];

/** Two of the tabs are a lead's job and nobody else's: `intake` is work that
 * still needs an editor picked, and `flagged` is a QC1 somebody says never
 * happened. An editor or reviewer can act on neither, so they are not offered
 * either — every tab on screen should be a question its reader can answer. */
const LEAD_ONLY_FILTERS: JobStatusFilter[] = ["intake", "flagged"];

function statusFiltersFor(user: User | undefined): JobStatusFilter[] {
  const forRole = isLead(user)
    ? ALL_STATUS_FILTERS
    : ALL_STATUS_FILTERS.filter((f) => !LEAD_ONLY_FILTERS.includes(f));
  return leadsAllPods(user) ? forRole.filter((f) => f !== "mine") : forRole;
}

/** Which stages each status tab can contain at all — the tab's own definition,
 * as a predicate.
 *
 * `intake` and `delivered` are single-stage tabs. `active` is the span between
 * them: assigned through final, which is the change that stopped ACTIVE from
 * swallowing the whole intake backlog. `overdue`, `mine` and `scrapped` each
 * exclude finished work for their own reasons. `all` and `flagged` cut across
 * everything. */
const TAB_STAGES: Record<JobStatusFilter, (stage: Stage) => boolean> = {
  intake: (stage) => stage === "intake",
  active: (stage) => stage !== "intake" && stage !== "delivered",
  overdue: (stage) => stage !== "delivered",
  mine: (stage) => stage !== "delivered",
  delivered: (stage) => stage === "delivered",
  scrapped: (stage) => stage !== "delivered",
  all: () => true,
  flagged: () => true,
};

/** The tab that *does* own a stage, for the two stages that have one. Lets the
 * contradiction message offer the narrow fix ("Open the INTAKE tab") instead of
 * dumping the user on ALL. */
const TAB_FOR_STAGE: Partial<Record<Stage, JobStatusFilter>> = {
  intake: "intake",
  delivered: "delivered",
};

/** Tailwind needs the whole class name in the source, so the column counts are
 * a lookup rather than a template string. */
const CARD_GRID_COLS: Record<number, string> = {
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
  7: "lg:grid-cols-7",
  8: "lg:grid-cols-8",
};

/** Every column is sortable server-side. `pod` and `channel` sort on the name,
 * not the id, because that is what the cell reads. */
const SORT_COLUMNS: Array<{ field: JobSortField; label: string }> = [
  { field: "title", label: "Job" },
  { field: "stage", label: "Stage" },
  { field: "deadline", label: "Deadline" },
  { field: "video_type", label: "Video type" },
  { field: "rush", label: "Rush" },
  { field: "pod", label: "Client Pod" },
  // Next to the client it belongs to, and sortable for the same reason: "show
  // me everything that went to Dhan HQ" is a question about a group of rows.
  { field: "channel", label: "Channel" },
];

/** Who may file a video under a channel — the same rule the server applies
 * (`check_pod_lead`): the pod's own TL, or the company-wide tier. A scrapped
 * project takes no changes at all. */
function canFileJob(job: JobDetail, user: User | undefined): boolean {
  if (job.scrapped_at) return false;
  if (leadsAllPods(user)) return true;
  return hasRole(user, "tl") && job.tl_id === user?.id;
}

/** A "needs your attention" card on the Overview: label + icon, a big number,
 * one line saying what it means, and a link into the rows behind it. The
 * number is coloured only when it signals something (`tone`). */
function AttentionCard({
  label,
  icon,
  value,
  description,
  tone,
  onClick,
}: {
  label: string;
  icon: string;
  value: string | number;
  description: string;
  tone: "primary" | "bad" | "warn" | "none";
  onClick: () => void;
}) {
  const accent =
    tone === "primary"
      ? { border: "border-l-[var(--primary)]", text: "text-[var(--primary-text)]" }
      : tone === "bad"
        ? { border: "border-l-[var(--bad-text)]", text: "text-[var(--bad-text)]" }
        : tone === "warn"
          ? { border: "border-l-[var(--warn-text)]", text: "text-[var(--warn-text)]" }
          : { border: "border-l-[var(--border-color)]", text: "text-[var(--text-main)]" };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`glass-card card-interactive flex flex-col gap-1 border-l-4 p-5 text-left ${accent.border}`}
    >
      <span className="flex items-center justify-between text-sm font-bold text-[var(--text-muted)]">
        {label}
        <i className={`${icon} text-xl ${tone === "none" ? "text-[var(--text-dim)]" : accent.text}`} />
      </span>
      <span className={`num mt-1.5 text-[44px] font-bold leading-[1.1] ${accent.text}`}>{value}</span>
      <span className="text-[13px] text-[var(--text-dim)]">{description}</span>
      <span className="mt-2 flex items-center gap-1 text-[13px] font-bold text-[var(--primary-text)]">
        Open in pipeline <i className="ri-arrow-right-line" />
      </span>
    </button>
  );
}

/** One cell of the Overview's "pipeline health" strip. A button when it has an
 * `onClick`, a link when it has `to`. */
function StripCell({
  label,
  icon,
  value,
  hint,
  onClick,
  to,
  title,
}: {
  label: string;
  icon: string;
  value: string | number;
  hint: string;
  onClick?: () => void;
  to?: string;
  title?: string;
}) {
  const className =
    "block w-full p-5 text-left transition-colors hover:bg-[var(--bg-card-hover)] first:rounded-l-[14px] last:rounded-r-[14px]";
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text-dim)]">
        <i className={icon} /> {label}
      </span>
      <span className="num mt-0.5 block text-[30px] font-bold leading-tight text-[var(--text-main)]">{value}</span>
      <span className="block text-xs text-[var(--text-dim)]">{hint}</span>
    </>
  );
  return to ? (
    <Link to={to} title={title} className={className}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} title={title} className={className}>
      {body}
    </button>
  );
}

/** A job as a phone card: everything the table row shows — title, code, type,
 * rush, cut link, flags, whose move, client and channel, editor, QC reviewer,
 * deadline (and the actual one), rounds, and scrapped by/why. */
function MobileJobCard({
  job: j,
  typeLabel,
  onSelect,
  selected,
}: {
  job: JobDetail;
  typeLabel: string;
  onSelect: () => void;
  selected: boolean;
}) {
  const due = deadlineInfo(j.deadline, j.stage);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full flex-col gap-2.5 rounded-2xl border border-[var(--border-color)] p-4 text-left shadow-[var(--shadow-card)] ${jobCardClass(j)} ${
        selected ? "ring-2 ring-[var(--primary)]" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={`text-base font-bold leading-snug ${j.scrapped_at ? "line-through" : ""}`}>{j.title}</span>
        <StageBadge stage={j.stage} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-dim)]">
        <span className="font-mono">{j.code}</span>
        <span className={`inline-flex h-5 items-center rounded-md px-1.5 font-bold ${videoTypeClass(j.video_type)}`}>{typeLabel}</span>
        <RushBadge rush={j.rush} />
        {j.frame_link && <i className="ri-film-line" title="A cut is linked" />}
        <span>Next: {STAGE_OWNERS[j.stage]}</span>
        {j.is_mine && <span className="font-bold text-[var(--primary-text)]">Waiting on you</span>}
        {j.qc1_flagged_at && (
          <span className="flex items-center gap-1 font-bold text-[var(--warn-text)]">
            <i className="ri-flag-2-fill" /> QC1 flagged
          </span>
        )}
      </div>
      <div className="text-[13px] text-[var(--text-muted)]">
        {j.pod_name} · {j.channel_name ?? "Not filed"}
      </div>
      <dl className="grid grid-cols-2 gap-3 border-t border-[var(--border-color-subtle)] pt-2.5 text-[13px]">
        <div className="min-w-0">
          <dt className="text-xs text-[var(--text-dim)]">Editor</dt>
          <dd className="flex items-center gap-1.5 font-semibold">
            {j.editor_name ? (
              <>
                <Avatar name={j.editor_name} size={24} />
                <span className="truncate">{j.editor_name}</span>
              </>
            ) : (
              <span className="text-[var(--text-dim)]">Unassigned</span>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-[var(--text-dim)]">QC reviewer</dt>
          <dd className="flex items-center gap-1.5 font-semibold">
            {j.qc2_reviewer_name ? (
              <>
                <Avatar name={j.qc2_reviewer_name} size={24} />
                <span className="truncate">{j.qc2_reviewer_name}</span>
              </>
            ) : (
              <span className="text-[var(--text-dim)]">Not routed</span>
            )}
          </dd>
        </div>
      </dl>
      <div className="flex items-center justify-between gap-2">
        <span>
          <span className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[13px] font-bold ${DEADLINE_CHIP_CLASSES[due.tone]}`}>
            <i className={DEADLINE_CHIP_ICONS[due.tone]} /> {due.label}
          </span>
          <span className="mt-0.5 block text-xs text-[var(--text-dim)]">
            {j.deadline ? formatFullDate(j.deadline) : "No deadline"}
            {j.client_deadline && <> · actual {formatFullDate(j.client_deadline)}</>}
          </span>
        </span>
        <span
          className={`num text-sm font-bold ${j.round >= 3 ? "text-[var(--bad-text)]" : j.round > 0 ? "text-[var(--warn-text)]" : "text-[var(--text-dim)]"}`}
          title="Revision rounds"
        >
          R{j.round}
        </span>
      </div>
      {j.scrapped_at && (
        <div className="border-t border-[var(--border-color-subtle)] pt-2 text-xs text-[var(--text-muted)]">
          Scrapped by {j.scrapped_by_name ?? "—"} · {timeAgo(j.scrapped_at)}
          {j.scrap_reason && <span className="mt-0.5 block">{j.scrap_reason}</span>}
        </div>
      )}
    </button>
  );
}
/** The Channel cell: a lead files the row from here, everyone else reads it.
 *
 * Its own component because each row needs its own mutation, and inline
 * because that is where the question comes up — a TL working down the table
 * seeing "—" should be one click from answering it, not a click into the panel
 * and a click back out. `stopPropagation` on the select: the row itself opens
 * the detail panel. */
function ChannelCell({
  job,
  channels,
  canFile,
}: {
  job: JobDetail;
  channels: Channel[];
  canFile: boolean;
}) {
  const update = useUpdateJob(job.id);
  const toast = useToast();

  if (!canFile) {
    return job.channel_name ? (
      <span className="rounded bg-[var(--bg-pill)] px-1.5 py-0.5 font-semibold text-[var(--text-muted)]">
        {job.channel_name}
      </span>
    ) : (
      <span className="text-[var(--text-dim)]">—</span>
    );
  }

  return (
    <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
      {/* No channels on this client yet: offer the first one instead of a
          dropdown whose only option is "Not filed". The TL filing the work is
          the person allowed to name the channel, so this is not a detour
          through the pods screen. */}
      {channels.length === 0 ? (
        <NewChannelInline
          podId={job.pod_id}
          podName={job.pod_name}
          label="Channel"
          compact
          onCreated={(channel) =>
            update.mutate(
              { channel_id: channel.id },
              { onError: (error) => toast.notifyError(error, "Could not file this video.") },
            )
          }
        />
      ) : (
        <SearchableSelect value={job.channel_id ?? ""} disabled={update.isPending} onChange={(id) => update.mutate(id ? { channel_id: id } : { clear_channel: true }, { onError: (error) => toast.notifyError(error, "Could not file this video.") })} placeholder="Not filed" options={[{ value: "", label: "Not filed" }, ...channels.map((channel) => ({ value: channel.id, label: channel.name }))]} />
      )}
    </div>
  );
}

/** The table's header, in order. A column with a `field` sorts on the server;
 * the others are plain headings. (Video type, rush and channel are shown
 * inside the Video / Client cells; their sort fields stay valid for deep
 * links via SORT_COLUMNS.) */
const TABLE_COLUMNS: Array<{ label: string; field?: JobSortField }> = [
  { label: "Video", field: "title" },
  { label: "Stage", field: "stage" },
  { label: "Editor" },
  { label: "QC reviewer" },
  { label: "Deadline", field: "deadline" },
  { label: "Client", field: "pod" },
  { label: "Rounds", field: "round" },
];

/** Sort fields a deep link is allowed to name, so `?sort=` from another
 * screen can't put the table in a state its own headers can't get out of. */
const SORT_FIELDS: JobSortField[] = [...SORT_COLUMNS.map((c) => c.field), "round", "pipeline"];

/** The params that are applied to a control and then dropped from the URL. */
const DEEP_LINK_PARAMS = ["editor", "stage", "unrouted", "sort", "dir", "channel"] as const;

const DEFAULT_PAGE_SIZE = 25;
const POD_STATUS_LABEL: Record<PodStatus, string> = {
  active: "Active",
  paused: "Paused",
  churned: "Churned",
};

export default function DashboardPage() {
  const { data: user } = useCurrentUser();
  const { data: catalogTypes = [] } = useVideoTypes();
  const { data: pods } = usePods();
  const outletCtx = useOutletContext<{
    selectedPodId?: string;
    setSelectedPodId?: (podId: string) => void;
  }>();
  const activePodId = outletCtx?.selectedPodId;
  /* Every channel this person can see, in one query rather than one per client.
     The table's resting state is *All Clients*, and there both the filter and a
     row's own cell need the whole set — the per-pod list had nothing to say, so
     the channel filter simply vanished on the view a lead lives in. */
  const { data: allChannels } = useAllChannels();
  const channels = useMemo(
    () =>
      activePodId
        ? (allChannels ?? []).filter((c) => c.pod_id === activePodId)
        : (allChannels ?? []),
    [allChannels, activePodId],
  );
  /* Grouped by client for the picker: "Shorts" on its own does not say whose,
     and two clients may each have one. */
  const channelsByPod = useMemo(() => {
    const groups = new Map<string, { podName: string; items: Channel[] }>();
    for (const channel of channels) {
      const key = channel.pod_id;
      const group = groups.get(key) ?? { podName: channel.pod_name ?? "Client", items: [] };
      group.items.push(channel);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [channels]);

  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get("view") as ViewTab | null;
  const requestedView = viewParam && VALID_VIEWS.includes(viewParam) ? viewParam : null;
  const viewTab: ViewTab = resolveView(requestedView, user);
  const modalOpen = searchParams.get("newJob") === "1";

  /** Which status tab the pipeline is on. It lives in the URL, not in local
   * state, so "the 4 jobs waiting on me" is a link someone can send, survives
   * a refresh, and can be arrived at from another screen — an Overview tile,
   * a notification — in one navigation instead of a click and then a click. */
  const statusParam = searchParams.get("status") as JobStatusFilter | null;
  const statusFilters = statusFiltersFor(user);
  const filter: JobStatusFilter =
    statusParam && statusFilters.includes(statusParam) ? statusParam : "all";

  /** `all` is the default, so it stays out of the URL. */
  const withStatus = (params: URLSearchParams, status: JobStatusFilter) => {
    if (status === "all") params.delete("status");
    else params.set("status", status);
    return params;
  };

  const setFilter = (status: JobStatusFilter) =>
    setSearchParams((prev) => withStatus(new URLSearchParams(prev), status), { replace: true });

  /** "Only the jobs whose QC1 a reviewer says never happened." In the URL
   * rather than in local state, like the status tab and for the same reasons:
   * it is the one view a lead sends to somebody else. */
  const qc1Flagged = searchParams.get("flagged") === "1";
  const setQc1Flagged = (on: boolean) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (on) next.set("flagged", "1");
        else next.delete("flagged");
        return next;
      },
      { replace: true },
    );

  /** Jump to the pipeline table already filtered — one history entry and one
   * URLSearchParams update, because two `setSearchParams` calls in the same
   * handler race and the second wins. */
  const openPipeline = (status: JobStatusFilter) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("view", "pipeline");
      return withStatus(next, status);
    });

  /** The flagged-QC1 tile → every flagged job, at any stage. `all`, not
   * `active`: a QC1 that never happened on a video that has since shipped is
   * the case worth looking at hardest, and every other tab would hide it. */
  const openFlagged = () =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("view", "pipeline");
      next.set("flagged", "1");
      return withStatus(next, "all");
    });

  /** Same, plus a stage. The stage chips are local state rather than a param,
   * so this sets both in one handler — they are separate mechanisms, so
   * neither clobbers the other. */
  const openPipelineStage = (status: JobStatusFilter, stage: Stage[]) => {
    setStages(stage);
    openPipeline(status);
  };

  /** Pod card → the pipeline table, already filtered to that client. The
   * selector lives in the layout, so we set both it and the view. */
  const openPodPipeline = (podId: string) => {
    outletCtx?.setSelectedPodId?.(podId);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("view", "pipeline");
      return next;
    });
  };

  const closeModal = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("newJob");
      return next;
    });
  };

  /* An editor's home is their own queue, not the manager's table. The table is
     one click away ("View all my jobs") and back again. */
  const isEditorOnly = hasRole(user, "ve") && !isLead(user) && !hasRole(user, "qc");
  const [editorShowTable, setEditorShowTable] = useState(false);
  const showEditorQueue = isEditorOnly && !editorShowTable;

  /* Table or board — remembered per browser, so choosing Board once sticks. */
  const [viewMode, setViewMode] = useState<"kanban" | "table">(() => {
    try {
      const stored = localStorage.getItem("km_pipeline_view");
      if (stored === "kanban" || stored === "table") return stored;
    } catch {
      /* storage unavailable (private mode) — fall through to the default */
    }
    return "table";
  });
  /* Leads default to the board the first time (nothing stored yet); the
     stored choice always wins afterwards. */
  useEffect(() => {
    if (!user || !isLead(user)) return;
    try {
      if (localStorage.getItem("km_pipeline_view") === null) setViewMode("kanban");
    } catch {
      /* storage unavailable — keep the table */
    }
  }, [user]);

  /* Phones: one stage at a time instead of eight columns side by side. */
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 767px)");
    if (!query) return;
    const onChange = () => setNarrow(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const [mobileStage, setMobileStage] = useState<Stage>("editing");

  const changeViewMode = (mode: "kanban" | "table") => {
    setViewMode(mode);
    try {
      localStorage.setItem("km_pipeline_view", mode);
    } catch {
      /* the choice still applies for this visit */
    }
  };
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    if (!filtersOpen) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setFiltersOpen(false); };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [filtersOpen]);
  const [searchInput, setSearchInput] = useState("");
  /* Debounced so the table's own search box doesn't hit the server on every
   * keystroke. Same 300ms the header's global search waits — one hook, so a
   * box added later gets it by using it rather than by remembering to. */
  const search = useDebouncedValue(searchInput).trim();
  const [stages, setStages] = useState<Stage[]>([]);
  const [videoTypes, setVideoTypes] = useState<VideoType[]>([]);
  const [editorId, setEditorId] = useState("");
  const [unassigned, setUnassigned] = useState(false);
  const [unrouted, setUnrouted] = useState(false);
  const [rushOnly, setRushOnly] = useState(false);
  /* "__none" is a real answer, not the absence of one: every job older than
     the channels table is unfiled, and "what still has to be filed" is the
     question a TL actually works from. */
  const [channelId, setChannelId] = useState("");
  const [deadlineFrom, setDeadlineFrom] = useState("");
  const [deadlineTo, setDeadlineTo] = useState("");
  /* The resting order follows the board's columns, then deadline within each
     stage. Other column headers still let the user choose a different sort. */
  const [sortBy, setSortBy] = useState<JobSortField>("stage");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  /* Ticked rows, for filing a backlog under a channel in one move. Ids rather
     than rows: the list underneath is polled every 30s and re-sorted on demand,
     so holding the rows themselves would go stale mid-selection. */
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [bulkChannelId, setBulkChannelId] = useState("");

  /* The board runs to the bottom of the window, measured rather than guessed:
   * columns that shrink to fit their cards leave a page of dead space under
   * seven bare headers whenever a filter comes back empty. */
  const [boardRef, boardHeight] = useFillViewportHeight<HTMLDivElement>({
    enabled: viewTab === "pipeline" && viewMode === "kanban",
  });

  const lead = isLead(user);
  const canCreateJobs = lead;

  /* The editor filter needs the roster, and `GET /users` is owner/TL-only —
   * so it is a lead-only control, not a 403 for everyone else. */
  const { data: allUsers } = useUsers({ includeInactive: false, enabled: lead });
  const editors = useMemo(() => allUsers?.filter((u) => u.role === "ve") ?? [], [allUsers]);

  /* Land a role on its own home view *in the URL*, not just in render — the
   * sidebar highlights by href and the header titles by `?view=`, so "/" for
   * a QC has to become "/?view=qcqueue" or both say "Overview". */
  useEffect(() => {
    if (!user || requestedView) return;
    const home = homeView(user);
    if (home === "overview") return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("view", home);
        return next;
      },
      { replace: true },
    );
  }, [user, requestedView, setSearchParams]);

  /* Filters the pipeline accepts as a deep link, so a card on another screen
   * can hand someone the rows behind its number rather than the table's
   * default. Each lands on the control it belongs to — the stage chips, the
   * editor dropdown, the Unrouted toggle, the column sort — so the table never
   * sits silently filtered by something the user can't see named anywhere.
   *
   * `editor` and `channel` also arrive from the header's global search — a
   * channel hit there means "show me this channel's work", which is a filter
   * on this table and nowhere else.
   *
   * All of them are dropped from the URL once applied: clearing the control by
   * hand would otherwise be undone by the next render off a URL that still
   * names it. */
  useEffect(() => {
    const editorParam = searchParams.get("editor");
    const stageParam = searchParams.getAll("stage").filter((s): s is Stage =>
      STAGE_SEQUENCE.includes(s as Stage),
    );
    const unroutedParam = searchParams.get("unrouted") === "1";
    const channelParam = searchParams.get("channel");
    const sortParam = searchParams.get("sort") as JobSortField | null;
    const sortable = sortParam && SORT_FIELDS.includes(sortParam) ? sortParam : null;
    if (!editorParam && !stageParam.length && !unroutedParam && !sortable && !channelParam) return;

    if (editorParam) {
      setEditorId(editorParam);
      setUnassigned(false);
    }
    if (stageParam.length) setStages(stageParam);
    if (unroutedParam) setUnrouted(true);
    if (channelParam) setChannelId(channelParam);
    if (sortable) {
      setSortBy(sortable);
      setSortDir(searchParams.get("dir") === "asc" ? "asc" : "desc");
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of DEEP_LINK_PARAMS) next.delete(key);
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  /** Everything the server needs to answer "which rows". Held in one object
   * so the table, the board columns and the status cards are provably asking
   * the same question — the cards used to take a narrower set than the rows
   * they sat on, and quietly disagreed. */
  const filters: JobFilters = useMemo(
    () => ({
      pod_id: activePodId || undefined,
      search: search || undefined,
      stage: stages.length ? stages : undefined,
      video_type: videoTypes.length ? videoTypes : undefined,
      editor_id: !unassigned && editorId ? editorId : undefined,
      unassigned: unassigned || undefined,
      unrouted: unrouted || undefined,
      rush: rushOnly || undefined,
      channel_id: channelId && channelId !== "__none" ? channelId : undefined,
      no_channel: channelId === "__none" || undefined,
      qc1_flagged: qc1Flagged || undefined,
      deadline_from: deadlineFrom || undefined,
      deadline_to: deadlineTo || undefined,
    }),
    [
      activePodId,
      search,
      stages,
      videoTypes,
      editorId,
      unassigned,
      unrouted,
      rushOnly,
      channelId,
      qc1Flagged,
      deadlineFrom,
      deadlineTo,
    ],
  );

  const activeFilterCount =
    stages.length +
    videoTypes.length +
    (editorId || unassigned ? 1 : 0) +
    (unrouted ? 1 : 0) +
    (rushOnly ? 1 : 0) +
    (channelId ? 1 : 0) +
    (qc1Flagged ? 1 : 0) +
    (deadlineFrom || deadlineTo ? 1 : 0);

  const activeFilterLabels = [
    ...stages.map((stage) => STAGE_LABELS[stage]),
    ...videoTypes.map((type) => videoTypeLabel(type, catalogTypes)),
    ...(channelId
      ? [channelId === "__none" ? "Not filed" : channels.find((channel) => channel.id === channelId)?.name ?? "Channel"]
      : []),
    ...(unassigned ? ["Unassigned"] : editorId ? [editors.find((editor) => editor.id === editorId)?.name ?? "Editor"] : []),
    ...(unrouted ? ["Unrouted QC2"] : []),
    ...(rushOnly ? ["Rush"] : []),
    ...(qc1Flagged ? ["QC1 flagged"] : []),
    ...(deadlineFrom || deadlineTo ? [`Deadline ${deadlineFrom || "Any"} – ${deadlineTo || "Any"}`] : []),
  ];

  const clearFilters = () => {
    setStages([]);
    setVideoTypes([]);
    setEditorId("");
    setUnassigned(false);
    setUnrouted(false);
    setRushOnly(false);
    setChannelId("");
    setQc1Flagged(false);
    setDeadlineFrom("");
    setDeadlineTo("");
  };

  /* Any filter/sort/scope change invalidates the current page */
  useEffect(() => {
    setPage(1);
  }, [filter, filters, sortBy, sortDir, pageSize]);

  /* A channel belongs to one client, so switching clients can leave the filter
     naming something the new board has never heard of — which returns nothing
     and looks like an empty pipeline rather than a stale filter.

     Only when it *is* stale, though. A channel hit in the header's search sets
     the pod selector and the channel filter in the same click, and clearing on
     every pod change unconditionally raced that: this effect is declared after
     the deep-link one, so it ran second and wiped the filter the navigation
     had just applied. Checking membership instead of change makes the two
     independent of the order they happen to run in. */
  useEffect(() => {
    if (!channelId || !allChannels) return;
    const channel = allChannels.find((c) => c.id === channelId);
    if (!channel || (activePodId && channel.pod_id !== activePodId)) setChannelId("");
  }, [activePodId, channelId, allChannels]);

  const toggleSort = (field: JobSortField) => {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(field);
      setSortDir("asc");
    }
  };

  /* One page of rows, filtered and sorted by the database. The board mode
   * asks per column instead (see BoardColumn), so this query is idle there
   * rather than pulling a thousand rows nobody paginates. */
  const { data: pipelineResp, isLoading } = useJobs(
    {
      ...filters,
      status: filter,
      sort_by: sortBy,
      sort_dir: sortDir,
      page,
      page_size: pageSize,
    },
    /* Work queues go stale the moment someone else advances a job, and an
     * editor watching this table had no way to see it without reloading.
     * 30s matches `useNotifications`. */
    { enabled: viewTab === "pipeline" && viewMode === "table" && !showEditorQueue, refetchInterval: 30_000 },
  );
  const filteredJobs: JobDetail[] = pipelineResp?.items ?? [];
  const total = pipelineResp?.total ?? 0;
  const showScrapColumns = filter === "scrapped";
  /* Stage chips the current tab can never contain. Picking one is a
   * contradiction, not a filter, and it returns an empty table that reads as
   * a broken one — so the table says which combination did it instead of "no
   * jobs match".
   *
   * Written as one rule rather than a list of the combinations somebody
   * happened to hit: INTAKE and DELIVERED are single-stage tabs, ACTIVE is
   * everything between them, and the three that exclude finished work exclude
   * it for their own reasons. Every pairing falls out of that. */
  const impossibleStages = stages.filter((stage) => !TAB_STAGES[filter](stage));

  /* ---- Filing videos under a channel, one row or forty ------------------ */
  const toast = useToast();
  const bulkFile = useBulkFileUnderChannel();
  const bulkRetryQc2 = useBulkRetryQc2Assignment();

  /* Only the rows this person may actually file get a checkbox — the server
     applies `check_pod_lead` per pod and would refuse the whole selection
     otherwise, which is a worse way to find out. */
  const fileableJobs = useMemo(
    () => filteredJobs.filter((j) => canFileJob(j, user)),
    [filteredJobs, user],
  );
  const canFileAny = fileableJobs.length > 0;
  const checkedJobs = useMemo(
    () => fileableJobs.filter((j) => checkedIds.includes(j.id)),
    [fileableJobs, checkedIds],
  );
  const retryableCount = checkedJobs.filter(
    (job) => job.stage === "qc2" && !job.qc2_reviewer_id,
  ).length;
  /* A channel belongs to one client, so a selection spanning two of them can
     only be *unfiled* — the server says the same thing, this just says it
     before the click. */
  const checkedPodIds = useMemo(
    () => [...new Set(checkedJobs.map((j) => j.pod_id))],
    [checkedJobs],
  );
  const bulkPodId = checkedPodIds.length === 1 ? checkedPodIds[0] : null;
  const bulkPodName = bulkPodId
    ? (checkedJobs[0]?.pod_name ?? pods?.find((p) => p.id === bulkPodId)?.name ?? null)
    : null;
  const bulkChannelOptions = useMemo(
    () => (bulkPodId ? (allChannels ?? []).filter((c) => c.pod_id === bulkPodId) : []),
    [allChannels, bulkPodId],
  );
  const allChecked = canFileAny && fileableJobs.every((j) => checkedIds.includes(j.id));

  const toggleChecked = (jobId: string) =>
    setCheckedIds((prev) =>
      prev.includes(jobId) ? prev.filter((id) => id !== jobId) : [...prev, jobId],
    );

  const toggleCheckAll = () =>
    setCheckedIds(allChecked ? [] : fileableJobs.map((j) => j.id));

  /** File the selection, or unfile it when `target` is null. `name` is for the
   * channel that was created a moment ago and is not in the list yet — the
   * message should say where the work went, not "that channel". */
  const applyBulkChannel = (target: string | null, name?: string) => {
    if (!checkedJobs.length) return;
    bulkFile.mutate(
      { job_ids: checkedJobs.map((j) => j.id), channel_id: target },
      {
        onSuccess: ({ updated, unchanged }) => {
          const count = `${updated} video${updated === 1 ? "" : "s"}`;
          const trailer = unchanged ? ` — ${unchanged} already ${target ? "were" : "weren't"}.` : ".";
          toast.notify(
            target
              ? `${count} filed under ${name ?? bulkChannelOptions.find((c) => c.id === target)?.name ?? "that channel"}${trailer}`
              : `${count} taken back out of their channels${trailer}`,
            "success",
          );
          setCheckedIds([]);
          setBulkChannelId("");
        },
        onError: (error) => toast.notifyError(error, "Could not file those videos."),
      },
    );
  };

  const retrySelectedQc2 = () => {
    if (!retryableCount || bulkRetryQc2.isPending) return;
    bulkRetryQc2.mutate(checkedJobs.map((job) => job.id), {
      onSuccess: ({ assigned, no_capacity, skipped }) => {
        const parts = [`${assigned} QC reviewer${assigned === 1 ? "" : "s"} assigned`];
        if (no_capacity) parts.push(`${no_capacity} still waiting for capacity`);
        if (skipped) parts.push(`${skipped} already assigned or no longer in QC 2`);
        toast.notify(parts.join(" · "), no_capacity ? "info" : "success");
        setCheckedIds([]);
      },
      onError: (error) => toast.notifyError(error, "Could not retry QC assignment."),
    });
  };

  /* A selection is about the rows in front of you. Re-filtering, re-sorting or
     paging replaces them, and acting on ids that scrolled away is the one
     mistake this screen must not make easy. */
  useEffect(() => {
    setCheckedIds([]);
    setBulkChannelId("");
  }, [filters, filter, sortBy, sortDir, page, pageSize, viewMode]);

  /* Side panel. The row we already have renders the panel instantly; the
   * detail query then refreshes it (and keeps it live after an action). */
  const { data: selectedJob } = useJob(selectedJobId);
  const { data: selectedJobEvents } = useJobEvents(selectedJobId);
  const panelJob = selectedJob ?? filteredJobs.find((j) => j.id === selectedJobId);

  /* Status cards above the toolbar — counts for every tab, not just the
   * one currently selected, so switching tabs doesn't require a re-fetch.
   * Same filters as the table, so a card can never count rows the table
   * below it is hiding. */
  const { data: statusCounts } = useJobStats(
    filters,
    /* Polled with the table above it — a count that disagrees with the rows
     * it sits on top of is worse than a slightly old one. Also fetched on the
     * Overview, which leads with the same "waiting on you" number. */
    {
      enabled: viewTab === "pipeline" || viewTab === "overview",
      refetchInterval: 30_000,
    },
  );
  const showMine = statusFilters.includes("mine");
  const ALL_STATUS_CARDS: Array<{
    key: JobStatusFilter;
    label: string;
    hint: string;
    icon: string;
    iconWrapClass: string;
    countClass: string;
  }> = [
    // Start with the default view, then the stages of work.
    { key: "all", label: "All", hint: "Everything you can see, scrapped included", icon: "ri-layout-grid-line", iconWrapClass: "bg-[var(--primary-glow-subtle)] text-[var(--primary-light)]", countClass: "text-[var(--text-main)]" },
    { key: "intake", label: "Intake", hint: "Arrived, no editor picked yet — waiting to be assigned", icon: "ri-inbox-line", iconWrapClass: "bg-amber-500/15 text-amber-400", countClass: "text-amber-400" },
    // Assigned and moving. It used to mean "anything not delivered", which
    // contained Intake whole — so the two cards next to each other did not
    // add up, and 43 unassigned videos were being reported as work in
    // progress. The two are disjoint now.
    { key: "active", label: "Active", hint: "Assigned and moving — editing through the final check", icon: "ri-film-line", iconWrapClass: "bg-purple-500/15 text-purple-400", countClass: "text-[var(--text-main)]" },
    { key: "overdue", label: "Overdue", hint: "Past deadline and still open", icon: "ri-alarm-warning-line", iconWrapClass: "bg-rose-500/15 text-rose-400", countClass: "text-rose-400" },
    // "Mine" is the answer to "what do I do next", so it wears the brand's
    // own purple — the same colour the rows it counts are tinted with.
    { key: "mine", label: "Mine", hint: "Waiting on you right now", icon: "ri-user-line", iconWrapClass: "bg-[var(--primary-glow-subtle)] text-[var(--primary-light)]", countClass: "text-[var(--primary-light)]" },
    // Finished work is excluded from every other tab by construction —
    // `active` *means* not delivered — so without this tab the only place a
    // delivered video appeared was ALL, and picking Delivered in the stage
    // filter while ACTIVE was selected returned nothing at all.
    { key: "delivered", label: "Delivered", hint: "Signed off and gone to the client", icon: "ri-rocket-line", iconWrapClass: "bg-emerald-500/15 text-emerald-400", countClass: "text-[var(--accent-green)]" },
    { key: "scrapped", label: "Scrapped", hint: "Cancelled before delivery", icon: "ri-close-circle-line", iconWrapClass: "bg-[var(--bg-pill)] text-[var(--text-dim)]", countClass: "text-[var(--text-muted)]" },
    // A QC2 reviewer saying a cut never had a real QC1. Delivered ones stay
    // counted: the flag is about how the work was reviewed, and that does not
    // stop mattering once the video ships.
    { key: "flagged", label: "Flagged", hint: "QC1 a reviewer says never happened — for an admin to rule on", icon: "ri-flag-2-line", iconWrapClass: "bg-amber-500/15 text-[var(--accent-amber)]", countClass: "text-[var(--accent-amber)]" },
  ];
  const STATUS_CARDS = ALL_STATUS_CARDS.filter((card) => statusFilters.includes(card.key));

  /* Overview KPIs and pod cards, counted server-side. Held until we know the
   * role — "overview" is only the real view for a lead. */
  const { data: overview } = useWorkspaceOverview({
    enabled: viewTab === "overview" && Boolean(user),
  });

  /** Which view someone gets depends on their role, so render nothing until
   * we have it — otherwise a QC sees a flash of the owner's Overview. */
  if (!user) {
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <i className="ri-loader-4-line animate-spin" /> Loading your workspace...
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* ================= VIEW 1: OVERVIEW ================= */}
      {viewTab === "overview" && (
        <div className="space-y-7">
          {/* Needs your attention — the three questions people open this page
              with. Each card is the filter it counts, so one click lands on
              exactly the rows behind the number. */}
          <section aria-labelledby="overview-attention">
            <h2 id="overview-attention" className="mb-2.5 text-sm font-bold text-[var(--text-muted)]">
              Needs your attention
            </h2>
            <div className={`grid grid-cols-1 gap-4 ${showMine ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
              {/* First, and clickable, because "what is waiting on me" is the
                  question people open this page with. It lands on the
                  pipeline already filtered rather than making them find the
                  tab. */}
              {showMine && (
                <AttentionCard
                  label="On my plate"
                  icon="ri-user-line"
                  value={statusCounts ? statusCounts.mine : "—"}
                  tone={statusCounts?.mine ? "primary" : "none"}
                  description={statusCounts?.mine ? "Waiting on you right now" : "Nothing is waiting on you"}
                  onClick={() => openPipeline("mine")}
                />
              )}

              <AttentionCard
                label="Overdue"
                icon="ri-alarm-warning-line"
                value={overview ? overview.overdue : "—"}
                tone={overview?.overdue ? "bad" : "none"}
                description={overview?.overdue ? "Past deadline, not delivered" : "Nothing past its deadline"}
                onClick={() => openPipeline("overdue")}
              />

              {/* The half of the old "in flight" number somebody has to act
                  on: videos that have arrived with nobody on them. A to-do
                  list, not a status. */}
              <AttentionCard
                label="Awaiting assignment"
                icon="ri-inbox-line"
                value={overview ? overview.intake : "—"}
                tone={overview?.intake ? "warn" : "none"}
                description={overview?.intake ? "Arrived, no editor picked yet" : "Everything has an editor"}
                onClick={() => openPipeline("intake")}
              />
            </div>
          </section>

          {/* Pipeline health — one calm strip. Same numbers, same links as
              the eight tiles it replaces. */}
          <section aria-labelledby="overview-health">
            <h2 id="overview-health" className="mb-2.5 text-sm font-bold text-[var(--text-muted)]">
              Pipeline health <span className="font-medium text-[var(--text-dim)]">· across all clients</span>
            </h2>
            <div className="glass-card grid grid-cols-2 divide-[var(--border-color)] md:grid-cols-5 md:divide-x">
              {/* Counts what the ACTIVE tab lists: assigned through final
                  check, not the intake backlog. */}
              <StripCell
                label="In flight"
                icon="ri-film-line"
                value={overview ? overview.in_flight : "—"}
                hint="Assigned and moving"
                onClick={() => openPipeline("active")}
              />
              {/* The only tile that counts a stage rather than a status, so
                  it lands on the stage chip as well as the tab. */}
              <StripCell
                label="Pending QC 1"
                icon="ri-eye-line"
                value={overview ? overview.pending_qc1 : "—"}
                hint="First-pass review, with the pod TL"
                onClick={() => openPipelineStage("active", ["qc1"])}
              />
              {/* Delivered work is excluded from every in-flight number by
                  design, so it needs a tile of its own. */}
              <StripCell
                label="Delivered"
                icon="ri-rocket-line"
                value={overview ? overview.delivered : "—"}
                hint={overview?.delivered ? "Signed off and sent to the client" : "Nothing delivered yet"}
                onClick={() => openPipeline("delivered")}
              />
              {/* Analytics rather than the Delivered tab — the question this
                  number raises ("whose work, which client") is the one
                  Analytics breaks down. */}
              <StripCell
                label="First-pass rate"
                icon="ri-checkbox-circle-line"
                value={overview?.first_pass_pct == null ? "—" : `${overview.first_pass_pct}%`}
                hint={
                  overview?.first_pass_pct == null
                    ? "No deliveries yet to measure"
                    : `${overview.clean_delivered} of ${overview.delivered} delivered with no revision round`
                }
                to="/analytics"
                title="Open Analytics — first-pass rate and average rounds, per client and per editor"
              />
              {/* A process number, not a job one: one flag is a bad day, six
                  is a TL who has stopped reviewing. */}
              <StripCell
                label="QC 1 flagged"
                icon="ri-flag-2-line"
                value={overview ? overview.qc1_flagged : "—"}
                hint={overview?.qc1_flagged ? "Passed through QC1 without a review" : "No QC1 has been flagged"}
                onClick={openFlagged}
                title="Jobs a QC2 reviewer says never got a real QC1"
              />
            </div>
          </section>

          {/* Client pods, the ones that need attention first */}
          <section aria-labelledby="overview-pods">
            <h2 id="overview-pods" className="mb-2.5 text-sm font-bold text-[var(--text-muted)]">
              Client pods{" "}
              {overview && (
                <span className="font-medium text-[var(--text-dim)]">
                  · {overview.pods.length} client{overview.pods.length === 1 ? "" : "s"}, most overdue first
                </span>
              )}
            </h2>
            {!overview && <SkeletonCards count={3} className="h-36" />}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[...(overview?.pods ?? [])]
                .sort((a, b) => b.overdue - a.overdue || b.intake - a.intake)
                .map((p) => {
                  /* The pill states what we actually know: the pod's own
                   * status first (a paused client isn't "on track", it's
                   * paused), then whether anything in it has blown its
                   * deadline. */
                  const pill =
                    p.status !== "active"
                      ? { label: POD_STATUS_LABEL[p.status], className: "bg-[var(--stage-intake-bg)] text-[var(--stage-intake-fg)]" }
                      : p.overdue > 0
                        ? { label: `${p.overdue} overdue`, className: "bg-[var(--bad-bg)] text-[var(--bad-text)]" }
                        : { label: "Active", className: "bg-[var(--ok-bg)] text-[var(--ok-text)]" };
                  return (
                    <button
                      type="button"
                      key={p.pod_id}
                      onClick={() => openPodPipeline(p.pod_id)}
                      title={`Open ${p.pod_name} in the pipeline table`}
                      className="glass-card card-interactive w-full p-5 text-left"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="min-w-0 truncate text-[17px] font-bold">{p.pod_name}</h3>
                        <Badge className={pill.className}>
                          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
                          {pill.label}
                        </Badge>
                      </div>
                      {/* Where the work is: intake / in flight / delivered.
                          (In QC is a count of its own below, not a slice.) */}
                      <div
                        className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full bg-[var(--border-color)]"
                        role="img"
                        aria-label={`${p.intake} intake, ${p.in_flight} in flight, ${p.delivered} delivered`}
                      >
                        {p.intake > 0 && <span style={{ flex: p.intake }} className="bg-[var(--warn-text)]" />}
                        {p.in_flight > 0 && <span style={{ flex: p.in_flight }} className="bg-[var(--primary)]" />}
                        {p.delivered > 0 && <span style={{ flex: p.delivered }} className="bg-[var(--ok-text)]" />}
                      </div>
                      <div className="mt-3 grid grid-cols-4 gap-2 text-xs text-[var(--text-dim)]">
                        <div>
                          <span className="block">Intake</span>
                          <span className={`num text-lg font-bold ${p.intake ? "text-[var(--warn-text)]" : "text-[var(--text-main)]"}`}>{p.intake}</span>
                        </div>
                        <div>
                          <span className="block">In flight</span>
                          <span className="num text-lg font-bold text-[var(--text-main)]">{p.in_flight}</span>
                        </div>
                        <div>
                          <span className="block">In QC</span>
                          <span className="num text-lg font-bold text-[var(--text-main)]">{p.in_qc}</span>
                        </div>
                        <div>
                          <span className="block">Delivered</span>
                          <span className="num text-lg font-bold text-[var(--text-main)]">{p.delivered}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
            </div>
            {overview?.pods.length === 0 && (
              <EmptyState
                icon="ri-group-line"
                title="No client pods yet"
                description="Onboard a client and its jobs, editors and QC routing all hang off that pod."
              />
            )}
          </section>
        </div>
      )}

      {/* ================= VIEW 2: PIPELINE BOARD ================= */}
      {viewTab === "pipeline" && showEditorQueue && user && (
        <EditorQueue
          user={user}
          onSelect={setSelectedJobId}
          onViewAll={() => setEditorShowTable(true)}
        />
      )}

      {viewTab === "pipeline" && !showEditorQueue && (
        <div className="space-y-5">
          {isEditorOnly && (
            <button
              type="button"
              onClick={() => setEditorShowTable(false)}
              className="text-sm font-bold text-[var(--primary-text)] hover:underline"
            >
              <i className="ri-arrow-left-line" /> Back to my queue
            </button>
          )}
          {/* Status tabs — each one is the filter it counts, so clicking a
              number always lands on exactly the rows behind it. (This used to
              be eight stat cards *and* a second row of status pills saying the
              same thing.) */}
          <TabBar
            aria-label="Job status"
            value={filter}
            onChange={setFilter}
            tabs={STATUS_CARDS.map((card) => ({
              key: card.key,
              label: card.label,
              count: statusCounts ? statusCounts[card.key] : null,
              alert: card.key === "overdue",
              title: card.hint,
            }))}
          />

          {/* Search, filters and view mode */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1 sm:max-w-md">
              <i className="ri-search-line pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-[var(--text-dim)]" />
              <input
                type="search"
                aria-label="Search jobs by title or code"
                placeholder="Search by title or code"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="h-10 w-full rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-input)] pl-10 pr-3 text-sm outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--primary)]"
              />
            </div>
            <Button
              variant="secondary"
              onClick={() => setFiltersOpen(true)}
              aria-expanded={filtersOpen}
              aria-controls="pipeline-filter-drawer"
            >
              <i className="ri-equalizer-2-line text-base" /> Filters
              {activeFilterCount > 0 && (
                <span className="num rounded-full bg-[var(--primary)] px-1.5 text-xs leading-5 text-white">{activeFilterCount}</span>
              )}
            </Button>
            <div className="hidden flex-1 items-center justify-end gap-4 text-xs text-[var(--text-dim)] lg:flex">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-3 w-[3px] rounded bg-[var(--primary)]" /> Waiting on you
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-3 w-[3px] rounded bg-[var(--warn-text)]" /> QC1 flagged
              </span>
            </div>
            <Segmented
              aria-label="Pipeline view"
              value={viewMode}
              onChange={changeViewMode}
              options={[
                { key: "table", label: "Table", icon: "ri-table-line" },
                { key: "kanban", label: "Board", icon: "ri-layout-column-line" },
              ]}
            />
          </div>

          {filtersOpen && <div className="fixed inset-0 z-[80] bg-black/60" onMouseDown={(event) => { if (event.target === event.currentTarget) setFiltersOpen(false); }}>
          <section id="pipeline-filter-drawer" className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto border-l border-[var(--border-color)] bg-[var(--bg-sidebar)] p-4 shadow-2xl sm:p-6" aria-label="Pipeline filters" role="dialog" aria-modal="true">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <i className="ri-equalizer-2-line text-lg text-[var(--primary-light)]" />
                <span className="text-base font-bold">Filters</span>
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-[var(--primary)] px-2 py-0.5 text-xs font-bold text-white">{activeFilterCount}</span>
                )}
              </div>
              <button type="button" autoFocus onClick={() => setFiltersOpen(false)} aria-label="Close filters" className="flex min-h-10 min-w-10 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-pill)]"><i className="ri-close-line text-lg" /></button>
            </div>
            {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--primary-light)] hover:bg-[var(--bg-pill)]"
                >
                  Clear all
                </button>
              )}
            {activeFilterLabels.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Active filters">
                {activeFilterLabels.map((label, index) => (
                  <span key={`${label}-${index}`} className="rounded-full bg-[var(--primary-glow-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--primary-light)]">
                    {label}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-5">
              <div className="grid grid-cols-1 gap-4">
                <div className="min-w-0">
                  <span className="mb-1.5 block text-xs font-semibold text-[var(--text-muted)]">Stage</span>
            <FilterMenu
              label="Stage"
              icon="ri-flow-chart"
              options={STAGE_SEQUENCE.map((s) => ({ value: s, label: STAGE_LABELS[s] }))}
              selected={stages}
              onChange={setStages}
            />
                </div>
                <div className="min-w-0">
                  <span className="mb-1.5 block text-xs font-semibold text-[var(--text-muted)]">Video type</span>
            <FilterMenu
              label="Video type"
              icon="ri-film-line"
              options={catalogTypes.map((t) => ({
                value: t.key,
                label: t.label,
                className: VIDEO_TYPE_CLASSES[t.key] ?? "text-[var(--primary-light)]",
              }))}
              selected={videoTypes}
              onChange={setVideoTypes}
            />
                </div>

            {/* Offered across every client, not just one. It used to appear
                only with a client selected, which meant the filter was absent
                from the table's own resting state — and "everything that went
                to Dhan HQ" is exactly a question you ask from there. With more
                than one client in view the options are grouped by client, since
                two of them may each have a "Shorts". */}
            {channels.length > 0 && (
              <label className="min-w-0 text-xs font-semibold text-[var(--text-muted)]">
                <span className="mb-1.5 block">Channel</span>
                <SearchableSelect aria-label="Channel" value={channelId} onChange={setChannelId} placeholder="Any channel" options={[
                  { value: "", label: "Any channel" },
                  ...(activePodId ? channels.map((channel) => ({ value: channel.id, label: channel.name })) : channelsByPod.flatMap((group) => group.items.map((channel) => ({ value: channel.id, label: `${group.podName} — ${channel.name}` })))),
                  { value: "__none", label: "Not filed yet" },
                ]} />
              </label>
            )}

            {/* The other half of the chicken-and-egg: with a client selected
                and no channels on it, there was nothing on this screen to make
                one with. */}
            {activePodId && channels.length === 0 && lead && (
              <div className="flex min-w-0 items-center rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2.5">
                <NewChannelInline
                  podId={activePodId}
                  podName={pods?.find((p) => p.id === activePodId)?.name}
                  label="Add a channel for this client"
                />
              </div>
            )}

            {lead && (
              <label className="min-w-0 text-xs font-semibold text-[var(--text-muted)]">
                <span className="mb-1.5 block">Editor</span>
                <SearchableSelect
                aria-label="Editor"
                value={unassigned ? "__unassigned" : editorId}
                onChange={(value) => {
                  setUnassigned(value === "__unassigned");
                  setEditorId(value === "__unassigned" ? "" : value);
                }}
                placeholder="Any editor"
                options={[{ value: "", label: "Any editor" }, { value: "__unassigned", label: "Unassigned" }, ...editors.map((e) => ({ value: e.id, label: e.name }))]}
              />
              </label>
            )}

                <label className="min-w-0 text-xs font-semibold text-[var(--text-muted)]">
                  <span className="mb-1.5 block">Deadline from</span>
                  <input
                    type="date"
                    value={deadlineFrom}
                    onChange={(e) => setDeadlineFrom(e.target.value)}
                    className="w-full min-w-0 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                  />
                </label>
                <label className="min-w-0 text-xs font-semibold text-[var(--text-muted)]">
                  <span className="mb-1.5 block">Deadline to</span>
                  <input
                    type="date"
                    value={deadlineTo}
                    onChange={(e) => setDeadlineTo(e.target.value)}
                    className="w-full min-w-0 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                  />
                </label>
              </div>

              <div className="mt-4 border-t border-[var(--border-color-subtle)] pt-3">
                <p className="mb-2 text-xs font-semibold text-[var(--text-muted)]">Quick filters</p>
                <div className="flex flex-wrap gap-2">

            <button
              type="button"
              onClick={() => setUnrouted((v) => !v)}
              title="Jobs sitting at QC2 that routing could not place"
              aria-pressed={unrouted}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${
                unrouted
                  ? "border-[var(--primary)] bg-[var(--primary-glow-subtle)] text-[var(--primary-light)]"
                  : "border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:border-[var(--primary)]"
              }`}
            >
              <i className="ri-user-unfollow-line" /> Unrouted QC2
            </button>

            {/* Also cuts across the tabs. "What did we call urgent this week"
                is a question about the whole board, and a rush job that shipped
                on time is the one worth looking back at. */}
            <button
              type="button"
              onClick={() => setRushOnly((v) => !v)}
              title="Jobs somebody marked urgent — QC2 routing may place these on a reviewer with no points left"
              aria-pressed={rushOnly}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${
                rushOnly
                  ? "border-rose-400 bg-rose-500/10 text-rose-400"
                  : "border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:border-rose-400"
              }`}
            >
              <i className="ri-flashlight-line" /> Rush
            </button>

            {/* Cuts across the status tabs rather than being one: a skipped
                QC1 on a job that has since been delivered is exactly the row
                worth finding. */}
            <button
              type="button"
              onClick={() => setQc1Flagged(!qc1Flagged)}
              title="Jobs a QC2 reviewer says never got a real QC1"
              aria-pressed={qc1Flagged}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${
                qc1Flagged
                  ? "border-[var(--accent-amber)] bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]"
                  : "border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:border-[var(--accent-amber)]"
              }`}
            >
              <i className="ri-flag-2-line" /> QC1 flagged
            </button>

                </div>
              </div>
            </div>
          </section>
          </div>}

          {/* Kanban Board View — one query per column, each one filtered and
              counted by the server, so a column header states the real total
              rather than however many rows happened to be downloaded. */}
          {viewMode === "kanban" && narrow && (
            <div className="space-y-3">
              <TabBar
                aria-label="Stage"
                showCounts={false}
                value={mobileStage}
                onChange={setMobileStage}
                tabs={STAGE_SEQUENCE.map((s) => ({ key: s, label: STAGE_LABELS[s] }))}
              />
              <div className="min-h-[60vh]">
                <BoardColumn
                  key={mobileStage}
                  stage={mobileStage}
                  filters={filters}
                  status={filter}
                  enabled={viewTab === "pipeline"}
                  onSelect={setSelectedJobId}
                  full
                />
              </div>
            </div>
          )}

          {viewMode === "kanban" && !narrow && (
            <div
              ref={boardRef}
              style={boardHeight ? { height: boardHeight } : undefined}
              className="flex snap-x snap-proximity items-stretch gap-3 overflow-x-auto pb-4"
            >
              {STAGE_SEQUENCE.map((stage) => (
                <BoardColumn
                  key={stage}
                  stage={stage}
                  filters={filters}
                  status={filter}
                  enabled={viewTab === "pipeline"}
                  onSelect={setSelectedJobId}
                />
              ))}
            </div>
          )}

          {/* Filing the backlog. Every video created before channels existed
              has none, and a client with three hundred of them is never going
              to be filed a dropdown at a time — which is how a channel report
              stays mostly-unknown forever. */}
          {viewMode === "table" && checkedJobs.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--primary)] bg-[var(--primary-glow-subtle)] px-3 py-2">
              <span className="rounded bg-[var(--bg-card)] px-2 py-0.5 text-xs font-bold text-[var(--primary-light)]">
                {checkedJobs.length} selected
              </span>

              {retryableCount > 0 && (
                <Button
                  type="button"
                  className="!px-2 !py-1 !text-xs"
                  disabled={bulkRetryQc2.isPending || bulkFile.isPending}
                  onClick={retrySelectedQc2}
                >
                  <i className={bulkRetryQc2.isPending ? "ri-loader-4-line animate-spin" : "ri-refresh-line"} />
                  {bulkRetryQc2.isPending ? " Retrying..." : ` Retry assignment (${retryableCount})`}
                </Button>
              )}

              {bulkPodId ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-bold uppercase text-[var(--text-dim)]">
                      File under
                    </label>
                    <SearchableSelect value={bulkChannelId} onChange={setBulkChannelId} placeholder="Choose a channel..." options={[{ value: "", label: "Choose a channel..." }, ...bulkChannelOptions.map((channel) => ({ value: channel.id, label: channel.name }))]} />
                    <Button
                      type="button"
                      className="!px-2 !py-1 !text-xs"
                      disabled={!bulkChannelId || bulkFile.isPending}
                      onClick={() => applyBulkChannel(bulkChannelId)}
                    >
                      {bulkFile.isPending ? (
                        <>
                          <i className="ri-loader-4-line animate-spin" /> Filing...
                        </>
                      ) : (
                        <>
                          <i className="ri-play-list-add-line" /> Apply
                        </>
                      )}
                    </Button>
                  </div>
                  {/* Creating one from here is the same TL doing the same job —
                      they are filing the work, so they are the person who gets
                      to name the channel. Files the selection straight away,
                      which is what they were about to do next. */}
                  <NewChannelInline
                    podId={bulkPodId}
                    podName={bulkPodName}
                    onCreated={(channel) => {
                      setBulkChannelId(channel.id);
                      applyBulkChannel(channel.id, channel.name);
                    }}
                  />
                </>
              ) : (
                <span className="text-xs text-[var(--text-muted)]">
                  Videos from {checkedPodIds.length} clients are selected. A channel belongs to one
                  client, so pick one client's rows to file them — unfiling still works across all
                  of them.
                </span>
              )}

              <button
                type="button"
                disabled={bulkFile.isPending}
                onClick={() => applyBulkChannel(null)}
                title="Take the selected videos back out of their channels"
                className="text-xs font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--accent-amber)] disabled:opacity-50"
              >
                <i className="ri-eraser-line" /> Unfile
              </button>

              <button
                type="button"
                onClick={() => setCheckedIds([])}
                className="ml-auto text-xs font-semibold text-[var(--text-dim)] transition-colors hover:text-[var(--text-main)]"
              >
                <i className="ri-close-circle-line" /> Clear selection
              </button>
            </div>
          )}

          {/* Table View — 9 columns at 14px with a sticky header. Video type,
              rush and channel live inside the Video / Client cells instead of
              columns of their own (rush was "—" on most rows). */}
          {viewMode === "table" && (
            <>
              {/* Phones: the same rows as the table, as cards — every field the
                  table has, so the two layouts never disagree. */}
              <div className="space-y-2.5 md:hidden">
                {isLoading && <SkeletonRows rows={4} label="Loading jobs" />}
                {filteredJobs.map((j) => (
                  <MobileJobCard
                    key={j.id}
                    job={j}
                    typeLabel={videoTypeLabel(j.video_type, catalogTypes)}
                    onSelect={() => setSelectedJobId(j.id)}
                    selected={selectedJobId === j.id}
                  />
                ))}
                {!isLoading && filteredJobs.length === 0 && (
                  <EmptyState icon="ri-inbox-line" title="No jobs match these filters" />
                )}
                <div className="glass-card">
                  <Pagination
                    page={page}
                    pageSize={pageSize}
                    total={total}
                    onPageChange={setPage}
                    onPageSizeChange={setPageSize}
                    noun="jobs"
                  />
                </div>
              </div>
            <div className="glass-card overflow-hidden max-md:hidden">
              <div className="max-h-[calc(100vh-290px)] min-h-[200px] overflow-auto">
                <table className="k-table w-full min-w-[960px]">
                  <thead>
                    <tr>
                      {/* Only for the rows this person can act on — a column of
                          permanently disabled boxes is worse than no column. */}
                      {canFileAny && (
                        <th className="w-11">
                          <input
                            type="checkbox"
                            aria-label="Select every video on this page"
                            checked={allChecked}
                            onChange={toggleCheckAll}
                            className="h-4 w-4 accent-[var(--primary)]"
                          />
                        </th>
                      )}
                      {TABLE_COLUMNS.map((col) => (
                        <th key={col.label} aria-sort={col.field && sortBy === col.field ? (sortDir === "asc" ? "ascending" : "descending") : undefined}>
                          {col.field ? (
                            <button
                              type="button"
                              onClick={() => toggleSort(col.field!)}
                              className="flex items-center gap-1 font-bold hover:text-[var(--text-main)]"
                            >
                              {col.label}
                              <i
                                className={
                                  sortBy === col.field
                                    ? sortDir === "asc"
                                      ? "ri-arrow-up-s-line text-[var(--primary)]"
                                      : "ri-arrow-down-s-line text-[var(--primary)]"
                                    : "ri-expand-up-down-line opacity-40"
                                }
                              />
                            </button>
                          ) : (
                            col.label
                          )}
                        </th>
                      ))}
                      {/* Who killed it and why, but only on the tab that is
                          about killed work. */}
                      {showScrapColumns && (
                        <>
                          <th>Scrapped by</th>
                          <th>Reason</th>
                        </>
                      )}
                      <th className="w-8" aria-label="Open" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredJobs.map((j) => {
                      const due = deadlineInfo(j.deadline, j.stage);
                      const tone = jobRowTone(j);
                      return (
                        <tr
                          key={j.id}
                          onClick={() => setSelectedJobId(j.id)}
                          title={TONE_LABELS[tone] || undefined}
                          className={`cursor-pointer ${jobRowClass(j)} ${
                            selectedJobId === j.id ? "ring-1 ring-inset ring-[var(--primary)]" : ""
                          }`}
                        >
                          {canFileAny && (
                            <td onClick={(e) => e.stopPropagation()}>
                              {canFileJob(j, user) ? (
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${j.title}`}
                                  checked={checkedIds.includes(j.id)}
                                  onChange={() => toggleChecked(j.id)}
                                  className="h-4 w-4 accent-[var(--primary)]"
                                />
                              ) : null}
                            </td>
                          )}
                          <td>
                            <div
                              className={`font-bold text-[var(--text-main)] ${tone === "scrapped" ? "line-through" : ""}`}
                            >
                              {j.title}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-dim)]">
                              <span className="font-mono">{j.code}</span>
                              <span className={`inline-flex h-5 items-center gap-1 rounded-md px-1.5 font-bold ${videoTypeClass(j.video_type)}`}>
                                {videoTypeLabel(j.video_type, catalogTypes)}
                              </span>
                              <RushBadge rush={j.rush} />
                              {j.frame_link && <i className="ri-film-line" title="A cut is linked" />}
                              {/* Read off `is_mine`, not off the row tone: a
                                  flagged or delivered row is tinted for another
                                  reason and would otherwise silently stop
                                  saying whose move it is. */}
                              {j.is_mine && (
                                <span className="font-bold text-[var(--primary-text)]">Waiting on you</span>
                              )}
                              {j.qc1_flagged_at && (
                                <span
                                  className="flex items-center gap-1 font-bold text-[var(--warn-text)]"
                                  title={j.qc1_flag_reason ?? undefined}
                                >
                                  <i className="ri-flag-2-fill" /> QC1 flagged
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            <StageBadge stage={j.stage} />
                            <div className="mt-1 text-xs text-[var(--text-dim)]" title="Whose move it is at this stage">
                              Next: {STAGE_OWNERS[j.stage]}
                            </div>
                          </td>
                          <td>
                            {j.editor_name ? (
                              <span className="flex items-center gap-2 font-semibold">
                                <Avatar name={j.editor_name} size={26} /> {j.editor_name}
                              </span>
                            ) : (
                              <span className="text-[var(--text-dim)]">Unassigned</span>
                            )}
                          </td>
                          <td>
                            {j.qc2_reviewer_name ? (
                              <span className="flex items-center gap-2 font-semibold">
                                <Avatar name={j.qc2_reviewer_name} size={26} /> {j.qc2_reviewer_name}
                              </span>
                            ) : (
                              <span className="text-[var(--text-dim)]">Not routed</span>
                            )}
                          </td>
                          {/* The date the work is done to. A lead's row also
                              carries the actual deadline — as a tooltip, since
                              the panel spells it out. */}
                          <td
                            title={
                              j.client_deadline
                                ? `Actual deadline ${formatFullDate(j.client_deadline)}${
                                    deadlineBuffer(j.deadline, j.client_deadline)
                                      ? ` · ${deadlineBuffer(j.deadline, j.client_deadline)!.label}`
                                      : ""
                                  }`
                                : undefined
                            }
                          >
                            <div className={`font-bold ${DEADLINE_TONE_CLASSES[due.tone]}`}>{due.label}</div>
                            <div className="flex items-center gap-1 text-xs text-[var(--text-dim)]">
                              {j.deadline ? formatFullDate(j.deadline) : "—"}
                              {j.client_deadline && <i className="ri-flag-line" />}
                            </div>
                          </td>
                          <td className="min-w-[10rem]">
                            <div className="font-semibold">{j.pod_name}</div>
                            <div className="mt-0.5 text-xs">
                              <ChannelCell
                                job={j}
                                channels={(allChannels ?? []).filter((c) => c.pod_id === j.pod_id)}
                                canFile={canFileJob(j, user)}
                              />
                            </div>
                          </td>
                          <td>
                            <span
                              className={`num font-bold ${j.round >= 3 ? "text-[var(--bad-text)]" : j.round > 0 ? "text-[var(--warn-text)]" : "text-[var(--text-dim)]"}`}
                            >
                              {j.round}
                            </span>
                          </td>
                          {showScrapColumns && (
                            <>
                              <td>
                                <div>{j.scrapped_by_name ?? "—"}</div>
                                <div className="text-xs text-[var(--text-dim)]">
                                  {j.scrapped_at ? timeAgo(j.scrapped_at) : ""}
                                </div>
                              </td>
                              <td className="max-w-[22rem]">
                                {/* Truncated, with the whole reason on hover —
                                    a reason long enough to be useful is long
                                    enough to wreck the row height. */}
                                <span
                                  className="block truncate text-[var(--text-muted)]"
                                  title={j.scrap_reason ?? undefined}
                                >
                                  {j.scrap_reason ?? "—"}
                                </span>
                              </td>
                            </>
                          )}
                          <td className="text-[var(--text-dim)]">
                            <i className="ri-arrow-right-s-line text-lg" />
                          </td>
                        </tr>
                      );
                    })}
                    {isLoading && (
                      <tr>
                        <td colSpan={8 + (canFileAny ? 1 : 0) + (showScrapColumns ? 2 : 0)} className="!p-4">
                          <SkeletonRows rows={5} label="Loading jobs" />
                        </td>
                      </tr>
                    )}
                    {!isLoading && filteredJobs.length === 0 && (
                      <tr>
                        {/* Counted from the header: Video, Stage, Deadline,
                            Client, Editor, QC reviewer, Rounds and the chevron
                            (+ the checkbox column and the two scrap columns
                            when they are shown). */}
                        <td
                          colSpan={8 + (canFileAny ? 1 : 0) + (showScrapColumns ? 2 : 0)}
                          className="!p-8 text-center text-[var(--text-muted)]"
                        >
                          {impossibleStages.length > 0 ? (
                            /* Not "no jobs match": the tab and the stage chip
                               contradict each other, so the table would be empty
                               however much work there is. Naming both is the
                               difference between a filter the user can fix and a
                               system that looks like it lost the rows. */
                            <span className="flex flex-wrap items-center justify-center gap-1.5">
                              The {filter.toUpperCase()} tab never contains{" "}
                              <strong className="text-[var(--text-main)]">
                                {impossibleStages.map((st) => STAGE_LABELS[st]).join(" or ")}
                              </strong>{" "}
                              — that's what it means.
                              <button
                                type="button"
                                onClick={() =>
                                  setFilter(impossibleStages.length === 1 && TAB_FOR_STAGE[impossibleStages[0]]
                                    ? TAB_FOR_STAGE[impossibleStages[0]]!
                                    : "all")
                                }
                                className="font-bold text-[var(--primary-text)] underline underline-offset-2"
                              >
                                {impossibleStages.length === 1 && TAB_FOR_STAGE[impossibleStages[0]]
                                  ? `Open the ${TAB_FOR_STAGE[impossibleStages[0]]!.toUpperCase()} tab`
                                  : "Switch to ALL"}
                              </button>
                              to see them.
                            </span>
                          ) : filter === "scrapped" ? (
                            "Nothing has been scrapped here. Good."
                          ) : filter === "delivered" ? (
                            "Nothing delivered yet under these filters."
                          ) : (
                            "No jobs match these filters."
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <Pagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                noun="jobs"
                className="border-t border-[var(--border-color)]"
              />
            </div>
            </>
          )}
        </div>
      )}

      {/* ================= VIEW: TEAM CAPACITY ================= */}
      {viewTab === "capacity" && <TeamCapacityPanel onSelectJob={setSelectedJobId} />}

      {/* ================= VIEW: QC2 AUTO-ROUTER (owner / TL) ================= */}
      {viewTab === "qcteam" && <QcRouterPanel podId={activePodId || undefined} />}

      {/* ================= VIEW: MY QC QUEUE (reviewer) ================= */}
      {viewTab === "qcqueue" && <QcQueuePanel />}

      {/* ================= VIEW: BRAND KIT (needs a pod) ================= */}
      {viewTab === "brandkit" && <BrandKitHub pods={pods ?? []} loading={!pods} />}

      {/* ================= VIEWS THAT AREN'T BUILT YET ================= */}
      {PHASE_2_VIEWS[viewTab] && (
        <div className="glass-card p-6 max-w-2xl space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--bg-pill)] text-[var(--text-muted)] flex items-center justify-center text-lg">
              <i className={PHASE_2_VIEWS[viewTab].icon} />
            </div>
            <div>
              <h3 className="text-base font-bold">{PHASE_2_VIEWS[viewTab].title}</h3>
              <span className="text-xs font-semibold text-[var(--text-dim)]">
                Phase 2
              </span>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-[var(--text-muted)]">{PHASE_2_VIEWS[viewTab].body}</p>
          <p className="text-xs text-[var(--text-dim)]">
            Spec: <span className="font-mono">{PHASE_2_VIEWS[viewTab].doc}</span>
          </p>
        </div>
      )}

      {/* ================= JOB INSPECTOR SIDE PANEL ================= */}
      <JobDetailPanel
        open={Boolean(selectedJobId)}
        job={panelJob}
        events={selectedJobEvents}
        onClose={() => setSelectedJobId(null)}
      />

      {/* ================= NEW EDIT JOB WIZARD ================= */}
      <NewJobWizard open={modalOpen && canCreateJobs} onClose={closeModal} />
    </div>
  );
}

/** One board column, with its own paged server query and total.
 *
 * Cards are fixed-height and never change on hover: title, code, type, rush,
 * a deadline chip and the assignee. Everything else is one click away in the
 * job panel. Delivered — the one column that only grows — starts collapsed to
 * a rail. */
function BoardColumn({
  stage,
  filters,
  status,
  enabled,
  onSelect,
  full = false,
}: {
  stage: Stage;
  filters: JobFilters;
  status: JobStatusFilter;
  enabled: boolean;
  onSelect: (jobId: string) => void;
  /** Phone layout: the column fills the width and is never collapsed. */
  full?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(stage === "delivered" && !full);
  /* A selected stage or status tab applies to the board just as it does to
     the table. Skip queries for columns those filters cannot contain. */
  const matchesFilters =
    (!filters.stage || filters.stage.includes(stage)) && TAB_STAGES[status](stage);
  const { data, hasNextPage, fetchNextPage, isFetchingNextPage, isPending, isError, refetch } = useBoardJobs(
    {
      ...filters,
      status,
      stage: [stage],
      sort_by: "deadline",
      sort_dir: "asc",
    },
    { enabled: enabled && matchesFilters && !collapsed, refetchInterval: 30_000 },
  );
  /* How many in this column are past deadline — asked of the server, not
     counted off the cards that happen to be loaded. */
  const overdueQuery = useJobs(
    { ...filters, status: "overdue", stage: [stage], page: 1, page_size: 1 },
    {
      enabled: enabled && matchesFilters && stage !== "delivered" && !collapsed,
      refetchInterval: 30_000,
    },
  );
  const overdue = overdueQuery.data?.total ?? 0;
  const jobs = matchesFilters ? data?.pages.flatMap((page) => page.items) ?? [] : [];
  const { data: catalogTypes = [] } = useVideoTypes();
  const total = matchesFilters ? data?.pages[0]?.total ?? 0 : 0;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label={`Expand ${STAGE_LABELS[stage]}`}
        className="flex h-full w-14 shrink-0 flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--bg-card)] py-4 text-[var(--text-dim)] transition-colors hover:border-[var(--primary)]"
      >
        <i className="ri-expand-left-right-line text-lg" />
        <span className="[writing-mode:vertical-rl] text-[13px] font-bold">{STAGE_LABELS[stage]}</span>
      </button>
    );
  }

  return (
    <div className={`flex h-full ${full ? "w-full" : "w-[264px] shrink-0 snap-start"} flex-col rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-hover)]`}>
      <div className="flex items-center gap-2 px-3.5 py-3">
        <h3 className="text-sm font-bold">{STAGE_LABELS[stage]}</h3>
        <span className="num rounded-full border border-[var(--border-color)] bg-[var(--bg-card)] px-2 text-[13px] font-bold leading-5">
          {total}
        </span>
        {overdue > 0 && (
          <span
            className="flex items-center gap-1 text-xs font-bold text-[var(--bad-text)]"
            title={`${overdue} past deadline in ${STAGE_LABELS[stage]}`}
          >
            <i className="ri-alarm-warning-fill" /> {overdue}
          </span>
        )}
        <span className="flex-1" />
        {stage === "delivered" && (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse Delivered"
            className="text-[var(--text-dim)] hover:text-[var(--text-main)]"
          >
            <i className="ri-contract-left-right-line" />
          </button>
        )}
        <span
          className="inline-flex h-5 items-center rounded-md border border-[var(--border-color)] px-1.5 text-xs font-bold text-[var(--text-muted)]"
          title="Whose move it is at this stage"
        >
          {STAGE_OWNERS[stage]}
        </span>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-2.5 pb-2.5">
        {jobs.map((j) => {
          const due = deadlineInfo(j.deadline, j.stage);
          const assignee = stage === "qc2" ? j.qc2_reviewer_name : j.editor_name;
          return (
            <button
              type="button"
              key={j.id}
              onClick={() => onSelect(j.id)}
              title={TONE_LABELS[jobRowTone(j)] || undefined}
              aria-label={`${j.title}, ${STAGE_LABELS[stage]}, ${due.label}`}
              className={`flex w-full flex-col gap-2 rounded-[10px] border border-[var(--border-color)] p-3 text-left shadow-[var(--shadow-card)] transition-colors hover:border-[var(--primary)] ${jobCardClass(j)}`}
            >
              {/* Everything the table shows, so the two views never disagree:
                  code, type, rush, cut link, title, whose move, client and
                  channel, editor, QC reviewer, deadline (and the actual one),
                  rounds, and — on scrapped work — who and why. */}
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-dim)]">
                  <span className="flex items-center gap-1.5 truncate">
                    <span className="truncate font-mono">{j.code}</span>
                    {j.frame_link && <i className="ri-film-line" title="A cut is linked" />}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <RushBadge rush={j.rush} />
                    <span className={`inline-flex h-5 items-center rounded-md px-1.5 font-bold ${videoTypeClass(j.video_type)}`}>
                      {videoTypeLabel(j.video_type, catalogTypes)}
                    </span>
                  </span>
                </div>
                <div className={`mt-1 line-clamp-2 text-sm font-bold leading-snug ${j.scrapped_at ? "line-through" : ""}`}>
                  {j.title}
                </div>
                {(j.is_mine || j.qc1_flagged_at) && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold">
                    {j.is_mine && <span className="text-[var(--primary-text)]">Waiting on you</span>}
                    {j.qc1_flagged_at && (
                      <span className="flex items-center gap-1 text-[var(--warn-text)]" title={j.qc1_flag_reason ?? undefined}>
                        <i className="ri-flag-2-fill" /> QC1 flagged
                      </span>
                    )}
                  </div>
                )}
                <div className="mt-1 truncate text-xs text-[var(--text-dim)]">
                  {j.pod_name} · {j.channel_name ?? "Not filed"}
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-[var(--border-color-subtle)] pt-2 text-xs">
                <div className="min-w-0">
                  <dt className="text-[var(--text-dim)]">Editor</dt>
                  <dd className="flex items-center gap-1.5 font-semibold">
                    {j.editor_name ? (
                      <>
                        <Avatar name={j.editor_name} size={20} />
                        <span className="truncate">{j.editor_name}</span>
                      </>
                    ) : (
                      <span className="text-[var(--text-dim)]">Unassigned</span>
                    )}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[var(--text-dim)]">QC reviewer</dt>
                  <dd className="flex items-center gap-1.5 font-semibold">
                    {j.qc2_reviewer_name ? (
                      <>
                        <Avatar name={j.qc2_reviewer_name} size={20} />
                        <span className="truncate">{j.qc2_reviewer_name}</span>
                      </>
                    ) : (
                      <span className="text-[var(--text-dim)]">Not routed</span>
                    )}
                  </dd>
                </div>
              </dl>

              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span
                    className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-bold ${DEADLINE_CHIP_CLASSES[due.tone]}`}
                  >
                    <i className={DEADLINE_CHIP_ICONS[due.tone]} /> {due.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--text-dim)]">
                    {j.deadline ? formatFullDate(j.deadline) : "No deadline"}
                    {j.client_deadline && <> · actual {formatFullDate(j.client_deadline)}</>}
                  </span>
                </span>
                <span
                  className={`num shrink-0 text-xs font-bold ${j.round >= 3 ? "text-[var(--bad-text)]" : j.round > 0 ? "text-[var(--warn-text)]" : "text-[var(--text-dim)]"}`}
                  title="Revision rounds"
                >
                  R{j.round}
                </span>
              </div>

              {j.scrapped_at && (
                <div className="border-t border-[var(--border-color-subtle)] pt-2 text-xs text-[var(--text-muted)]">
                  Scrapped by {j.scrapped_by_name ?? "—"} · {timeAgo(j.scrapped_at)}
                  {j.scrap_reason && <span className="mt-0.5 block line-clamp-2">{j.scrap_reason}</span>}
                </div>
              )}
            </button>
          );
        })}

        {matchesFilters && isPending && !collapsed && <SkeletonCards count={3} className="h-[112px]" />}

        {jobs.length === 0 && (!matchesFilters || !isPending) && !(matchesFilters && isError) && (
          <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center text-[var(--text-dim)]">
            <i className="ri-inbox-line text-xl" />
            <span className="text-[13px] font-semibold">Nothing in {STAGE_LABELS[stage]}</span>
          </div>
        )}

        {matchesFilters && isError && (
          <ErrorState what="these jobs" onRetry={() => void refetch()} className="!p-3" />
        )}

        {hasNextPage && matchesFilters && !isError && (
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? "Loading..." : `+${total - jobs.length} more`}
          </Button>
        )}
      </div>
    </div>
  );
}
