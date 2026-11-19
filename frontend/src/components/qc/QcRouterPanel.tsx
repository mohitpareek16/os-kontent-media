import { useState } from "react";
import { Link } from "react-router-dom";

import { JobDetailPanel } from "@/components/pipeline/JobDetailPanel";
import { UnroutedJobsCard } from "@/components/qc/UnroutedJobsCard";
import { useJob, useJobEvents, useJobs } from "@/hooks/useJobs";
import { useQcLoad } from "@/hooks/useUsers";
import { useVideoTypes } from "@/hooks/useVideoTypes";
import type { JobDetail, QcLoad } from "@/types";

interface QcRouterPanelProps {
  /** The pod selected in the sidebar, if any — the unrouted list follows it
   * the same way the pipeline table does. Reviewer load is company-wide:
   * QC is a shared resource across pods (docs/04). */
  podId?: string;
}

/** How many unrouted jobs the card lists before it says "+N more". If this
 * ever overflows, the number that matters is the total in the stat card. */
const UNROUTED_PAGE_SIZE = 50;

const ROUTING_RULES: Array<{ icon: string; title: string; body: string }> = [
  {
    icon: "ri-price-tag-3-line",
    title: "A review is priced by what it is",
    body: "The owner sets each video type's QC points. A repeat review costs half, rounded up, from the current type price.",
  },
  {
    icon: "ri-battery-charge-line",
    title: "24 points a day, or 12 part-time",
    body: "Spent against a date, not a queue: finishing a job does not hand the points back until tomorrow. Somebody who burns 24 by lunch is done for the day.",
  },
  {
    icon: "ri-scales-3-line",
    title: "Lowest share of their own day wins",
    body: "Scored on load ÷ capacity, not on raw points — otherwise a part-timer gets loaded like a full-timer, which is the whole reason two budgets exist.",
  },
  {
    icon: "ri-award-line",
    title: "−0.15 if they know the pod, −0.05 per idle day",
    body: "Familiarity is worth about a fifth of a day. The idle term caps at three days: a tiebreak, so the same person doesn't catch three jobs in a row.",
  },
  {
    icon: "ri-shut-down-line",
    title: "The job has to fit what's left",
    body: "The next review must fit the points left. A part-timer holds at most one podcast a day.",
  },
  {
    icon: "ri-pushpin-line",
    title: "Sticky on every revisit",
    body: "Only a first watch is scored. Later rounds go back to the same reviewer at half price even if it takes them over — they wrote the change list.",
  },
  {
    icon: "ri-flashlight-line",
    title: "Rush may overflow, once nobody has room",
    body: "A job marked rush can be pushed onto the least-loaded reviewer up to 125% of their day. Past that it still holds — an empty pool never silently overflows.",
  },
];

function eligibility(row: QcLoad): "eligible" | "out_of_points" | "unavailable" {
  if (!row.available) return "unavailable";
  if (row.points_left <= 0) return "out_of_points";
  return "eligible";
}

function ReviewerChip({ row, muted }: { row: QcLoad; muted?: boolean }) {
  return (
    <span
      className={`flex items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-pill)] px-2 py-0.5 text-xs font-semibold ${
        muted ? "text-[var(--text-dim)]" : "text-[var(--text-muted)]"
      }`}
      title={
        row.employment_type === "part_time"
          ? `${row.name} works part-time — 12 points a day`
          : `${row.name} works full-time — 24 points a day`
      }
    >
      {row.name}
      {row.employment_type === "part_time" && (
        <span className="rounded bg-[var(--bg-main)] px-1 text-[9px] font-bold text-[var(--text-dim)]">PT</span>
      )}
      <span className="font-mono text-[var(--text-main)]">
        {row.load}/{row.capacity}
      </span>
      {/* What is actually left, which is the number that decides whether the
       * next job can go to them — `load/capacity` alone leaves a TL doing the
       * subtraction, and "6 free" vs "a podcast fits" is the whole question. */}
      <span className="text-xs text-[var(--text-dim)]">
        {row.points_left > 0 ? `${row.points_left} left` : "spent out"}
      </span>
    </span>
  );
}

/** The owner/TL view of QC2 auto-routing: what routing would do right now,
 * and what it failed to place. The per-reviewer load table itself lives in
 * Team Capacity → QC (`components/capacity/TeamCapacityPanel`); this page
 * deliberately doesn't repeat it. */
