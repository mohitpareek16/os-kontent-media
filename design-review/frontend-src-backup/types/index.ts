/** What somebody may *do*. Not what they are called — that is `role_title`
 * on the account, and it grants nothing.
 *
 * - `owner` — the whole workspace, and the only role that administers
 *   accounts. Ask `isAdmin()` from `@/lib/roles`, never `role === "owner"`.
 * - `tl` — a Team Lead, on the pods where they are `Pod.tl_id`. Can be held
 *   as a *secondary* role by anyone (see `User.secondary_role`), which is how
 *   an editor or an HR comes to run client pods of their own.
 * - `qc`, `ve` — the review and edit queues.
 * - `hr` — people-ops: the roster and onboarding, and nothing else.
 * - `fo` — the Founder's Office. A name with no powers of its own since the
 *   role rework; existing accounts hold `secondary_role: "tl"`.
 * - `staff` — no powers at all. Everyone the pipeline has no word for
 *   (Graphic Designer, Social Media) is this, plus a `role_title`. */
export type Role = "owner" | "tl" | "qc" | "ve" | "hr" | "fo" | "staff";

export type Stage =
  | "intake"
  | "assigned"
  | "editing"
  | "qc1"
  | "qc2"
  | "revisions"
  | "final"
  | "delivered";

export type PodStatus = "active" | "paused" | "churned";

export interface Pod {
  id: string;
  name: string;
  tl_id: string;
  status: PodStatus;
  billing_currency: string;
  retainer_volume: number | null;
}

export interface PodStatusCounts {
  all: number;
  active: number;
  paused: number;
  churned: number;
}

export interface PodMember {
  user_id: string;
  name: string;
  email: string;
  /** Their account role, which may differ from what they do in this pod. */
  role: Role;
  pod_role: "tl" | "qc" | "ve";
  certified_at: string | null;
}

/** What kind of video this is. The column that replaced `weight` on every
 * screen — the format is what a brief actually says, where the weight was a
 * difficulty guess made at the moment nobody knew yet. */
export type VideoType = string;

export interface VideoTypeConfig {
  key: string;
  label: string;
  qc_points: number;
  enabled: boolean;
  sort_order: number;
}

/** Still on every job, still what QC routing counts in, and no longer asked
 * for or shown anywhere — see migration 0018. */
export type Weight = "light" | "standard" | "heavy";

export interface Job {
  id: string;
  code: string;
  title: string;
  pod_id: string;
  /** Which of the client's channels this video is for — Dhan HQ against AAD.
   * Null on every job created before channels existed, and on any the TL
   * hasn't filed yet: a blank chip is honest, a guessed one is not. */
  channel_id: string | null;
  stage: Stage;
  video_type: VideoType;
  weight: Weight;
  /** "This one cannot wait for somebody to free up." It buys exactly one
   * thing: when no QC reviewer has room, a rush job may be pushed onto the
   * least-loaded of them at up to 125% of their day instead of holding in the
   * unrouted pile. Not a priority sort, and it does not change what the review
   * costs — see docs/12-qc2-load-model.md. */
  rush: boolean;
  assigned_editor_id: string | null;
  qc2_reviewer_id: string | null;
  /** Which desk sent this cut back, while the editor works on the changes.
   * The re-submit goes there and nowhere else — a QC2 send-back returns to
   * QC2, not through QC1 again. Null on a job that has never been sent back. */
  sent_back_from: "qc1" | "qc2" | "final" | null;
  frame_link: string | null;
  round: number;
  /** The date the pod works to, and the only one an editor or a QC is ever
   * shown — so on screen it is called simply "Deadline", for everybody
   * (`DEADLINE_LABEL`). Every queue, row tint and overdue count reads this. */
  deadline: string | null;
  /** The **"Actual deadline"** (`ACTUAL_DEADLINE_LABEL`) — what the client
   * was really promised, which is usually a few days later than the date the
   * team works to. Null means one of two
   * things and the difference is the point: "none set" if you are a lead on
   * this pod, and "you are not shown this" if you are not. The server
   * redacts it rather than the browser hiding it, so on an editor's session
   * the field genuinely is not in the payload. */
  client_deadline: string | null;
  delivered_at: string | null;
  client_sheet_ok: boolean;
  ops_tracker_ok: boolean;
  created_at: string;
  /** Set when the project was cancelled before delivery. Scrapping is not a
   * stage — the job keeps the stage it died at — so this timestamp, not
   * `stage`, is what "is this job dead" reads. */
  scrapped_at: string | null;
  scrapped_by_id: string | null;
  scrap_reason: string | null;
  /** Set when the QC2 reviewer says this cut never had a real QC1 — the TL
   * passed it straight through. Not a stage and not a send-back: the job
   * carries on where it was, the flag is a statement about what already
   * happened to it. `qc1_flag_tl_id` is who cleared QC1, snapshotted when the
   * flag was raised; `qc1_flagged_by_id` is the reviewer who raised it. */
  qc1_flagged_at: string | null;
  qc1_flagged_by_id: string | null;
  qc1_flag_tl_id: string | null;
  qc1_flag_reason: string | null;
}

