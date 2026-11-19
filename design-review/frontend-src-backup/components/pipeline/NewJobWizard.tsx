import { useState, useMemo, useCallback, useRef, useEffect } from "react";

import { NewChannelInline } from "@/components/pods/NewChannelInline";
import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { Stepper } from "@/components/ui/Stepper";
import { useToast } from "@/components/ui/Toast";
import { useCreateJobsBatch } from "@/hooks/useJobs";
import { usePodChannels, usePods } from "@/hooks/usePods";
import { useVELoad } from "@/hooks/useUsers";
import { useVideoTypes } from "@/hooks/useVideoTypes";
import { ACTUAL_DEADLINE_LABEL, DEADLINE_LABEL } from "@/lib/format";
import { matchesSearch } from "@/lib/matchesSearch";
import type { Channel, Pod, VELoad, VideoType } from "@/types";

/* --------------------------------------------------------------------------
   Types
   -------------------------------------------------------------------------- */
/** The urgent flag, as a toggle rather than a checkbox: it is a claim about
 * the job ("this cannot wait"), not a setting, and it should look like one
 * that has been made rather than one that was left ticked.
 *
 * The title says what it actually buys. "Rush" invites people to assume it
 * jumps a queue, and the one thing that would make this flag useless is
 * everybody putting it on everything. */
function RushToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Mark this video urgent"
      onClick={onToggle}
      title={
        on
          ? "Urgent: if no QC reviewer has room, this can still be given to the least-loaded one instead of waiting. It does not jump the queue."
          : "Mark urgent — lets QC2 routing place this on a full reviewer rather than leaving it unrouted."
      }
      className={`flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${
        on
          ? "border-transparent bg-rose-500/15 text-rose-400"
          : "border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-dim)] hover:text-[var(--text-muted)]"
      }`}
    >
      <i className={on ? "ri-flashlight-fill" : "ri-flashlight-line"} />
      Rush
    </button>
  );
}

interface EditRow {
  id: string;
  title: string;
  driveLink: string;
  /** Which of the client's channels this one is for. Empty means "not filed",
   * which is a legitimate answer — the TL can file it later from the job
   * panel, and a guessed channel is worse than a blank one. */
  channelId: string;
  videoType: VideoType;
  /** Marks the job urgent. It buys exactly one thing — QC2 routing may push it
   * onto a full reviewer rather than holding it unrouted (docs/12) — and it is
   * off by default because a flag everything carries means nothing. */
  rush: boolean;
  /** The date the *team* works to — what the editor will see. Blank is a
   * legitimate answer: the job is created in intake and the TL sets it when
   * they hand it over. */
  deadline: string;
  /** The date the *client* was promised. Read off the brief, which is why it
   * is entered here and the team's date usually is not — nobody knows who is
   * free next Tuesday while pasting in a week of work. Only the Owner and
   * the pod's TL ever see it again. */
  clientDeadline: string;
  assignedVE: string;
  selected: boolean;
}

interface NewJobWizardProps {
  open: boolean;
  onClose: () => void;
}


const STEPS = ["Select Pod", "Add Edits", "Assign & Create"];

let _rowId = 0;
function newRowId() {
  return `row-${++_rowId}`;
}

/* --------------------------------------------------------------------------
   PARSER — pulls title + URL out of a pasted list
   -------------------------------------------------------------------------- */
interface SkippedLine {
  line: string;
  num: number;
}

interface ParsedPaste {
  rows: EditRow[];
  skipped: SkippedLine[];
}

/** A list numbered `1.` `2.` `3.` used to be the only shape this understood,
 * and the lists people actually paste are usually a Drive export — a title, a
 * tab, a folder link, no numbers anywhere — so the whole paste came back as
 * "0 edits detected" with every line in the skipped drawer. The number was
 * never the point; the title and the link are. Bullets, plain lines, and the
 * WhatsApp habit of putting the link on its own line under the title all read
 * as the same thing now.
 *
 * Rows and skipped lines come out of one pass on purpose: the badge saying
 * "12 detected · 2 skipped" and the rows that reach step 3 have to be counted
 * by the same rule, and they were two copies of the regex before. */
function parsePastedText(raw: string): ParsedPaste {
  const rows: EditRow[] = [];
  const skipped: SkippedLine[] = [];
  /* A title whose link is expected on the next line. Held until we find out. */
  let pending: SkippedLine | null = null;

  const flushPending = () => {
    if (pending) skipped.push(pending);
    pending = null;
  };

  const addRow = (title: string, url: string) => {
    rows.push({
      id: newRowId(),
      title,
      driveLink: url,
      channelId: "",
      videoType: "long_form",
      rush: false,
      deadline: "",
      clientDeadline: "",
      assignedVE: "",
      selected: false,
    });
  };

  raw.split("\n").forEach((line, index) => {
    const num = index + 1;
    if (!line.trim()) return;

    const urlMatch = line.match(/https?:\/\/\S+/i);
    if (!urlMatch) {
      // Could be a heading ("Batch 3:") or a title waiting for its link — we
      // only find out on the next line, so hold it rather than judge it now.
      flushPending();
      pending = { line, num };
      return;
    }

    const url = urlMatch[0].replace(/[),.;]+$/, "");
    const title = cleanTitle(line.slice(0, urlMatch.index));

    if (title) {
      flushPending();
      addRow(title, url);
      return;
    }
    if (pending) {
      addRow(cleanTitle(pending.line), url);
      pending = null;
      return;
    }
    // A bare link with nothing to call it. Naming it after the URL would put
    // a folder id in the pipeline table, which is worse than saying so.
    skipped.push({ line, num });
  });

  flushPending();
  return { rows, skipped };
}