export function QcRouterPanel({ podId }: QcRouterPanelProps) {
  const { data: qcRows, isLoading: loadLoading } = useQcLoad();
  const { data: videoTypes = [] } = useVideoTypes();
  /* Ask the server for exactly the unrouted jobs. This used to pull a
   * thousand active jobs and keep the handful that matched — so "UNROUTED
   * NOW" was really "unrouted among the first thousand". */
  const { data: resp, isLoading: jobsLoading } = useJobs(
    { status: "active", pod_id: podId || undefined, unrouted: true, page_size: UNROUTED_PAGE_SIZE },
    /* A job can become unrouted at any moment; this page is where someone
     * notices. 30s, same as notifications. */
    { refetchInterval: 30_000 },
  );
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const { data: selectedJob } = useJob(selectedJobId);
  const { data: selectedJobEvents } = useJobEvents(selectedJobId);

  const unrouted: JobDetail[] = resp?.items ?? [];
  const unroutedTotal = resp?.total ?? 0;
  const panelJob = selectedJob ?? unrouted.find((j) => j.id === selectedJobId);

  const rows = qcRows ?? [];
  const eligible = rows.filter((r) => eligibility(r) === "eligible");
  const spentOut = rows.filter((r) => eligibility(r) === "out_of_points");
  const unavailable = rows.filter((r) => eligibility(r) === "unavailable");
  const nextInLine = rows.find((r) => r.status === "idle_next");
  /* The most expensive video that still fits somebody. A pool where the
   * biggest gap is 4 points is not "full" — it is full *of podcasts*, which is
   * a different conversation with the TL. */
  const biggestGap = eligible.reduce((most, r) => Math.max(most, r.points_left), 0);
  const podcastCapable = eligible.filter((r) => r.can_take_podcast);
  const podcastPoints = videoTypes.find((type) => type.key === "podcast")?.qc_points;

  /* Say *why* routing gave up. "Everyone's off", "everyone's spent out" and
   * "nobody has room for a podcast specifically" are three different problems
   * with three different fixes, and a silent list says none of them. */
  const reason = (() => {
    if (rows.length === 0) return undefined;
    if (eligible.length > 0 && podcastCapable.length === 0 && podcastPoints)
      return `Nobody can take a podcast right now — the largest gap left in anyone's day is ${biggestGap} point${biggestGap === 1 ? "" : "s"}, and a podcast costs ${podcastPoints}.`;
    if (eligible.length > 0)
      return "There are reviewers with room now — these arrived while nobody was free, and nothing has re-routed them since.";
    if (unavailable.length === rows.length)
      return `All ${rows.length} reviewer${rows.length === 1 ? " is" : "s are"} marked unavailable, so routing had nobody to score.`;
    if (spentOut.length === rows.length)
      return `All ${rows.length} reviewer${rows.length === 1 ? " is" : "s are"} out of points for today. The budget is daily — these will route on their own tomorrow morning, or a lead can hand one over now.`;
    return "No reviewer was both on duty and had room for these when they arrived.";
  })();

  /* Each card goes where its number can be acted on: the unrouted count to
   * the pipeline table holding exactly those rows, the two reviewer numbers to
   * the QC side of Team Capacity, which is the per-reviewer view this panel
   * deliberately doesn't repeat. */
  const STATS: Array<{
    label: string;
    value: string;
    hint: string;
    icon: string;
    wrap: string;
    tone: string;
    to: string;
    title: string;
  }> = [
    {
      label: "UNROUTED NOW",
      value: jobsLoading ? "—" : String(unroutedTotal),
      hint: unroutedTotal ? "Nobody is reviewing these" : "Every QC2 job has a reviewer",
      icon: "ri-error-warning-line",
      wrap: "bg-amber-500/15 text-amber-400",
      tone: unroutedTotal ? "text-[var(--accent-amber)]" : "text-[var(--text-main)]",
      /* `status=all` so a job that has since been scrapped or delivered still
       * shows: "why did this never get a reviewer" outlives the round. */
      to: "/?view=pipeline&status=all&unrouted=1",
      title: "Open these in the pipeline table",
    },
    {
      label: "REVIEWERS OPEN",
      value: loadLoading ? "—" : `${eligible.length}/${rows.length}`,
      hint: loadLoading
        ? "On duty with points left"
        : `On duty with points left · ${podcastCapable.length} can take a podcast`,
      icon: "ri-shield-check-line",
      wrap: "bg-emerald-500/15 text-emerald-400",
      tone: "text-[var(--text-main)]",
      to: "/?view=capacity&tab=qc",
      title: "Open the QC load view — every reviewer's day, in full",
    },
    {
      label: "NEXT IN LINE",
      value: nextInLine ? nextInLine.name : "—",
      hint: nextInLine ? "Idle longest — takes the next job" : "Nobody is fully idle; lowest score wins",
      icon: "ri-user-follow-line",
      wrap: "bg-purple-500/15 text-purple-400",
      tone: "text-[var(--text-main)]",
      to: "/?view=capacity&tab=qc",
      title: nextInLine
        ? `Open the QC load view to see ${nextInLine.name}'s day`
        : "Open the QC load view — every reviewer's day, in full",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        {STATS.map((s) => (
          <Link
            key={s.label}
            to={s.to}
            title={s.title}
            className="glass-card block p-5 transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--text-dim)]">{s.label}</span>
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg text-lg ${s.wrap}`}>
                <i className={s.icon} />
              </div>
            </div>
            <div className={`mt-2 truncate text-2xl font-bold ${s.tone} ${s.label === "NEXT IN LINE" ? "" : "font-mono"}`}>
              {s.value}
            </div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">{s.hint}</div>
          </Link>
        ))}
      </div>

      {(jobsLoading || loadLoading) && (
        <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <i className="ri-loader-4-line animate-spin" /> Loading QC routing state...
        </p>
      )}

      <UnroutedJobsCard
        jobs={unrouted}
        total={unroutedTotal}
        onSelect={setSelectedJobId}
        reason={reason}
        reviewers={rows}
      />

      {/* Who routing can actually pick from right now. The full per-reviewer
       * load view (bars, cleared counts) is Team Capacity → QC — not repeated here. */}
      <section className="glass-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <i className="ri-cpu-line text-purple-400" /> Who routing can pick from
            </h3>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Points spent today against each reviewer's own daily budget, grouped by whether the next QC2 job
              could go to them.
            </p>
          </div>
          <Link
            to="/?view=capacity"
            className="flex items-center gap-1 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--primary-light)]"
          >
            Full QC load view <i className="ri-arrow-right-line" />
          </Link>
        </div>

        {!loadLoading && rows.length === 0 ? (
          <p className="mt-4 text-xs text-[var(--text-muted)]">
            No QC accounts exist yet, so nothing can be routed. Create one under Users &amp; Roles and QC2 jobs will start
            being assigned automatically.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <span className="text-xs font-bold text-[var(--accent-green)]">
                Eligible now
              </span>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {eligible.length > 0 ? (
                  eligible.map((r) => <ReviewerChip key={r.user_id} row={r} />)
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">
                    Nobody — the next QC2 job will land in the unrouted list above.
                  </span>
                )}
              </div>
            </div>

            <div>
              <span className="text-xs font-bold text-[var(--accent-amber)]">
                Skipped — out of points for today
              </span>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {spentOut.length > 0 ? (
                  spentOut.map((r) => <ReviewerChip key={r.user_id} row={r} muted />)
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">Nobody has spent their day out.</span>
                )}
              </div>
            </div>

            <div>
              <span className="text-xs font-bold text-[var(--text-dim)]">
                Skipped — marked unavailable
              </span>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {unavailable.length > 0 ? (
                  unavailable.map((r) => <ReviewerChip key={r.user_id} row={r} muted />)
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">Everyone is available.</span>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* The actual rule, in the same words as docs/05 — so nobody has to
       * guess why a job went where it went. */}
      <section className="glass-card p-5">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <i className="ri-route-line text-purple-400" /> How a QC2 job gets routed
        </h3>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-[var(--border-color-subtle)] bg-[var(--bg-pill)] p-3 font-mono text-xs leading-relaxed text-[var(--text-muted)]">
{`cost  = video type's current QC points     (half, rounded up, on a repeat round)
pool  = on duty, and points_spent_today + cost ≤ their daily budget
score = points_spent_today ÷ daily_budget
      − 0.15  if they've cleared work on this pod before
      − 0.05 × min(days_idle, 3)`}
        </pre>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Lowest score wins. A repeat round skips all of this and goes straight back to the reviewer who
          raised the changes.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {ROUTING_RULES.map((rule) => (
            <div
              key={rule.title}
              className="flex gap-3 rounded-lg border border-[var(--border-color-subtle)] bg-[var(--bg-pill)] p-3"
            >
              <i className={`${rule.icon} mt-0.5 text-base text-[var(--primary-light)]`} />
              <div>
                <div className="text-xs font-bold text-[var(--text-main)]">{rule.title}</div>
                <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">{rule.body}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-3 text-xs text-[var(--text-dim)]">
          Full rule: <span className="font-mono">docs/12-qc2-load-model.md</span> · implementation:{" "}
          <span className="font-mono">app/services/routing.py</span>
        </p>
      </section>

      <JobDetailPanel
        open={Boolean(selectedJobId)}
        job={panelJob}
        events={selectedJobEvents}
        onClose={() => setSelectedJobId(null)}
      />
    </div>
  );
}
