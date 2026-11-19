import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { StageBadge } from "@/components/pipeline/StageBadge";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { useCapacityOpenJobs, useEditorCapacity, useQcLoad } from "@/hooks/useUsers";
import { deadlineInfo, DEADLINE_TONE_CLASSES, formatFullDate } from "@/lib/format";
import { matchesSearch } from "@/lib/matchesSearch";
import type { CapacityJob, QcLoad, QcStatus } from "@/types";

const QC_STATUS: Record<QcStatus, string> = {
  unavailable: "Unavailable",
  idle_next: "Next in line",
  full: "At capacity today",
  idle: "Ready for work",
  loaded: "In progress",
};

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function groupJobs(jobs: CapacityJob[], role: "editor_id" | "qc_id") {
  const groups = new Map<string, CapacityJob[]>();
  for (const job of jobs) {
    const id = job[role];
    if (id) groups.set(id, [...(groups.get(id) ?? []), job]);
  }
  return groups;
}

function AssignmentList({ jobs, onSelectJob }: { jobs: CapacityJob[]; onSelectJob: (id: string) => void }) {
  const [showAll, setShowAll] = useState(true);
  const visible = showAll ? jobs : jobs.slice(0, 3);
  return (
    <div className="mt-5 border-t border-[var(--border-color)] pt-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-xs font-extrabold uppercase tracking-[.14em] text-[var(--text-muted)]">Assigned videos</h4>
        <span className="rounded-full bg-[var(--bg-pill)] px-2 py-0.5 font-mono text-xs font-bold text-[var(--text-main)]">{jobs.length}</span>
      </div>
      {jobs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border-color)] p-4 text-xs text-[var(--text-muted)]">No assigned videos in client pods you can access.</p>
      ) : (
        <div className={showAll ? "max-h-[32rem] space-y-2 overflow-y-auto pr-1" : "space-y-2"}>
          {visible.map((job) => {
            const due = deadlineInfo(job.deadline, job.stage);
            return (
              <button key={job.id} type="button" onClick={() => onSelectJob(job.id)} className="group w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-left transition-all hover:-translate-y-0.5 hover:border-[var(--primary)] hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><span className="font-mono text-[10px] font-bold text-[var(--primary-light)]">{job.code}</span><h5 className="line-clamp-2 text-sm font-bold text-[var(--text-main)]">{job.title}</h5></div>
                  <i aria-hidden="true" className="ri-arrow-right-up-line shrink-0 text-[var(--text-dim)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--primary-light)]" />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]"><StageBadge stage={job.stage} /><span className="truncate">{job.pod_name}</span>{job.rush && <span className="font-bold text-rose-500"><i className="ri-flashlight-fill" /> Rush</span>}<span className={`ml-auto font-semibold ${DEADLINE_TONE_CLASSES[due.tone]}`} title={formatFullDate(job.deadline)}>{due.label}</span></div>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[var(--border-color-subtle)] pt-2 text-[10px]"><PersonRole label="Editor" name={job.editor_name} /><PersonRole label="TL" name={job.tl_name} /><PersonRole label="QC" name={job.qc_name} /></div>
              </button>
            );
          })}
        </div>
      )}
      {jobs.length > 3 && <button type="button" onClick={() => setShowAll(!showAll)} className="mt-2 min-h-10 w-full rounded-xl text-xs font-bold text-[var(--primary-light)] hover:bg-[var(--bg-pill)]">{showAll ? "Show fewer" : `Show all ${jobs.length} videos`} <i className={showAll ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} /></button>}
    </div>
  );
}

function PersonRole({ label, name }: { label: string; name: string | null }) {
  return <div className="min-w-0"><span className="block font-bold uppercase tracking-wide text-[var(--text-dim)]">{label}</span><span className="block truncate font-semibold text-[var(--text-main)]" title={name ?? undefined}>{name ?? "Not assigned"}</span></div>;
}

function QcLoadBar({ row }: { row: QcLoad }) {
  const width = (value: number) => `${Math.min(100, (value / row.capacity) * 100)}%`;
  return <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-[var(--bg-pill)]" aria-label={`${row.load} of ${row.capacity} QC points used`} role="meter" aria-valuenow={Math.min(row.load, row.capacity)} aria-valuemin={0} aria-valuemax={row.capacity}><span className="bg-amber-400" style={{ width: width(row.points_today) }} /><span className="bg-rose-400" style={{ width: width(row.points_carried) }} /></div>;
}