/** What `GET /jobs` and `GET /jobs/{id}` actually return: a Job plus the
 * names behind its ids, resolved server-side. `GET /users` is owner/tl-only,
 * so these are the only way a VE or QC can see who owns what. */
export interface JobDetail extends Job {
  pod_name: string;
  channel_name: string | null;
  tl_id: string;
  tl_name: string | null;
  editor_name: string | null;
  qc2_reviewer_name: string | null;
  scrapped_by_name: string | null;
  /** Who raised the QC1 flag, and the TL it is about — two different people. */
  qc1_flagged_by_name: string | null;
  qc1_flag_tl_name: string | null;
  /** Is this job waiting on *me* right now — computed server-side from the
   * same rule the Mine tab counts with (`services/access.py::mine_clauses`).
   * Never re-derive it here: two implementations of "mine" is how the count
   * and the highlighted rows come to disagree. */
  is_mine: boolean;
}

export type JobSortField =
  /** The default, and not a column: rows are grouped by what state the work
   * is in — being worked on, waiting for an editor, delivered, scrapped —
   * and sorted by deadline inside each group, no-deadline last. Clicking a
   * column header replaces it outright rather than layering on top. */
  | "pipeline"
  | "title"
  | "code"
  | "stage"
  | "deadline"
  | "video_type"
  | "weight"
  | "rush"
  | "round"
  | "pod"
  | "channel"
  | "created_at";
/** The pipeline's status tabs. `mine` is "waiting on me right now", not
 * "has my name on it" — see `mine_clauses` on the server. `scrapped` is its
 * own tab because cancelled work is excluded from the other three; it is
 * still included in `all`, which means all.
 *
 * `delivered` is a tab for the same reason: finished work is excluded from
 * every other one by construction — a delivered job is never active, never
 * overdue, never Mine and cannot be scrapped. Without it, the only way to see
 * a delivered video was ALL, and picking Delivered in the stage filter while
 * the ACTIVE tab was selected returned nothing at all, which reads as "the
 * system lost it".
 *
 * `intake` and `active` are disjoint: intake is "arrived, nobody on it yet"
 * and active is "assigned and moving". Active used to mean "anything not
 * delivered" and so contained intake whole, which is why the two cards did
 * not add up and why unassigned rows sat interleaved with work in progress. */
export type JobStatusFilter =
  | "intake"
  | "active"
  | "overdue"
  | "mine"
  | "delivered"
  | "all"
  | "scrapped"
  /** Jobs a QC2 reviewer says never got a real QC1 — a tab rather than a
   * buried filter, because the admin deciding what to do about one has to be
   * able to find them. Cuts across every stage, delivered included. */
  | "flagged";

/** The shape every list endpoint answers in. `total` is the number of rows
 * matching the filters, not the number in `items` — the pager counts it, so
 * no screen has to download everything to know how much there is. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export type PaginatedJobs = Page<JobDetail>;

export interface JobStatusCounts {
  intake: number;
  active: number;
  overdue: number;
  mine: number;
  delivered: number;
  all: number;
  scrapped: number;
  flagged: number;
}

/** How the latest QC1 review went, derived server-side from the event log
 * (`services/qc1_review.py`). Facts, not a verdict: who cleared it, how long
 * it had been sitting at QC1, and whether they said anything while it was.
 *
 * `seconds` is null when the entry into QC1 isn't on the log — an unknown
 * duration must not render as an instant one when "it took no time at all" is
 * the very thing under question. */
