import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";

import { TeamCapacityPanel } from "@/components/capacity/TeamCapacityPanel";
import { BrandKitHub } from "@/components/brand/BrandKitHub";
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
import { Button } from "@/components/ui/Button";
import { FilterMenu } from "@/components/ui/FilterMenu";
import { Pagination } from "@/components/ui/Pagination";
import { RushBadge } from "@/components/ui/RushBadge";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
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

  const [viewMode, setViewMode] = useState<"kanban" | "table">("table");
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
    { enabled: viewTab === "pipeline" && viewMode === "table", refetchInterval: 30_000 },
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
        <div className="space-y-6">
          {/* Top KPI Stat Tiles */}
          {/* Wraps onto a second row rather than squeezing seven tiles into
              one: these are read, not glanced at. */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {/* First tile, and clickable, because "what is waiting on me" is
                the question people open this page with. It lands on the
                pipeline already filtered rather than making them find the
                tab. */}
            {showMine && (
              <button
                type="button"
                onClick={() => openPipeline("mine")}
                className="glass-card p-5 text-left transition-all hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">ON MY PLATE</span>
                  <div className="w-9 h-9 rounded-lg bg-[var(--primary-glow-subtle)] text-[var(--primary-light)] flex items-center justify-center text-lg"><i className="ri-user-line" /></div>
                </div>
                <div className="text-3xl font-extrabold font-mono mt-2 text-[var(--primary-light)]">
                  {statusCounts ? statusCounts.mine : "—"}
                </div>
                <div className="text-xs text-[var(--text-muted)] mt-1">
                  {statusCounts?.mine ? "Waiting on you right now" : "Nothing is waiting on you"}
                </div>
              </button>
            )}

            {/* Counts what the ACTIVE tab lists, which it did not used to: this
                number included every unassigned video, so a board with 15 cuts
                in progress and 43 waiting to be handed out reported 58 "in
                flight" and the tile disagreed with the tab it opened. */}
            <button
              type="button"
              onClick={() => openPipeline("active")}
              className="glass-card p-5 text-left transition-all hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">IN FLIGHT JOBS</span>
                <div className="w-9 h-9 rounded-lg bg-purple-500/15 text-purple-400 flex items-center justify-center text-lg"><i className="ri-film-line" /></div>
              </div>
              <div className="text-3xl font-extrabold font-mono mt-2">{overview ? overview.in_flight : "—"}</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">Assigned and moving</div>
            </button>

            {/* The other half of what that number used to be, and the half
                somebody has to act on: videos that have arrived with nobody on
                them. A to-do list, not a status. */}
            <button
              type="button"
              onClick={() => openPipeline("intake")}
              className="glass-card p-5 text-left transition-all hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">AWAITING ASSIGNMENT</span>
                <div className="w-9 h-9 rounded-lg bg-amber-500/15 text-amber-400 flex items-center justify-center text-lg"><i className="ri-inbox-line" /></div>
              </div>
              <div className={`text-3xl font-extrabold font-mono mt-2 ${overview?.intake ? "text-amber-400" : "text-[var(--text-main)]"}`}>
                {overview ? overview.intake : "—"}
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1">
                {overview?.intake ? "Arrived, no editor picked yet" : "Everything has an editor"}
              </div>
            </button>

            <button
              type="button"
              onClick={() => openPipeline("overdue")}
              className="glass-card p-5 text-left transition-all hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">OVERDUE</span>
                <div className="w-9 h-9 rounded-lg bg-rose-500/15 text-rose-400 flex items-center justify-center text-lg"><i className="ri-alarm-warning-line" /></div>
              </div>
              <div className={`text-3xl font-extrabold font-mono mt-2 ${overview?.overdue ? "text-[var(--accent-red)]" : "text-[var(--text-main)]"}`}>
                {overview ? overview.overdue : "—"}
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1">
                {overview?.overdue ? "Past deadline, not delivered" : "Nothing past its deadline"}
              </div>
            </button>

            {/* Analytics rather than the Delivered tab — the Delivered tile
                already goes there, and the question this number raises ("whose
                work, which client") is the one Analytics breaks down. */}
            <Link
              to="/analytics"
              title="Open Analytics — first-pass rate and average rounds, per client and per editor"
              className="glass-card block p-5 text-left transition-all hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">FIRST-PASS SUCCESS</span>
                <div className="w-9 h-9 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-lg"><i className="ri-checkbox-circle-line" /></div>
              </div>
              <div className={`text-3xl font-extrabold font-mono mt-2 ${overview?.first_pass_pct == null ? "text-[var(--text-dim)]" : "text-[var(--accent-green)]"}`}>
                {overview?.first_pass_pct == null ? "—" : `${overview.first_pass_pct}%`}
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1">
                {overview?.first_pass_pct == null
                  ? "No deliveries yet to measure"
                  : `${overview.clean_delivered} of ${overview.delivered} delivered with no revision round`}
              </div>
            </Link>

            {/* The only tile that counts a stage rather than a status, so it
                lands on the stage chip as well as the tab. */}
            <button
              type="button"
              onClick={() => openPipelineStage("active", ["qc1"])}
              className="glass-card p-5 text-left transition-all hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">PENDING QC1</span>
                <div className="w-9 h-9 rounded-lg bg-amber-500/15 text-amber-400 flex items-center justify-center text-lg"><i className="ri-eye-line" /></div>
              </div>
              <div className="text-3xl font-extrabold font-mono text-amber-400 mt-2">{overview ? overview.pending_qc1 : "—"}</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">First-pass review, with the pod TL</div>
            </button>

            {/* Delivered work had no tile and no tab: it is excluded from
                every in-flight number by design, so the dashboard counted it
                nowhere and the pipeline showed it only under ALL. */}
            <button
              type="button"
              onClick={() => openPipeline("delivered")}
              className="glass-card p-5 text-left transition-all hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">DELIVERED</span>
                <div className="w-9 h-9 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-lg"><i className="ri-rocket-line" /></div>
              </div>
              <div className="text-3xl font-extrabold font-mono mt-2 text-[var(--accent-green)]">
                {overview ? overview.delivered : "—"}
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1">
                {overview?.delivered ? "Signed off and sent to the client" : "Nothing delivered yet"}
              </div>
            </button>

            {/* A process number, not a job one: one flag is a bad day, six is
                a TL who has stopped reviewing. Amber, matching the tint the
                rows themselves wear. */}
            <button
              type="button"
              onClick={openFlagged}
              title="Jobs a QC2 reviewer says never got a real QC1"
              className="glass-card p-5 text-left transition-all hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">QC1 FLAGGED</span>
                <div className="w-9 h-9 rounded-lg bg-amber-500/15 text-[var(--accent-amber)] flex items-center justify-center text-lg"><i className="ri-flag-2-line" /></div>
              </div>
              <div className={`text-3xl font-extrabold font-mono mt-2 ${overview?.qc1_flagged ? "text-[var(--accent-amber)]" : "text-[var(--text-main)]"}`}>
                {overview ? overview.qc1_flagged : "—"}
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1">
                {overview?.qc1_flagged
                  ? "Passed through QC1 without a review"
                  : "No QC1 has been flagged"}
              </div>
            </button>
          </div>

          {/* Pod Cards Overview Grid */}
          <div>
            <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
              <i className="ri-layout-grid-line text-purple-400" /> Client Pod Status Overview
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {overview?.pods.map((p) => {
                /* The chip states what we actually know: the pod's own status
                 * first (a paused client isn't "on track", it's paused), then
                 * whether anything in it has blown its deadline. */
                const chip =
                  p.status !== "active"
                    ? {
                        label: POD_STATUS_LABEL[p.status],
                        className: "bg-[var(--bg-pill)] text-[var(--text-muted)] border-[var(--border-color)]",
                      }
                    : p.overdue > 0
                      ? {
                          label: `${p.overdue} overdue`,
                          className: "bg-[var(--accent-red-bg)] text-[var(--accent-red)] border-rose-500/20",
                        }
                      : {
                          label: "Active",
                          className: "bg-[var(--accent-green-bg)] text-[var(--accent-green)] border-emerald-500/20",
                        };
                return (
                  <button
                    type="button"
                    key={p.pod_id}
                    onClick={() => openPodPipeline(p.pod_id)}
                    title={`Open ${p.pod_name} in the pipeline table`}
                    className="glass-card p-5 text-left w-full border-glow hover:-translate-y-1 transition-all"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="font-bold text-base truncate">{p.pod_name}</h4>
                        <p className="text-xs text-[var(--text-muted)] flex items-center gap-1 mt-0.5">
                          <i className="ri-table-line" /> Open pipeline
                        </p>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold border shrink-0 ${chip.className}`}>
                        {chip.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-4 pt-3 border-t border-[var(--border-color-subtle)] text-xs">
                      <div><span className="text-[var(--text-dim)] block">In Flight</span><span className="font-mono font-bold text-sm">{p.in_flight}</span></div>
                      {/* Amber when there is a backlog: a client whose work is
                          all sitting unassigned looks identical to a quiet one
                          on the other three numbers. */}
                      <div><span className="text-[var(--text-dim)] block">Intake</span><span className={`font-mono font-bold text-sm ${p.intake ? "text-amber-400" : ""}`}>{p.intake}</span></div>
                      <div><span className="text-[var(--text-dim)] block">Delivered</span><span className="font-mono font-bold text-sm">{p.delivered}</span></div>
                      <div><span className="text-[var(--text-dim)] block">In QC</span><span className="font-mono font-bold text-sm">{p.in_qc}</span></div>
                    </div>
                  </button>
                );
              })}
              {overview?.pods.length === 0 && (
                <p className="glass-card p-5 text-xs text-[var(--text-muted)]">
                  No client pods yet. Onboard a client and its jobs, editors and QC routing all hang off that pod.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= VIEW 2: PIPELINE BOARD ================= */}
      {viewTab === "pipeline" && (
        <div className="space-y-5">
          {/* Status Cards — each one is the filter it counts, so clicking a
              number always lands on exactly the rows behind it. */}
          <div
            className={`grid grid-cols-2 gap-4 sm:grid-cols-3 ${CARD_GRID_COLS[STATUS_CARDS.length] ?? "lg:grid-cols-4"}`}
          >
            {STATUS_CARDS.map((card) => (
              <button
                key={card.key}
                onClick={() => setFilter(card.key)}
                title={card.hint}
                className={`glass-card p-4 text-left transition-all hover:-translate-y-0.5 ${filter === card.key ? "border-glow border-[var(--primary)]" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-dim)]">{card.label}</span>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-base ${card.iconWrapClass}`}>
                    <i className={card.icon} />
                  </div>
                </div>
                <div className={`text-2xl font-extrabold font-mono mt-2 ${card.countClass}`}>
                  {statusCounts ? statusCounts[card.key] : "—"}
                </div>
              </button>
            ))}
          </div>

          {/* Search, view and status stay visible while detailed filters can
              collapse on a phone. */}
          <div className="glass-card p-3 sm:p-4 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex w-full min-w-0 gap-2 sm:max-w-xl">
              <div className="relative min-w-0 flex-1">
                <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
                <input
                  type="search"
                  aria-label="Search jobs by title or code"
                  placeholder="Search jobs by title or code..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                aria-expanded={filtersOpen}
                aria-controls="pipeline-filter-drawer"
                className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-xl border border-[var(--primary)] bg-[var(--primary-glow-subtle)] px-4 text-xs font-bold text-[var(--primary-light)] hover:bg-[var(--primary-glow)] sm:self-auto"
              >
                <i className="ri-equalizer-2-line text-base text-[var(--primary-light)]" /> Filters
                {activeFilterCount > 0 && <span className="rounded-full bg-[var(--primary)] px-1.5 py-0.5 text-[10px] text-white">{activeFilterCount}</span>}
              </button>
              </div>
              <div className="flex shrink-0 items-center gap-1 self-start rounded-xl border border-[var(--border-color)] bg-[var(--bg-pill)] p-1 sm:self-auto" role="group" aria-label="Pipeline view">
                <button
                  type="button"
                  onClick={() => setViewMode("kanban")}
                  aria-pressed={viewMode === "kanban"}
                  className={`flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold ${viewMode === "kanban" ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)]"}`}
                >
                  <i className="ri-kanban-view" /> Board
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("table")}
                  aria-pressed={viewMode === "table"}
                  className={`flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold ${viewMode === "table" ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)]"}`}
                >
                  <i className="ri-table-line" /> Table
                </button>
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Job status">
              {statusFilters.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  aria-pressed={filter === f}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    filter === f
                      ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                      : "border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:border-[var(--primary)]"
                  }`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
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
          {viewMode === "kanban" && (
            <div
              ref={boardRef}
              style={boardHeight ? { height: boardHeight } : undefined}
              className="flex items-stretch gap-4 overflow-x-auto pb-4"
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
              <span className="rounded bg-[var(--bg-card)] px-2 py-0.5 text-[11px] font-bold text-[var(--primary-light)]">
                {checkedJobs.length} selected
              </span>

              {retryableCount > 0 && (
                <Button
                  type="button"
                  className="!px-2 !py-1 !text-[10px]"
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
                    <label className="text-[10px] font-bold uppercase text-[var(--text-dim)]">
                      File under
                    </label>
                    <SearchableSelect value={bulkChannelId} onChange={setBulkChannelId} placeholder="Choose a channel..." options={[{ value: "", label: "Choose a channel..." }, ...bulkChannelOptions.map((channel) => ({ value: channel.id, label: channel.name }))]} />
                    <Button
                      type="button"
                      className="!px-2 !py-1 !text-[10px]"
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
                <span className="text-[11px] text-[var(--text-muted)]">
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
                className="text-[11px] font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--accent-amber)] disabled:opacity-50"
              >
                <i className="ri-eraser-line" /> Unfile
              </button>

              <button
                type="button"
                onClick={() => setCheckedIds([])}
                className="ml-auto text-[11px] font-semibold text-[var(--text-dim)] transition-colors hover:text-[var(--text-main)]"
              >
                <i className="ri-close-circle-line" /> Clear selection
              </button>
            </div>
          )}

          {/* Table Board View */}
          {viewMode === "table" && (
            <div className="glass-card overflow-x-auto">
              <table className="w-max min-w-full text-left text-sm md:text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-color)] text-[var(--text-dim)] font-bold uppercase tracking-wider">
                    {/* Only for the rows this person can act on — a column of
                        permanently disabled boxes is worse than no column. */}
                    {canFileAny && (
                      <th className="p-4 w-8">
                        <input
                          type="checkbox"
                          aria-label="Select every video on this page"
                          checked={allChecked}
                          onChange={toggleCheckAll}
                          className="h-3.5 w-3.5 accent-[var(--primary)]"
                        />
                      </th>
                    )}
                    {SORT_COLUMNS.map((col) => (
                      <th
                        key={col.field}
                        onClick={() => toggleSort(col.field)}
                        className="p-4 cursor-pointer select-none hover:text-[var(--text-main)]"
                      >
                        <span className="flex items-center gap-1">
                          {col.label}
                          <i
                            className={
                              sortBy === col.field
                                ? sortDir === "asc"
                                  ? "ri-arrow-up-s-line text-[var(--primary)]"
                                  : "ri-arrow-down-s-line text-[var(--primary)]"
                                : "ri-expand-up-down-line opacity-30"
                            }
                          />
                        </span>
                      </th>
                    ))}
                    <th className="p-4">Editor</th>
                    <th className="p-4">QC Reviewer</th>
                    <th
                      onClick={() => toggleSort("round")}
                      className="p-4 cursor-pointer select-none hover:text-[var(--text-main)]"
                    >
                      <span className="flex items-center gap-1">
                        Rounds
                        <i
                          className={
                            sortBy === "round"
                              ? sortDir === "asc"
                                ? "ri-arrow-up-s-line text-[var(--primary)]"
                                : "ri-arrow-down-s-line text-[var(--primary)]"
                              : "ri-expand-up-down-line opacity-30"
                          }
                        />
                      </span>
                    </th>
                    {/* Who killed it and why, but only on the tab that is
                        about killed work — three dead columns on every other
                        tab would push the deadline off the screen. */}
                    {showScrapColumns && (
                      <>
                        <th className="p-4">Scrapped by</th>
                        <th className="p-4">Reason</th>
                      </>
                    )}
                    <th className="p-4 w-8" />
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
                        className={`border-b border-[var(--border-color-subtle)] hover:bg-[var(--bg-pill)] cursor-pointer transition-colors ${jobRowClass(j)} ${
                          selectedJobId === j.id ? "ring-1 ring-inset ring-[var(--primary)]" : ""
                        }`}
                      >
                        {canFileAny && (
                          <td className="p-4" onClick={(e) => e.stopPropagation()}>
                            {canFileJob(j, user) ? (
                              <input
                                type="checkbox"
                                aria-label={`Select ${j.title}`}
                                checked={checkedIds.includes(j.id)}
                                onChange={() => toggleChecked(j.id)}
                                className="h-3.5 w-3.5 accent-[var(--primary)]"
                              />
                            ) : null}
                          </td>
                        )}
                        <td className="p-4">
                          <div
                            className={`font-bold text-[var(--text-main)] ${tone === "scrapped" ? "line-through" : ""}`}
                          >
                            {j.title}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--text-dim)]">
                            <span className="font-mono">{j.code}</span>
                            {j.frame_link && <i className="ri-film-line" title="A cut is linked" />}
                            {/* The channel has its own column now — repeating it
                                here was the only place it appeared, and two
                                copies of one fact in one row is noise. */}
                            {/* Read off `is_mine`, not off the row tone: a
                                flagged or delivered row is tinted for another
                                reason and would otherwise silently stop
                                saying whose move it is. */}
                            {j.is_mine && (
                              <span className="font-semibold text-[var(--primary-light)]">
                                Waiting on you
                              </span>
                            )}
                            {j.qc1_flagged_at && (
                              <span
                                className="flex items-center gap-1 font-semibold text-[var(--accent-amber)]"
                                title={j.qc1_flag_reason ?? undefined}
                              >
                                <i className="ri-flag-2-fill" /> QC1 flagged
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-4"><StageBadge stage={j.stage} /></td>
                        {/* The date the work is done to, which is what this
                            column has always been. A lead's row also carries
                            the actual deadline — as a tooltip rather than a
                            tenth column, since the table is already dense and
                            the panel spells it out. Nobody else's payload has
                            the field, so nobody else gets the tooltip. */}
                        <td
                          className="p-4"
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
                          <div className={`font-semibold ${DEADLINE_TONE_CLASSES[due.tone]}`}>{due.label}</div>
                          <div className="flex items-center gap-1 text-[10px] text-[var(--text-dim)]">
                            {j.deadline ? formatFullDate(j.deadline) : "—"}
                            {j.client_deadline && <i className="ri-flag-line" />}
                          </div>
                        </td>
                        <td className="p-4">
                          <span
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold ${VIDEO_TYPE_CLASSES[j.video_type] ?? ""}`}
                          >
                            <i className={VIDEO_TYPE_ICONS[j.video_type]} />
                            {videoTypeLabel(j.video_type, catalogTypes)}
                          </span>
                        </td>
                        {/* Its own cell, because the header row has always had
                            its own Rush column. The badge used to sit inside
                            the video-type cell above, which left this column
                            permanently blank and every cell from Client Pod
                            rightwards sitting one column left of its heading. */}
                        <td className="p-4">
                          {j.rush ? (
                            <RushBadge rush />
                          ) : (
                            <span className="text-[var(--text-dim)]">—</span>
                          )}
                        </td>
                        <td className="p-4">{j.pod_name}</td>
                        <td className="p-4 w-36">
                          <ChannelCell
                            job={j}
                            channels={(allChannels ?? []).filter((c) => c.pod_id === j.pod_id)}
                            canFile={canFileJob(j, user)}
                          />
                        </td>
                        <td className="p-4">
                          {j.editor_name ?? <span className="text-[var(--text-dim)]">Unassigned</span>}
                        </td>
                        <td className="p-4">
                          {j.qc2_reviewer_name ?? <span className="text-[var(--text-dim)]">Not routed</span>}
                        </td>
                        <td className="p-4">
                          <span
                            className={`font-mono font-bold ${j.round >= 3 ? "text-rose-400" : j.round > 0 ? "text-amber-400" : "text-[var(--text-dim)]"}`}
                          >
                            {j.round}
                          </span>
                        </td>
                        {showScrapColumns && (
                          <>
                            <td className="p-4">
                              <div>{j.scrapped_by_name ?? "—"}</div>
                              <div className="text-[10px] text-[var(--text-dim)]">
                                {j.scrapped_at ? timeAgo(j.scrapped_at) : ""}
                              </div>
                            </td>
                            <td className="p-4 max-w-[22rem]">
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
                        <td className="p-4 text-[var(--text-dim)]"><i className="ri-arrow-right-s-line text-base" /></td>
                      </tr>
                    );
                  })}
                  {!isLoading && filteredJobs.length === 0 && (
                    <tr>
                      {/* Counted off the header rather than hard-coded — the
                          number was already two short of the columns above it,
                          which is what adding one silently costs. Editor, QC
                          reviewer, Rounds and the chevron are the four that
                          aren't sortable; the checkbox column cannot be here,
                          since an empty page has no rows to tick. */}
                      <td
                        colSpan={SORT_COLUMNS.length + 4 + (showScrapColumns ? 2 : 0)}
                        className="p-8 text-center text-[var(--text-muted)]"
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
                              className="font-semibold text-[var(--primary-light)] underline underline-offset-2"
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

              <Pagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                noun="jobs"
                className="border-t border-[var(--border-color-subtle)]"
              />
            </div>
          )}
        </div>
      )}

      {isLoading && viewTab === "pipeline" && (
        <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <i className="ri-loader-4-line animate-spin" /> Loading jobs...
        </p>
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
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-dim)]">
                Phase 2
              </span>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-[var(--text-muted)]">{PHASE_2_VIEWS[viewTab].body}</p>
          <p className="text-[11px] text-[var(--text-dim)]">
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