export function TeamCapacityPanel({ onSelectJob }: { onSelectJob: (id: string) => void }) {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<{ name: string; jobs: CapacityJob[] } | null>(null);
  const tab = params.get("tab") === "qc" ? "qc" : "editors";
  const setTab = (next: "editors" | "qc") => setParams((current) => { const updated = new URLSearchParams(current); if (next === "qc") updated.set("tab", "qc"); else updated.delete("tab"); return updated; }, { replace: true });
  const editorsQuery = useEditorCapacity();
  const qcQuery = useQcLoad();
  const jobsQuery = useCapacityOpenJobs();
  const loading = editorsQuery.isLoading || qcQuery.isLoading || jobsQuery.isLoading;
  const error = editorsQuery.error || qcQuery.error || jobsQuery.error;
  const editors = editorsQuery.data ?? [];
  const qcRows = qcQuery.data ?? [];
  const jobs = jobsQuery.data ?? [];
  const byEditor = useMemo(() => groupJobs(jobs, "editor_id"), [jobs]);
  const byQc = useMemo(() => groupJobs(jobs, "qc_id"), [jobs]);
  const people = tab === "editors" ? editors : qcRows;
  const grouped = tab === "editors" ? byEditor : byQc;
  const visible = people.filter((person) => matchesSearch(person.name, search) || (grouped.get(person.user_id) ?? []).some((job) => matchesSearch(`${job.title} ${job.code} ${job.pod_name}`, search)));
  const assignedCount = tab === "editors" ? jobs.filter((job) => job.editor_id).length : jobs.filter((job) => job.qc_id).length;
  const readyCount = tab === "editors" ? editors.filter((editor) => editor.reachable_free).length : qcRows.filter((reviewer) => reviewer.available && reviewer.points_left > 0).length;

  return (
    <div className="space-y-6 pb-8">
      <section className="glass-card p-5 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-wider text-[var(--primary-light)]"><i className="ri-pulse-line mr-2" /> Team capacity</p><h1 className="mt-2 text-2xl font-extrabold">See the work. See the people.</h1><p className="mt-2 max-w-xl text-sm text-[var(--text-muted)]">A clear view of everyone’s workload and videos in the client pods you can access.</p>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryStat icon="ri-team-line" label={tab === "editors" ? "Editors" : "QC reviewers"} value={people.length} tone="purple" />
        <SummaryStat icon="ri-film-line" label="Assigned videos" value={assignedCount} tone="cyan" />
        <SummaryStat icon="ri-sparkling-2-line" label="Ready for more" value={readyCount} tone="green" />
      </div>

      <div className="glass-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full gap-1 rounded-xl bg-[var(--bg-input)] p-1 sm:w-auto" role="group" aria-label="Capacity team">
          <button type="button" aria-pressed={tab === "editors"} onClick={() => setTab("editors")} className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-xs font-bold transition-colors ${tab === "editors" ? "bg-[var(--primary)] text-white shadow-md" : "text-[var(--text-muted)] hover:text-[var(--text-main)]"}`}><i className="ri-scissors-cut-line" /> Editors <span className="opacity-75">{editors.length}</span></button>
          <button type="button" aria-pressed={tab === "qc"} onClick={() => setTab("qc")} className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-xs font-bold transition-colors ${tab === "qc" ? "bg-[var(--primary)] text-white shadow-md" : "text-[var(--text-muted)] hover:text-[var(--text-main)]"}`}><i className="ri-shield-check-line" /> QC <span className="opacity-75">{qcRows.length}</span></button>
        </div>
        <div className="relative w-full sm:max-w-sm"><i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search people or videos" placeholder="Search people or videos..." className="min-h-11 w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] py-2 pl-9 pr-3 text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]" /></div>
      </div>

      <ErrorNote error={error} fallback="Could not load team capacity." />
      {loading && <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><i className="ri-loader-4-line animate-spin" /> Loading team capacity...</p>}
      {!loading && !error && visible.length === 0 && <p className="rounded-2xl border border-dashed border-[var(--border-color)] p-8 text-center text-sm text-[var(--text-muted)]">{search ? "No people or videos match your search." : "No teammates found in this group."}</p>}

      {!loading && !error && <div className="grid items-start gap-4 xl:grid-cols-2">
        {tab === "editors" && editors.filter((person) => visible.some((match) => match.user_id === person.user_id)).map((editor) => {
          const assigned = byEditor.get(editor.user_id) ?? [];
          const used = Math.min(100, editor.max_concurrent_jobs ? editor.open_count / editor.max_concurrent_jobs * 100 : 0);
          return <article key={editor.user_id} role="button" tabIndex={0} onClick={() => setSelected({ name: editor.name, jobs: assigned })} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected({ name: editor.name, jobs: assigned }); } }} className="glass-card cursor-pointer overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"><div className="p-5"><div className="flex items-start gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary-glow-subtle)] text-sm font-extrabold text-[var(--primary-light)]">{initials(editor.name)}</span><div className="min-w-0 flex-1"><h3 className="truncate text-base font-extrabold text-[var(--text-main)]">{editor.name}</h3><p className="mt-0.5 text-xs text-[var(--text-muted)]">Video editor Â· {editor.open_by_pod.length} client pods</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${editor.reachable_free ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "bg-rose-500/10 text-rose-600 dark:text-rose-300"}`}>{editor.reachable_free ? "AVAILABLE" : "FULL"}</span></div><div className="mt-5 flex items-end justify-between"><div><span className="font-mono text-3xl font-extrabold text-[var(--text-main)]">{editor.open_count}</span><span className="ml-1 text-xs font-semibold text-[var(--text-muted)]">/ {editor.max_concurrent_jobs} slots</span></div><span className="text-xs font-bold text-[var(--primary-light)]">{editor.free_slots} free</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--bg-pill)]"><div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${used}%` }} /></div><div className="mt-3 flex flex-wrap gap-3 text-[11px] text-[var(--text-muted)]"><span>Delivered <b className="text-[var(--text-main)]">{editor.delivered_count}</b></span><span>Clean delivery <b className="text-[var(--text-main)]">{editor.clean_pct == null ? "â€”" : `${Math.round(editor.clean_pct)}%`}</b></span></div></div></article>;
        })}
        {tab === "qc" && qcRows.filter((person) => visible.some((match) => match.user_id === person.user_id)).map((reviewer) => {
          const assigned = byQc.get(reviewer.user_id) ?? [];
          return <article key={reviewer.user_id} role="button" tabIndex={0} onClick={() => setSelected({ name: reviewer.name, jobs: assigned })} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected({ name: reviewer.name, jobs: assigned }); } }} className="glass-card cursor-pointer overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"><div className="p-5"><div className="flex items-start gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary-glow-subtle)] text-sm font-extrabold text-[var(--primary-light)]">{initials(reviewer.name)}</span><div className="min-w-0 flex-1"><h3 className="truncate text-base font-extrabold text-[var(--text-main)]">{reviewer.name}</h3><p className="mt-0.5 text-xs text-[var(--text-muted)]">QC reviewer Â· {reviewer.employment_type === "part_time" ? "Part time" : "Full time"}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${reviewer.available ? "bg-[var(--primary-glow-subtle)] text-[var(--primary-light)]" : "bg-slate-500/10 text-[var(--text-muted)]"}`}>{QC_STATUS[reviewer.status]}</span></div><div className="mt-5 flex items-end justify-between"><div><span className="font-mono text-3xl font-extrabold text-[var(--text-main)]">{reviewer.load}</span><span className="ml-1 text-xs font-semibold text-[var(--text-muted)]">/ {reviewer.capacity} pts today</span></div><span className="text-xs font-bold text-[var(--primary-light)]">{reviewer.points_left} left</span></div><QcLoadBar row={reviewer} /><div className="mt-3 flex flex-wrap gap-3 text-[11px] text-[var(--text-muted)]"><span>Today <b className="text-[var(--text-main)]">{reviewer.points_today} pts</b></span><span>Carried <b className="text-[var(--text-main)]">{reviewer.points_carried} pts</b></span><span>Cleared <b className="text-[var(--text-main)]">{reviewer.cleared_count}</b></span></div></div></article>;
        })}
      </div>}
      <Drawer open={selected !== null} onClose={() => setSelected(null)} header={<div><p className="text-xs text-[var(--text-muted)]">Assigned videos</p><h2 className="text-lg font-bold">{selected?.name}</h2></div>}>
        {selected && <AssignmentList jobs={selected.jobs} onSelectJob={(id) => { setSelected(null); onSelectJob(id); }} />}
      </Drawer>
    </div>
  );
}

function SummaryStat({ icon, label, value, tone }: { icon: string; label: string; value: number; tone: "purple" | "cyan" | "green" }) {
  const color = { purple: "text-[var(--primary-light)] bg-[var(--primary-glow-subtle)]", cyan: "text-[var(--primary-light)] bg-[var(--primary-glow-subtle)]", green: "text-[var(--accent-green)] bg-[var(--accent-green-bg)]" }[tone];
  return <div className="flex items-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 shadow-sm"><span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl ${color}`}><i className={icon} /></span><div><p className="text-xs font-semibold text-[var(--text-muted)]">{label}</p><p className="font-mono text-2xl font-extrabold text-[var(--text-main)]">{value}</p></div></div>;
}
