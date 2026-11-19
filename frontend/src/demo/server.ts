import { AxiosError, AxiosHeaders } from "axios";
import type { AxiosResponse, InternalAxiosRequestConfig } from "axios";

import type {
  Channel,
  Job,
  JobDetail,
  JobEvent,
  JobStatusCounts,
  Notification,
  Role,
  Stage,
  User,
  WorkspaceOverview,
} from "@/types";

import { buildSeed, DB_VERSION } from "./seed";
import type { DemoDb } from "./seed";

/* A tiny in-memory stand-in for the FastAPI backend, used only when the app is
 * built with VITE_DEMO=true. It answers the same URLs with the same shapes the
 * real API does, applies the same role scoping in a simplified form, and keeps
 * changes in the browser (localStorage) so a refresh does not undo them. The
 * real backend is never touched. */

const STORAGE_KEY = "km_demo_db";
type Q = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let db: DemoDb = load();

function load(): DemoDb {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoDb;
      if (parsed.version === DB_VERSION) return parsed;
    }
  } catch {
    /* corrupt or unavailable storage — reseed */
  }
  return buildSeed();
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* private mode / quota — the demo still works for this visit */
  }
}

/** Throw away every change and start from the seed again. */
export function resetDemo() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  db = buildSeed();
  save();
}

/* ------------------------------------------------------------------ helpers */

class HttpError extends Error {
  constructor(public status: number, public detail: string) {
    super(detail);
  }
}
const fail = (status: number, detail: string): never => {
  throw new HttpError(status, detail);
};

const DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);
const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const nowIso = () => new Date().toISOString();
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const getUser = (id: string | null | undefined) => db.users.find((u) => u.id === id);
const getPod = (id: string) => db.pods.find((p) => p.id === id);
const nameOf = (id: string | null | undefined) => getUser(id)?.name ?? null;
const roles = (u: User): Role[] => (u.secondary_role ? [u.role, u.secondary_role] : [u.role]);
const hasRole = (u: User, ...r: Role[]) => roles(u).some((x) => r.includes(x));
const isOwner = (u: User) => u.role === "owner";
const isLead = (u: User) => hasRole(u, "owner", "tl");

function ledPods(u: User): string[] {
  if (isOwner(u)) return db.pods.map((p) => p.id);
  if (hasRole(u, "tl")) return db.pods.filter((p) => p.tl_id === u.id).map((p) => p.id);
  return [];
}

/** Which jobs this person may see — owner: all; lead: their pods; editor: their
 * own; QC: their reviews plus unrouted QC2; others: none. */
function visible(j: Job, u: User): boolean {
  if (isOwner(u)) return true;
  if (hasRole(u, "tl") && ledPods(u).includes(j.pod_id)) return true;
  if (hasRole(u, "ve") && j.assigned_editor_id === u.id) return true;
  if (hasRole(u, "qc") && (j.qc2_reviewer_id === u.id || (j.stage === "qc2" && !j.qc2_reviewer_id))) return true;
  return false;
}

function isMine(j: Job, u: User): boolean {
  if (j.scrapped_at || j.stage === "delivered") return false;
  const lead = !isOwner(u) && hasRole(u, "tl") && ledPods(u).includes(j.pod_id);
  if (lead && ["intake", "qc1", "final"].includes(j.stage)) return true;
  if (hasRole(u, "ve") && j.assigned_editor_id === u.id && ["assigned", "editing", "revisions"].includes(j.stage)) return true;
  if (hasRole(u, "qc") && j.stage === "qc2" && j.qc2_reviewer_id === u.id) return true;
  return false;
}

function detail(j: Job, u: User): JobDetail {
  const pod = getPod(j.pod_id)!;
  const channel = db.channels.find((c) => c.id === j.channel_id);
  const sees = isOwner(u) || ledPods(u).includes(j.pod_id);
  return {
    ...j,
    client_deadline: sees ? j.client_deadline : null,
    pod_name: pod.name,
    channel_name: channel?.name ?? null,
    tl_id: pod.tl_id,
    tl_name: nameOf(pod.tl_id),
    editor_name: nameOf(j.assigned_editor_id),
    qc2_reviewer_name: nameOf(j.qc2_reviewer_id),
    scrapped_by_name: nameOf(j.scrapped_by_id),
    qc1_flagged_by_name: nameOf(j.qc1_flagged_by_id),
    qc1_flag_tl_name: nameOf(j.qc1_flag_tl_id),
    is_mine: isMine(j, u),
  };
}

function paginate<T>(items: T[], params: Q, defaultSize = 25) {
  const page = Math.max(1, Number(params.page) || 1);
  const size = Math.max(1, Number(params.page_size) || defaultSize);
  return { items: items.slice((page - 1) * size, page * size), total: items.length, page, page_size: size };
}

const arr = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const bool = (v: unknown) => v === true || v === "true";
const includesText = (hay: string, needle: string) => hay.toLowerCase().includes(needle.toLowerCase());

/* ------------------------------------------------------------- job queries */

type Status = JobStatusCounts extends infer C ? keyof C : never;

function matchesStatus(j: Job, status: Status, u: User): boolean {
  const dead = Boolean(j.scrapped_at);
  switch (status) {
    case "intake": return !dead && j.stage === "intake";
    case "active": return !dead && j.stage !== "intake" && j.stage !== "delivered";
    case "overdue": return !dead && j.stage !== "delivered" && Boolean(j.deadline) && j.deadline! < today();
    case "mine": return isMine(j, u);
    case "delivered": return !dead && j.stage === "delivered";
    case "scrapped": return dead;
    case "flagged": return Boolean(j.qc1_flagged_at);
    default: return true;
  }
}

function filterJobs(p: Q, u: User, skipStatus = false): Job[] {
  return db.jobs.filter((j) => {
    if (!visible(j, u)) return false;
    if (p.pod_id && j.pod_id !== p.pod_id) return false;
    if (!skipStatus && p.status && !matchesStatus(j, p.status, u)) return false;
    // A status tab other than all/scrapped/flagged never contains cancelled work.
    if (p.scrapped !== undefined && p.scrapped !== null) {
      if (bool(p.scrapped) !== Boolean(j.scrapped_at)) return false;
    }
    if (p.search) {
      const s = String(p.search);
      const hay = `${j.title} ${j.code} ${getPod(j.pod_id)?.name ?? ""} ${nameOf(j.assigned_editor_id) ?? ""}`;
      if (!includesText(hay, s)) return false;
    }
    const stages = arr<string>(p.stage);
    if (stages.length && !stages.includes(j.stage)) return false;
    const types = arr<string>(p.video_type);
    if (types.length && !types.includes(j.video_type)) return false;
    if (p.editor_id && j.assigned_editor_id !== p.editor_id) return false;
    if (p.reviewer_id && j.qc2_reviewer_id !== p.reviewer_id) return false;
    if (bool(p.unassigned) && j.assigned_editor_id) return false;
    if (bool(p.unrouted) && !(j.stage === "qc2" && !j.qc2_reviewer_id)) return false;
    if (p.deadline_from && (!j.deadline || j.deadline < p.deadline_from)) return false;
    if (p.deadline_to && (!j.deadline || j.deadline > p.deadline_to)) return false;
    if (bool(p.no_deadline) && j.deadline) return false;
    if (bool(p.qc1_flagged) && !j.qc1_flagged_at) return false;
    if (bool(p.rush) && !j.rush) return false;
    if (p.channel_id && j.channel_id !== p.channel_id) return false;
    if (bool(p.no_channel) && j.channel_id) return false;
    return true;
  });
}