/** How a QC1 review ended when the job went forward.
 *
 * `comments_added` means the TL left notes on Frame.io — the comments
 * themselves never come into this database (docs/03), so this flag is the
 * only trace of them, and it is what stops a real review from reading as a
 * rubber stamp to the QC2 reviewer downstream. */
export type Qc1Outcome = "approved" | "comments_added";

export interface Qc1Pass {
  round: number;
  entered_at: string | null;
  cleared_at: string;
  seconds: number | null;
  cleared_by_id: string | null;
  cleared_by_name: string | null;
  /** Notes left while it sat at QC1, plus the hand-off note on the move
   * itself. Zero is the number the flag exists for — unless `outcome` says
   * the comments were left on Frame.io, where this team writes them. */
  comments: number;
  /** Which QC1 button was pressed. Null on a pass recorded before the two
   * buttons existed, which is not the same as "approved" and is shown as
   * unknown rather than guessed. */
  outcome: Qc1Outcome | null;
}

export interface PodOverview {
  pod_id: string;
  pod_name: string;
  status: PodStatus;
  /** Assigned and moving — the ACTIVE tab's definition. */
  in_flight: number;
  /** Arrived, no editor picked yet. Counted apart from `in_flight`. */
  intake: number;
  delivered: number;
  in_qc: number;
  overdue: number;
}

/** Everything the Overview screen renders, counted server-side.
 * `first_pass_pct` is null when nothing has been delivered — there is no
 * rate yet, and 0% would read as every delivery having failed. */
export interface WorkspaceOverview {
  in_flight: number;
  /** Arrived and unassigned, across every pod. The one number on this screen
   * that is a to-do list rather than a status. */
  intake: number;
  overdue: number;
  delivered: number;
  clean_delivered: number;
  pending_qc1: number;
  first_pass_pct: number | null;
  /** Jobs whose QC1 a reviewer says never happened. A process number, not a
   * job one — one is a bad day, six is a TL who has stopped reviewing. */
  qc1_flagged: number;
  pods: PodOverview[];
}

/* --- Global search (the header box) --- */

/** A result row: what gets drawn, plus the id it navigates to. Deliberately
 * not `Job` / `Pod` / `User` — a dropdown line needs a title and a
 * destination, and the full read types would put an editor's phone number
 * into a list that only prints their name. */
/** Why a job came back for a query that appears nowhere in its own title or
 * code. The row prints it — "via client Dhan" — because a result whose text
 * does not contain what you typed otherwise reads as a broken search. */
export type SearchJobMatch = "job" | "pod" | "channel" | "editor" | "tl" | "reviewer";

export interface SearchJobHit {
  id: string;
  code: string;
  title: string;
  stage: Stage;
  pod_id: string;
  pod_name: string;
  channel_name: string | null;
  editor_name: string | null;
  matched_on: SearchJobMatch;
  /** Set when the project was killed. Search is the one surface that still
   * finds scrapped work — it has to be labelled, because nowhere else in the
   * product shows it. */
  scrapped_at: string | null;
}

export interface SearchPodHit {
  id: string;
  name: string;
  status: PodStatus;
  tl_name: string | null;
  /** Live work in this pod, scoped to what the searcher can see. */
  open_jobs: number;
  /** Channels the client is still publishing to. */
  channels: number;
}

/** One destination inside a client pod. Its own result kind because it is
 * usually the row somebody wanted — a channel is where the work goes, and the
 * pipeline table can filter by one. */
export interface SearchChannelHit {
  id: string;
  name: string;
  pod_id: string;
  pod_name: string;
  open_jobs: number;
  /** Retired, not deleted. Labelled rather than hidden: an archived channel
   * still names the work that went to it. */
  archived: boolean;
}

export interface SearchPersonHit {
  id: string;
  name: string;
  email: string;
  role: Role;
  is_active: boolean;
  /** The clients they work on, as far as the searcher can see. */
  pods: string[];
  /** Live jobs they are the editor or the QC2 reviewer of. */
  open_jobs: number;
}

export interface SearchResults {
  /** Echoed back by the server. Searches race — this is how a response that
   * lands after the user has typed on is recognised as stale. */
  query: string;
  jobs: SearchJobHit[];
  pods: SearchPodHit[];
  channels: SearchChannelHit[];
  people: SearchPersonHit[];
}

