import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useSearchParams } from "react-router-dom";

import { StageBadge } from "@/components/pipeline/StageBadge";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Drawer } from "@/components/ui/Drawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonCards } from "@/components/ui/Skeleton";
import { Segmented } from "@/components/ui/TabBar";
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
        <h4 className="text-sm font-bold text-[var(--text-muted)]">Assigned videos</h4>
        <span className="rounded-full bg-[var(--bg-pill)] px-2 py-0.5 font-mono text-xs font-bold text-[var(--text-main)]">{jobs.length}</span>
      </div>
      {jobs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border-color)] p-4 text-xs text-[var(--text-muted)]">No assigned videos in client pods you can access.</p>
      ) : (
        <div className={showAll ? "max-h-[32rem] space-y-2 overflow-y-auto pr-1" : "space-y-2"}>
          {visible.map((job) => {
            const due = deadlineInfo(job.deadline, job.stage);
            return (
              <button key={job.id} type="button" onClick={() => onSelectJob(job.id)} className="group w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-left transition-all hover:border-[var(--primary)] hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><span className="font-mono text-xs font-bold text-[var(--primary-light)]">{job.code}</span><h5 className="line-clamp-2 text-sm font-bold text-[var(--text-main)]">{job.title}</h5></div>
                  <i aria-hidden="true" className="ri-arrow-right-up-line shrink-0 text-[var(--text-dim)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--primary-light)]" />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]"><StageBadge stage={job.stage} /><span className="truncate">{job.pod_name}</span>{job.rush && <span className="font-bold text-[var(--bad-text)]"><i className="ri-flashlight-fill" /> Rush</span>}<span className={`ml-auto font-semibold ${DEADLINE_TONE_CLASSES[due.tone]}`} title={formatFullDate(job.deadline)}>{due.label}</span></div>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[var(--border-color-subtle)] pt-2 text-xs"><PersonRole label="Editor" name={job.editor_name} /><PersonRole label="TL" name={job.tl_name} /><PersonRole label="QC" name={job.qc_name} /></div>
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
  return <div className="min-w-0"><span className="block font-bold text-[var(--text-dim)]">{label}</span><span className="block truncate font-semibold text-[var(--text-main)]" title={name ?? undefined}>{name ?? "Not assigned"}</span></div>;
}

function QcLoadBar({ row }: { row: QcLoad }) {
  const width = (value: number) => `${Math.min(100, (value / row.capacity) * 100)}%`;
  return <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-[var(--bg-pill)]" aria-label={`${row.load} of ${row.capacity} QC points used`} role="meter" aria-valuenow={Math.min(row.load, row.capacity)} aria-valuemin={0} aria-valuemax={row.capacity}><span className="bg-[var(--warn-text)]" style={{ width: width(row.points_today) }} /><span className="bg-[var(--bad-text)] opacity-70" style={{ width: width(row.points_carried) }} /></div>;
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

  const visibleEditors = editors.filter((person) => visible.some((match) => match.user_id === person.user_id));
  const visibleQc = qcRows.filter((person) => visible.some((match) => match.user_id === person.user_id));

  return (
    <div className="space-y-5 pb-8">
      <PageHeader description="Everyone's workload across the client pods you can access." />

      <div className="glass-card grid grid-cols-3 divide-x divide-[var(--border-color)]">
        {[
          { label: tab === "editors" ? "Editors" : "QC reviewers", value: people.length, hint: "In your pods" },
          { label: "Assigned videos", value: assignedCount, hint: "Open right now" },
          { label: "Ready for more", value: readyCount, hint: tab === "editors" ? "Have a free slot" : "Available with points left" },
        ].map((cell) => (
          <div key={cell.label} className="p-5">
            <p className="text-[13px] font-semibold text-[var(--text-dim)]">{cell.label}</p>
            <p className="num text-[30px] font-bold leading-tight">{cell.value}</p>
            <p className="text-xs text-[var(--text-dim)]">{cell.hint}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Segmented
          aria-label="Capacity team"
          value={tab}
          onChange={setTab}
          options={[
            { key: "editors", label: "Editors", icon: "ri-scissors-cut-line", count: editors.length },
            { key: "qc", label: "QC reviewers", icon: "ri-shield-check-line", count: qcRows.length },
          ]}
        />
        <div className="relative w-full sm:ml-auto sm:max-w-sm">
          <i className="ri-search-line pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-[var(--text-dim)]" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search people or videos" placeholder="Search people or videos" className="h-10 w-full rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-input)] pl-10 pr-3 text-sm text-[var(--text-main)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--primary)]" />
        </div>
      </div>

      <ErrorNote error={error} fallback="Could not load team capacity." />
      {loading && <SkeletonCards count={4} className="h-40" />}
      {!loading && !error && visible.length === 0 && (
        <EmptyState
          icon="ri-team-line"
          title={search ? "No people or videos match your search" : "No teammates found in this group"}
          description={search ? "Try a different name, job title or code." : undefined}
        />
      )}

      {!loading && !error && (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {tab === "editors" && visibleEditors.map((editor) => (
            <PersonCard
              key={editor.user_id}
              name={editor.name}
              subtitle={`Video editor · ${editor.open_by_pod.length} client pod${editor.open_by_pod.length === 1 ? "" : "s"}`}
              pill={{ label: editor.reachable_free ? "Available" : "Full", tone: editor.reachable_free ? "ok" : "bad" }}
              headline={editor.open_count}
              unit={`of ${editor.max_concurrent_jobs} slots`}
              aside={{ text: `${editor.free_slots} free`, tone: editor.free_slots > 0 ? "ok" : "bad" }}
              bar={
                <div className="flex gap-1" role="img" aria-label={`${editor.open_count} of ${editor.max_concurrent_jobs} slots in use`}>
                  {Array.from({ length: Math.min(editor.max_concurrent_jobs, 12) }, (_, i) => (
                    <span key={i} className={`h-2 flex-1 rounded-full ${i < editor.open_count ? "bg-[var(--primary)]" : "bg-[var(--border-color)]"}`} />
                  ))}
                </div>
              }
              facts={[
                ["Delivered", String(editor.delivered_count)],
                ["Clean delivery", editor.clean_pct == null ? "—" : `${Math.round(editor.clean_pct)}%`],
              ]}
              onOpen={() => setSelected({ name: editor.name, jobs: byEditor.get(editor.user_id) ?? [] })}
            />
          ))}
          {tab === "qc" && visibleQc.map((reviewer) => (
            <PersonCard
              key={reviewer.user_id}
              name={reviewer.name}
              subtitle={`QC reviewer · ${reviewer.employment_type === "part_time" ? "Part time" : "Full time"}`}
              pill={{ label: QC_STATUS[reviewer.status], tone: reviewer.available ? "ok" : "mute" }}
              headline={reviewer.load}
              unit={`of ${reviewer.capacity} pts today`}
              aside={{ text: `${reviewer.points_left} left`, tone: reviewer.points_left > 0 ? "ok" : "bad" }}
              bar={<QcLoadBar row={reviewer} />}
              facts={[
                ["Today", `${reviewer.points_today} pts`],
                ["Carried", `${reviewer.points_carried} pts`],
                ["Cleared", String(reviewer.cleared_count)],
              ]}
              onOpen={() => setSelected({ name: reviewer.name, jobs: byQc.get(reviewer.user_id) ?? [] })}
            />
          ))}
        </div>
      )}
      <Drawer open={selected !== null} onClose={() => setSelected(null)} header={<div><p className="text-[13px] text-[var(--text-dim)]">Assigned videos</p><h2 className="text-[22px] font-bold">{selected?.name}</h2></div>}>
        {selected && <AssignmentList jobs={selected.jobs} onSelectJob={(id) => { setSelected(null); onSelectJob(id); }} />}
      </Drawer>
    </div>
  );
}

const PILL_TONES = {
  ok: "bg-[var(--ok-bg)] text-[var(--ok-text)]",
  bad: "bg-[var(--bad-bg)] text-[var(--bad-text)]",
  mute: "bg-[var(--stage-intake-bg)] text-[var(--stage-intake-fg)]",
} as const;

/** One person's load: who, status, the headline number, a bar you can count,
 * and a few facts. Clicking opens their assigned videos. */
function PersonCard({
  name,
  subtitle,
  pill,
  headline,
  unit,
  aside,
  bar,
  facts,
  onOpen,
}: {
  name: string;
  subtitle: string;
  pill: { label: string; tone: keyof typeof PILL_TONES };
  headline: number;
  unit: string;
  aside: { text: string; tone: "ok" | "bad" };
  bar: ReactNode;
  facts: [string, string][];
  onOpen: () => void;
}) {
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className="glass-card card-interactive p-5"
    >
      <div className="flex items-start gap-3">
        <Avatar name={name} size={44} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[17px] font-bold text-[var(--text-main)]">{name}</h3>
          <p className="mt-0.5 text-[13px] text-[var(--text-dim)]">{subtitle}</p>
        </div>
        <Badge className={PILL_TONES[pill.tone]}>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          {pill.label}
        </Badge>
      </div>
      <div className="mb-2 mt-4 flex items-baseline justify-between">
        <span>
          <span className="num text-[28px] font-bold text-[var(--text-main)]">{headline}</span>
          <span className="ml-1.5 text-[15px] font-semibold text-[var(--text-dim)]">{unit}</span>
        </span>
        <span className={`text-[13px] font-bold ${aside.tone === "ok" ? "text-[var(--ok-text)]" : "text-[var(--bad-text)]"}`}>
          {aside.text}
        </span>
      </div>
      {bar}
      <div className="mt-3.5 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-[var(--text-dim)]">
        {facts.map(([label, value]) => (
          <span key={label}>
            {label} <b className="text-[var(--text-main)]">{value}</b>
          </span>
        ))}
      </div>
    </article>
  );
}