const STAGE_RANK: Record<Stage, number> = { revisions: 0, editing: 1, qc1: 2, qc2: 3, final: 4, assigned: 5, intake: 6, delivered: 7 };

function sortJobs(items: Job[], sortBy: string | undefined, dir: string | undefined): Job[] {
  const mult = dir === "desc" ? -1 : 1;
  const dl = (j: Job) => j.deadline ?? "9999-12-31";
  const key: Record<string, (j: Job) => string | number> = {
    title: (j) => j.title.toLowerCase(), code: (j) => j.code, stage: (j) => STAGE_RANK[j.stage],
    deadline: dl, video_type: (j) => j.video_type, weight: (j) => j.weight, rush: (j) => (j.rush ? 0 : 1),
    round: (j) => j.round, pod: (j) => getPod(j.pod_id)?.name ?? "",
    channel: (j) => db.channels.find((c) => c.id === j.channel_id)?.name ?? "~", created_at: (j) => j.created_at,
  };
  const out = [...items];
  if (!sortBy || sortBy === "pipeline") {
    // Working first, then waiting, then delivered/scrapped; deadline inside each group.
    const group = (j: Job) => (j.scrapped_at ? 3 : j.stage === "delivered" ? 2 : j.stage === "intake" ? 1 : 0);
    return out.sort((a, b) => group(a) - group(b) || dl(a).localeCompare(dl(b)) * mult);
  }
  const k = key[sortBy] ?? dl;
  return out.sort((a, b) => {
    const x = k(a); const y = k(b);
    return (x < y ? -1 : x > y ? 1 : 0) * mult;
  });
}

function counts(p: Q, u: User): JobStatusCounts {
  const base = filterJobs({ ...p, status: undefined }, u, true);
  const c = (s: Status) => base.filter((j) => matchesStatus(j, s, u)).length;
  return { intake: c("intake"), active: c("active"), overdue: c("overdue"), mine: c("mine"), delivered: c("delivered"), all: base.length, scrapped: c("scrapped"), flagged: c("flagged") };
}

function overview(u: User): WorkspaceOverview {
  const jobs = db.jobs.filter((j) => visible(j, u) && !j.scrapped_at);
  const delivered = jobs.filter((j) => j.stage === "delivered");
  const clean = delivered.filter((j) => j.round === 0).length;
  return {
    in_flight: jobs.filter((j) => matchesStatus(j, "active", u)).length,
    intake: jobs.filter((j) => j.stage === "intake").length,
    overdue: jobs.filter((j) => matchesStatus(j, "overdue", u)).length,
    delivered: delivered.length,
    clean_delivered: clean,
    pending_qc1: jobs.filter((j) => j.stage === "qc1").length,
    first_pass_pct: delivered.length ? Math.round((clean / delivered.length) * 100) : null,
    qc1_flagged: db.jobs.filter((j) => visible(j, u) && j.qc1_flagged_at).length,
    pods: db.pods
      .filter((p) => jobs.some((j) => j.pod_id === p.id) || ledPods(u).includes(p.id))
      .map((p) => {
        const pj = jobs.filter((j) => j.pod_id === p.id);
        return {
          pod_id: p.id, pod_name: p.name, status: p.status,
          in_flight: pj.filter((j) => matchesStatus(j, "active", u)).length,
          intake: pj.filter((j) => j.stage === "intake").length,
          delivered: pj.filter((j) => j.stage === "delivered").length,
          in_qc: pj.filter((j) => ["qc1", "qc2"].includes(j.stage)).length,
          overdue: pj.filter((j) => matchesStatus(j, "overdue", u)).length,
        };
      }),
  };
}

function logEvent(j: Job, actor: User, type: string, payload: Record<string, unknown> = {}): JobEvent {
  const ev: JobEvent = { id: uid("e"), job_id: j.id, event_type: type, actor_id: actor.id, actor_name: actor.name, payload, created_at: nowIso() };
  (db.events[j.id] ??= []).push(ev);
  return ev;
}

function notify(userId: string | null | undefined, j: Job, type: string, headline: string, actor: User, text: string | null = null) {
  if (!userId || userId === actor.id) return;
  const pod = getPod(j.pod_id)!;
  db.notifications.unshift({
    id: uid("n"), user_id: userId, channel: "in_app", read_at: null, created_at: nowIso(), job_id: j.id, pod_id: j.pod_id,
    event_type: type, job_code: j.code, job_title: j.title, pod_name: pod.name, stage: j.stage, actor_name: actor.name,
    note: text, headline, body: `${j.title} · ${pod.name}${text ? ` · ${text}` : ""}`,
  });
}

/* ---------------------------------------------------------- load summaries */

const QC_CAP = { full_time: 24, part_time: 12 } as const;
const typePoints = (key: string) => db.videoTypes.find((t) => t.key === key)?.qc_points ?? 3;

function editorRows() {
  return db.users.filter((x) => x.role === "ve" && x.is_active).map((e) => {
    const open = db.jobs.filter((j) => j.assigned_editor_id === e.id && j.stage !== "delivered" && !j.scrapped_at);
    const delivered = db.jobs.filter((j) => j.assigned_editor_id === e.id && j.stage === "delivered");
    const byPod = db.pods.map((p) => ({ pod_id: p.id, pod_name: p.name, count: open.filter((j) => j.pod_id === p.id).length })).filter((x) => x.count > 0);
    const free = Math.max(0, e.max_concurrent_jobs - open.length);
    return {
      user_id: e.id, name: e.name, open_by_pod: byPod, open_count: open.length, delivered_count: delivered.length,
      clean_pct: delivered.length ? Math.round((delivered.filter((j) => j.round === 0).length / delivered.length) * 100) : null,
      weighted_load: open.length, max_concurrent_jobs: e.max_concurrent_jobs, free_slots: free, reachable_free: free > 0,
    };
  });
}