/* --- Kontent Bot (Phase 3) --- */

/** Which lookup the bot ran to produce an answer. `ok: false` means the
 * server refused it — the bot asked for something this user can't see. */
export interface ChatToolCall {
  name: string;
  arguments: Record<string, unknown>;
  ok: boolean;
}

export type ChartType = "bar" | "grouped_bar" | "stacked_bar" | "line" | "area" | "pie" | "donut";

/** A chart the bot asked for. Built and validated server-side by
 * `services/ai/tools/charts.py` — every series is guaranteed to hold exactly
 * one number per label, so the renderer never has to defend against ragged
 * data. Stored on the message, so reopening a thread shows the graph that
 * was actually shown rather than one redrawn from data that has since moved. */
export interface ChartSpec {
  chart_type: ChartType;
  title: string;
  labels: string[];
  series: { name: string; values: number[] }[];
  y_label: string | null;
  value_format: "number" | "percent" | "days" | "points";
  note: string | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tool_calls: ChatToolCall[];
  charts: ChartSpec[];
  model: string | null;
  created_at: string;
}

export interface ChatConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatConversationDetail extends ChatConversation {
  messages: ChatMessage[];
}

/** Lets the UI say *why* the bot isn't answering instead of rendering a
 * chat box that silently fails — see the "don't render numbers you don't
 * have" rule in docs/06-frontend-rules.md. */
export interface ChatStatus {
  enabled: boolean;
  model: string;
  daily_cap: number;
  used_today: number;
  reason: string | null;
}

