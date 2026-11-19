import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  LayoutGrid, Users, BookOpen, BarChart3, Plus, Search, X, Check, Gauge,
  MessageSquare, RotateCcw, ArrowRight, AlertTriangle, Trash2, Flag,
  ChevronRight, ChevronDown, Loader2, FileText, Palette, Ban, ListChecks,
  Boxes, ExternalLink, Film, Shuffle, Circle, Zap, Info, Send, Clock,
  CheckCheck, Bot, IndianRupee
} from "lucide-react";

/* ================================================================== */
/*  Pipeline                                                          */
/* ================================================================== */

const STAGES = [
  { id: "intake",    label: "Intake",      owner: "TL" },
  { id: "assigned",  label: "Assigned",    owner: "TL" },
  { id: "editing",   label: "Editing",     owner: "VE" },
  { id: "qc1",       label: "QC 1",        owner: "TL" },
  { id: "qc2",       label: "QC 2",        owner: "QC" },
  { id: "revisions", label: "Revisions",   owner: "VE" },
  { id: "final",     label: "Final check", owner: "TL" },
  { id: "delivered", label: "Delivered",   owner: "TL" },
];
const sIdx = (id) => STAGES.findIndex((s) => s.id === id);
const sOf = (id) => STAGES[sIdx(id)] || STAGES[0];

const ROLE_STYLE = {
  TL: { chip: "bg-indigo-100 text-indigo-800", bar: "bg-indigo-500", dot: "bg-indigo-500" },
  VE: { chip: "bg-teal-100 text-teal-800",     bar: "bg-teal-500",   dot: "bg-teal-500" },
  QC: { chip: "bg-amber-100 text-amber-800",   bar: "bg-amber-500",  dot: "bg-amber-500" },
};

const ASSET_TYPES = {
  brief: { label: "Brand brief", icon: FileText,   chip: "bg-indigo-100 text-indigo-800" },
  sop:   { label: "SOP",         icon: ListChecks, chip: "bg-teal-100 text-teal-800" },
  kit:   { label: "Asset kit",   icon: Palette,    chip: "bg-violet-100 text-violet-800" },
  never: { label: "Do-not list", icon: Ban,        chip: "bg-rose-100 text-rose-700" },
};

const WEIGHTS = { light: { label: "Light", cost: 1 }, standard: { label: "Standard", cost: 2 }, heavy: { label: "Heavy", cost: 4 } };
const QC_CAPACITY = 8;
const CERT_THRESHOLD = 3;

/* ================================================================== */
/*  WhatsApp template registry                                        */
/*  Every one is Utility. Marketing is capped ~2/user/day (err 131049)*/
/*  {{n}} are positional variables — Meta approves the shape, not the */
/*  text you interpolate.                                             */
/* ================================================================== */

const TEMPLATES = {
  job_assigned_v1: {
    name: "job_assigned_v1", category: "Utility", status: "approved", paced: false,
    to: "editor", urgency: "now",
    body: "New edit assigned.\n\n*{{1}}* — {{2}}\nClient: {{3}}\nDue: {{4}}\n\nUpload here: {{5}}",
    vars: ["code", "title", "client", "deadline", "frameLink"],
    buttons: ["Started", "Can't take it"],
  },
  qc1_ready_v1: {
    name: "qc1_ready_v1", category: "Utility", status: "approved", paced: false,
    to: "tl", urgency: "now",
    body: "{{1}} is out of edit and ready for QC 1.\n\n*{{2}}*\nEditor: {{3}} · v{{4}}\n\n{{5}}",
    vars: ["code", "title", "editor", "version", "frameLink"],
    buttons: ["Reviewing now"],
  },
  qc2_assigned_v1: {
    name: "qc2_assigned_v1", category: "Utility", status: "approved", paced: false,
    to: "qc", urgency: "now",
    body: "QC 2 assigned to you.\n\n*{{1}}* — {{2}}\nPod: {{3}} · Editor: {{4}}\n\nLeave notes as comments here: {{5}}",
    vars: ["code", "title", "client", "editor", "frameLink"],
    buttons: ["Picked up", "Reassign me"],
  },
  changes_raised_v1: {
    name: "changes_raised_v1", category: "Utility", status: "approved", paced: false,
    to: "editor", urgency: "now",
    body: "Change list is live — round {{1}}.\n\n*{{2}}*\n{{3}} open comments on v{{4}}\n\n{{5}}",
    vars: ["round", "title", "openComments", "version", "frameLink"],
    buttons: ["On it", "Need a call"],
  },
  final_check_v1: {
    name: "final_check_v1", category: "Utility", status: "approved", paced: false,
    to: "tl", urgency: "now",
    body: "{{1}} passed QC 2 and is ready for your final check.\n\n*{{2}}*\nRounds: {{3}}\n\n{{4}}",
    vars: ["code", "title", "rounds", "frameLink"],
    buttons: ["Approve", "Send back"],
  },
  deadline_soon_v1: {
    name: "deadline_soon_v1", category: "Utility", status: "paced", paced: true,
    to: "editor", urgency: "now",
    body: "Heads up — *{{1}}* is due {{2}}.\n\nStill sitting at {{3}}.\n\n{{4}}",
    vars: ["title", "due", "stage", "frameLink"],
    buttons: ["On track", "Need more time"],
  },
  stuck_rounds_v1: {
    name: "stuck_rounds_v1", category: "Utility", status: "approved", paced: false,
    to: "tl", urgency: "now",
    body: "*{{1}}* has hit round {{2}}.\n\nEditor: {{3}} · Pod: {{4}}\n\nUsually a brief problem, not an editor problem.",
    vars: ["title", "rounds", "editor", "client"],
    buttons: ["Looking into it"],
  },
  delivered_v1: {
    name: "delivered_v1", category: "Utility", status: "approved", paced: false,
    to: "tl", urgency: "digest",
    body: "Delivered: *{{1}}* ({{2}})\nRounds: {{3}} · Editor: {{4}}",
    vars: ["title", "client", "rounds", "editor"],
    buttons: [],
  },
  daily_digest_v1: {
    name: "daily_digest_v1", category: "Utility", status: "approved", paced: false,
    to: "any", urgency: "digest",
    body: "Your day on {{1}}:\n\n{{2}}\n\nOpen the board: {{3}}",
    vars: ["date", "summary", "appLink"],
    buttons: ["Open board"],
  },
  pending_review_v1: {
    name: "pending_review_v1", category: "Utility", status: "pending", paced: false,
    to: "qc", urgency: "digest",
    body: "{{1}} jobs are waiting in your QC queue.\n\nOldest: *{{2}}* ({{3}})",
    vars: ["count", "oldestTitle", "oldestAge"],
    buttons: ["Open queue"],
  },
};

/* Event → who gets messaged → which template */
const EVENT_MAP = {
  job_assigned:   { template: "job_assigned_v1",   to: "editor", label: "Editor assigned to a job" },
  sent_to_qc1:    { template: "qc1_ready_v1",      to: "tl",     label: "Editor marks cut ready" },
  qc2_routed:     { template: "qc2_assigned_v1",   to: "qc",     label: "QC 2 routed to a reviewer" },
  changes_raised: { template: "changes_raised_v1", to: "editor", label: "QC requests changes" },
  qc2_passed:     { template: "final_check_v1",    to: "tl",     label: "QC 2 passes the cut" },
  deadline_soon:  { template: "deadline_soon_v1",  to: "editor", label: "Deadline within 24h" },
  stuck_rounds:   { template: "stuck_rounds_v1",   to: "tl",     label: "Job hits 3 rounds" },
  delivered:      { template: "delivered_v1",      to: "tl",     label: "Job delivered" },
};