function qcRow(q: User) {
  const mine = db.jobs.filter((j) => j.qc2_reviewer_id === q.id && !j.scrapped_at);
  const today_ = mine.filter((j) => j.stage === "qc2").reduce((n, j) => n + typePoints(j.video_type), 0);
  const carried = mine.filter((j) => j.stage === "revisions").reduce((n, j) => n + Math.ceil(typePoints(j.video_type) / 2), 0);
  const capacity = QC_CAP[q.employment_type];
  const load = Math.min(today_ + carried, capacity + 6);
  const byType: Record<string, number> = {};
  mine.filter((j) => j.stage === "qc2").forEach((j) => (byType[j.video_type] = (byType[j.video_type] ?? 0) + 1));
  const left = Math.max(0, capacity - load);
  return {
    user_id: q.id, name: q.name, available: q.available, employment_type: q.employment_type, capacity,
    points_today: today_, points_carried: carried, load, points_left: left, open_count: mine.filter((j) => !["delivered", "final"].includes(j.stage)).length,
    videos_by_type: byType, podcasts_held: byType["podcast"] ?? 0, can_take_podcast: left >= 8,
    cleared_count: mine.filter((j) => ["final", "delivered"].includes(j.stage)).length,
    status: !q.available ? "unavailable" as const : left <= 0 ? "full" as const : load === 0 ? "idle" as const : "loaded" as const,
  };
}

/* ------------------------------------------------------------------ router */

interface Ctx { me: User; params: Q; body: any; match: RegExpMatchArray } // eslint-disable-line @typescript-eslint/no-explicit-any
type Handler = (c: Ctx) => unknown;
const routes: { method: string; re: RegExp; h: Handler; auth?: boolean }[] = [];
const route = (method: string, path: string, h: Handler, auth = true) =>
  routes.push({ method, re: new RegExp(`^${path.replace(/:[a-z_]+/g, "([^/]+)")}$`), h, auth });

/* auth */
route("POST", "/auth/login", ({ body }) => {
  const email = String(body?.email ?? "").trim().toLowerCase();
  const found = db.users.find((u) => u.email.toLowerCase() === email);
  if (!found || !body?.password) fail(401, "Invalid credentials");
  if (!found!.is_active) fail(403, "This account has been deactivated. Ask your team lead.");
  return { access_token: `demo.${found!.id}` };
}, false);
route("POST", "/auth/impersonate/:id", ({ match }) => {
  if (!getUser(match[1])) fail(404, "No such user");
  return { access_token: `demo.${match[1]}` };
});
route("POST", "/auth/forgot-password", () => ({}), false);
route("POST", "/auth/reset-password", () => ({}), false);

/* users */
route("GET", "/users/me", ({ me }) => me);
route("PATCH", "/users/me/availability", ({ me, body }) => { me.available = Boolean(body.available); return me; });
route("GET", "/users/stats", () => {
  const by: Record<string, { total: number; inactive: number }> = {};
  (["owner", "fo", "tl", "qc", "ve", "hr", "staff"] as Role[]).forEach((r) => {
    const us = db.users.filter((u) => u.role === r);
    by[r] = { total: us.length, inactive: us.filter((u) => !u.is_active).length };
  });
  return { active: db.users.filter((u) => u.is_active).length, inactive: db.users.filter((u) => !u.is_active).length, by_role: by };
});
route("GET", "/users/role-titles", () => db.roleTitles);
route("GET", "/users/capacity", () => editorRows().map((e) => ({ user_id: e.user_id, name: e.name, open_count: e.open_count, weighted_load: e.weighted_load, max_concurrent_jobs: e.max_concurrent_jobs })));
route("GET", "/users/ve-load", () => editorRows().map((e) => ({ user_id: e.user_id, name: e.name, assigned_count: e.open_count, completed_count: e.delivered_count, weighted_load: e.weighted_load, max_concurrent_jobs: e.max_concurrent_jobs, free_slots: e.free_slots })));
route("GET", "/users/editor-capacity", () => editorRows());
route("GET", "/users/qc-load", () => db.users.filter((u) => u.role === "qc" && u.is_active).map(qcRow));
route("GET", "/users/me/qc-load", ({ me }) => qcRow(me));
route("GET", "/users/capacity/open-jobs", ({ me }) =>
  db.jobs.filter((j) => visible(j, me) && !j.scrapped_at && j.stage !== "delivered" && (j.assigned_editor_id || j.qc2_reviewer_id)).map((j) => ({
    id: j.id, code: j.code, title: j.title, stage: j.stage, video_type: j.video_type, deadline: j.deadline, rush: j.rush,
    pod_name: getPod(j.pod_id)!.name, editor_id: j.assigned_editor_id, editor_name: nameOf(j.assigned_editor_id),
    tl_name: nameOf(getPod(j.pod_id)!.tl_id), qc_id: j.qc2_reviewer_id, qc_name: nameOf(j.qc2_reviewer_id),
  })));
route("GET", "/users/:id/open-work", ({ match }) => ({
  editing: db.jobs.filter((j) => j.assigned_editor_id === match[1] && j.stage !== "delivered" && !j.scrapped_at).length,
  reviewing: db.jobs.filter((j) => j.qc2_reviewer_id === match[1] && j.stage === "qc2").length,
  leading_pods: db.pods.filter((p) => p.tl_id === match[1]).length,
}));
route("GET", "/users", ({ params }) => {
  let list = [...db.users];
  if (params.search) list = list.filter((u) => includesText(`${u.name} ${u.email}`, String(params.search)));
  if (params.role) list = list.filter((u) => u.role === params.role);
  if (params.status === "active") list = list.filter((u) => u.is_active);
  if (params.status === "inactive") list = list.filter((u) => !u.is_active);
  if (params.include_inactive === false || params.include_inactive === "false") list = list.filter((u) => u.is_active);
  const sort = (params.sort_by as keyof User) || "name";
  list.sort((a, b) => String(a[sort] ?? "").localeCompare(String(b[sort] ?? "")) * (params.sort_dir === "desc" ? -1 : 1));
  return paginate(list, params, 25);
});
route("POST", "/users", ({ body }) => {
  if (db.users.some((u) => u.email.toLowerCase() === String(body.email).toLowerCase())) fail(409, "That email is already in use.");
  const u: User = {
    id: uid("u_"), name: body.name, email: String(body.email).toLowerCase(), role: body.role, role_title: body.role_title ?? null,
    secondary_role: body.secondary_role ?? null, phone: body.phone ?? null, available: true, is_active: true,
    max_concurrent_jobs: 4, employment_type: body.employment_type ?? "full_time", last_status_change: null,
  };
  db.users.push(u);
  return u;
});
route("PATCH", "/users/:id", ({ match, body }) => {
  const u = getUser(match[1]) ?? fail(404, "No such user");
  const b = { ...body };
  if (b.clear_secondary_role) { u.secondary_role = null; delete b.clear_secondary_role; }
  delete b.role_title_id;
  Object.assign(u, b);
  return u;
});
route("POST", "/users/:id/deactivate", ({ match, body, me }) => {
  const u = getUser(match[1]) ?? fail(404, "No such user");
  u.is_active = false; u.available = false;
  u.last_status_change = { action: "deactivated", actor_name: me.name, reason: body?.reason ?? null, created_at: nowIso() };
  return u;
});
route("POST", "/users/:id/reactivate", ({ match, body, me }) => {
  const u = getUser(match[1]) ?? fail(404, "No such user");
  u.is_active = true; u.available = true;
  u.last_status_change = { action: "reactivated", actor_name: me.name, reason: body?.reason ?? null, created_at: nowIso() };
  return u;
});
route("POST", "/users/:id/reset-password", () => ({}));