export interface JobEvent {
  id: string;
  job_id: string;
  event_type: string;
  actor_id: string;
  actor_name: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface AccountStatusChange {
  action: "deactivated" | "reactivated";
  actor_name: string | null;
  reason: string | null;
  created_at: string;
}

/** What is still hanging on an account, read before switching it off.
 * Deactivation does not move anybody's work — see `OpenWorkSummary` on the
 * server. */
export interface OpenWork {
  editing: number;
  reviewing: number;
  leading_pods: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** What they are called, when their role has no word for it — "Graphic
   * Designer", "Social Media". Null on the built-in roles, which carry their
   * own names. Grants nothing; see `Role`. */
  role_title: string | null;
  /** A role lent on top of `role`, today only `"tl"`. Read it through
   * `hasRole()` / `isLead()` in `@/lib/roles` — `user.role === "tl"` misses
   * every person who was given the role rather than born with it. */
  secondary_role: Role | null;
  phone: string | null;
  /** Routing toggle — "don't send me new QC work today". */
  available: boolean;
  /** Account switch — a deactivated teammate cannot log in. Never deleted:
   * their id is referenced by every job they ever touched. */
  is_active: boolean;
  /** How many videos this editor may hold at once. A hard cap, enforced on
   * every assignment path — a slot frees when a job is delivered. */
  max_concurrent_jobs: number;
  /** Full day or half day. Present on every account because the admin screen
   * edits one row at a time, but only a QC reviewer's routing reads it: it is
   * what their daily QC2 points budget is derived from. */
  employment_type: EmploymentType;  /** The last time somebody switched this account on or off — who did it,
   * when, and why if they said. Null on an account nobody has ever switched,
   * which is most of them. */
  last_status_change?: AccountStatusChange | null;
}

/** Roster totals for the tiles above the account directory. Counted over
 * everyone, not over the page on screen, so they don't move as you filter. */
/** A job title somebody already chose, offered by the onboarding form so the
 * tenth designer is filed under the same word as the first. */
export interface RoleTitle {
  id: string;
  name: string;
}

export interface UserDirectoryStats {
  active: number;
  inactive: number;
  by_role: Record<Role, { total: number; inactive: number }>;
}

export interface UserCapacity {
  user_id: string;
  name: string;
  /** Videos held right now — the number an editor's cap is actually in. */
  open_count: number;
  weighted_load: number;
  max_concurrent_jobs: number;
}

export type BrandAssetType = "brief" | "sop" | "kit" | "do_not";

export interface BrandAsset {
  id: string;
  pod_id: string;
  type: BrandAssetType;
  title: string;
  file_path: string;
  version: number;
}

export interface Notification {
  id: string;
  channel: "in_app" | "whatsapp";
  read_at: string | null;
  created_at: string;
  job_id: string | null;
  pod_id: string | null;
  event_type: string;
  /** Enough context to read the inbox without opening every row. */
  job_code: string;
  job_title: string;
  pod_name: string;
  stage: Stage | null;
  actor_name: string | null;
  note: string | null;
  /** The sentence, rendered by the server (`services/notification_text.py`).
   * The inbox, the toast and the push notification are three readers of one
   * event and the third cannot import a browser module, so the wording lives
   * in one place and rides on the row. */
  headline: string;
  /** The second line: which video, for which client, and the first line of
   * whatever the person typed. */
  body: string;
}

export interface VELoad {
  user_id: string;
  name: string;
  assigned_count: number;
  completed_count: number;
  weighted_load: number;
  max_concurrent_jobs: number;
  /** Slots left under the cap, floored at zero. Counted server-side so the
   * picker and the check that refuses a full editor use one number. */
  free_slots: number;
}

export interface PodJobCount {
  pod_id: string;
  pod_name: string;
  count: number;
}

export interface EditorCapacity {
  user_id: string;
  name: string;
  open_by_pod: PodJobCount[];
  open_count: number;
  delivered_count: number;
  clean_pct: number | null;
  weighted_load: number;
  max_concurrent_jobs: number;
  free_slots: number;
  reachable_free: boolean;
}

export interface CapacityJob {
  id: string;
  code: string;
  title: string;
  stage: Stage;
  video_type: VideoType;
  deadline: string | null;
  rush: boolean;
  pod_name: string;
  editor_id: string | null;
  editor_name: string | null;
  tl_name: string | null;
  qc_id: string | null;
  qc_name: string | null;
}

export type QcStatus = "unavailable" | "idle_next" | "idle" | "loaded" | "full";

export type EmploymentType = "full_time" | "part_time";

/** One reviewer's day in QC2 points — docs/12-qc2-load-model.md.
 *
 * Replaced `weighted_load` against a single company-wide `capacity_cap`, which
 * could not describe the model it was reporting on: one cap for everybody drew
 * a part-timer as half-full when they were done for the day. */
export interface QcLoad {
  user_id: string;
  name: string;
  available: boolean;
  employment_type: EmploymentType;
  /** Points a day: 24 full-time, 12 part-time. Derived server-side from
   * `employment_type` — never a stored per-account number. */
  capacity: number;
  /** `points_today + points_carried === load`. Split because they mean
   * different things to whoever is reading: one is what they have done today,
   * the other is a round from an earlier day they have not finished. */
  points_today: number;
  points_carried: number;
  load: number;
  points_left: number;
  open_count: number;
  /** Charges in the load window keyed by video type, e.g. `{long_form: 2}`. */
  videos_by_type: Partial<Record<VideoType, number>>;
  podcasts_held: number;
  /** Sent, not derived: two rules feed it (points left, and the part-time
   * podcast cap) and only the first is visible in the numbers above. */
  can_take_podcast: boolean;
  cleared_count: number;
  status: QcStatus;
}

/** One of a client's publishing destinations. A pod is the client; a channel
 * is one of the places they put video. Deliberately not a second pod — the
 * roster, the capacity and the first-pass rate all belong to the client. */
export interface Channel {
  id: string;
  pod_id: string;
  name: string;
  /** Which client it belongs to. Only the cross-pod list fills it in — a
   * picker holding two clients' "Shorts" has to say whose is whose. */
  pod_name?: string | null;
  /** Retired. Stays on the jobs already filed under it and drops out of every
   * picker — archiving is a statement about new work, not old work. */
  archived_at: string | null;
  /** Live jobs filed under it. What a TL needs before retiring one. */
  job_count: number;
}

/** `raw` is what the client sent and the TL adds; `video` is the cut and the
 * editor adds it. One column used to be both, which is why an editor's
 * "paste your link" box opened pre-filled with the client's Drive folder. */
export type JobLinkKind = "raw" | "video";

export interface JobLink {
  id: string;
  job_id: string;
  kind: JobLinkKind;
  title: string | null;
  url: string;
  added_by_id: string;
  added_by_name: string | null;
  created_at: string;
}
