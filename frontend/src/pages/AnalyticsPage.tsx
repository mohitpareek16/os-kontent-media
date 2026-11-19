import { useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import { Banner } from "@/components/ui/Banner";
import { BarList } from "@/components/analytics/BarList";
import { KontentBotWidget } from "@/components/analytics/KontentBotWidget";
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
    <div className="space-y-5">
      <PageHeader
        description="Pipeline health, revision load, and editor capacity — company-wide or per client."
        actions={<PodSwitcher value={podId} onChange={setPodId} />}
      />

      {!podId && (
        <Banner tone="info">
          Showing company-wide capacity below. Pick a specific client above for its pipeline-stage
          breakdown.
        </Banner>
      )}

      {podId && (
        <>
          {/* Headline numbers as one strip; each is still the way into the
              rows behind it. */}
          <div className="glass-card grid grid-cols-1 divide-[var(--border-color)] sm:grid-cols-3 sm:divide-x">
            <button
              type="button"
              title="Open this pod's delivered jobs in the pipeline table"
              onClick={() => openPipeline("status=delivered")}
              className="p-5 text-left transition-colors hover:bg-[var(--bg-card-hover)] sm:rounded-l-[14px]"
            >
              <span className="block text-[13px] font-semibold text-[var(--text-dim)]">First-pass rate</span>
              <span className="num block text-[30px] font-bold leading-tight">
                {firstPass?.first_pass_rate != null ? `${Math.round(firstPass.first_pass_rate * 100)}%` : "—"}
              </span>
              <span className="text-xs text-[var(--text-dim)]">Delivered with no revision round</span>
            </button>
            {/* Sorted by rounds, descending: the average is the headline, but
                the jobs that made it are what a lead can actually do something
                about. */}
            <button
              type="button"
              title="Open this pod's jobs, most revision rounds first"
              onClick={() => openPipeline("status=all&sort=round&dir=desc")}
              className="p-5 text-left transition-colors hover:bg-[var(--bg-card-hover)]"
            >
              <span className="block text-[13px] font-semibold text-[var(--text-dim)]">Avg QC rounds</span>
              <span className="num block text-[30px] font-bold leading-tight">
                {firstPass?.avg_rounds != null ? firstPass.avg_rounds.toFixed(1) : "—"}
              </span>
              <span className="text-xs text-[var(--text-dim)]">Rounds per delivered job</span>
            </button>
            <div className="p-5">
              <span className="block text-[13px] font-semibold text-[var(--text-dim)]">Stuck jobs</span>
              <span className={`num block text-[30px] font-bold leading-tight ${stuckJobs?.length ? "text-[var(--bad-text)]" : ""}`}>
                {stuckJobs ? stuckJobs.length : "—"}
              </span>
              <span className="text-xs text-[var(--text-dim)]">3 or more revision rounds</span>
            </div>
          </div>

          {/* Stage distribution: one stacked bar and a legend. */}
          <div className="glass-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[var(--text-main)]">Stage distribution</h2>
              <span className="text-[13px] text-[var(--text-dim)]">{stageItems.reduce((n, i) => n + i.value, 0)} videos</span>
            </div>
            <div
              className="mb-3.5 mt-4 flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-[var(--border-color)]"
              role="img"
              aria-label={stageItems.map((i) => `${i.label} ${i.value}`).join(", ")}
            >
              {stageItems.filter((i) => i.value > 0).map((i) => (
                <span key={i.label} style={{ flex: i.value }} className={i.colorClassName} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs text-[var(--text-dim)] sm:grid-cols-4 xl:grid-cols-8">
              {stageItems.map((i) => (
                <span key={i.label}>
                  <span aria-hidden className={`mr-1.5 inline-block h-2 w-2 rounded-sm ${i.colorClassName}`} />
                  {i.label}
                  <b className="num block text-xl text-[var(--text-main)]">{i.value}</b>
                </span>
              ))}
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
          <div className="glass-card p-5">
            <h2 className="mb-4 flex flex-wrap items-center gap-2 text-base font-bold text-[var(--text-main)]">
              <i className="ri-user-line text-[var(--primary)]" /> Avg QC rounds by editor
            </h2>
            <BarList items={editorItems} formatValue={(v) => v.toFixed(1)} />
          </div>

          <div className="glass-card p-5">
            <h2 className="mb-4 flex flex-wrap items-center gap-2 text-base font-bold text-[var(--text-main)]">
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
          </div>
        </>
      )}

      {isLead(user) && (
        <div className="glass-card p-5">
          <h2 className="mb-4 flex flex-wrap items-center gap-2 text-base font-bold text-[var(--text-main)]">
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