/* pods */
route("GET", "/pods/channels", ({ me }) =>
  db.channels.filter((c) => !c.archived_at && (isOwner(me) || ledPods(me).includes(c.pod_id) || db.jobs.some((j) => j.channel_id === c.id && visible(j, me))))
    .map((c) => ({ ...c, pod_name: getPod(c.pod_id)?.name ?? null })));
route("GET", "/pods", ({ params, me }) => {
  const mine = db.pods.filter((p) => isOwner(me) || ledPods(me).includes(p.id) || db.jobs.some((j) => j.pod_id === p.id && visible(j, me)) || db.members.some((m) => m.pod_id === p.id && m.user_id === me.id));
  let list = mine;
  if (params.status && params.status !== "all") list = list.filter((p) => p.status === params.status);
  if (params.search) list = list.filter((p) => includesText(p.name, String(params.search)));
  list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  return {
    ...paginate(list, params, 24),
    counts: { all: mine.length, active: mine.filter((p) => p.status === "active").length, paused: mine.filter((p) => p.status === "paused").length, churned: mine.filter((p) => p.status === "churned").length },
  };
});
route("POST", "/pods", ({ body }) => {
  const p = { id: uid("p_"), name: body.name, tl_id: body.tl_id, status: body.status ?? "active", billing_currency: body.billing_currency ?? "INR", retainer_volume: body.retainer_volume ?? null };
  db.pods.push(p);
  return p;
});
route("PATCH", "/pods/:id", ({ match, body }) => {
  const p = getPod(match[1]) ?? fail(404, "No such client");
  Object.assign(p, body);
  return p;
});
route("GET", "/pods/:id/members", ({ match }) => db.members.filter((m) => m.pod_id === match[1]));
route("POST", "/pods/:id/members", ({ match, body }) => {
  const u = getUser(body.user_id) ?? fail(404, "No such user");
  db.members.push({ pod_id: match[1], user_id: u.id, name: u.name, email: u.email, role: u.role, pod_role: body.pod_role, certified_at: null });
  return {};
});
route("DELETE", "/pods/:id/members/:uid", ({ match }) => { db.members = db.members.filter((m) => !(m.pod_id === match[1] && m.user_id === match[2])); return {}; });
route("GET", "/pods/:id/channels", ({ match, params }) => db.channels.filter((c) => c.pod_id === match[1] && (bool(params.include_archived) || !c.archived_at)));
route("POST", "/pods/:id/channels", ({ match, body }) => {
  const c: Channel = { id: uid("c_"), pod_id: match[1], name: body.name, pod_name: getPod(match[1])?.name ?? null, archived_at: null, job_count: 0 };
  db.channels.push(c);
  return c;
});
route("PATCH", "/pods/:id/channels/:cid", ({ match, body }) => {
  const c = db.channels.find((x) => x.id === match[2]) ?? fail(404, "No such channel");
  if (body.name !== undefined) c.name = body.name;
  if (body.archived !== undefined) c.archived_at = body.archived ? nowIso() : null;
  return c;
});

/* analytics */
const podJobs = (id: string, me: User) => db.jobs.filter((j) => j.pod_id === id && visible(j, me) && !j.scrapped_at);
route("GET", "/pods/:id/analytics/stage-distribution", ({ match, me }) => {
  const out: Record<string, number> = {};
  podJobs(match[1], me).forEach((j) => (out[j.stage] = (out[j.stage] ?? 0) + 1));
  return out;
});
route("GET", "/pods/:id/analytics/first-pass-rate", ({ match, me }) => {
  const d = podJobs(match[1], me).filter((j) => j.stage === "delivered");
  return { first_pass_rate: d.length ? d.filter((j) => j.round === 0).length / d.length : null, avg_rounds: d.length ? d.reduce((n, j) => n + j.round, 0) / d.length : null };
});
route("GET", "/pods/:id/analytics/avg-rounds-by-editor", ({ match, me }) => {
  const out: Record<string, number> = {};
  const by: Record<string, Job[]> = {};
  podJobs(match[1], me).filter((j) => j.assigned_editor_id).forEach((j) => (by[j.assigned_editor_id!] ??= []).push(j));
  Object.entries(by).forEach(([id, js]) => (out[id] = js.reduce((n, j) => n + j.round, 0) / js.length));
  return out;
});
route("GET", "/pods/:id/analytics/stuck-jobs", ({ match, me }) => podJobs(match[1], me).filter((j) => j.round >= 3 || (j.stage === "revisions" && j.round >= 2)));

/* brand kit */
route("GET", "/pods/:id/brand-assets/links", ({ match }) => db.brandLinks.filter((l) => l.pod_id === match[1]));
route("POST", "/pods/:id/brand-assets/links", ({ match, body }) => { const l = { id: uid("bl"), pod_id: match[1], title: body.title, url: body.url, category: body.category, created_at: nowIso() }; db.brandLinks.push(l); return l; });
route("PUT", "/pods/:id/brand-assets/links/:lid", ({ match, body }) => { const l = db.brandLinks.find((x) => x.id === match[2]) ?? fail(404, "No such link"); Object.assign(l, { title: body.title, url: body.url, category: body.category }); return l; });
route("DELETE", "/pods/:id/brand-assets/links/:lid", ({ match }) => { db.brandLinks = db.brandLinks.filter((l) => l.id !== match[2]); return {}; });
route("GET", "/pods/:id/brand-assets/history", ({ match }) => db.brandEvents[match[1]] ?? []);
route("GET", "/pods/:id/brand-assets/:aid/download", ({ match }) => {
  const a = db.brandAssets.find((x) => x.id === match[2]) ?? fail(404, "No such file");
  return { __blob: `Demo file: ${a.title}\nThis is sample content for the demo build.`, __name: a.file_path.split("/").pop() };
});
route("GET", "/pods/:id/brand-assets", ({ match, params }) => {
  const all = db.brandAssets.filter((a) => a.pod_id === match[1]);
  const off = Number(params.offset) || 0;
  return all.slice(off, off + (Number(params.limit) || 500));
});
route("POST", "/pods/:id/brand-assets", ({ match, params, me }) => {
  const type = (params.type as string) || "kit";
  const title = decodeURIComponent((params.title as string) || "Untitled");
  const existing = db.brandAssets.find((a) => a.pod_id === match[1] && a.title === title && a.type === type);
  if (existing) { existing.version += 1; return existing; }
  const a = { id: uid("ba"), pod_id: match[1], type: type as "kit", title, file_path: `${match[1]}/${title}`, version: 1 };
  db.brandAssets.push(a);
  (db.brandEvents[match[1]] ??= []).unshift({ id: uid("be"), action: "asset_added", title, before: null, after: { version: 1 }, note: null, actor_name: me.name, created_at: nowIso() });
  return a;
});