/** One board column, with its own paged server query and total. */
function BoardColumn({
  stage,
  filters,
  status,
  enabled,
  onSelect,
}: {
  stage: Stage;
  filters: JobFilters;
  status: JobStatusFilter;
  enabled: boolean;
  onSelect: (jobId: string) => void;
}) {
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
    { enabled: enabled && matchesFilters, refetchInterval: 30_000 },
  );
  const jobs = matchesFilters ? data?.pages.flatMap((page) => page.items) ?? [] : [];
  const { data: catalogTypes = [] } = useVideoTypes();
  const total = matchesFilters ? data?.pages[0]?.total ?? 0 : 0;

  return (
    <div className="w-[calc(100vw-2rem)] max-w-[320px] shrink-0 md:w-[320px] h-full bg-[var(--bg-card)] border border-[var(--border-color-subtle)] rounded-xl flex flex-col">
      <div className="p-3 border-b border-[var(--border-color-subtle)] flex items-center justify-between">
        <span className="font-bold text-sm md:text-xs flex items-center gap-2">
          {STAGE_LABELS[stage]}{" "}
          <span className="px-2 py-0.5 rounded bg-[var(--bg-pill)] text-xs font-mono">{total}</span>
        </span>
        <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400">
          {STAGE_OWNERS[stage]}
        </span>
      </div>

      <div className="p-3 flex-1 overflow-y-auto space-y-3">
        {jobs.map((j) => {
          const due = deadlineInfo(j.deadline, j.stage);
          return (
            <button
              type="button"
              key={j.id}
              onClick={() => onSelect(j.id)}
              title={TONE_LABELS[jobRowTone(j)] || undefined}
              className={`group relative w-full p-3.5 border hover:z-10 hover:border-[var(--primary)] hover:scale-[1.02] focus-visible:z-10 focus-visible:scale-[1.02] rounded-lg text-left transition-transform shadow-md ${jobCardClass(j)}`}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-dim)]">
                <span className="font-mono">{j.code}</span>
              </div>
              <div
                className={`mt-1 text-sm font-semibold ${j.scrapped_at ? "line-through" : ""}`}
              >
                {j.title}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <StageBadge stage={j.stage} />
                <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold ${VIDEO_TYPE_CLASSES[j.video_type] ?? ""}`}>
                  <i className={VIDEO_TYPE_ICONS[j.video_type] ?? "ri-film-line"} /> {videoTypeLabel(j.video_type, catalogTypes)}
                </span>
              </div>
              <dl className="mt-3 space-y-2 border-t border-[var(--border-color-subtle)] pt-2 text-sm md:text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-[var(--text-dim)]">Editor</dt>
                  <dd className="min-w-0 text-right break-words">{j.editor_name ?? "Unassigned"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-[var(--text-dim)]">QC Reviewer</dt>
                  <dd className="min-w-0 text-right break-words">{j.qc2_reviewer_name ?? "Not routed"}</dd>
                </div>
              </dl>
              <div className="mt-2 hidden border-t border-[var(--border-color-subtle)] pt-2 group-hover:block group-focus-visible:block">
                {(j.frame_link || j.is_mine || j.qc1_flagged_at) && (
                  <div className="flex flex-wrap items-center gap-2 text-[var(--text-dim)]">
                    {j.frame_link && <i className="ri-film-line" title="A cut is linked" />}
                    {j.is_mine && <span className="font-semibold text-[var(--primary-light)]">Waiting on you</span>}
                    {j.qc1_flagged_at && (
                      <span className="font-semibold text-[var(--accent-amber)]" title={j.qc1_flag_reason ?? undefined}>
                        <i className="ri-flag-2-fill" /> QC1 flagged
                      </span>
                    )}
                  </div>
                )}
                <dl className="space-y-2 text-sm md:text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-[var(--text-dim)]">Rush</dt>
                  <dd>{j.rush ? <RushBadge rush /> : "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-[var(--text-dim)]">Deadline</dt>
                  <dd className="text-right">
                    <span className={`font-semibold ${DEADLINE_TONE_CLASSES[due.tone]}`}>{due.label}</span>
                    <span className="block text-[var(--text-muted)]">{formatFullDate(j.deadline)}</span>
                  </dd>
                </div>
                {j.client_deadline && (
                  <div className="flex justify-between gap-2">
                    <dt className="shrink-0 text-[var(--text-dim)]">Actual deadline</dt>
                    <dd className="text-right text-[var(--text-muted)]">
                      {formatFullDate(j.client_deadline)}
                      {deadlineBuffer(j.deadline, j.client_deadline) && (
                        <span className="block">{deadlineBuffer(j.deadline, j.client_deadline)!.label}</span>
                      )}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-[var(--text-dim)]">Client Pod</dt>
                  <dd className="min-w-0 text-right font-semibold break-words">{j.pod_name}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-[var(--text-dim)]">Channel</dt>
                  <dd className="min-w-0 text-right break-words">{j.channel_name ?? "Not filed"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-[var(--text-dim)]">Rounds</dt>
                  <dd className={`font-mono font-bold ${j.round >= 3 ? "text-rose-400" : j.round > 0 ? "text-amber-400" : "text-[var(--text-dim)]"}`}>
                    {j.round}
                  </dd>
                </div>
                {j.scrapped_at && (
                  <>
                    <div className="flex justify-between gap-2">
                      <dt className="shrink-0 text-[var(--text-dim)]">Scrapped by</dt>
                      <dd className="min-w-0 text-right break-words">
                        {j.scrapped_by_name ?? "—"}
                        <span className="block text-[var(--text-dim)]">{timeAgo(j.scrapped_at)}</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--text-dim)]">Reason</dt>
                      <dd className="mt-0.5 break-words text-[var(--text-muted)]">{j.scrap_reason ?? "—"}</dd>
                    </div>
                  </>
                )}
                </dl>
              </div>
            </button>
          );
        })}

        {matchesFilters && isPending && (
          <p className="text-center text-xs text-[var(--text-dim)]">Loading jobs...</p>
        )}

        {jobs.length === 0 && (!matchesFilters || !isPending) && !(matchesFilters && isError) && (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center text-[var(--text-dim)]">
            <i className="ri-inbox-line text-xl opacity-50" />
            <span className="text-xs font-semibold">Nothing in {STAGE_LABELS[stage]}</span>
          </div>
        )}

        {matchesFilters && isError && (
          <button type="button" onClick={() => void refetch()} className="w-full text-center text-xs text-[var(--accent-red)]">
            Could not load jobs. Retry
          </button>
        )}

        {hasNextPage && matchesFilters && !isError && (
          <button
            type="button"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-pill)] px-3 py-2 text-xs font-semibold text-[var(--text-main)] hover:border-[var(--primary)] disabled:cursor-wait disabled:opacity-60"
          >
            {isFetchingNextPage ? "Loading..." : `+${total - jobs.length} more · Load 10 more`}
          </button>
        )}
      </div>
    </div>
  );
}