/** Strips the list marker people paste along with the title — `1.`, `2)`,
 * `-`, `•` — and the dangling separator left behind when the link that
 * followed it is cut off ("Title —" ). */
function cleanTitle(raw: string): string {
  return raw
    .replace(/^\s*(?:\d+\s*[.)\]]|[-*•–—])\s*/, "")
    .replace(/[\s\-–—:|]+$/, "")
    .trim();
}

/** Which of the client's channels a row is for.
 *
 * "Not filed" is the first option and stays a legitimate answer: a channel
 * nobody has chosen is blank on the row, and the TL can file it later from the
 * job panel. Guessing one at intake would write something indistinguishable
 * from a decision. */
function ChannelSelect({
  value,
  onChange,
  channels,
  podId,
  podName,
  className = "",
}: {
  value: string;
  onChange: (id: string) => void;
  channels: Channel[];
  /** So a client with no channels yet can get its first one from right here.
   * This used to render nothing at all in that case, which meant the wizard
   * could never be the place a channel came from — and the wizard is where
   * somebody first notices the video needs one. */
  podId: string;
  podName?: string | null;
  className?: string;
}) {
  if (channels.length === 0) {
    return (
      <NewChannelInline
        podId={podId}
        podName={podName}
        label="Channel"
        compact
        onCreated={(channel) => onChange(channel.id)}
      />
    );
  }
  return (
    <SearchableSelect value={value} onChange={onChange} placeholder="No channel" className={className} options={[{ value: "", label: "No channel" }, ...channels.map((channel) => ({ value: channel.id, label: channel.name }))]} />
  );
}

/* --------------------------------------------------------------------------
   Searchable VE Dropdown with load badges
   -------------------------------------------------------------------------- */