/* video types */
route("GET", "/video-types", () => [...db.videoTypes].sort((a, b) => a.sort_order - b.sort_order));
route("POST", "/video-types", ({ body }) => { const t = { key: body.key, label: body.label, qc_points: body.qc_points, enabled: true, sort_order: db.videoTypes.length + 1 }; db.videoTypes.push(t); return t; });
route("PATCH", "/video-types/:key", ({ match, body }) => { const t = db.videoTypes.find((x) => x.key === match[1]) ?? fail(404, "No such type"); Object.assign(t, body); return t; });

/* search */
route("GET", "/search", ({ params, me }) => {
  const q = String(params.q ?? "").trim();
  const limit = Number(params.limit) || 6;
  const jobs = db.jobs.filter((j) => visible(j, me) && includesText(`${j.title} ${j.code} ${getPod(j.pod_id)?.name} ${nameOf(j.assigned_editor_id) ?? ""}`, q)).slice(0, limit).map((j) => ({
    id: j.id, code: j.code, title: j.title, stage: j.stage, pod_id: j.pod_id, pod_name: getPod(j.pod_id)!.name,
    channel_name: db.channels.find((c) => c.id === j.channel_id)?.name ?? null, editor_name: nameOf(j.assigned_editor_id),
    matched_on: includesText(`${j.title} ${j.code}`, q) ? ("job" as const) : includesText(getPod(j.pod_id)!.name, q) ? ("pod" as const) : ("editor" as const),
    scrapped_at: j.scrapped_at,
  }));
  const pods = db.pods.filter((p) => includesText(p.name, q)).slice(0, limit).map((p) => ({
    id: p.id, name: p.name, status: p.status, tl_name: nameOf(p.tl_id), open_jobs: db.jobs.filter((j) => j.pod_id === p.id && j.stage !== "delivered" && !j.scrapped_at).length,
    channels: db.channels.filter((c) => c.pod_id === p.id).length,
  }));
  const channels = db.channels.filter((c) => includesText(c.name, q)).slice(0, limit).map((c) => ({
    id: c.id, name: c.name, pod_id: c.pod_id, pod_name: getPod(c.pod_id)!.name, open_jobs: db.jobs.filter((j) => j.channel_id === c.id && j.stage !== "delivered").length, archived: Boolean(c.archived_at),
  }));
  const people = isLead(me) || hasRole(me, "hr") ? db.users.filter((u) => includesText(`${u.name} ${u.email}`, q)).slice(0, limit).map((u) => ({
    id: u.id, name: u.name, email: u.email, role: u.role, is_active: u.is_active,
    pods: db.members.filter((m) => m.user_id === u.id).map((m) => getPod(m.pod_id)!.name), open_jobs: db.jobs.filter((j) => (j.assigned_editor_id === u.id || j.qc2_reviewer_id === u.id) && j.stage !== "delivered").length,
  })) : [];
  return { query: q, jobs, pods, channels, people };
});

/* notifications */
const mineNotes = (me: User) => db.notifications.filter((n) => n.user_id === me.id);
const publicNote = ({ user_id: _u, ...n }: Notification & { user_id: string }): Notification => n;
route("GET", "/notifications/push/key", () => ({ public_key: "", enabled: false }));
route("POST", "/notifications/push/subscribe", () => ({}));
route("POST", "/notifications/push/unsubscribe", () => ({}));
route("POST", "/notifications/push/test", () => ({ sent_to: 0, delay_seconds: 5 }));
route("POST", "/notifications/read-all", ({ me }) => { mineNotes(me).forEach((n) => (n.read_at ??= nowIso())); return {}; });
route("POST", "/notifications/:id/read", ({ match }) => { const n = db.notifications.find((x) => x.id === match[1]); if (n) n.read_at ??= nowIso(); return {}; });
route("GET", "/notifications", ({ me, params }) => {
  let list = mineNotes(me).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const unread = list.filter((n) => !n.read_at).length;
  if (bool(params.unread_only)) list = list.filter((n) => !n.read_at);
  if (params.search) list = list.filter((n) => includesText(`${n.job_title} ${n.job_code}`, String(params.search)));
  const page = paginate(list.map(publicNote), params, 25);
  return { ...page, unread };
});