const RATE_UTILITY = 0.115; // ₹ per delivered utility template, India. Verify against your BSP rate card.

/* ================================================================== */
/*  Utils                                                             */
/* ================================================================== */

const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 9);
const daysLeft = (d) => Math.round((new Date(d + "T00:00:00") - new Date(todayISO() + "T00:00:00")) / 864e5);
const fmtDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
const fmtTime = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function dueLabel(job) {
  if (job.stage === "delivered") return { text: "Delivered", tone: "text-emerald-600" };
  const d = daysLeft(job.deadline);
  if (d < 0) return { text: `${Math.abs(d)}d overdue`, tone: "text-rose-600 font-medium" };
  if (d === 0) return { text: "Due today", tone: "text-amber-600 font-medium" };
  return { text: `${d}d left`, tone: "text-slate-500" };
}

const frameLink = (id) => `https://next.frame.io/r/${id}`;

/* ================================================================== */
/*  Notification engine                                               */
/* ================================================================== */

/* A user's 24h service window is open if they messaged us within 24h.
   Inside it: free-form, free. Outside: approved template, billed. */
function windowOpen(user) {
  if (!user.lastInboundAt) return false;
  return Date.now() - user.lastInboundAt < 24 * 3600 * 1000;
}
function windowLeft(user) {
  if (!windowOpen(user)) return null;
  const ms = 24 * 3600 * 1000 - (Date.now() - user.lastInboundAt);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function render(tpl, values) {
  return tpl.body.replace(/\{\{(\d+)\}\}/g, (_, n) => values[tpl.vars[Number(n) - 1]] ?? "—");
}

function buildMessage(eventKey, job, pod, users) {
  const ev = EVENT_MAP[eventKey];
  if (!ev) return null;
  const tpl = TEMPLATES[ev.template];
  const recipientId = ev.to === "editor" ? job.editorId : ev.to === "qc" ? job.qcId : pod.tlId;
  const recipient = users.find((u) => u.id === recipientId);
  if (!recipient) return null;

  const nameOf = (id) => users.find((u) => u.id === id)?.name || "—";
  const values = {
    code: job.code, title: job.title, client: pod.client,
    deadline: fmtDate(job.deadline), editor: nameOf(job.editorId),
    version: job.frame?.version ?? 1, openComments: job.frame?.unresolved ?? 0,
    round: job.revisions, rounds: job.revisions, stage: sOf(job.stage).label,
    due: fmtDate(job.deadline), frameLink: job.frame ? frameLink(job.frame.reviewId) : "link pending",
  };

  const free = windowOpen(recipient);
  return {
    id: uid(), ts: Date.now(), event: eventKey, jobId: job.id, jobCode: job.code,
    to: recipient.id, toName: recipient.name, template: tpl.name,
    mode: free ? "free-form" : "template",
    cost: free ? 0 : RATE_UTILITY,
    status: tpl.status === "pending" ? "blocked" : "sent",
    blockedReason: tpl.status === "pending" ? "Template not approved by Meta yet" : null,
    body: render(tpl, values), buttons: tpl.buttons, urgency: tpl.urgency,
  };
}

/* ================================================================== */
/*  Seed                                                              */
/* ================================================================== */

const hAgo = (h) => Date.now() - h * 3600 * 1000;

const SEED_USERS = [
  { id: "u_mukul",    name: "Mukul",    role: "owner", available: true,  lastInboundAt: hAgo(2) },
  { id: "u_abhishek", name: "Abhishek", role: "tl",    available: true,  lastInboundAt: hAgo(1) },
  { id: "u_ravi",     name: "Ravi",     role: "tl",    available: true,  lastInboundAt: hAgo(40) },
  { id: "u_tanvi",    name: "Tanvi",    role: "qc",    available: true,  lastInboundAt: hAgo(3) },
  { id: "u_ishan",    name: "Ishan",    role: "qc",    available: true,  lastInboundAt: hAgo(30) },
  { id: "u_farah",    name: "Farah",    role: "qc",    available: true,  lastInboundAt: null },
  { id: "u_deepak",   name: "Deepak",   role: "qc",    available: false, lastInboundAt: hAgo(80) },
  { id: "u_aditya",   name: "Aditya",   role: "ve",    available: true,  lastInboundAt: hAgo(0.5) },
  { id: "u_priyanka", name: "Priyanka", role: "ve",    available: true,  lastInboundAt: hAgo(50) },
  { id: "u_rahul",    name: "Rahul",    role: "ve",    available: true,  lastInboundAt: hAgo(6) },
  { id: "u_sneha",    name: "Sneha",    role: "ve",    available: true,  lastInboundAt: null },
  { id: "u_karan",    name: "Karan",    role: "ve",    available: true,  lastInboundAt: hAgo(20) },
  { id: "u_meera",    name: "Meera",    role: "ve",    available: true,  lastInboundAt: hAgo(70) },
];

function seedPods() {
  return [
    { id: "p_dhan", client: "Dhan", tlId: "u_abhishek", frameProject: "Dhan / 2026",
      memberIds: ["u_abhishek", "u_aditya", "u_priyanka", "u_rahul"],
      assets: [
        { id: uid(), type: "brief", title: "Dhan brand brief v4", note: "Fintech, retail traders. Confident not hypey. Never promise returns.", updatedAt: addDays(-12) },
        { id: uid(), type: "sop", title: "Shorts editing SOP", note: "Hook in 1.5s. Captions burned in, Inter SemiBold. Cut on beat.", updatedAt: addDays(-30) },
        { id: uid(), type: "never", title: "Do-not list", note: "No SEBI-sensitive claims. No competitor names. No tickers on thumbnails.", updatedAt: addDays(-20) },
      ] },
    { id: "p_vested", client: "Vested", tlId: "u_abhishek", frameProject: "Vested / 2026",
      memberIds: ["u_abhishek", "u_aditya", "u_sneha"],
      assets: [{ id: uid(), type: "brief", title: "Vested brand brief v2", note: "US stocks for Indian investors. Calm, explanatory, data-forward.", updatedAt: addDays(-8) }] },
    { id: "p_coindcx", client: "CoinDCX", tlId: "u_ravi", frameProject: "CoinDCX / Always-on",
      memberIds: ["u_ravi", "u_rahul", "u_karan"],
      assets: [{ id: uid(), type: "brief", title: "CoinDCX brand brief", note: "Crypto exchange. Fast, punchy, meme-literate but compliant.", updatedAt: addDays(-15) }] },
    { id: "p_damac", client: "Damac Properties", tlId: "u_ravi", frameProject: "Damac / Q3",
      memberIds: ["u_ravi", "u_karan", "u_meera"],
      assets: [{ id: uid(), type: "brief", title: "Damac brand brief", note: "UAE luxury real estate. Cinematic, slow, no hard sell. AED billing.", updatedAt: addDays(-6) }] },
  ];
}

function seedJobs() {
  const raw = [
    ["p_dhan","Options basics — Ep 12","u_aditya",null,"editing",1,0,"standard","standard",1,0],
    ["p_dhan","Market wrap — 26 Jul","u_priyanka",null,"qc1",0,1,"rush","light",2,3],
    ["p_dhan","Shorts batch — 14 clips","u_rahul",null,"intake",6,0,"standard","heavy",1,0],
    ["p_dhan","Weekly recap — wk29","u_rahul","u_tanvi","delivered",-1,3,"rush","standard",4,0],
    ["p_dhan","Margin explainer","u_aditya","u_tanvi","delivered",-6,0,"standard","standard",1,0],
    ["p_dhan","Tax series — Ep 3","u_aditya","u_farah","delivered",-9,0,"standard","standard",1,0],
    ["p_vested","US market open — 29 Jul","u_sneha","u_ishan","revisions",2,3,"standard","standard",4,5],
    ["p_vested","ETF explainer","u_aditya","u_ishan","qc2",-1,1,"standard","standard",2,4],
    ["p_vested","Founder interview p2","u_sneha","u_farah","delivered",-4,0,"standard","heavy",1,0],
    ["p_coindcx","Token explainer reel","u_rahul","u_tanvi","qc2",-1,2,"standard","light",3,2],
    ["p_coindcx","App walkthrough","u_karan","u_farah","delivered",-2,1,"standard","standard",2,0],
    ["p_coindcx","Security feature promo","u_karan",null,"assigned",4,0,"standard","standard",1,0],
    ["p_damac","Marina tour 60s","u_karan","u_ishan","final",3,1,"rush","standard",2,0],
    ["p_damac","Penthouse walkthrough","u_meera",null,"editing",5,0,"standard","heavy",1,0],
    ["p_damac","Client testimonial","u_meera",null,"assigned",7,0,"standard","light",1,0],
  ];
  return raw.map(([podId, title, editorId, qcId, stage, dueIn, revisions, priority, weight, version, unresolved], i) => ({
    id: uid(), code: `KM-${1040 + i}`, podId, title, editorId, qcId, stage, revisions, priority, weight,
    deadline: addDays(dueIn), brief: "", qcAssignedAt: qcId ? addDays(-2 - (i % 5)) : null,
    qcReason: qcId ? "Seeded" : null,
    frame: sIdx(stage) >= 2 ? { assetId: uid(), reviewId: uid().slice(0, 6), version, unresolved } : null,
    sheetInternal: stage === "delivered", sheetClient: stage === "delivered",
    createdAt: addDays(-10 + i),
    log: [{ ts: addDays(-10 + i), actor: "TL", text: "Brief logged from client WhatsApp" }],
  }));
}

/* ================================================================== */
/*  QC routing                                                        */
/* ================================================================== */

function routeQC(job, qcTeam, allJobs) {
  if (job.qcId && job.revisions > 0) {
    const prev = qcTeam.find((u) => u.id === job.qcId);
    if (prev && prev.available)
      return { qcId: prev.id, reason: `Round ${job.revisions + 1} — stays with ${prev.name}, who wrote the change list` };
  }
  const pool = qcTeam.filter((u) => u.available);
  if (!pool.length) return { qcId: null, reason: "No reviewer available. Held in queue." };

  const scored = pool.map((u) => {
    const open = allJobs.filter((j) => j.qcId === u.id && j.stage === "qc2");
    const load = open.reduce((s, j) => s + WEIGHTS[j.weight || "standard"].cost, 0);
    const familiar = allJobs.some((j) => j.podId === job.podId && j.qcId === u.id && j.stage === "delivered");
    const last = allJobs.filter((j) => j.qcId === u.id).map((j) => j.qcAssignedAt || "2000-01-01").sort().pop() || "2000-01-01";
    const idle = Math.max(0, Math.round((new Date(todayISO()) - new Date(last)) / 864e5));
    return { u, load, open: open.length, familiar, idle, score: load - (familiar ? 2 : 0) - Math.min(idle, 3) * 0.4 };
  }).sort((a, b) => a.score - b.score);

  const w = scored[0];
  const bits = [`${w.open} open (${w.load} pts)`];
  if (w.familiar) bits.push("knows this pod");
  if (w.idle >= 2) bits.push(`idle ${w.idle}d`);
  return { qcId: w.u.id, reason: `Routed to ${w.u.name} — ${bits.join(", ")}` };
}

/* ================================================================== */
/*  Bits                                                              */
/* ================================================================== */

const Chip = ({ className = "", children }) => (
  <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>
);

function Filmstrip({ stage, revisions }) {
  const idx = sIdx(stage);
  return (
    <div className="flex items-center gap-px">
      {STAGES.map((s, i) => (
        <div key={s.id} title={s.label}
          className={`h-5 rounded-sm transition-all ${i === idx ? "w-6" : "w-3"} ${i === idx ? ROLE_STYLE[s.owner].bar : i < idx ? "bg-slate-300" : "bg-slate-100"}`} />
      ))}
      {revisions > 0 && <span className={`ml-2 font-mono text-xs ${revisions >= 3 ? "text-rose-600 font-semibold" : "text-slate-400"}`}>×{revisions}</span>}
    </div>
  );
}

const StatTile = ({ label, value, sub, tone = "text-slate-900" }) => (
  <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
    <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
    <div className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
    {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
  </div>
);

function FrameBadge({ job, compact }) {
  if (!job.frame) return compact ? null : <span className="inline-flex items-center gap-1.5 text-xs text-slate-400"><Film size={12} /> No asset</span>;
  return (
    <a href={frameLink(job.frame.reviewId)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-500">
      <Film size={12} className="text-slate-400" /><span className="font-mono">v{job.frame.version}</span>
      {job.frame.unresolved > 0 && <span className="rounded bg-amber-100 px-1 font-mono text-amber-800">{job.frame.unresolved}</span>}
      {!compact && <ExternalLink size={11} className="text-slate-400" />}
    </a>
  );
}

/* A rendered WhatsApp bubble — what the person actually receives */
function WaBubble({ msg }) {
  return (
    <div className="rounded-lg rounded-tl-sm border border-emerald-200 bg-emerald-50 p-3">
      <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-800">{msg.body}</pre>
      {msg.buttons?.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-emerald-200 pt-2.5">
          {msg.buttons.map((b) => (
            <span key={b} className="rounded border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-800">{b}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Job drawer                                                        */
/* ================================================================== */

function JobDrawer({ job, pod, me, users, jobs, onClose, onUpdate, onDelete, onSend }) {
  const [showRouting, setShowRouting] = useState(false);
  const nameOf = (id) => users.find((u) => u.id === id)?.name;
  const qcTeam = users.filter((u) => u.role === "qc");
  const st = sOf(job.stage);
  const isVE = me.role === "ve", isQC = me.role === "qc";
  const canManage = me.role === "owner" || me.id === pod.tlId;
  const log = (text, actor) => [...job.log, { ts: todayISO(), actor, text }];

  const advance = () => {
    const i = sIdx(job.stage);
    if (i >= STAGES.length - 1) return;
    const next = job.stage === "revisions" ? "qc2" : STAGES[i + 1].id;
    let nj = { ...job, stage: next, log: log(`Moved to ${sOf(next).label}`, st.owner) };
    if (next === "qc2") {
      const r = routeQC(nj, qcTeam, jobs);
      nj = { ...nj, qcId: r.qcId, qcReason: r.reason, qcAssignedAt: todayISO(), log: log(r.reason, "TL") };
    }
    onUpdate(nj);
    const evt = { qc1: "sent_to_qc1", qc2: "qc2_routed", final: "qc2_passed", delivered: "delivered" }[next];
    if (evt) onSend(evt, nj, pod);
  };

  const sendBack = () => {
    const nj = { ...job, stage: "revisions", revisions: job.revisions + 1,
      frame: job.frame ? { ...job.frame, unresolved: Math.max(1, job.frame.unresolved) } : null,
      log: log(`Sent back — round ${job.revisions + 1}`, st.owner) };
    onUpdate(nj);
    onSend("changes_raised", nj, pod);
    if (nj.revisions >= 3) onSend("stuck_rounds", nj, pod);
  };

  const deliver = () => {
    const nj = { ...job, stage: "delivered", sheetClient: true, sheetInternal: true,
      frame: job.frame ? { ...job.frame, unresolved: 0 } : null,
      log: log("Delivered to client, sheets updated", "TL") };
    onUpdate(nj); onSend("delivered", nj, pod);
  };

  const reroute = (qcId) => {
    const u = users.find((x) => x.id === qcId);
    const nj = { ...job, qcId, qcAssignedAt: todayISO(), qcReason: `Manually reassigned to ${u.name} by ${me.name}`,
      log: log(`QC 2 reassigned to ${u.name}`, "TL") };
    onUpdate(nj); onSend("qc2_routed", nj, pod); setShowRouting(false);
  };

  const due = dueLabel(job);
  const myTurn = (isVE && ["editing", "revisions"].includes(job.stage)) || (isQC && job.stage === "qc2" && job.qcId === me.id);

  /* preview of the next bot message this stage would fire */
  const nextEvent = { assigned: "job_assigned", editing: "sent_to_qc1", qc1: "qc2_routed", qc2: "changes_raised", revisions: "sent_to_qc1", final: "delivered" }[job.stage];
  const preview = nextEvent ? buildMessage(nextEvent, job, pod, users) : null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-slate-900 bg-opacity-20" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-slate-200 bg-slate-50">
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Chip className="bg-slate-100 text-slate-600">{pod.client}</Chip>
                <span className="font-mono text-xs text-slate-400">{job.code}</span>
                {job.priority === "rush" && <Chip className="bg-rose-100 text-rose-700">Rush</Chip>}
              </div>
              <h2 className="mt-1.5 truncate text-lg font-semibold">{job.title}</h2>
            </div>
            <button onClick={onClose} className="rounded p-1.5 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
          </div>
          <div className="mt-4"><Filmstrip stage={job.stage} revisions={job.revisions} /></div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chip className={ROLE_STYLE[st.owner].chip}>{st.label} · {st.owner}</Chip>
            <span className={`text-xs ${due.tone}`}>{due.text}</span>
            <FrameBadge job={job} />
          </div>
        </div>

        <div className="flex-1 space-y-5 px-6 py-5">
          {/* actions */}
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs font-medium uppercase tracking-wider text-slate-400">Move this job</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {isVE && myTurn && (
                <button onClick={advance} className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700">
                  <Check size={14} /> {job.stage === "revisions" ? "Changes done" : "Mark sent to QC"}
                </button>
              )}
              {isQC && job.stage === "qc2" && job.qcId === me.id && (
                <>
                  <button onClick={advance} className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"><Check size={14} /> Pass QC 2</button>
                  <button onClick={sendBack} className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"><RotateCcw size={14} /> Request changes</button>
                </>
              )}
              {!isVE && !isQC && job.stage !== "delivered" && job.stage !== "final" && (
                <button onClick={advance} className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700">
                  {job.stage === "revisions" ? "Back to QC 2" : `Advance to ${STAGES[sIdx(job.stage) + 1].label}`} <ArrowRight size={14} />
                </button>
              )}
              {canManage && job.stage === "final" && (
                <button onClick={deliver} className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"><Check size={14} /> Approve &amp; deliver</button>
              )}
              {canManage && ["qc1", "final"].includes(job.stage) && (
                <button onClick={sendBack} className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"><RotateCcw size={14} /> Send back</button>
              )}
              {(isVE || isQC) && !myTurn && <p className="text-sm text-slate-500">With {sOf(job.stage).owner}. Nothing for you yet.</p>}
            </div>
          </div>

          {/* bot preview */}
          {preview && !isVE && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
                  <Bot size={13} /> Bot fires next
                </div>
                <div className="flex items-center gap-2">
                  <Chip className={preview.mode === "free-form" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}>
                    {preview.mode === "free-form" ? "Free — window open" : `Template · ₹${RATE_UTILITY}`}
                  </Chip>
                </div>
              </div>
              <div className="mt-3 text-xs text-slate-500">To {preview.toName} · <span className="font-mono">{preview.template}</span></div>
              <div className="mt-2"><WaBubble msg={preview} /></div>
            </div>
          )}

          {/* Frame.io */}
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400"><Film size={13} /> Frame.io</div>
              <span className="text-xs text-slate-400">{pod.frameProject}</span>
            </div>
            {job.frame ? (
              <>
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  <div><div className="text-xs text-slate-400">Version</div><div className="mt-0.5 font-mono">v{job.frame.version}</div></div>
                  <div><div className="text-xs text-slate-400">Open comments</div><div className={`mt-0.5 font-mono ${job.frame.unresolved > 0 ? "text-amber-700" : "text-emerald-600"}`}>{job.frame.unresolved}</div></div>
                  <div><div className="text-xs text-slate-400">Rounds</div><div className="mt-0.5 font-mono">{job.revisions}</div></div>
                </div>
                <a href={frameLink(job.frame.reviewId)} target="_blank" rel="noreferrer"
                  className="mt-3 flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2 hover:border-slate-400">
                  <span className="truncate font-mono text-xs text-slate-600">{frameLink(job.frame.reviewId)}</span>
                  <ExternalLink size={13} className="shrink-0 text-slate-400" />
                </a>
              </>
            ) : <p className="mt-3 text-sm text-slate-500">No asset yet. Created on the editor's first upload.</p>}
          </div>

          {/* QC routing */}
          {!isVE && sIdx(job.stage) >= 3 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400"><Shuffle size={13} /> QC 2 routing</div>
                {canManage && <button onClick={() => setShowRouting(!showRouting)} className="text-xs text-slate-500 hover:text-slate-900">{showRouting ? "Close" : "Reassign"}</button>}
              </div>
              <div className="mt-3 flex items-center gap-2.5">
                <span className={`h-2 w-2 rounded-full ${ROLE_STYLE.QC.dot}`} />
                <span className="text-sm font-medium">{nameOf(job.qcId) || "Not yet routed"}</span>
              </div>
              {job.qcReason && <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500"><Info size={12} className="mt-0.5 shrink-0" />{job.qcReason}</p>}
              {showRouting && (
                <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                  {qcTeam.map((u) => {
                    const open = jobs.filter((j) => j.qcId === u.id && j.stage === "qc2");
                    const load = open.reduce((s, j) => s + WEIGHTS[j.weight || "standard"].cost, 0);
                    return (
                      <button key={u.id} onClick={() => reroute(u.id)} disabled={!u.available}
                        className="flex w-full items-center justify-between rounded border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-40">
                        <span className="flex items-center gap-2">
                          <Circle size={8} className={u.available ? "fill-emerald-500 text-emerald-500" : "fill-slate-300 text-slate-300"} />{u.name}
                        </span>
                        <span className="font-mono text-xs text-slate-500">{open.length} open · {load} pts</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs font-medium uppercase tracking-wider text-slate-400">Activity</div>
            <ol className="mt-3 space-y-2.5">
              {[...job.log].reverse().map((e, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="mt-1 font-mono text-xs text-slate-400">{fmtDate(e.ts)}</span>
                  <span className={`mt-0.5 h-4 shrink-0 rounded-sm px-1 text-xs font-medium ${ROLE_STYLE[e.actor]?.chip || "bg-slate-100 text-slate-600"}`}>{e.actor}</span>
                  <span className="text-slate-700">{e.text}</span>
                </li>
              ))}
            </ol>
          </div>

          {canManage && <button onClick={() => { onDelete(job.id); onClose(); }} className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-rose-600"><Trash2 size={12} /> Delete job</button>}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  App                                                               */
/* ================================================================== */

export default function KontentOps() {
  const [users, setUsers] = useState(SEED_USERS);
  const [pods, setPods] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [outbox, setOutbox] = useState([]);
  const [loading, setLoading] = useState(true);
  const [meId, setMeId] = useState("u_mukul");
  const [podId, setPodId] = useState("p_dhan");
  const [view, setView] = useState("overview");
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("active");
  const [podMenu, setPodMenu] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [p, j, o] = await Promise.all([window.storage.get("km4:pods"), window.storage.get("km4:jobs"), window.storage.get("km4:outbox")]);
        setPods(p ? JSON.parse(p.value) : seedPods());
        setJobs(j ? JSON.parse(j.value) : seedJobs());
        setOutbox(o ? JSON.parse(o.value) : []);
      } catch { setPods(seedPods()); setJobs(seedJobs()); }
      setLoading(false);
    })();
  }, []);

  const savePods = useCallback(async (n) => { setPods(n); try { await window.storage.set("km4:pods", JSON.stringify(n)); } catch {} }, []);
  const saveJobs = useCallback(async (n) => { setJobs(n); try { await window.storage.set("km4:jobs", JSON.stringify(n)); } catch {} }, []);
  const saveOutbox = useCallback(async (n) => { setOutbox(n); try { await window.storage.set("km4:outbox", JSON.stringify(n)); } catch {} }, []);

  const me = users.find((u) => u.id === meId);
  const nameOf = (id) => users.find((u) => u.id === id)?.name || "—";
  const qcTeam = users.filter((u) => u.role === "qc");

  const send = useCallback((eventKey, job, pod) => {
    const msg = buildMessage(eventKey, job, pod, users);
    if (!msg) return;
    setOutbox((prev) => { const n = [msg, ...prev]; window.storage?.set("km4:outbox", JSON.stringify(n)).catch(() => {}); return n; });
    setToast(msg.status === "blocked"
      ? { tone: "bad", text: `Blocked — ${msg.template} isn't approved yet` }
      : { tone: "ok", text: `WhatsApp sent to ${msg.toName}${msg.mode === "free-form" ? " (free)" : ""}` });
    setTimeout(() => setToast(null), 2600);
  }, [users]);

  /* simulate the recipient tapping a button — opens their 24h window */
  const simulateReply = (userId) => {
    setUsers(users.map((u) => u.id === userId ? { ...u, lastInboundAt: Date.now() } : u));
    setToast({ tone: "ok", text: `${nameOf(userId)} replied — 24h window open, next 24h of messages are free` });
    setTimeout(() => setToast(null), 3200);
  };

  const visiblePods = useMemo(() => {
    if (me.role === "owner" || me.role === "qc") return pods;
    if (me.role === "tl") return pods.filter((p) => p.tlId === me.id);
    return pods.filter((p) => p.memberIds.includes(me.id));
  }, [pods, me]);

  useEffect(() => { if (visiblePods.length && !visiblePods.find((p) => p.id === podId)) setPodId(visiblePods[0].id); }, [visiblePods]);
  useEffect(() => {
    const allowed = { ve: ["mywork", "progress"], qc: ["qcqueue", "qcteam"],
      tl: ["pipeline", "brandkit", "members", "capacity", "qcteam", "bot", "insights"],
      owner: ["overview", "pipeline", "brandkit", "members", "capacity", "qcteam", "bot", "insights"] }[me.role];
    if (!allowed.includes(view)) setView(allowed[0]);
  }, [meId]);

  const pod = visiblePods.find((p) => p.id === podId) || visiblePods[0];
  const canManagePod = pod && (me.role === "owner" || me.id === pod.tlId);

  const scopedJobs = useMemo(() => {
    const ids = new Set(visiblePods.map((p) => p.id));
    let list = jobs.filter((j) => ids.has(j.podId));
    if (me.role === "ve") list = list.filter((j) => j.editorId === me.id);
    if (me.role === "qc") list = list.filter((j) => j.qcId === me.id);
    return list;
  }, [jobs, visiblePods, me]);

  const podJobs = useMemo(() => scopedJobs.filter((j) => j.podId === pod?.id), [scopedJobs, pod]);

  const filtered = useMemo(() => {
    let list = ["ve", "qc"].includes(me.role) ? scopedJobs : podJobs;
    if (filter === "active") list = list.filter((j) => j.stage !== "delivered");
    else if (filter === "overdue") list = list.filter((j) => j.stage !== "delivered" && daysLeft(j.deadline) < 0);
    else if (filter === "mine") list = list.filter((j) => me.role === "qc" ? j.stage === "qc2" : ["editing", "revisions"].includes(j.stage));
    else if (!["all", "active", "overdue", "mine"].includes(filter)) list = list.filter((j) => j.stage === filter);
    if (q.trim()) { const s = q.toLowerCase(); list = list.filter((j) => [j.title, j.code, nameOf(j.editorId)].join(" ").toLowerCase().includes(s)); }
    return [...list].sort((a, b) => a.deadline.localeCompare(b.deadline));
  }, [scopedJobs, podJobs, filter, q, me]);

  const certifiedOn = useCallback((uId, pId) =>
    jobs.filter((j) => j.podId === pId && j.editorId === uId && j.stage === "delivered" && j.revisions <= 1).length >= CERT_THRESHOLD, [jobs]);

  const qcLoad = useMemo(() => qcTeam.map((u) => {
    const open = jobs.filter((j) => j.qcId === u.id && j.stage === "qc2");
    return { u, open, load: open.reduce((s, j) => s + WEIGHTS[j.weight || "standard"].cost, 0),
      done: jobs.filter((j) => j.qcId === u.id && j.stage === "delivered").length };
  }).sort((a, b) => a.load - b.load), [jobs, qcTeam]);

  const capacity = useMemo(() => users.filter((u) => u.role === "ve").map((u) => {
    const open = jobs.filter((j) => j.editorId === u.id && j.stage !== "delivered");
    const done = jobs.filter((j) => j.editorId === u.id && j.stage === "delivered");
    return { user: u, open: open.length,
      byPod: pods.map((p) => ({ pod: p, n: open.filter((j) => j.podId === p.id).length, cert: certifiedOn(u.id, p.id) })).filter((x) => x.n > 0 || x.cert),
      delivered: done.length,
      clean: done.length ? Math.round(done.filter((j) => j.revisions === 0).length / done.length * 100) : null };
  }).sort((a, b) => b.open - a.open), [jobs, pods, users, certifiedOn]);

  /* bot economics */
  const bot = useMemo(() => {
    const billed = outbox.filter((m) => m.mode === "template" && m.status !== "blocked");
    const free = outbox.filter((m) => m.mode === "free-form");
    const openWindows = users.filter(windowOpen).length;
    const perVideo = 6;
    const monthlyVideos = 300;
    const worstCase = monthlyVideos * perVideo * RATE_UTILITY;
    const bestCase = monthlyVideos * 1 * RATE_UTILITY;
    return { billed: billed.length, free: free.length, spend: billed.length * RATE_UTILITY,
      blocked: outbox.filter((m) => m.status === "blocked").length, openWindows, worstCase, bestCase };
  }, [outbox, users]);

  const NAV = {
    ve: [{ id: "mywork", label: "My work", icon: LayoutGrid }, { id: "progress", label: "My progress", icon: BarChart3 }],
    qc: [{ id: "qcqueue", label: "My QC queue", icon: LayoutGrid }, { id: "qcteam", label: "QC team load", icon: Gauge }],
    tl: [{ id: "pipeline", label: "Pipeline", icon: LayoutGrid }, { id: "brandkit", label: "Brand kit", icon: BookOpen },
         { id: "members", label: "Members", icon: Users }, { id: "capacity", label: "Editor capacity", icon: Gauge },
         { id: "qcteam", label: "QC team load", icon: Shuffle }, { id: "bot", label: "WhatsApp bot", icon: Bot },
         { id: "insights", label: "Insights", icon: BarChart3 }],
    owner: [{ id: "overview", label: "All pods", icon: Boxes }, { id: "pipeline", label: "Pipeline", icon: LayoutGrid },
            { id: "brandkit", label: "Brand kit", icon: BookOpen }, { id: "members", label: "Members", icon: Users },
            { id: "capacity", label: "Editor capacity", icon: Gauge }, { id: "qcteam", label: "QC team load", icon: Shuffle },
            { id: "bot", label: "WhatsApp bot", icon: Bot }, { id: "insights", label: "Insights", icon: BarChart3 }],
  }[me.role];

  if (loading) return <div className="flex h-96 items-center justify-center bg-slate-50 text-slate-400"><Loader2 className="animate-spin" size={20} /></div>;

  const myOpen = scopedJobs.filter((j) => j.stage !== "delivered");
  const myTurn = myOpen.filter((j) => me.role === "qc" ? j.stage === "qc2" : ["editing", "revisions"].includes(j.stage));
  const myInbox = outbox.filter((m) => m.to === me.id);

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900">
      {toast && (
        <div className={`fixed left-1/2 top-5 z-50 rounded-lg border px-4 py-2.5 text-sm shadow-lg ${
          toast.tone === "bad" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}
          style={{ transform: "translateX(-50%)" }}>
          {toast.text}
        </div>
      )}

      {/* rail */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="text-sm font-semibold tracking-tight">Kontent OS</div>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
            <span className="flex items-center gap-1"><Film size={11} /> Frame.io</span>
            <span className="flex items-center gap-1"><MessageSquare size={11} /> WhatsApp</span>
          </div>
        </div>

        {["tl", "owner"].includes(me.role) && pod && (
          <div className="relative border-b border-slate-200 p-3">
            <button onClick={() => setPodMenu(!podMenu)} className="flex w-full items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left hover:bg-slate-50">
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{pod.client}</span>
                <span className="block text-xs text-slate-400">TL {nameOf(pod.tlId)}</span></span>
              <ChevronDown size={15} className="shrink-0 text-slate-400" />
            </button>
            {podMenu && (
              <div className="absolute left-3 right-3 top-16 z-20 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                {visiblePods.map((p) => (
                  <button key={p.id} onClick={() => { setPodId(p.id); setPodMenu(false); }}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 ${p.id === pod.id ? "font-medium" : "text-slate-600"}`}>
                    <span className="truncate">{p.client}</span>
                    <span className="font-mono text-xs text-slate-400">{jobs.filter((j) => j.podId === p.id && j.stage !== "delivered").length}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <nav className="flex-1 space-y-0.5 p-3">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setView(id)}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm ${view === id ? "bg-slate-100 font-medium" : "text-slate-600 hover:bg-slate-50"}`}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </nav>

        {/* personal window state */}
        <div className="border-t border-slate-200 p-3">
          <div className={`rounded-md border px-3 py-2 text-xs ${windowOpen(me) ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-500"}`}>
            <div className="flex items-center justify-between font-medium">
              <span className="flex items-center gap-1.5"><Clock size={11} /> Your WhatsApp window</span>
            </div>
            <div className="mt-1">{windowOpen(me) ? `Open · ${windowLeft(me)} left` : "Closed — templates only"}</div>
            {!windowOpen(me) && (
              <button onClick={() => simulateReply(me.id)} className="mt-2 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50">
                Simulate a reply
              </button>
            )}
          </div>
        </div>

        <div className="border-t border-slate-200 p-3">
          <label className="text-xs uppercase tracking-wider text-slate-400">Viewing as</label>
          <select value={meId} onChange={(e) => setMeId(e.target.value)}
            className="mt-1.5 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-slate-500">
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} — {{ owner: "Owner", tl: "TL", qc: "QC", ve: "Editor" }[u.role]}</option>)}
          </select>
        </div>
      </aside>

      {/* main */}
      <main className="min-w-0 flex-1">
        <header className="border-b border-slate-200 bg-white px-7 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">{NAV.find((n) => n.id === view)?.label}</h1>
              <p className="mt-0.5 text-sm text-slate-500">
                {["ve", "qc"].includes(me.role) ? `${myTurn.length} waiting on you · ${myInbox.length} bot messages`
                  : view === "bot" ? `${outbox.length} sent · ${bot.openWindows}/${users.length} windows open`
                  : `${pod?.client} · ${podJobs.filter((j) => j.stage !== "delivered").length} in flight`}
              </p>
            </div>
          </div>
        </header>

        <div className="p-7">
          {/* ============ WHATSAPP BOT ============ */}
          {view === "bot" && (
            <div className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile label="Sent this session" value={outbox.length} sub={`${bot.free} free, ${bot.billed} billed`} />
                <StatTile label="Windows open" value={`${bot.openWindows}/${users.length}`} sub="Free-form allowed" />
                <StatTile label="Session spend" value={`₹${bot.spend.toFixed(2)}`} sub={`₹${RATE_UTILITY}/template`} />
                <StatTile label="Blocked" value={bot.blocked} tone={bot.blocked ? "text-rose-600" : "text-slate-900"} sub="Template not approved" />
              </div>

              <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                <div className="flex items-start gap-2.5">
                  <IndianRupee size={15} className="mt-0.5 shrink-0 text-indigo-700" />
                  <div className="text-sm text-indigo-900">
                    <span className="font-medium">At 300 videos a month:</span> roughly ₹{bot.worstCase.toFixed(0)} if nobody ever replies
                    (6 templates per video), or ₹{bot.bestCase.toFixed(0)} if the first message gets a tap and the rest ride the free 24h window.
                    That gap is the whole reason every template ends in a button.
                  </div>
                </div>
              </div>

              {/* window state per person */}
              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <div className="text-xs font-medium uppercase tracking-wider text-slate-400">Service windows</div>
                <p className="mt-1.5 text-xs text-slate-500">Open = they messaged us in the last 24h, so anything we send is free-form and free.</p>
                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  {users.filter((u) => u.role !== "owner").map((u) => {
                    const open = windowOpen(u);
                    return (
                      <div key={u.id} className={`flex items-center justify-between rounded border px-3 py-2 text-sm ${open ? "border-emerald-200 bg-emerald-50" : "border-slate-200"}`}>
                        <span className="flex items-center gap-2">
                          <Circle size={8} className={open ? "fill-emerald-500 text-emerald-500" : "fill-slate-300 text-slate-300"} />
                          <span className="font-medium">{u.name}</span>
                          <Chip className={ROLE_STYLE[u.role === "tl" ? "TL" : u.role === "qc" ? "QC" : "VE"].chip}>{{ tl: "TL", qc: "QC", ve: "VE" }[u.role]}</Chip>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className={`text-xs ${open ? "text-emerald-700" : "text-slate-400"}`}>{open ? windowLeft(u) : "closed"}</span>
                          {!open && <button onClick={() => simulateReply(u.id)} className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50">reply</button>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* template registry */}
              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <div className="text-xs font-medium uppercase tracking-wider text-slate-400">Template registry</div>
                <p className="mt-1.5 text-xs text-slate-500">Every template is Utility. Marketing is capped near 2 per person per day across all businesses — it would kill this pipeline.</p>
                <div className="mt-4 space-y-2">
                  {Object.values(TEMPLATES).map((t) => (
                    <div key={t.name} className="rounded border border-slate-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{t.name}</span>
                          <Chip className="bg-slate-100 text-slate-600">{t.category}</Chip>
                          {t.status === "approved" && <Chip className="bg-emerald-100 text-emerald-800"><Check size={10} /> Approved</Chip>}
                          {t.status === "paced" && <Chip className="bg-amber-100 text-amber-800">Pacing · 7 days</Chip>}
                          {t.status === "pending" && <Chip className="bg-rose-100 text-rose-700">Awaiting Meta</Chip>}
                        </div>
                        <span className="text-xs text-slate-400">{t.urgency === "now" ? "Immediate" : "Digest"} · to {t.to}</span>
                      </div>
                      <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-600">{t.body}</pre>
                      {t.buttons.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {t.buttons.map((b) => <span key={b} className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600">{b}</span>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* outbox */}
              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <div className="text-xs font-medium uppercase tracking-wider text-slate-400">Outbox</div>
                <div className="mt-4 space-y-3">
                  {outbox.slice(0, 12).map((m) => (
                    <div key={m.id} className="rounded border border-slate-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm">
                          <Send size={12} className="text-slate-400" />
                          <span className="font-medium">{m.toName}</span>
                          <span className="font-mono text-xs text-slate-400">{m.jobCode}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {m.status === "blocked"
                            ? <Chip className="bg-rose-100 text-rose-700">Blocked</Chip>
                            : <Chip className={m.mode === "free-form" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}>
                                {m.mode === "free-form" ? "Free-form · ₹0" : `Template · ₹${m.cost}`}</Chip>}
                          <span className="text-xs text-slate-400">{fmtTime(m.ts)}</span>
                        </div>
                      </div>
                      {m.blockedReason && <p className="mt-2 text-xs text-rose-600">{m.blockedReason}</p>}
                      <div className="mt-2"><WaBubble msg={m} /></div>
                    </div>
                  ))}
                  {outbox.length === 0 && (
                    <p className="py-10 text-center text-sm text-slate-400">
                      Nothing sent yet. Advance a job in the pipeline and the bot fires.
                    </p>
                  )}
                </div>
              </div>

              {/* event map */}
              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <div className="text-xs font-medium uppercase tracking-wider text-slate-400">Event map</div>
                <table className="mt-4 w-full text-sm">
                  <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400">
                    <th className="py-2 font-medium">Trigger</th><th className="py-2 font-medium">Goes to</th><th className="py-2 font-medium">Template</th>
                  </tr></thead>
                  <tbody>
                    {Object.entries(EVENT_MAP).map(([k, v]) => (
                      <tr key={k} className="border-b border-slate-100">
                        <td className="py-2.5 text-slate-700">{v.label}</td>
                        <td className="py-2.5"><Chip className={ROLE_STYLE[v.to === "editor" ? "VE" : v.to === "qc" ? "QC" : "TL"].chip}>
                          {{ editor: "Editor", qc: "QC", tl: "TL" }[v.to]}</Chip></td>
                        <td className="py-2.5 font-mono text-xs text-slate-500">{v.template}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ============ MY WORK / QC QUEUE — with bot inbox ============ */}
          {["mywork", "qcqueue"].includes(view) && (
            <>
              {myInbox.length > 0 && (
                <div className="mb-5 rounded-lg border border-emerald-200 bg-white p-4">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
                    <Bot size={13} /> What the bot sent you
                  </div>
                  <div className="mt-3 space-y-2">
                    {myInbox.slice(0, 3).map((m) => <WaBubble key={m.id} msg={m} />)}
                  </div>
                </div>
              )}
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search jobs"
                    className="w-64 rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-500" />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[["mine", me.role === "qc" ? "Awaiting my review" : "Waiting on me"], ["active", "All open"], ["all", "Everything"]].map(([id, label]) => (
                    <button key={id} onClick={() => setFilter(id)}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${filter === id ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"}`}>{label}</button>
                  ))}
                </div>
              </div>
              <JobTable jobs={filtered} pods={pods} me={me} onSelect={setSel} nameOf={nameOf} />
            </>
          )}

          {view === "pipeline" && (
            <>
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search jobs"
                    className="w-64 rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-500" />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[["active", "Active"], ["overdue", "Overdue"], ...STAGES.map((s) => [s.id, s.label]), ["all", "All"]].map(([id, label]) => (
                    <button key={id} onClick={() => setFilter(id)}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${filter === id ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"}`}>{label}</button>
                  ))}
                </div>
              </div>
              <JobTable jobs={filtered} pods={pods} me={me} onSelect={setSel} nameOf={nameOf} />
            </>
          )}

          {view === "overview" && (
            <div className="grid gap-3 md:grid-cols-2">
              {visiblePods.map((p) => {
                const js = jobs.filter((j) => j.podId === p.id);
                const act = js.filter((j) => j.stage !== "delivered");
                const over = act.filter((j) => daysLeft(j.deadline) < 0).length;
                return (
                  <button key={p.id} onClick={() => { setPodId(p.id); setView("pipeline"); }}
                    className="rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-slate-400">
                    <div className="flex items-start justify-between">
                      <div><div className="font-medium">{p.client}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500"><Film size={11} /> {p.frameProject}</div></div>
                      {over > 0 ? <Chip className="bg-rose-100 text-rose-700">{over} overdue</Chip> : <Chip className="bg-emerald-100 text-emerald-800">On track</Chip>}
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                      <div><div className="text-slate-400">In flight</div><div className="mt-0.5 font-mono text-sm">{act.length}</div></div>
                      <div><div className="text-slate-400">Delivered</div><div className="mt-0.5 font-mono text-sm">{js.length - act.length}</div></div>
                      <div><div className="text-slate-400">Assets</div><div className="mt-0.5 font-mono text-sm">{p.assets.length}</div></div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {view === "qcteam" && (
            <div className="space-y-2">
              {qcLoad.map(({ u, open, load, done }) => (
                <div key={u.id} className={`rounded-lg border bg-white p-4 ${u.available ? "border-slate-200" : "border-slate-200 opacity-60"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Circle size={9} className={u.available ? "fill-emerald-500 text-emerald-500" : "fill-slate-300 text-slate-300"} />
                      <span className="font-medium">{u.name}</span>
                      {u.available && load === 0 && <Chip className="bg-emerald-100 text-emerald-800">Idle — next in line</Chip>}
                      {!u.available && <Chip className="bg-slate-100 text-slate-500">Unavailable</Chip>}
                      {windowOpen(u) && <Chip className="bg-emerald-100 text-emerald-800"><MessageSquare size={10} /> window open</Chip>}
                    </div>
                    <div className="flex gap-5 text-xs">
                      <span className="text-slate-500">Open <span className="ml-1 font-mono text-slate-800">{open.length}</span></span>
                      <span className="text-slate-500">Load <span className="ml-1 font-mono text-slate-800">{load}/{QC_CAPACITY}</span></span>
                      <span className="text-slate-500">Cleared <span className="ml-1 font-mono text-slate-800">{done}</span></span>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${load > QC_CAPACITY ? "bg-rose-400" : load === 0 ? "bg-slate-200" : "bg-amber-400"}`}
                      style={{ width: `${Math.min(100, (load / QC_CAPACITY) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {view === "capacity" && (
            <div className="space-y-2">
              {capacity.map((c) => (
                <div key={c.user.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{c.user.name}</span>
                      <Chip className={c.open >= 4 ? "bg-rose-100 text-rose-700" : "bg-teal-100 text-teal-800"}>{c.open} open</Chip>
                      {windowOpen(c.user) && <Chip className="bg-emerald-100 text-emerald-800"><MessageSquare size={10} /> reachable free</Chip>}
                    </div>
                    <div className="flex gap-5 text-xs">
                      <span className="text-slate-500">Delivered <span className="ml-1 font-mono text-slate-800">{c.delivered}</span></span>
                      <span className="text-slate-500">Clean <span className="ml-1 font-mono text-slate-800">{c.clean === null ? "—" : `${c.clean}%`}</span></span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {c.byPod.map(({ pod: p, n, cert }) => (
                      <span key={p.id} className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs ${n > 0 ? "border-slate-300 bg-slate-50 text-slate-700" : "border-dashed border-slate-200 text-slate-400"}`}>
                        {p.client}{n > 0 && <span className="font-mono">{n}</span>}{cert && <Check size={11} className="text-emerald-600" />}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {view === "brandkit" && pod && (
            <div className="grid gap-3 md:grid-cols-2">
              {pod.assets.map((a) => {
                const t = ASSET_TYPES[a.type]; const Icon = t.icon;
                return (
                  <div key={a.id} className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex items-center gap-2"><Icon size={14} className="text-slate-400" /><Chip className={t.chip}>{t.label}</Chip></div>
                    <div className="mt-2 text-sm font-medium">{a.title}</div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600">{a.note}</p>
                  </div>
                );
              })}
            </div>
          )}

          {view === "members" && pod && (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Member</th><th className="px-4 py-2.5 font-medium">Role</th>
                  <th className="px-4 py-2.5 font-medium">Open</th><th className="px-4 py-2.5 font-medium">WhatsApp</th>
                </tr></thead>
                <tbody>
                  {users.filter((u) => pod.memberIds.includes(u.id)).map((u) => (
                    <tr key={u.id} className="border-b border-slate-100">
                      <td className="px-4 py-3 font-medium">{u.name}</td>
                      <td className="px-4 py-3"><Chip className={ROLE_STYLE[u.role === "tl" ? "TL" : u.role === "qc" ? "QC" : "VE"].chip}>{{ tl: "TL", qc: "QC", ve: "Editor" }[u.role]}</Chip></td>
                      <td className="px-4 py-3 font-mono text-slate-700">{jobs.filter((j) => j.editorId === u.id && j.stage !== "delivered").length}</td>
                      <td className="px-4 py-3 text-xs">{windowOpen(u) ? <span className="text-emerald-700">window open · {windowLeft(u)}</span> : <span className="text-slate-400">templates only</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {view === "insights" && pod && (() => {
            const js = jobs.filter((j) => j.podId === pod.id);
            const act = js.filter((j) => j.stage !== "delivered");
            const del = js.filter((j) => j.stage === "delivered");
            const byStage = STAGES.map((s) => ({ ...s, n: js.filter((j) => j.stage === s.id).length }));
            const max = Math.max(1, ...byStage.map((x) => x.n));
            return (
              <div className="space-y-6">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <StatTile label="In flight" value={act.length} sub={pod.client} />
                  <StatTile label="Overdue" value={act.filter((j) => daysLeft(j.deadline) < 0).length} />
                  <StatTile label="First-pass rate" value={del.length ? `${Math.round(del.filter((j) => j.revisions === 0).length / del.length * 100)}%` : "—"} />
                  <StatTile label="Bot messages" value={outbox.filter((m) => jobs.find((j) => j.id === m.jobId)?.podId === pod.id).length} sub="This session" />
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-5">
                  <div className="text-xs font-medium uppercase tracking-wider text-slate-400">Where work is sitting</div>
                  <div className="mt-4 space-y-2.5">
                    {byStage.map((s) => (
                      <div key={s.id} className="flex items-center gap-3">
                        <div className="w-24 shrink-0 text-sm text-slate-600">{s.label}</div>
                        <div className="h-5 flex-1 overflow-hidden rounded bg-slate-50">
                          <div className={`h-full rounded ${ROLE_STYLE[s.owner].bar}`} style={{ width: `${(s.n / max) * 100}%`, minWidth: s.n ? "6px" : "0" }} />
                        </div>
                        <div className="w-8 shrink-0 text-right font-mono text-sm text-slate-700">{s.n}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          {view === "progress" && (
            <div className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-3">
                <StatTile label="Open now" value={myOpen.length} sub={`${myTurn.length} waiting on you`} />
                <StatTile label="Delivered" value={scopedJobs.filter((j) => j.stage === "delivered").length} />
                <StatTile label="Bot messages" value={myInbox.length} sub="Sent to you" />
              </div>
              {myInbox.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-white p-5">
                  <div className="text-xs font-medium uppercase tracking-wider text-slate-400">Recent from the bot</div>
                  <div className="mt-3 space-y-2">{myInbox.slice(0, 5).map((m) => <WaBubble key={m.id} msg={m} />)}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {sel && (() => {
        const j = jobs.find((x) => x.id === sel);
        const p = pods.find((x) => x.id === j?.podId);
        return j && p ? (
          <JobDrawer job={j} pod={p} me={me} users={users} jobs={jobs} onClose={() => setSel(null)}
            onUpdate={(nj) => saveJobs(jobs.map((x) => x.id === nj.id ? nj : x))}
            onDelete={(id) => saveJobs(jobs.filter((x) => x.id !== id))} onSend={send} />
        ) : null;
      })()}
    </div>
  );
}

function JobTable({ jobs, pods, me, onSelect, nameOf }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400">
          <th className="px-4 py-2.5 font-medium">Job</th><th className="px-4 py-2.5 font-medium">Pipeline</th>
          <th className="px-4 py-2.5 font-medium">Frame.io</th><th className="px-4 py-2.5 font-medium">Due</th><th className="px-4 py-2.5"></th>
        </tr></thead>
        <tbody>
          {jobs.map((j) => {
            const st = sOf(j.stage);
            const jp = pods.find((p) => p.id === j.podId);
            const due = dueLabel(j);
            return (
              <tr key={j.id} onClick={() => onSelect(j.id)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{j.title}</span>
                    {j.priority === "rush" && <Chip className="bg-rose-100 text-rose-700">Rush</Chip>}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono">{j.code}</span>·<span>{jp?.client}</span>
                  </div>
                </td>
                <td className="px-4 py-3"><Filmstrip stage={j.stage} revisions={j.revisions} />
                  <div className="mt-1 text-xs text-slate-500">{st.label}</div></td>
                <td className="px-4 py-3"><FrameBadge job={j} compact /></td>
                <td className="px-4 py-3"><div className={`text-xs ${due.tone}`}>{due.text}</div>
                  <div className="mt-0.5 text-xs text-slate-400">{fmtDate(j.deadline)}</div></td>
                <td className="px-4 py-3 text-slate-300"><ChevronRight size={16} /></td>
              </tr>
            );
          })}
          {jobs.length === 0 && <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-400">Nothing here.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