function VEDropdown({
  value,
  onChange,
  veList,
}: {
  value: string;
  onChange: (id: string) => void;
  veList: VELoad[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Editors with no slot left are not listed at all. They used to be, in red
  // — and picking one produced a 400 on save with the whole batch rejected,
  // which is a worse way to learn the same fact.
  const filtered = veList
    .filter((v) => v.free_slots > 0)
    .filter((v) => matchesSearch(v.name, search));

  const selected = veList.find((v) => v.user_id === value);
  const fullCount = veList.filter((v) => v.free_slots === 0).length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full text-left px-2.5 py-1.5 bg-[var(--bg-input)] border border-[var(--border-color)] rounded-lg text-xs font-medium text-[var(--text-main)] outline-none transition-colors focus:border-[var(--primary)] truncate flex items-center justify-between gap-1"
      >
        <span className="truncate">
          {selected ? selected.name : <span className="text-[var(--text-dim)]">Select VE...</span>}
        </span>
        <i className={`ri-arrow-${open ? "up" : "down"}-s-line text-[var(--text-dim)] shrink-0`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-72 bg-[var(--bg-card-hover)] border border-[var(--border-color)] rounded-xl shadow-xl overflow-hidden animate-[fadeIn_0.15s_ease-out]" style={{ background: "var(--bg-card-hover)" }}>
          <div className="p-2 border-b border-[var(--border-color-subtle)]">
            <div className="relative">
              <i className="ri-search-line absolute left-2.5 top-2 text-[var(--text-dim)] text-xs" />
              <input
                type="text"
                placeholder="Search editors..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-7 pr-2 py-1.5 bg-[var(--bg-input)] border border-[var(--border-color-subtle)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {/* Unassign option */}
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--bg-pill)] text-[var(--text-dim)] italic"
            >
              — Unassigned —
            </button>
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-xs text-[var(--text-dim)] text-center">
                {fullCount > 0
                  ? "Every editor is at their limit — leave these in intake and assign when one delivers"
                  : "No editors found"}
              </div>
            )}
            {filtered.map((ve) => {
              // The last slot or two is worth flagging: fill it and the next
              // paste has nowhere to go.
              const isTight = ve.free_slots <= 1;
              return (
                <button
                  key={ve.user_id}
                  type="button"
                  onClick={() => { onChange(ve.user_id); setOpen(false); setSearch(""); }}
                  className={`w-full text-left px-3 py-2.5 text-xs hover:bg-[var(--bg-pill)] transition-colors flex items-center justify-between gap-2 ${
                    value === ve.user_id ? "bg-purple-500/10 text-purple-300 font-semibold" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--primary-hover)] flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                      {ve.name.charAt(0)}
                    </div>
                    <span className="truncate font-semibold">{ve.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      isTight
                        ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                        : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    }`}>
                      {ve.free_slots} free
                    </span>
                    <span className="text-[10px] text-[var(--text-dim)]">
                      {ve.assigned_count}/{ve.max_concurrent_jobs}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Searchable Pod Dropdown
   -------------------------------------------------------------------------- */
function PodSearchDropdown({
  pods,
  value,
  onChange,
  statusFilter,
}: {
  pods: Pod[];
  value: string;
  onChange: (id: string) => void;
  statusFilter: string;
}) {
  const [search, setSearch] = useState("");

  const filtered = pods
    .filter((p) => statusFilter === "all" || p.status === statusFilter)
    .filter((p) => matchesSearch(p.name, search));

  return (
    <div className="space-y-3">
      <div className="relative">
        <i className="ri-search-line absolute left-3 top-2.5 text-[var(--text-dim)]" />
        <input
          type="text"
          placeholder="Search all client pods..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-[var(--bg-input)] border border-[var(--border-color)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
        />
      </div>
      <div className="max-h-48 overflow-y-auto space-y-1">
        {filtered.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.id)}
            className={`w-full text-left px-4 py-3 rounded-lg text-sm font-semibold transition-all flex items-center justify-between ${
              value === p.id
                ? "bg-gradient-to-r from-purple-700/30 to-indigo-800/20 border border-purple-500/40 text-white"
                : "bg-[var(--bg-card)] border border-[var(--border-color-subtle)] text-[var(--text-main)] hover:border-[var(--border-color-hover)]"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/20 to-indigo-500/20 flex items-center justify-center">
                <i className="ri-group-line text-purple-400 text-sm" />
              </div>
              <span>{p.name}</span>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
              p.status === "active"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : p.status === "paused"
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  : "bg-rose-500/10 text-rose-400 border-rose-500/20"
            }`}>
              {p.status}
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-6 text-sm text-[var(--text-dim)]">
            <i className="ri-search-eye-line text-2xl block mb-2" />
            No pods match your search
          </div>
        )}
      </div>
    </div>
  );
}

/* ==========================================================================
   MAIN WIZARD COMPONENT
   ========================================================================== */
export function NewJobWizard({ open, onClose }: NewJobWizardProps) {
  const { data: pods } = usePods();
  const { data: veList } = useVELoad();
  const { data: videoTypes } = useVideoTypes();
  const activeTypes = (videoTypes ?? []).filter((type) => type.enabled);
  const defaultType = activeTypes.find((type) => type.key === "long_form")?.key ?? activeTypes[0]?.key ?? "long_form";
  const createBatch = useCreateJobsBatch();
  const toast = useToast();

  const [step, setStep] = useState(0);
  const [selectedPodId, setSelectedPodId] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">("active");
  const [entryMode, setEntryMode] = useState<"single" | "paste">("single");
  const [pasteText, setPasteText] = useState("");
  const [rows, setRows] = useState<EditRow[]>([
    { id: newRowId(), title: "", driveLink: "", channelId: "", videoType: "long_form", rush: false, deadline: "", clientDeadline: "", assignedVE: "", selected: false },
  ]);

  /* Bulk assign state */
  const [bulkVE, setBulkVE] = useState("");
  const [bulkDeadline, setBulkDeadline] = useState("");
  const [bulkClientDeadline, setBulkClientDeadline] = useState("");
  /* A pasted batch is usually all one format — twenty shorts, or a week of
   * podcasts — so setting it twenty times is twenty chances to miss one. */
  const [bulkVideoType, setBulkVideoType] = useState<VideoType>("long_form");
  useEffect(() => {
    if (!videoTypes) return;
    setRows((current) => current.map((row) => activeTypes.some((type) => type.key === row.videoType) ? row : { ...row, videoType: defaultType }));
    setBulkVideoType((current) => activeTypes.some((type) => type.key === current) ? current : defaultType);
  }, [videoTypes]);
  const [bulkChannel, setBulkChannel] = useState("");

  /* Recent pods from localStorage */
  const recentPodIds: string[] = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("km_recent_pods") || "[]");
    } catch {
      return [];
    }
  }, []);

  const recentPods = useMemo(
    () =>
      recentPodIds
        .map((id) => pods?.find((p) => p.id === id))
        .filter(Boolean) as Pod[],
    [recentPodIds, pods]
  );

  const selectedPod = pods?.find((p) => p.id === selectedPodId);
  /* Fetched once the client is chosen — a channel belongs to one of them, so
     there is nothing to ask for until step 1 is answered. */
  const { data: channels } = usePodChannels(selectedPodId || null);

  /* Reset on close */
  const handleClose = useCallback(() => {
    setStep(0);
    setSelectedPodId("");
    setEntryMode("single");
    setPasteText("");
    setRows([{ id: newRowId(), title: "", driveLink: "", channelId: "", videoType: defaultType, rush: false, deadline: "", clientDeadline: "", assignedVE: "", selected: false }]);
    setBulkVE("");
    setBulkDeadline("");
    setBulkVideoType(defaultType);
    setBulkChannel("");
    onClose();
  }, [onClose, defaultType]);

  /* Save to recent pods */
  const savePodRecent = (podId: string) => {
    const existing: string[] = JSON.parse(localStorage.getItem("km_recent_pods") || "[]");
    const updated = [podId, ...existing.filter((id) => id !== podId)].slice(0, 4);
    localStorage.setItem("km_recent_pods", JSON.stringify(updated));
  };

  /* Step 1 → 2 */
  const handlePodSelect = (podId: string) => {
    setSelectedPodId(podId);
    savePodRecent(podId);
    setStep(1);
  };

  /* Step 2: Add row */
  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { id: newRowId(), title: "", driveLink: "", channelId: "", videoType: defaultType, rush: false, deadline: "", clientDeadline: "", assignedVE: "", selected: false },
    ]);
  };

  /* Step 2: Remove row */
  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  /* Step 2: Update row field */
  const updateRow = (id: string, field: keyof EditRow, value: string | boolean) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  /* One parse for the preview badge, the skipped drawer and the rows that
   * reach step 3 — they have to agree. */
  const parsedPaste = useMemo(() => parsePastedText(pasteText), [pasteText]);
  const skippedLines = parsedPaste.skipped;
  const parsedPreviewCount = parsedPaste.rows.length;

  /* Step 2 → 3 */
  const goToAssign = () => {
    if (entryMode === "paste" && parsedPaste.rows.length > 0) {
      setRows(parsedPaste.rows.map((row) => ({ ...row, videoType: defaultType })));
    }
    setStep(2);
  };

  /* Bulk actions */
  const selectedCount = rows.filter((r) => r.selected).length;
  const allSelected = rows.length > 0 && rows.every((r) => r.selected);

  const toggleSelectAll = () => {
    const newVal = !allSelected;
    setRows((prev) => prev.map((r) => ({ ...r, selected: newVal })));
  };

  /* Fills the selected rows one at a time and stops at the editor's free
   * slots — the server refuses the whole batch otherwise, and "5 at a time"
   * is easier to work with as a stopping point than as a rejection. Rows the
   * slots don't reach keep no editor and are created in intake, which is
   * where the TL wanted the overflow anyway. */
  const applyBulkVE = () => {
    const editor = veList?.find((v) => v.user_id === bulkVE);
    if (!editor) return;

    const alreadyLinedUp = rows.filter((r) => !r.selected && r.assignedVE === bulkVE).length;
    let slots = Math.max(0, editor.free_slots - alreadyLinedUp);
    let filled = 0;
    let wanted = 0;

    // Walked here rather than inside the state updater: the updater can run
    // twice in dev (StrictMode) and would count the slots twice with it.
    const next = rows.map((r) => {
      if (!r.selected || r.assignedVE === bulkVE) return r;
      wanted += 1;
      if (slots === 0) return { ...r, assignedVE: "" };
      slots -= 1;
      filled += 1;
      return { ...r, assignedVE: bulkVE };
    });
    setRows(next);

    if (filled < wanted) {
      toast.notify(
        `${editor.name} has room for ${filled} more — the other ${wanted - filled} stay ` +
          "unassigned and will be created in intake.",
        "info",
      );
    }
  };

  const applyBulkVideoType = () => {
    setRows((prev) => prev.map((r) => (r.selected ? { ...r, videoType: bulkVideoType } : r)));
  };

  /* A paste is usually one channel's week — twenty Dhan HQ videos, then five
     for AAD — so filing them one row at a time is the tax this removes. */
  const applyBulkChannel = () => {
    setRows((prev) => prev.map((r) => (r.selected ? { ...r, channelId: bulkChannel } : r)));
  };

  /* No bulk *un*-mark: marking a whole paste urgent is the realistic case (a
   * client escalation lands as one batch), and un-marking one row is a click
   * on that row. */
  const applyBulkRush = () => {
    setRows((prev) => prev.map((r) => (r.selected ? { ...r, rush: true } : r)));
  };

  const applyBulkDeadline = () => {
    setRows((prev) =>
      prev.map((r) => (r.selected ? { ...r, deadline: bulkDeadline } : r))
    );
  };

  const applyBulkClientDeadline = () => {
    setRows((prev) =>
      prev.map((r) => (r.selected ? { ...r, clientDeadline: bulkClientDeadline } : r))
    );
  };

  /* How far ahead of the promise the team works, when nobody has said
   * otherwise. Three days is the shape of one revision round on this board,
   * and it is a button rather than a setting because the right number is a
   * judgement about *this* week's load — a stored default would be applied
   * for a year without anyone looking at it again. */
  const DEFAULT_LEAD_DAYS = 3;

  /** Fill the deadline from the actual one, `days` earlier, on every
   * selected row that has a client date. Rows without one are left alone
   * rather than given a date derived from nothing. */
  const pullTeamDeadlineEarlier = (days: number) => {
    setRows((prev) =>
      prev.map((r) => {
        if (!r.selected || !r.clientDeadline) return r;
        const due = new Date(`${r.clientDeadline}T00:00:00`);
        due.setDate(due.getDate() - days);
        return { ...r, deadline: due.toISOString().slice(0, 10) };
      })
    );
  };

  /* Auto Assign (greedy least-loaded balancing over weighted per-week
   * capacity) lived here and is deliberately gone: intake comes in as a bulk
   * paste and the TL assigns from it when they know who is actually free
   * that day, which the balancer could not know. A job with no editor is a
   * legitimate resting state now — it sits in intake and shows up on the
   * Intake card — so nothing has to guess a name at creation time.
   *
   * If it ever comes back it has to respect the hard per-editor cap
   * (`free_slots` on /users/ve-load), not just a ratio; the old version
   * happily filled someone past it. */

  /* Final submit */
  const handleSubmit = () => {
    const validRows = rows.filter((r) => r.title.trim());
    if (validRows.length === 0 || validRows.some((row) => !activeTypes.some((type) => type.key === row.videoType))) return;

    createBatch.mutate(
      {
        pod_id: selectedPodId,
        jobs: validRows.map((r) => ({
          title: r.title.trim(),
          channel_id: r.channelId || null,
          video_type: r.videoType,
          rush: r.rush,
          // The client's footage, filed as raw. At intake a link can only be
          // that — nobody has cut anything — and putting it on the editor's
          // link field is what used to greet them with the client's folder
          // pre-filled in their own "paste your cut" box.
          raw_links: r.driveLink.trim() ? [{ url: r.driveLink.trim() }] : [],
          deadline: r.deadline || null,
          client_deadline: r.clientDeadline || null,
          assigned_editor_id: r.assignedVE || null,
        })),
      },
      {
        onSuccess: (jobs) => {
          toast.notify(
            `${jobs.length} job${jobs.length === 1 ? "" : "s"} created in ${selectedPod?.name ?? "the pod"}.`,
            "success",
          );
          handleClose();
        },
        // The wizard does not close on a failure — nothing was saved, and
        // closing would throw away the rows that still need fixing.
        onError: (error) => toast.notifyError(error, "Couldn't create these jobs."),
      }
    );
  };

  const canProceedStep2 =
    entryMode === "single"
      ? rows.some((r) => r.title.trim())
      : parsedPreviewCount > 0;

  return (
    <Modal open={open} onClose={handleClose} title="New Edit Jobs" size="full">
      <div className="space-y-5">
        {/* Stepper */}
        <Stepper steps={STEPS} current={step} />

        {/* ============================================== STEP 1 ============================================== */}
        {step === 0 && (
          <div className="space-y-5 animate-fade-in-up">
            {/* Recent Pods */}
            {recentPods.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-dim)] mb-3 flex items-center gap-1.5">
                  <i className="ri-time-line" /> Recent Pods
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {recentPods.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handlePodSelect(p.id)}
                      className={`p-4 rounded-xl border text-left transition-all hover:-translate-y-0.5 ${
                        selectedPodId === p.id
                          ? "bg-gradient-to-br from-purple-700/30 to-indigo-800/20 border-purple-500/40 shadow-lg shadow-purple-900/20"
                          : "bg-[var(--bg-card)] border-[var(--border-color)] hover:border-[var(--border-color-hover)] hover:shadow-md"
                      }`}
                    >
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-indigo-500/20 flex items-center justify-center mb-2">
                        <i className="ri-folder-video-line text-purple-400 text-lg" />
                      </div>
                      <div className="font-bold text-sm truncate">{p.name}</div>
                      <div className="text-[10px] text-[var(--text-dim)] mt-0.5 flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          p.status === "active" ? "bg-emerald-400" : "bg-amber-400"
                        }`} />
                        {p.status}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Status Filters */}
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-dim)] flex items-center gap-1.5">
                <i className="ri-group-line" /> All Client Pods
              </h3>
              <div className="flex gap-1">
                {(["active", "paused", "all"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setStatusFilter(f)}
                    className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase transition-all ${
                      statusFilter === f
                        ? "bg-purple-500/15 text-purple-400 border border-purple-500/30"
                        : "bg-[var(--bg-card)] text-[var(--text-dim)] border border-[var(--border-color-subtle)] hover:border-[var(--border-color)]"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Searchable Pod Dropdown */}
            {pods && (
              <PodSearchDropdown
                pods={pods}
                value={selectedPodId}
                onChange={handlePodSelect}
                statusFilter={statusFilter}
              />
            )}
          </div>
        )}

        {/* ============================================== STEP 2 ============================================== */}
        {step === 1 && (
          <div className="space-y-4 animate-fade-in-up">
            {/* Pod banner */}
            <div className="flex items-center justify-between bg-purple-500/8 border border-purple-500/20 rounded-lg px-4 py-2.5">
              <div className="flex items-center gap-2">
                <i className="ri-folder-video-line text-purple-400" />
                <span className="text-sm font-bold">{selectedPod?.name}</span>
                <span className="text-[10px] text-[var(--text-dim)] bg-[var(--bg-pill)] px-2 py-0.5 rounded">
                  {selectedPod?.status}
                </span>
                <span className="text-[10px] text-[var(--text-dim)]">
                  {(channels ?? []).length} channel{(channels ?? []).length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {/* Available before a single row is typed, because that is when
                    a TL notices the client's new channel is missing. */}
                <NewChannelInline podId={selectedPodId} podName={selectedPod?.name} />
                <button
                  type="button"
                  onClick={() => setStep(0)}
                  className="text-xs text-purple-400 hover:text-purple-300 font-semibold flex items-center gap-1"
                >
                  <i className="ri-arrow-left-line" /> Change
                </button>
              </div>
            </div>

            {/* Tab Toggle */}
            <div className="flex gap-1 p-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg w-fit">
              <button
                onClick={() => setEntryMode("single")}
                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${
                  entryMode === "single"
                    ? "bg-[var(--primary)] text-white shadow-md"
                    : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
                }`}
              >
                <i className="ri-add-circle-line" /> Single Entry
              </button>
              <button
                onClick={() => setEntryMode("paste")}
                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${
                  entryMode === "paste"
                    ? "bg-[var(--primary)] text-white shadow-md"
                    : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
                }`}
              >
                <i className="ri-clipboard-line" /> Paste Multiple
              </button>
            </div>

            {/* SINGLE ENTRY MODE */}
            {entryMode === "single" && (
              <div className="space-y-3">
                <div className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                  <i className="ri-information-line" />
                  Add edit jobs one by one. You can add more with the button below.
                </div>

                <div className="space-y-2">
                  {rows.map((row, idx) => (
                    <div
                      key={row.id}
                      className="flex flex-wrap items-center gap-2 p-3 bg-[var(--bg-card)] border border-[var(--border-color-subtle)] rounded-lg hover:border-[var(--border-color)] transition-colors"
                    >
                      <span className="text-[10px] font-bold text-[var(--text-dim)] w-5 shrink-0 text-center">
                        {idx + 1}
                      </span>
                      <Input
                        placeholder="Video title"
                        value={row.title}
                        onChange={(e) => updateRow(row.id, "title", e.target.value)}
                        className="flex-[3_1_240px] min-w-[240px] !py-1.5 !text-xs"
                      />
                      <Input
                        placeholder="Drive link (optional)"
                        value={row.driveLink}
                        onChange={(e) => updateRow(row.id, "driveLink", e.target.value)}
                        className="flex-[2_1_180px] min-w-[170px] !py-1.5 !text-xs"
                      />
                      <select
                        value={row.videoType}
                        onChange={(e) => updateRow(row.id, "videoType", e.target.value)}
                        className="px-2 py-1.5 bg-[var(--bg-input)] border border-[var(--border-color)] rounded-lg text-xs outline-none focus:border-[var(--primary)] w-32 shrink-0"
                      >
                        {activeTypes.map((t) => (
                          <option key={t.key} value={t.key}>{t.label}</option>
                        ))}
                      </select>
                      <ChannelSelect
                        value={row.channelId}
                        onChange={(id) => updateRow(row.id, "channelId", id)}
                        channels={channels ?? []}
                        podId={selectedPodId}
                        podName={selectedPod?.name}
                        className="w-36 shrink-0"
                      />
                      <RushToggle
                        on={row.rush}
                        onToggle={() => updateRow(row.id, "rush", !row.rush)}
                      />
                      {rows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeRow(row.id)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0"
                        >
                          <i className="ri-delete-bin-line text-sm" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={addRow}
                  className="w-full py-2.5 border-2 border-dashed border-[var(--border-color)] rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition-all flex items-center justify-center gap-1.5"
                >
                  <i className="ri-add-line" /> Add Another Edit
                </button>
              </div>
            )}

            {/* PASTE MODE */}
            {entryMode === "paste" && (
              <div className="space-y-3">
                <div className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                  <i className="ri-information-line" />
                  Paste the list from WhatsApp/Slack/Drive. Numbered or not — any line with a title
                  and a link is picked up, and a link on its own line joins the title above it.
                </div>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={`This Gold Pattern Hasn't Failed in 25 Years\thttps://drive.google.com/drive/folders/...\nIs Gold Preparing for Its Next Big Rally?\thttps://drive.google.com/drive/folders/...\n3. Momentum trading with Super Scalper\thttps://drive.google.com/drive/folders/...`}
                  className="w-full h-40 px-4 py-3 bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl text-xs font-mono text-[var(--text-main)] outline-none focus:border-[var(--primary)] resize-none placeholder:text-[var(--text-dim)]"
                />

                {/* Parse preview */}
                {pasteText.trim() && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 text-xs">
                      <span className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                        <i className="ri-check-line" /> {parsedPreviewCount} edits detected
                      </span>
                      {skippedLines.length > 0 && (
                        <span className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold">
                          <i className="ri-skip-forward-line" /> {skippedLines.length} lines skipped
                        </span>
                      )}
                    </div>

                    {skippedLines.length > 0 && (
                      <details className="text-xs">
                        <summary className="text-[var(--text-dim)] cursor-pointer hover:text-[var(--text-muted)] font-semibold">
                          View skipped lines
                        </summary>
                        <div className="mt-1 p-2 bg-amber-500/5 border border-amber-500/10 rounded-lg space-y-0.5 font-mono text-[var(--text-dim)]">
                          {skippedLines.map((s) => (
                            <div key={s.num}>L{s.num}: {s.line}</div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between pt-3 border-t border-[var(--border-color-subtle)]">
              <Button type="button" variant="ghost" onClick={() => setStep(0)}>
                <i className="ri-arrow-left-line" /> Back
              </Button>
              <Button
                type="button"
                disabled={!canProceedStep2}
                onClick={goToAssign}
              >
                Next: Assign VE <i className="ri-arrow-right-line" />
              </Button>
            </div>
          </div>
        )}

        {/* ============================================== STEP 3 ============================================== */}
        {step === 2 && (
          <div className="space-y-4 animate-fade-in-up">
            {/* Pod banner */}
            <div className="flex items-center gap-2 bg-purple-500/8 border border-purple-500/20 rounded-lg px-4 py-2">
              <i className="ri-folder-video-line text-purple-400" />
              <span className="text-sm font-bold">{selectedPod?.name}</span>
              {/* Same offer as the step before it: this is the screen where the
                  channel column is staring at you, so it is the likeliest place
                  to realise one is missing. */}
              <NewChannelInline podId={selectedPodId} podName={selectedPod?.name} compact />
              <span className="text-[10px] text-emerald-400 font-bold ml-auto">
                {rows.length} edit{rows.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Bulk Actions Toolbar */}
            <div className="flex items-center gap-3 flex-wrap p-3 bg-[var(--bg-card)] border border-[var(--border-color-subtle)] rounded-lg">
              <label className="flex items-center gap-2 text-xs font-bold text-[var(--text-muted)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="w-3.5 h-3.5 accent-[var(--primary)]"
                />
                Select All
              </label>

              <div className="h-4 w-px bg-[var(--border-color)]" />

              {selectedCount > 0 && (
                <>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 font-bold border border-purple-500/20">
                    {selectedCount} selected
                  </span>

                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] font-bold text-[var(--text-dim)] uppercase">Bulk VE:</label>
                    <div className="w-44">
                      <VEDropdown value={bulkVE} onChange={setBulkVE} veList={veList || []} />
                    </div>
                    <Button type="button" variant="outline" className="!px-2 !py-1 !text-[10px]" onClick={applyBulkVE} disabled={!bulkVE}>
                      Apply
                    </Button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] font-bold text-[var(--text-dim)] uppercase">Bulk type:</label>
                    <select
                      value={bulkVideoType}
                      onChange={(e) => setBulkVideoType(e.target.value as VideoType)}
                      className="px-2 py-1 bg-[var(--bg-input)] border border-[var(--border-color)] rounded text-[10px] outline-none focus:border-[var(--primary)]"
                    >
                      {activeTypes.map((t) => (
                        <option key={t.key} value={t.key}>{t.label}</option>
                      ))}
                    </select>
                    <Button type="button" variant="outline" className="!px-2 !py-1 !text-[10px]" onClick={applyBulkVideoType}>
                      Apply
                    </Button>
                  </div>

                  {/* A paste is usually one channel's week. Blank is a real
                      choice here — it clears the selected rows back to
                      unfiled. Shown even when the client has no channels yet:
                      `ChannelSelect` offers to create the first one, and
                      hiding the control was how twenty pasted rows ended up
                      unfiled with nothing on screen explaining why. */}
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] font-bold text-[var(--text-dim)] uppercase">
                      Bulk channel:
                    </label>
                    <ChannelSelect
                      value={bulkChannel}
                      onChange={setBulkChannel}
                      channels={channels ?? []}
                      podId={selectedPodId}
                      podName={selectedPod?.name}
                      className="w-36 !text-[10px]"
                    />
                    {(channels ?? []).length > 0 && (
                      <Button type="button" variant="outline" className="!px-2 !py-1 !text-[10px]" onClick={applyBulkChannel}>
                        Apply
                      </Button>
                    )}
                  </div>

                  {/* One-way, and deliberately: a client escalation arrives as
                      a whole batch, while un-marking is a single row somebody
                      changed their mind about. */}
                  <Button
                    type="button"
                    variant="outline"
                    className="!px-2 !py-1 !text-[10px]"
                    onClick={applyBulkRush}
                    title="Mark every selected row urgent"
                  >
                    <i className="ri-flashlight-line" /> Mark rush
                  </Button>

                  {/* Client date first, because it is the one that comes off
                      the brief — and because the button under it derives the
                      team's from it. */}
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] font-bold text-[var(--text-dim)] uppercase">Bulk client date:</label>
                    <input
                      type="date"
                      value={bulkClientDeadline}
                      onChange={(e) => setBulkClientDeadline(e.target.value)}
                      className="px-2 py-1 bg-[var(--bg-input)] border border-[var(--border-color)] rounded text-[10px] outline-none focus:border-[var(--primary)]"
                    />
                    <Button type="button" variant="outline" className="!px-2 !py-1 !text-[10px]" onClick={applyBulkClientDeadline} disabled={!bulkClientDeadline}>
                      Apply
                    </Button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] font-bold text-[var(--text-dim)] uppercase">Bulk team date:</label>
                    <input
                      type="date"
                      value={bulkDeadline}
                      onChange={(e) => setBulkDeadline(e.target.value)}
                      className="px-2 py-1 bg-[var(--bg-input)] border border-[var(--border-color)] rounded text-[10px] outline-none focus:border-[var(--primary)]"
                    />
                    <Button type="button" variant="outline" className="!px-2 !py-1 !text-[10px]" onClick={applyBulkDeadline} disabled={!bulkDeadline}>
                      Apply
                    </Button>
                  </div>

                  {/* The move this whole feature exists for, in one click. */}
                  <Button
                    type="button"
                    variant="outline"
                    className="!px-2 !py-1 !text-[10px]"
                    onClick={() => pullTeamDeadlineEarlier(DEFAULT_LEAD_DAYS)}
                    disabled={!rows.some((r) => r.selected && r.clientDeadline)}
                    title={`Set the deadline ${DEFAULT_LEAD_DAYS} days before the actual one, on every selected row that has one`}
                  >
                    <i className="ri-rewind-start-line" /> Team date −{DEFAULT_LEAD_DAYS}d
                  </Button>
                </>
              )}
            </div>

            {/* Assignment Table */}
            <div className="glass-card overflow-visible">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-color)] text-[var(--text-dim)] font-bold uppercase tracking-wider text-[10px]">
                    <th className="p-3 w-8"></th>
                    <th className="p-3 w-8">#</th>
                    <th className="p-3">Title</th>
                    <th className="p-3 w-48">Raw files</th>
                    <th className="p-3 w-36">Channel</th>
                    <th className="p-3 w-32">Video type</th>
                    <th className="p-3 w-20">Rush</th>
                    <th className="p-3 w-48">Assigned VE</th>
                    <th className="p-3 w-36" title="What the client was promised. Only you and the Owner ever see this.">
                      {ACTUAL_DEADLINE_LABEL}
                    </th>
                    <th className="p-3 w-36" title="What the team works to — the date the editor sees.">
                      {DEADLINE_LABEL}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={row.id} className="border-b border-[var(--border-color-subtle)] hover:bg-purple-900/5 transition-colors">
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(e) => updateRow(row.id, "selected", e.target.checked)}
                          className="w-3.5 h-3.5 accent-[var(--primary)]"
                        />
                      </td>
                      <td className="p-3 text-[var(--text-dim)] font-mono font-bold">{idx + 1}</td>
                      <td className="p-3">
                        <input
                          type="text"
                          value={row.title}
                          onChange={(e) => updateRow(row.id, "title", e.target.value)}
                          className="w-full bg-transparent outline-none text-xs font-semibold focus:text-[var(--primary)]"
                        />
                      </td>
                      <td className="p-3">
                        {row.driveLink ? (
                          <a
                            href={row.driveLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-purple-400 hover:text-purple-300 truncate block max-w-[180px] text-[10px]"
                            title={row.driveLink}
                          >
                            <i className="ri-google-fill mr-1" />
                            {row.driveLink.replace(/^https?:\/\//, "").slice(0, 28)}...
                          </a>
                        ) : (
                          <span className="text-[var(--text-dim)] text-[10px]">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <ChannelSelect
                          value={row.channelId}
                          onChange={(id) => updateRow(row.id, "channelId", id)}
                          channels={channels ?? []}
                          podId={selectedPodId}
                          podName={selectedPod?.name}
                          className="w-full !text-[10px]"
                        />
                      </td>
                      <td className="p-3">
                        <select
                          value={row.videoType}
                          onChange={(e) => updateRow(row.id, "videoType", e.target.value)}
                          className="px-1.5 py-1 bg-[var(--bg-input)] border border-[var(--border-color)] rounded text-[10px] outline-none focus:border-[var(--primary)] w-full"
                        >
                          {activeTypes.map((t) => (
                            <option key={t.key} value={t.key}>{t.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-3">
                        <RushToggle
                          on={row.rush}
                          onToggle={() => updateRow(row.id, "rush", !row.rush)}
                        />
                      </td>
                      <td className="p-3">
                        <VEDropdown
                          value={row.assignedVE}
                          onChange={(id) => updateRow(row.id, "assignedVE", id)}
                          veList={veList || []}
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="date"
                          value={row.clientDeadline}
                          onChange={(e) => updateRow(row.id, "clientDeadline", e.target.value)}
                          className="w-full px-2 py-1 bg-[var(--bg-input)] border border-[var(--border-color)] rounded text-[10px] outline-none focus:border-[var(--primary)]"
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="date"
                          value={row.deadline}
                          onChange={(e) => updateRow(row.id, "deadline", e.target.value)}
                          className={`w-full px-2 py-1 bg-[var(--bg-input)] border rounded text-[10px] outline-none focus:border-[var(--primary)] ${
                            row.deadline && row.clientDeadline && row.deadline > row.clientDeadline
                              ? "border-[var(--accent-red)]"
                              : "border-[var(--border-color)]"
                          }`}
                          title={
                            row.deadline && row.clientDeadline && row.deadline > row.clientDeadline
                              ? "This is after the client's date — the server will refuse it"
                              : undefined
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Error state */}
            {/* The whole batch is one transaction on the server, so one bad
             * row rejects all of them — the message says which one and why
             * ("That editor's account is deactivated"), and the wizard stays
             * open with the rows intact so it can be fixed and re-submitted. */}
            <ErrorNote
              error={createBatch.error}
              fallback="Couldn't create these jobs — nothing was saved."
            />

            <p className="flex items-start gap-1.5 text-[11px] text-[var(--text-dim)]">
              <i className="ri-inbox-line mt-px" />
              An editor and a deadline are optional — anything you leave blank is created
              in intake and shows up on the Intake card for the TL to assign later. The actual
              deadline is what you were really promised; only you and the Owner ever see it.
            </p>

            {/* Navigation */}
            <div className="flex justify-between pt-3 border-t border-[var(--border-color-subtle)]">
              <Button type="button" variant="ghost" onClick={() => setStep(1)}>
                <i className="ri-arrow-left-line" /> Back
              </Button>
              <Button
                type="button"
                disabled={createBatch.isPending || !rows.some((r) => r.title.trim())}
                onClick={handleSubmit}
              >
                {createBatch.isPending ? (
                  <>
                    <i className="ri-loader-4-line animate-spin" /> Creating...
                  </>
                ) : (
                  <>
                    <i className="ri-check-double-line" /> Assign & Create {rows.filter((r) => r.title.trim()).length} Jobs
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