/* jobs */
const needJob = (id: string) => db.jobs.find((j) => j.id === id) ?? fail(404, "That job doesn't exist.");
route("GET", "/jobs/stats", ({ params, me }) => counts(params, me));
route("GET", "/jobs/overview", ({ me }) => overview(me));
route("GET", "/jobs", ({ params, me }) => {
  const filtered = sortJobs(filterJobs(params, me), params.sort_by, params.sort_dir);
  const page = paginate(filtered, params, 25);
  return { ...page, items: page.items.map((j) => detail(j, me)) };
});
route("POST", "/jobs/batch", ({ body, me }) => {
  const out = (body.jobs as Q[]).map((item) => {
    db.counters.job += 1;
    const j: Job = {
      id: `j${db.counters.job}`, code: `KM-${1300 + db.counters.job}`, title: item.title, pod_id: body.pod_id, channel_id: item.channel_id ?? null,
      stage: item.assigned_editor_id ? "assigned" : "intake", video_type: item.video_type ?? "short_form", weight: item.weight ?? "standard", rush: Boolean(item.rush),
      assigned_editor_id: item.assigned_editor_id ?? null, qc2_reviewer_id: null, sent_back_from: null, frame_link: null, round: 0,
      deadline: item.deadline ?? null, client_deadline: item.client_deadline ?? null, delivered_at: null, client_sheet_ok: false, ops_tracker_ok: false,
      created_at: nowIso(), scrapped_at: null, scrapped_by_id: null, scrap_reason: null, qc1_flagged_at: null, qc1_flagged_by_id: null, qc1_flag_tl_id: null, qc1_flag_reason: null,
    };
    db.jobs.unshift(j);
    logEvent(j, me, "intake");
    (item.raw_links as Q[] | undefined)?.forEach((l) => db.links.push({ id: uid("l"), job_id: j.id, kind: "raw", title: l.title ?? null, url: l.url, added_by_id: me.id, added_by_name: me.name, created_at: nowIso() }));
    if (j.assigned_editor_id) notify(j.assigned_editor_id, j, "stage_changed", `${j.code} landed with you`, me);
    return j;
  });
  return out;
});
route("POST", "/jobs/bulk-channel", ({ body }) => {
  let updated = 0; let unchanged = 0;
  (body.job_ids as string[]).forEach((id) => { const j = db.jobs.find((x) => x.id === id); if (!j) return; if (j.channel_id === body.channel_id) unchanged++; else { j.channel_id = body.channel_id; updated++; } });
  return { updated, unchanged };
});
route("POST", "/jobs/bulk-retry-qc2", ({ body }) => {
  let assigned = 0; let no_capacity = 0; let skipped = 0;
  (body.job_ids as string[]).forEach((id) => {
    const j = db.jobs.find((x) => x.id === id);
    if (!j || j.stage !== "qc2" || j.qc2_reviewer_id) { skipped++; return; }
    const q = db.users.find((u) => u.role === "qc" && u.is_active && qcRow(u).points_left > 0);
    if (q) { j.qc2_reviewer_id = q.id; assigned++; } else no_capacity++;
  });
  return { assigned, no_capacity, skipped };
});
route("POST", "/jobs", ({ body, me }) => {
  db.counters.job += 1;
  const j: Job = {
    id: `j${db.counters.job}`, code: `KM-${1300 + db.counters.job}`, title: body.title, pod_id: body.pod_id, channel_id: body.channel_id ?? null, stage: "intake",
    video_type: body.video_type ?? "short_form", weight: body.weight ?? "standard", rush: Boolean(body.rush), assigned_editor_id: null, qc2_reviewer_id: null,
    sent_back_from: null, frame_link: null, round: 0, deadline: body.deadline ?? null, client_deadline: body.client_deadline ?? null, delivered_at: null,
    client_sheet_ok: false, ops_tracker_ok: false, created_at: nowIso(), scrapped_at: null, scrapped_by_id: null, scrap_reason: null,
    qc1_flagged_at: null, qc1_flagged_by_id: null, qc1_flag_tl_id: null, qc1_flag_reason: null,
  };
  db.jobs.unshift(j);
  logEvent(j, me, "intake");
  return j;
});
route("GET", "/jobs/:id/events", ({ match }) => db.events[match[1]] ?? []);
route("GET", "/jobs/:id/links", ({ match }) => db.links.filter((l) => l.job_id === match[1]));
route("POST", "/jobs/:id/links", ({ match, body, me }) => {
  const l = { id: uid("l"), job_id: match[1], kind: body.kind, title: body.title ?? null, url: body.url, added_by_id: me.id, added_by_name: me.name, created_at: nowIso() };
  db.links.push(l);
  if (body.kind === "video") needJob(match[1]).frame_link = body.url;
  return l;
});
route("DELETE", "/jobs/:id/links/:lid", ({ match }) => { db.links = db.links.filter((l) => l.id !== match[2]); return {}; });
route("GET", "/jobs/:id/qc1-pass", ({ match }) => {
  const ev = (db.events[match[1]] ?? []).filter((e) => e.event_type === "stage_changed" && e.payload.stage === "qc2").pop();
  if (!ev) return null;
  return { round: 0, entered_at: null, cleared_at: ev.created_at, seconds: 5400, cleared_by_id: ev.actor_id, cleared_by_name: ev.actor_name, comments: 1, outcome: "approved" };
});
route("POST", "/jobs/:id/advance", ({ match, body, me }) => {
  const j = needJob(match[1]);
  const from = j.stage;
  if (j.scrapped_at) fail(400, "This project was scrapped.");
  j.stage = body.stage as Stage;
  if (body.assigned_editor_id !== undefined && body.assigned_editor_id !== null) j.assigned_editor_id = body.assigned_editor_id;
  if (body.deadline) j.deadline = body.deadline;
  if (body.client_deadline) j.client_deadline = body.client_deadline;
  if (body.frame_link) j.frame_link = body.frame_link;
  if (j.stage === "revisions") { j.round += 1; j.sent_back_from = from === "qc2" || from === "final" ? from : "qc1"; }
  if (j.stage === "delivered") j.delivered_at = nowIso();
  if (j.stage === "qc2" && !j.qc2_reviewer_id) {
    const q = db.users.find((u) => u.role === "qc" && u.is_active && u.available && qcRow(u).points_left > 0);
    j.qc2_reviewer_id = q?.id ?? null;
  }
  if (body.note && j.stage === "revisions") logEvent(j, me, "changes_raised", { note: body.note });
  logEvent(j, me, "stage_changed", { stage: j.stage, ...(body.note ? { note: body.note } : {}) });
  const pod = getPod(j.pod_id)!;
  const target = j.stage === "revisions" || j.stage === "assigned" || j.stage === "editing" ? j.assigned_editor_id : j.stage === "qc2" ? j.qc2_reviewer_id : pod.tl_id;
  notify(target, j, j.stage === "revisions" ? "changes_raised" : "stage_changed", j.stage === "revisions" ? `Changes requested on ${j.code}` : `${j.code} is ready for ${j.stage.toUpperCase()}`, me, body.note ?? null);
  return detail(j, me);
});
route("POST", "/jobs/:id/reassign", ({ match, body, me }) => {
  const j = needJob(match[1]);
  const from = nameOf(j.assigned_editor_id) ?? "someone";
  j.assigned_editor_id = body.editor_id;
  logEvent(j, me, "job_reassigned", { from_editor_name: from, to_editor_name: nameOf(body.editor_id), note: body.reason });
  notify(body.editor_id, j, "job_reassigned", `${j.code} was reassigned to you`, me, body.reason);
  return detail(j, me);
});
route("POST", "/jobs/:id/claim-qc2", ({ match, me }) => { const j = needJob(match[1]); j.qc2_reviewer_id = me.id; logEvent(j, me, "qc2_claimed"); return detail(j, me); });
route("POST", "/jobs/:id/scrap", ({ match, body, me }) => {
  const j = needJob(match[1]);
  j.scrapped_at = nowIso(); j.scrapped_by_id = me.id; j.scrap_reason = body.reason;
  logEvent(j, me, "job_scrapped", { reason: body.reason });
  return detail(j, me);
});
route("POST", "/jobs/:id/restore", ({ match, me }) => { const j = needJob(match[1]); j.scrapped_at = null; j.scrapped_by_id = null; j.scrap_reason = null; logEvent(j, me, "job_restored"); return detail(j, me); });
route("POST", "/jobs/:id/qc1-flag/clear", ({ match, me }) => { const j = needJob(match[1]); j.qc1_flagged_at = null; j.qc1_flagged_by_id = null; j.qc1_flag_reason = null; logEvent(j, me, "qc1_flag_cleared"); return detail(j, me); });
route("POST", "/jobs/:id/qc1-flag", ({ match, body, me }) => {
  const j = needJob(match[1]);
  j.qc1_flagged_at = nowIso(); j.qc1_flagged_by_id = me.id; j.qc1_flag_tl_id = getPod(j.pod_id)!.tl_id; j.qc1_flag_reason = body.reason;
  logEvent(j, me, "qc1_flag_raised", { note: body.reason });
  return detail(j, me);
});
route("POST", "/jobs/:id/notes", ({ match, body, me }) => logEvent(needJob(match[1]), me, "note_added", { note: body.note }));
route("PATCH", "/jobs/:id/checklist", ({ match, body }) => { const j = needJob(match[1]); Object.assign(j, body); return j; });
route("GET", "/jobs/:id", ({ match, me }) => detail(needJob(match[1]), me));
route("PATCH", "/jobs/:id", ({ match, body, me }) => {
  const j = needJob(match[1]);
  const b = { ...body } as Q;
  const change: Record<string, unknown> = {};
  for (const k of ["title", "weight", "video_type", "rush", "deadline", "client_deadline", "assigned_editor_id", "qc2_reviewer_id", "channel_id"]) {
    if (b[k] !== undefined && (j as unknown as Q)[k] !== b[k]) { change[k] = { from: (j as unknown as Q)[k], to: b[k] }; (j as unknown as Q)[k] = b[k]; }
  }
  if (b.clear_deadline) j.deadline = null;
  if (b.clear_client_deadline) j.client_deadline = null;
  if (b.clear_editor) j.assigned_editor_id = null;
  if (b.clear_channel) j.channel_id = null;
  if (Object.keys(change).length) logEvent(j, me, "job_updated", change);
  return detail(j, me);
});

