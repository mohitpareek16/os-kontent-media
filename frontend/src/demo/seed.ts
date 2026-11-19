import type {
  BrandAsset,
  Channel,
  ChatConversationDetail,
  Job,
  JobEvent,
  JobLink,
  Notification,
  Pod,
  PodMember,
  RoleTitle,
  Stage,
  User,
  VideoTypeConfig,
} from "@/types";
import type { BrandKitEvent, BrandLink } from "@/api/brandAssets";
import type { VideoSummary, VoiceNoteRead } from "@/api/voiceNotes";

/* Everything below is made-up sample data for the demo build. Dates are
 * relative to "today" so the pipeline always has overdue, due-today and
 * upcoming work no matter when the demo is opened. */

const DAY = 86_400_000;
const NOW = Date.now();
const iso = (days: number, hour = 10) => {
  const d = new Date(NOW + days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const dateOnly = (days: number) => new Date(NOW + days * DAY).toISOString().slice(0, 10);

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DemoNotification extends Notification {
  user_id: string;
}

export interface DemoWhatsApp {
  enabled: boolean;
}

export interface DemoDb {
  version: number;
  users: User[];
  roleTitles: RoleTitle[];
  pods: Pod[];
  members: (PodMember & { pod_id: string })[];
  channels: Channel[];
  videoTypes: VideoTypeConfig[];
  jobs: Job[];
  events: Record<string, JobEvent[]>;
  links: JobLink[];
  notifications: DemoNotification[];
  brandAssets: BrandAsset[];
  brandLinks: BrandLink[];
  brandEvents: Record<string, BrandKitEvent[]>;
  voiceVideos: VideoSummary[];
  voiceNotes: VoiceNoteRead[];
  conversations: ChatConversationDetail[];
  whatsapp: { enabled: boolean; opt_in: Record<string, boolean> };
  counters: { job: number; id: number };
}

export const DB_VERSION = 4;

function user(
  id: string,
  name: string,
  role: User["role"],
  extra: Partial<User> = {},
): User {
  return {
    id,
    name,
    email: `${name.split(" ")[0].toLowerCase()}@kontent.media`,
    role,
    role_title: null,
    secondary_role: null,
    phone: `+91 98${Math.floor(100 + Math.random() * 899)}${Math.floor(10000 + Math.random() * 89999)}`,
    available: true,
    is_active: true,
    max_concurrent_jobs: 4,
    employment_type: "full_time",
    last_status_change: null,
    ...extra,
  };
}

export function buildSeed(): DemoDb {
  const r = rng(20261118);
  const pick = <T,>(items: T[]) => items[Math.floor(r() * items.length)];

  /* ---------------- people ---------------- */
  const users: User[] = [
    user("u_priya", "Priya Mehta", "owner"),
    user("u_karan", "Karan Verma", "tl"),
    user("u_sana", "Sana Iyer", "tl"),
    user("u_vikram", "Vikram Sethi", "fo", { secondary_role: "tl" }),
    user("u_ravi", "Ravi Sharma", "ve", { max_concurrent_jobs: 5 }),
    user("u_meera", "Meera Kapoor", "ve", { max_concurrent_jobs: 5 }),
    user("u_arjun", "Arjun Patel", "ve", { max_concurrent_jobs: 4 }),
    user("u_neha", "Neha Bansal", "ve", { max_concurrent_jobs: 3 }),
    user("u_kabir", "Kabir Singh", "ve"),
    user("u_tara", "Tara Menon", "ve"),
    user("u_yash", "Yash Gupta", "ve"),
    user("u_pooja", "Pooja Nair", "ve"),
    user("u_asha", "Asha Thomas", "ve", {
      is_active: false,
      available: false,
      last_status_change: {
        action: "deactivated",
        actor_name: "Priya Mehta",
        reason: "Left the company",
        created_at: iso(-12),
      },
    }),
    user("u_dev", "Dev Nair", "qc"),
    user("u_isha", "Isha Rao", "qc", { employment_type: "part_time" }),
    user("u_anita", "Anita Rao", "hr"),
    user("u_zoya", "Zoya Khan", "staff", { role_title: "Graphic Designer" }),
  ];
  const roleTitles: RoleTitle[] = [
    { id: "rt1", name: "Graphic Designer" },
    { id: "rt2", name: "Social Media Manager" },
  ];
  const byId = (id: string) => users.find((u) => u.id === id)!;

  /* ---------------- clients ---------------- */
  const pods: Pod[] = [
    { id: "p_northwind", name: "Northwind Fitness", tl_id: "u_karan", status: "active", billing_currency: "INR", retainer_volume: 12 },
    { id: "p_lumen", name: "Lumen Skincare", tl_id: "u_karan", status: "active", billing_currency: "INR", retainer_volume: 8 },
    { id: "p_orbit", name: "Orbit Podcast", tl_id: "u_karan", status: "active", billing_currency: "USD", retainer_volume: 6 },
    { id: "p_atlas", name: "Atlas Realty", tl_id: "u_sana", status: "active", billing_currency: "INR", retainer_volume: 10 },
    { id: "p_saffron", name: "Saffron Kitchen", tl_id: "u_sana", status: "active", billing_currency: "INR", retainer_volume: 5 },
    { id: "p_bright", name: "Bright Kids TV", tl_id: "u_vikram", status: "paused", billing_currency: "INR", retainer_volume: 4 },
  ];
  const channelNames: Record<string, string[]> = {
    p_northwind: ["Instagram", "YouTube", "Shorts"],
    p_lumen: ["Instagram", "YouTube"],
    p_orbit: ["YouTube", "Spotify clips"],
    p_atlas: ["LinkedIn", "YouTube"],
    p_saffron: ["Instagram", "Reels"],
    p_bright: ["YouTube"],
  };
  const channels: Channel[] = [];
  for (const pod of pods) {
    channelNames[pod.id].forEach((name, i) =>
      channels.push({
        id: `c_${pod.id.slice(2)}_${i}`,
        pod_id: pod.id,
        name,
        pod_name: pod.name,
        archived_at: null,
        job_count: 0,
      }),
    );
  }
  const members: DemoDb["members"] = [];
  const addMember = (pod_id: string, uid: string, pod_role: "tl" | "qc" | "ve") => {
    const u = byId(uid);
    members.push({ pod_id, user_id: u.id, name: u.name, email: u.email, role: u.role, pod_role, certified_at: iso(-60) });
  };
  for (const pod of pods) {
    addMember(pod.id, pod.tl_id, "tl");
    addMember(pod.id, "u_dev", "qc");
    addMember(pod.id, "u_isha", "qc");
  }
  const podEditors: Record<string, string[]> = {
    p_northwind: ["u_ravi", "u_meera", "u_kabir", "u_tara"],
    p_lumen: ["u_ravi", "u_tara", "u_yash", "u_meera"],
    p_orbit: ["u_meera", "u_yash", "u_kabir", "u_ravi"],
    p_atlas: ["u_arjun", "u_neha", "u_pooja", "u_kabir"],
    p_saffron: ["u_arjun", "u_pooja", "u_tara", "u_neha"],
    p_bright: ["u_neha", "u_pooja", "u_yash", "u_arjun"],
  };
  Object.entries(podEditors).forEach(([p, ids]) => ids.forEach((id) => addMember(p, id, "ve")));

  const videoTypes: VideoTypeConfig[] = [
    { key: "short_form", label: "Short", qc_points: 2, enabled: true, sort_order: 1 },
    { key: "reel", label: "Reel", qc_points: 3, enabled: true, sort_order: 2 },
    { key: "long_form", label: "Long-form", qc_points: 6, enabled: true, sort_order: 3 },
    { key: "podcast", label: "Podcast", qc_points: 8, enabled: true, sort_order: 4 },
    { key: "ad", label: "Ad", qc_points: 4, enabled: true, sort_order: 5 },
    { key: "motion", label: "Motion graphics", qc_points: 5, enabled: false, sort_order: 6 },
  ];

  /* ---------------- jobs ---------------- */
  const titles = [
    "Founder story – launch teaser", "Product demo – serum routine", "Episode 42 – highlights cut",
    "Client testimonial – 30s ad", "Recipe reel – saffron rice", "Brand film – final check",
    "Weekly recap – week 46", "New listing walkthrough", "Studio tour – 60s", "Class schedule promo",
    "Unboxing – serum kit", "Behind the scenes – set 2", "Trainer interview – part 1", "Trainer interview – part 2",
    "Ingredient spotlight – retinol", "Skincare routine – night", "Guest teaser – Dr. Mehta", "Episode 43 – full cut",
    "Open house highlights", "Neighbourhood guide – Bandra", "Festival menu reel", "Street food short",
    "Alphabet song – animation", "Story time – intro", "Customer reviews montage", "Summer sale – 15s ad",
    "Meal prep Sunday", "5-minute workout", "Founder AMA clips", "Podcast trailer – season 3",
    "Mortgage explainer", "Kitchen tour – chef's table", "Packaging reveal", "Holiday offer – bumper",
    "Before / after transformation", "Q&A with the coach", "Property drone shots", "Season finale teaser",
    "Dessert special – 30s", "Kids yoga short", "Lunch box ideas", "Behind the brand – 90s",
    "Weekend challenge announce", "Lumen x creator collab", "Client onboarding video", "Pop-up store tour",
    "Review roundup", "Best of the month", "Tips from our editors", "Ask the dermatologist",
    "Live class highlights", "How we cook – basics", "Mini documentary – chapter 1", "Teaser – new collection",
    "Pre-launch countdown", "Interview – head chef", "Villa walkthrough", "Coaching Q&A – part 2",
    "Fan favourites", "Stories template pack",
  ];
  const plan: { stage: Stage; n: number }[] = [
    { stage: "intake", n: 6 }, { stage: "assigned", n: 4 }, { stage: "editing", n: 10 },
    { stage: "qc1", n: 5 }, { stage: "qc2", n: 5 }, { stage: "revisions", n: 4 },
    { stage: "final", n: 3 }, { stage: "delivered", n: 26 },
  ];
  const editorsByPod = podEditors;
  const typeKeys = ["short_form", "reel", "long_form", "podcast", "ad"];
  const jobs: Job[] = [];
  const events: Record<string, JobEvent[]> = {};
  const links: JobLink[] = [];
  let evId = 1;
  let n = 0;
  const stageSeq: Stage[] = ["intake", "assigned", "editing", "qc1", "qc2", "final", "delivered"];

  for (const { stage, n: count } of plan) {
    for (let i = 0; i < count; i++) {
      n += 1;
      const id = `j${n}`;
      const pod = pods[(n * 7 + i) % pods.length];
      const podChannels = channels.filter((c) => c.pod_id === pod.id);
      const editor = stage === "intake" ? null : pick(editorsByPod[pod.id]);
      const reviewer =
        stage === "qc2" ? (i === 4 ? null : pick(["u_dev", "u_isha"])) :
        stage === "final" || stage === "delivered" ? pick(["u_dev", "u_isha"]) :
        stage === "revisions" && i % 2 === 0 ? pick(["u_dev", "u_isha"]) : null;
      const round = stage === "revisions" ? 1 + (i % 3) : stage === "delivered" ? (r() < 0.32 ? 1 + Math.floor(r() * 2) : 0) : stage === "qc2" ? (r() < 0.3 ? 1 : 0) : 0;
      let off: number;
      if (stage === "delivered") off = -(2 + Math.floor(r() * 18));
      else if (stage === "intake") off = 4 + Math.floor(r() * 8);
      else if (i % 5 === 1) off = -(1 + Math.floor(r() * 3));
      else if (i % 5 === 2) off = 0;
      else off = 1 + Math.floor(r() * 9);
      const deadline = dateOnly(off);
      const created = iso(off - 12 - Math.floor(r() * 4));
      const rush = r() < 0.16;
      const typeKey = pick(typeKeys);
      const filed = r() < 0.82 && podChannels.length > 0;
      const job: Job = {
        id,
        code: `KM-${1300 + n}`,
        title: titles[(n - 1) % titles.length],
        pod_id: pod.id,
        channel_id: filed ? pick(podChannels).id : null,
        stage,
        video_type: typeKey,
        weight: pick(["light", "standard", "heavy"] as const),
        rush,
        assigned_editor_id: editor,
        qc2_reviewer_id: reviewer,
        sent_back_from: stage === "revisions" ? (i % 2 === 0 ? "qc2" : "qc1") : null,
        frame_link: ["editing", "qc1", "qc2", "revisions", "final", "delivered"].includes(stage)
          ? `https://app.frame.io/reviews/${id}-demo`
          : null,
        round,
        deadline,
        client_deadline: dateOnly(off + 2),
        delivered_at: stage === "delivered" ? iso(off + 1, 17) : null,
        client_sheet_ok: stage === "delivered" || stage === "final",
        ops_tracker_ok: stage === "delivered",
        created_at: created,
        scrapped_at: null,
        scrapped_by_id: null,
        scrap_reason: null,
        qc1_flagged_at: null,
        qc1_flagged_by_id: null,
        qc1_flag_tl_id: null,
        qc1_flag_reason: null,
      };
      jobs.push(job);

      /* event log */
      const tl = pod.tl_id;
      const ev: JobEvent[] = [];
      const push = (event_type: string, actor_id: string, payload: Record<string, unknown>, at: string) =>
        ev.push({ id: `e${evId++}`, job_id: id, event_type, actor_id, actor_name: byId(actor_id).name, payload, created_at: at });
      push("intake", tl, {}, created);
      const reached = stageSeq.indexOf(stage === "revisions" ? "editing" : stage);
      stageSeq.slice(1, reached + 1).forEach((s, k) =>
        push("stage_changed", s === "assigned" ? tl : s === "editing" ? editor ?? tl : s === "qc1" ? editor ?? tl : s === "qc2" ? tl : reviewer ?? tl, { stage: s }, iso(off - 10 + k * 2)),
      );
      if (stage === "revisions") {
        push("stage_changed", tl, { stage: "qc1" }, iso(off - 4));
        push("changes_raised", reviewer ?? tl, { note: ["Hook is too slow — trim the first 3 seconds", "Colour grade is too warm; match the brand kit", "Audio dips at 0:42, fix the mix"][i % 3] }, iso(off - 2));
        push("stage_changed", reviewer ?? tl, { stage: "revisions" }, iso(off - 2));
      }
      if (stage === "delivered") push("stage_changed", tl, { stage: "delivered" }, job.delivered_at!);
      events[id] = ev;

      if (job.frame_link) {
        links.push({ id: `l${n}a`, job_id: id, kind: "video", title: "Working cut v" + (round + 1), url: job.frame_link, added_by_id: editor ?? tl, added_by_name: byId(editor ?? tl).name, created_at: created });
      }
      links.push({ id: `l${n}b`, job_id: id, kind: "raw", title: "Client footage", url: `https://drive.google.com/drive/folders/demo-${n}`, added_by_id: tl, added_by_name: byId(tl).name, created_at: created });
    }
  }

  /* a few special cases that make the filters and flags worth looking at */
  const scrap = jobs.filter((j) => j.stage === "editing").slice(0, 2);
  scrap.forEach((j, k) => {
    j.scrapped_at = iso(-2 - k);
    j.scrapped_by_id = "u_karan";
    j.scrap_reason = k === 0 ? "Client cancelled the campaign" : "Duplicate of an existing video";
    events[j.id].push({ id: `e${evId++}`, job_id: j.id, event_type: "job_scrapped", actor_id: "u_karan", actor_name: "Karan Verma", payload: { reason: j.scrap_reason }, created_at: j.scrapped_at });
  });
  const flagged = jobs.filter((j) => j.stage === "qc2" && j.qc2_reviewer_id).slice(0, 1);
  flagged.forEach((j) => {
    j.qc1_flagged_at = iso(-1);
    j.qc1_flagged_by_id = j.qc2_reviewer_id;
    j.qc1_flag_tl_id = pods.find((p) => p.id === j.pod_id)!.tl_id;
    j.qc1_flag_reason = "Cut went to QC2 with no QC1 comments and visible audio drift";
    events[j.id].push({ id: `e${evId++}`, job_id: j.id, event_type: "qc1_flag_raised", actor_id: j.qc2_reviewer_id!, actor_name: byId(j.qc2_reviewer_id!).name, payload: { note: j.qc1_flag_reason }, created_at: j.qc1_flagged_at });
  });

  channels.forEach((c) => (c.job_count = jobs.filter((j) => j.channel_id === c.id).length));

  /* Slot limits that fit the sample workload: one editor exactly full, the rest
     with a slot or two free, so the capacity screens show both states. */
  const spare: Record<string, number> = { u_ravi: 1, u_meera: 0, u_arjun: 2, u_neha: 1, u_kabir: 2, u_tara: 1, u_yash: 3, u_pooja: 1 };
  users.filter((x) => x.role === "ve" && x.is_active).forEach((e) => {
    const open = jobs.filter((j) => j.assigned_editor_id === e.id && j.stage !== "delivered" && !j.scrapped_at).length;
    e.max_concurrent_jobs = Math.max(open + (spare[e.id] ?? 1), 1);
  });

  /* ---------------- notifications ---------------- */
  const notifications: DemoNotification[] = [];
  let nid = 1;
  const note = (uid: string, j: Job, event_type: string, headline: string, actor: string, text: string | null, ageHours: number, unread: boolean) => {
    const pod = pods.find((p) => p.id === j.pod_id)!;
    notifications.push({
      id: `n${nid++}`, user_id: uid, channel: "in_app",
      read_at: unread ? null : iso(-ageHours / 24 + 0.1),
      created_at: new Date(NOW - ageHours * 3_600_000).toISOString(),
      job_id: j.id, pod_id: j.pod_id, event_type, job_code: j.code, job_title: j.title, pod_name: pod.name,
      stage: j.stage, actor_name: actor, note: text, headline, body: `${j.title} · ${pod.name}${text ? ` · ${text}` : ""}`,
    });
  };
  for (const u of users.filter((x) => x.is_active)) {
    const mine = jobs.filter((j) =>
      u.role === "owner" ? true :
      u.role === "tl" || u.secondary_role === "tl" ? pods.find((p) => p.id === j.pod_id)?.tl_id === u.id :
      u.role === "ve" ? j.assigned_editor_id === u.id :
      u.role === "qc" ? j.qc2_reviewer_id === u.id : false,
    ).filter((j) => !j.scrapped_at);
    mine.slice(0, 7).forEach((j, k) => {
      const age = 1 + k * 7;
      if (j.stage === "revisions") note(u.id, j, "changes_raised", `Changes requested on ${j.code}`, "Dev Nair", "Hook is too slow — trim the first 3 seconds", age, k < 3);
      else if (j.stage === "assigned" || j.stage === "editing") note(u.id, j, "stage_changed", `${j.code} landed with you`, "Karan Verma", null, age, k < 3);
      else if (j.stage === "qc1") note(u.id, j, "stage_changed", `${j.code} is ready for QC 1`, "Ravi Sharma", null, age, k < 3);
      else if (j.stage === "qc2") note(u.id, j, "stage_changed", `${j.code} is ready for QC 2`, "Karan Verma", null, age, k < 3);
      else note(u.id, j, "stage_changed", `${j.code} moved to ${j.stage}`, "Karan Verma", null, age, false);
    });
  }

  /* ---------------- brand kits ---------------- */
  const brandAssets: BrandAsset[] = [];
  const brandLinks: BrandLink[] = [];
  const brandEvents: Record<string, BrandKitEvent[]> = {};
  pods.forEach((p, k) => {
    brandAssets.push(
      { id: `ba${k}1`, pod_id: p.id, type: "brief", title: `${p.name} – brand brief`, file_path: `${p.id}/brief.pdf`, version: 2 },
      { id: `ba${k}2`, pod_id: p.id, type: "kit", title: `${p.name} – logo & colour kit`, file_path: `${p.id}/kit.zip`, version: 1 },
      { id: `ba${k}3`, pod_id: p.id, type: "do_not", title: "Do's and don'ts", file_path: `${p.id}/donts.pdf`, version: 1 },
    );
    brandLinks.push(
      { id: `bl${k}1`, pod_id: p.id, title: "Website", url: "https://example.com", category: "website", created_at: iso(-40) },
      { id: `bl${k}2`, pod_id: p.id, title: "Brand fonts", url: "https://fonts.google.com", category: "font", created_at: iso(-39) },
    );
    brandEvents[p.id] = [
      { id: `be${k}1`, action: "asset_added", title: `${p.name} – brand brief`, before: null, after: { version: 1 }, note: "First upload", actor_name: "Karan Verma", created_at: iso(-45) },
      { id: `be${k}2`, action: "asset_updated", title: `${p.name} – brand brief`, before: { version: 1 }, after: { version: 2 }, note: "Updated tone of voice", actor_name: "Karan Verma", created_at: iso(-9) },
    ];
  });

  /* ---------------- voice notes ---------------- */
  const voiceVideos: VideoSummary[] = [];
  const voiceNotes: VoiceNoteRead[] = [];
  jobs.filter((j) => j.frame_link).slice(0, 6).forEach((j, k) => {
    const key = `frameio:${j.id}`;
    const count = 2 + (k % 4);
    voiceVideos.push({ video_key: key, video_url: j.frame_link!, video_title: j.title, note_count: count, last_note_at: iso(-k) });
    for (let c = 0; c < count; c++) {
      voiceNotes.push({
        id: `vn${k}_${c}`, video_url: j.frame_link!, video_key: key, video_title: j.title,
        timestamp_seconds: 8 + c * 23.4, duration_seconds: 6 + c * 2.1, audio_filename: `note-${k}-${c}.webm`,
        recorded_by: ["Dev Nair", "Karan Verma", "Isha Rao"][c % 3], recorded_by_email: ["dev", "karan", "isha"][c % 3] + "@kontent.media",
        created_at: iso(-k - c / 4), expires_at: iso(60 - k),
      });
    }
  });

  return {
    version: DB_VERSION,
    users, roleTitles, pods, members, channels, videoTypes, jobs, events, links, notifications,
    brandAssets, brandLinks, brandEvents, voiceVideos, voiceNotes,
    conversations: [
      {
        id: "cv1", title: "Which client has the most overdue videos?", created_at: iso(-1), updated_at: iso(-1),
        messages: [
          { id: "m1", role: "user", content: "Which client has the most overdue videos?", tool_calls: [], charts: [], model: null, created_at: iso(-1) },
          { id: "m2", role: "assistant", content: "Northwind Fitness has the most overdue videos right now. Open the pipeline filtered to Overdue to see them.", tool_calls: [{ name: "overdue_by_client", arguments: {}, ok: true }], charts: [], model: "demo", created_at: iso(-1) },
        ],
      },
    ],
    whatsapp: { enabled: true, opt_in: {} },
    counters: { job: n, id: evId },
  };
}
