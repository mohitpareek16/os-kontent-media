import { useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";

import { BarList } from "@/components/analytics/BarList";
import { KontentBotWidget } from "@/components/analytics/KontentBotWidget";
import { StatTile } from "@/components/analytics/StatTile";
import { STAGE_BAR_COLORS, STAGE_LABELS } from "@/components/pipeline/StageBadge";
import { JobCard } from "@/components/pipeline/JobCard";
import { JobDetailPanel } from "@/components/pipeline/JobDetailPanel";
import { CapacityBar } from "@/components/pods/CapacityBar";
import { PodSwitcher } from "@/components/pods/PodSwitcher";
import { useCurrentUser } from "@/hooks/useAuth";
import {
  useAvgRoundsByEditor,
  useFirstPassRate,
  useStageDistribution,
  useStuckJobs,
} from "@/hooks/useAnalytics";
import { useJob, useJobEvents } from "@/hooks/useJobs";
import { useCapacity, useUsers } from "@/hooks/useUsers";
import type { Stage } from "@/types";
import { isLead } from "@/lib/roles";

export default function AnalyticsPage() {
  const navigate = useNavigate();
  /* The pipeline filters by the pod selected in the layout, not by this page's
   * own picker — so handing someone off to it means setting that selector too,
   * or they'd land on the whole company after reading one client's number.
   * Same handoff the Overview's pod cards do. */
  const { setSelectedPodId } = useOutletContext<{
    setSelectedPodId?: (podId: string) => void;
  }>();
  const [podId, setPodId] = useState<string | null>(null);

  const openPipeline = (query: string) => {
    if (podId) setSelectedPodId?.(podId);
    navigate(`/?view=pipeline&${query}`);
  };
  // Inspecting a stuck job shouldn't cost you the analytics view you were
  // reading — same panel as the pipeline, opened in place.
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const { data: selectedJob } = useJob(selectedJobId);
  const { data: selectedJobEvents } = useJobEvents(selectedJobId);
  const { data: user } = useCurrentUser();
  const { data: firstPass } = useFirstPassRate(podId);
  const { data: stageDistribution } = useStageDistribution(podId);
  const { data: avgRoundsByEditor } = useAvgRoundsByEditor(podId);
  const { data: stuckJobs } = useStuckJobs(podId);
  const { data: capacities } = useCapacity();
  const { data: users } = useUsers();

  const stageItems = (Object.keys(STAGE_LABELS) as Stage[]).map((stage) => ({
    label: STAGE_LABELS[stage],
    value: stageDistribution?.[stage] ?? 0,
    colorClassName: STAGE_BAR_COLORS[stage],
  }));

  const editorItems = Object.entries(avgRoundsByEditor ?? {}).map(([userId, avg]) => ({
    label: users?.find((u) => u.id === userId)?.name ?? userId,
    value: avg,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border-color)] pb-5">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--primary-light)]">
            <i className="ri-bar-chart-fill" /> Analytics
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[var(--text-main)]">
            Analytics
          </h1>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Pipeline health, revision load, and editor capacity — company-wide or per client.
          </p>
        </div>
        <PodSwitcher value={podId} onChange={setPodId} />
      </div>

      {!podId && (
        <div className="glass-card flex flex-col items-center gap-2 p-6 text-center">
          <i className="ri-pie-chart-2-line text-2xl text-[var(--primary)]" />
          <p className="text-sm text-[var(--text-muted)]">
            Showing company-wide capacity below. Pick a specific client above for its pipeline-stage
            breakdown.
          </p>
        </div>
      )}

      {podId && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <StatTile
              label="First-pass rate"
              value={firstPass?.first_pass_rate != null ? `${Math.round(firstPass.first_pass_rate * 100)}%` : "—"}
              hint="Delivered with no revision round"
              title="Open this pod's delivered jobs in the pipeline table"
              onClick={() => openPipeline("status=delivered")}
            />
            {/* Sorted by rounds, descending: the average is the headline, but
                the jobs that made it are what a lead can actually do something
                about. */}
            <StatTile
              label="Avg QC rounds"
              value={firstPass?.avg_rounds != null ? firstPass.avg_rounds.toFixed(1) : "—"}
              hint="Rounds per delivered job"
              title="Open this pod's jobs, most revision rounds first"
              onClick={() => openPipeline("status=all&sort=round&dir=desc")}
            />
          </div>

          <div className="glass-card p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-[var(--text-main)]">
              <i className="ri-kanban-view text-[var(--primary)]" /> Stage distribution
            </h2>
            <BarList items={stageItems} />
          </div>

          <div className="glass-card p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-[var(--text-main)]">
              <i className="ri-user-line text-[var(--primary)]" /> Avg QC rounds by editor
            </h2>
            <BarList items={editorItems} formatValue={(v) => v.toFixed(1)} />
          </div>

          <div className="glass-card p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-[var(--text-main)]">
              <i className="ri-error-warning-line text-[var(--accent-amber)]" /> Stuck jobs (3+ rounds)
              <span className="text-xs font-normal text-[var(--text-dim)]">— a briefing problem, not an editor one</span>
            </h2>
            {stuckJobs && stuckJobs.length > 0 ? (
              <div className="divide-y divide-[var(--border-color-subtle)]">
                {stuckJobs.map((job) => (
                  <JobCard key={job.id} job={job} onSelect={setSelectedJobId} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--text-dim)]">
                Nothing past 3 rounds in this pod — briefs are landing.
              </p>
            )}
          </div>
        </>
      )}

      {isLead(user) && (
        <div className="glass-card p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-[var(--text-main)]">
            <i className="ri-speed-line text-[var(--primary)]" /> Cross-pod capacity
            <span className="text-xs font-normal text-[var(--text-dim)]">
              — every editor's load across all their pods
            </span>
          </h2>
          <CapacityBar capacities={capacities ?? []} />
        </div>
      )}

      <JobDetailPanel
        open={Boolean(selectedJobId)}
        job={selectedJob}
        events={selectedJobEvents}
        onClose={() => setSelectedJobId(null)}
      />

      <KontentBotWidget />
    </div>
  );
}