/* voice notes */
const b64 = (s: string) => { const p = s.replace(/-/g, "+").replace(/_/g, "/"); return atob(p + "=".repeat((4 - (p.length % 4)) % 4)); };
route("GET", "/voice-notes/admin/videos", ({ params }) => {
  let list = db.voiceVideos;
  if (params.search) list = list.filter((v) => includesText(`${v.video_title ?? ""} ${v.video_url}`, String(params.search)));
  return { ...paginate(list, params, 25), total_notes: list.reduce((n, v) => n + v.note_count, 0) };
});
route("GET", "/voice-notes/admin/videos/:key/notes", ({ match }) => { const key = b64(match[1]); return db.voiceNotes.filter((n) => n.video_key === key); });
route("DELETE", "/voice-notes/admin/bulk-delete", ({ body }) => {
  const ids = new Set(body as string[]);
  db.voiceNotes = db.voiceNotes.filter((n) => !ids.has(n.id));
  db.voiceVideos.forEach((v) => (v.note_count = db.voiceNotes.filter((n) => n.video_key === v.video_key).length));
  db.voiceVideos = db.voiceVideos.filter((v) => v.note_count > 0);
  return {};
});
route("DELETE", "/voice-notes/:id", ({ match }) => {
  db.voiceNotes = db.voiceNotes.filter((n) => n.id !== match[1]);
  db.voiceVideos.forEach((v) => (v.note_count = db.voiceNotes.filter((n) => n.video_key === v.video_key).length));
  db.voiceVideos = db.voiceVideos.filter((v) => v.note_count > 0);
  return {};
});

/* chat */
route("GET", "/chat/status", () => ({ enabled: true, model: "demo", daily_cap: 25, used_today: 3, reason: null }));
route("GET", "/chat/conversations/:id", ({ match }) => db.conversations.find((c) => c.id === match[1]) ?? fail(404, "No such conversation"));
route("GET", "/chat/conversations", ({ params }) => paginate(db.conversations.map(({ messages: _m, ...c }) => c), params, 30));
route("DELETE", "/chat/conversations/:id", ({ match }) => { db.conversations = db.conversations.filter((c) => c.id !== match[1]); return {}; });

/* whatsapp */
const tpl = (name: string, status: string, extra: Q = {}) => ({
  name, language: "en", status, category: "UTILITY", requested_category: "UTILITY", quality_score: "GREEN", rejected_reason: null, meta_template_id: "tpl_" + name,
  submitted_at: nowIso(), approved_at: status === "APPROVED" ? nowIso() : null, last_status_at: nowIso(), last_synced_at: nowIso(), category_drifted: false, drifted: false,
  missing: false, unmanaged: false, purpose: "Job hand-off", recipient: "Assigned editor", param_count: 3, body_preview: "Hi {{1}}, {{2}} has landed with you. Deadline {{3}}.", buttons: ["Open job"], ...extra,
});
route("GET", "/whatsapp/status", () => ({
  configured: true, has_token: true, has_app_secret: true, has_verify_token: false, graph_version: "v21.0", waba_id: "10492000000000", phone_number_id: "1055000000000",
  display_phone_number: "+91 98100 00000", verified_name: "Kontent Media", quality_rating: "GREEN", messaging_limit: "TIER_1K", platform_type: "CLOUD_API",
  webhook_last_received_at: nowIso(), error: null,
}));
route("GET", "/whatsapp/templates", () => [
  tpl("job_assigned_v1", "APPROVED", { category: "MARKETING", category_drifted: true }), tpl("qc1_ready_v1", "APPROVED"), tpl("qc2_assigned_v1", "APPROVED"),
  tpl("changes_raised_v1", "APPROVED"), tpl("deadline_soon_v1", "APPROVED", { drifted: true }), tpl("daily_digest_v1", "PENDING"),
]);
route("POST", "/whatsapp/templates/sync", () => ({ seen: 6, changed: 0, unmanaged: [], synced_at: nowIso() }));
route("POST", "/whatsapp/templates/:name/submit", ({ match }) => tpl(decodeURIComponent(match[1]), "PENDING"));
route("POST", "/whatsapp/templates/:name/resubmit", ({ match }) => tpl(decodeURIComponent(match[1]), "PENDING"));
route("DELETE", "/whatsapp/templates/:name", () => ({}));
route("GET", "/whatsapp/events", () => [
  { event_key: "job_assigned", template_name: "job_assigned_v1", enabled: true, tier: "core", recipient: "Editor", purpose: "A video landed with you", template_ready: true, template_status: "APPROVED" },
  { event_key: "changes_raised", template_name: "changes_raised_v1", enabled: true, tier: "core", recipient: "Editor", purpose: "QC sent changes back", template_ready: true, template_status: "APPROVED" },
  { event_key: "deadline_soon", template_name: "deadline_soon_v1", enabled: false, tier: "scheduled", recipient: "Editor", purpose: "Deadline is tomorrow", template_ready: true, template_status: "APPROVED" },
]);
route("GET", "/whatsapp/settings", () => ({ enabled: db.whatsapp.enabled, pilot_user_ids: [], event_flags: {}, updated_at: nowIso() }));
route("PATCH", "/whatsapp/settings", ({ body }) => { if (body.enabled !== undefined) db.whatsapp.enabled = Boolean(body.enabled); return { enabled: db.whatsapp.enabled, pilot_user_ids: [], event_flags: {}, updated_at: nowIso() }; });
route("GET", "/whatsapp/messages/stats", () => ({ sent: 148, delivered: 141, read: 112, failed: 3, skipped: 9 }));
route("GET", "/whatsapp/messages", ({ params }) => {
  const rows = db.jobs.slice(0, 18).map((j, i) => ({
    id: `wm${i}`, user_id: j.assigned_editor_id ?? "u_ravi", user_name: nameOf(j.assigned_editor_id), job_id: j.id, job_code: j.code, event_key: "job_assigned", template_name: "job_assigned_v1",
    to_phone: "+91 98xxx xxxxx", status: ["read", "delivered", "sent", "failed"][i % 4], reason: null, error_code: i % 4 === 3 ? 131049 : null, error_detail: i % 4 === 3 ? "Marketing template cap" : null,
    button_action: null, button_tapped_at: null, sent_at: iso(-i), delivered_at: iso(-i), read_at: i % 4 === 0 ? iso(-i) : null, failed_at: null, created_at: iso(-i),
  }));
  return paginate(rows, params, 25);
});
route("GET", "/whatsapp/numbers", () => db.users.filter((u) => u.is_active).map((u) => ({
  user_id: u.id, name: u.name, email: u.email, role: u.role, is_active: u.is_active, phone: u.phone, phone_e164: u.phone?.replace(/\s/g, "") ?? null, phone_display: u.phone, valid: Boolean(u.phone),
  opt_in: db.whatsapp.opt_in[u.id] ?? true, last_inbound_at: iso(-1), window_open: u.id === "u_ravi", duplicate: false, reachable: true,
})));
route("PATCH", "/whatsapp/numbers/:id", ({ match, body }) => {
  if (body.opt_in !== undefined) db.whatsapp.opt_in[match[1]] = Boolean(body.opt_in);
  const u = getUser(match[1])!;
  return { user_id: u.id, name: u.name, email: u.email, role: u.role, is_active: u.is_active, phone: u.phone, phone_e164: u.phone, phone_display: u.phone, valid: true, opt_in: db.whatsapp.opt_in[u.id] ?? true, last_inbound_at: null, window_open: false, duplicate: false, reachable: true };
});
route("POST", "/whatsapp/test-send", () => ({ status: "sent", reason: null, error_code: null, error_detail: null, wamid: "wamid.demo", to_phone: "+91 98xxx xxxxx" }));
route("POST", "/whatsapp/scheduler/run", () => ({ reconciled: { seen: 6, changed: 0, unmanaged: [], synced_at: nowIso() }, deadline_soon: 2, deadline_missed: 1 }));

/* ---------------------------------------------------------------- adapter */

function meFromConfig(config: InternalAxiosRequestConfig): User | null {
  const raw = (config.headers as AxiosHeaders | undefined)?.get?.("Authorization") ?? (config.headers as Q | undefined)?.Authorization;
  const token = String(raw ?? "").replace(/^Bearer\s+/i, "");
  if (!token.startsWith("demo.")) return null;
  return getUser(token.slice(5)) ?? null;
}

function respond(config: InternalAxiosRequestConfig, status: number, data: unknown, headers: Record<string, string> = {}): AxiosResponse {
  return { data, status, statusText: String(status), headers, config, request: {} };
}

const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** The axios adapter installed on both API clients in demo mode. */
export async function demoAdapter(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  await new Promise((r) => setTimeout(r, 60 + Math.random() * 120));

  const method = (config.method ?? "get").toUpperCase();
  const path = String(config.url ?? "").split("?")[0].replace(/^\/api/, "").replace(/\/$/, "") || "/";
  const query = new URLSearchParams(String(config.url ?? "").split("?")[1] ?? "");
  const params: Q = { ...(config.params ?? {}) };
  query.forEach((v, k) => (params[k] = v));

  let body: unknown = config.data;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { /* leave as text */ }
  }

  const found = routes.find((r) => r.method === method && r.re.test(path));
  const reject = (status: number, detail: string) => {
    const response = respond(config, status, { detail });
    return Promise.reject(new AxiosError(detail, status >= 500 ? "ERR_BAD_RESPONSE" : "ERR_BAD_REQUEST", config, {}, response));
  };
  if (!found) return reject(404, `Demo mode has no handler for ${method} ${path}`);

  const me = meFromConfig(config);
  if (found.auth !== false && !me) return reject(401, "Not authenticated");

  try {
    const match = path.match(found.re)!;
    const out = found.h({ me: me as User, params, body: body ?? {}, match });
    if (MUTATING.has(method)) save();
    if (out && typeof out === "object" && "__blob" in (out as Q)) {
      const o = out as Q;
      return respond(config, 200, new Blob([o.__blob], { type: "text/plain" }), { "content-disposition": `attachment; filename="${o.__name}"` });
    }
    // Hand back a copy so a component mutating a response can't corrupt the store.
    return respond(config, 200, out === undefined ? {} : JSON.parse(JSON.stringify(out)));
  } catch (error) {
    if (error instanceof HttpError) return reject(error.status, error.detail);
    console.error("[demo]", error);
    return reject(500, "Demo backend error");
  }
}

/** Test hook / banner: how many jobs the signed-in demo account can see. */
export function demoStats() {
  return { jobs: db.jobs.length, users: db.users.length, pods: db.pods.length };
}

// Re-exported so the chat stub can read what the signed-in account can see.
export function demoOverviewFor(userId: string) {
  const u = getUser(userId);
  return u ? overview(u) : null;
}
export function demoUserFromToken(token: string | null) {
  return token && token.startsWith("demo.") ? getUser(token.slice(5)) ?? null : null;
}
export function demoAddConversation(question: string, answer: string) {
  const id = uid("cv");
  db.conversations.unshift({
    id, title: question.slice(0, 60), created_at: nowIso(), updated_at: nowIso(),
    messages: [
      { id: uid("m"), role: "user", content: question, tool_calls: [], charts: [], model: null, created_at: nowIso() },
      { id: uid("m"), role: "assistant", content: answer, tool_calls: [], charts: [], model: "demo", created_at: nowIso() },
    ],
  });
  save();
  return id;
}
