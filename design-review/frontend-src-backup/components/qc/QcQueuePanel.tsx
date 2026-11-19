import { useState } from "react";

import { JobDetailPanel } from "@/components/pipeline/JobDetailPanel";
import { QcQueueTable } from "@/components/qc/QcQueueTable";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { useCurrentUser } from "@/hooks/useAuth";
import { useJob, useJobEvents, useJobs } from "@/hooks/useJobs";
import { useOwnQcLoad, useSetOwnAvailability } from "@/hooks/useUsers";
import { hasRole } from "@/lib/roles";
import type { JobDetail, QcLoad, Stage, User } from "@/types";

/** Stages a job of mine can sit at while it's out of my hands but still
 * coming back to me — routing is sticky on revisits (docs/05), so these
 * return to this same queue rather than to whoever is idle. */
const IN_LOOP_STAGES: Stage[] = ["intake", "assigned", "editing", "qc1"];

/** Availability and load are one decision, so they're one card: the toggle
 * only means something next to the number routing is actually reading. */
function ReviewerStatusCard({ user, load }: { user?: User; load?: QcLoad }) {
  const setAvailability = useSetOwnAvailability();
  const available = user?.available ?? false;
  const spentOut = load ? load.points_left <= 0 : false;
  const pct = (points: number) => (load ? `${Math.min(100, (points / load.capacity) * 100)}%` : "0%");

  return (
    <section className="glass-card space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                available ? "bg-[var(--accent-green)] shadow-[0_0_8px_var(--accent-green)]" : "bg-[var(--text-dim)]"
              }`}
            />
            <h3 className="text-sm font-bold text-[var(--text-main)]">
              {available ? "Available for new QC2 work" : "Not available for new QC2 work"}
            </h3>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Turn this off and new QC2 work stops being routed to you — jobs already in your queue stay yours.
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={available}
          aria-label="Available for new QC2 work"
          disabled={setAvailability.isPending || !user}
          onClick={() => setAvailability.mutate(!available)}
          className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            available
              ? "border-transparent bg-[var(--accent-green)]"
              : "border-[var(--border-color)] bg-[var(--bg-pill)]"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              available ? "left-6" : "left-0.5"
            }`}
          />
        </button>
      </div>

      <ErrorNote error={setAvailability.error} fallback="Could not save that — try again." />

      {load && (
        <div className="border-t border-[var(--border-color-subtle)] pt-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-bold uppercase tracking-wider text-[var(--text-dim)]">Your day</span>
            <span className={`font-mono font-bold ${spentOut ? "text-[var(--accent-red)]" : "text-[var(--text-main)]"}`}>
              {load.load}/{load.capacity} pts
            </span>
          </div>
          {/* Two segments: what you have spent today, and what is still open
              from an earlier day. Carried-over work costs the same points and
              buys nothing new, so it earns its own colour. */}
          <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-[var(--bg-pill)]">
            <div
              className={`h-full ${spentOut ? "bg-[var(--accent-red)]" : "bg-[var(--accent-amber)]"}`}
              style={{ width: pct(load.points_today) }}
            />
            <div className="h-full bg-rose-400/70" style={{ width: pct(load.points_carried) }} />
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
            {load.open_count} open · {load.cleared_count} cleared ·{" "}
            {spentOut
              ? "you're out of points for today, so nothing new will route to you until tomorrow"
              : `${load.points_left} point${load.points_left === 1 ? "" : "s"} left today`}
            {load.points_carried > 0 && (
              <>
                {" · "}
                <span className="text-rose-400">
                  {load.points_carried} carried over from an unfinished round
                </span>
              </>
            )}
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-dim)]">
            Points are spent against the day, not the job: clearing something does not hand them back
            until tomorrow. Each video type has its own QC price; a round you have already watched
            costs half the current price, rounded up.
          </p>
        </div>
      )}
    </section>
  );
}

/** How many rows a group shows before the count on its card is the honest
 * answer. These are working queues — if one is long enough to page, the
 * number to act on is "how many", and the pipeline table is where you page. */
const GROUP_SIZE = 25;

/** The five groups a reviewer's work falls into, as clickable cards over one
 * table — the same shape the editor's pipeline uses, because it is the same
 * question ("what is on me, and what do I open first") and there is no reason
 * for two answers to look different.
 *
 * This replaced four stacked lists. Each was its own card with its own
 * heading, so a reviewer with work in three of them scrolled past two to
 * reach the third, could not scan a column, and had nowhere that said how
 * much was on them in total. */
interface QcGroup {
  key: string;
  label: string;
  hint: string;
  icon: string;
  iconWrapClass: string;
  countClass?: string;
  empty: string;
}

const GROUPS: QcGroup[] = [
  {
    key: "waiting",
    label: "Waiting on me",
    hint: "At QC2 and routed to you. Clear it forward, or send it back with a change list.",
    icon: "ri-eye-line",
    iconWrapClass: "bg-amber-500/15 text-amber-400",
    countClass: "text-amber-400",
    empty: "New QC2 work lands here automatically while you're available.",
  },
  {
    key: "sent_back",
    label: "Sent back",
    hint: "You raised a change list. The editor is working through it; it comes back to you.",
    icon: "ri-arrow-go-back-line",
    iconWrapClass: "bg-rose-500/15 text-rose-400",
    empty: "You haven't sent anything back that's still open.",
  },
  {
    key: "in_loop",
    label: "Still yours, elsewhere",
    hint: "Yours from an earlier round, currently with the TL or the editor. Routing is sticky, so these return to you.",
    icon: "ri-loop-left-line",
    iconWrapClass: "bg-indigo-500/15 text-indigo-400",
    empty: "Nothing of yours is elsewhere in the loop.",
  },
  {
    key: "cleared",
    label: "Cleared",
    hint: "You passed these at QC2 — with the TL for final check, or already delivered.",
    icon: "ri-checkbox-circle-line",
    iconWrapClass: "bg-emerald-500/15 text-emerald-400",
    empty: "Jobs you pass at QC2 land here.",
  },
  {
    key: "unrouted",
    label: "Unrouted",
    hint: "At QC2 with nobody reviewing — routing could not place them. Anyone in the pod can pick one up.",
    icon: "ri-user-search-line",
    iconWrapClass: "bg-slate-500/15 text-slate-300",
    empty: "Everything at QC2 has a reviewer.",
  },
];

/** A QC reviewer's own workspace: what is waiting on them, what they have
 * sent back, what they have cleared, and the QC2 jobs routing could not
 * place. The backend already scopes `GET /jobs` to "in-queue only" for a QC
 * account (docs/04); each group asks it for its own stages, so a group's
 * count is the queue's size rather than the size of a download. */
export function QcQueuePanel() {
  const { data: user } = useCurrentUser();
  const isQc = hasRole(user, "qc");
  const reviewerId = user?.id;

  /* One query per group, each filtered by the server on the stages that
   * define it. This screen used to pull 500 rows and slice them five ways in
   * the browser: past 500 the queue silently stopped showing work, and every
   * group's count was a count of what had been downloaded rather than of
   * what exists.
   *
   * Polled at the same 30s as notifications — this is the screen someone
   * sits on waiting for work, and it used to update only on a page reload. */
  const groupOptions = { enabled: Boolean(reviewerId), refetchInterval: 30_000 };
  /* `status: "all"` because one group is delivered work, which every narrower
   * status excludes — so cancelled projects have to be dropped explicitly, or
   * a scrapped job sits in a reviewer's queue asking to be reviewed. */
  const mine = {
    status: "all",
    scrapped: false,
    reviewer_id: reviewerId,
    page_size: GROUP_SIZE,
  } as const;

  const waiting = useJobs({ ...mine, stage: ["qc2"] }, groupOptions);
  const sentBack = useJobs({ ...mine, stage: ["revisions"] }, groupOptions);
  const inLoop = useJobs({ ...mine, stage: IN_LOOP_STAGES }, groupOptions);
  const cleared = useJobs({ ...mine, stage: ["final", "delivered"] }, groupOptions);
  const unrouted = useJobs(
    { status: "all", scrapped: false, unrouted: true, page_size: GROUP_SIZE },
    { refetchInterval: 30_000 },
  );

  const byKey = {
    waiting,
    sent_back: sentBack,
    in_loop: inLoop,
    cleared,
    unrouted,
  } as const;

  /* `GET /users/me/qc-load` is QC-only — anyone else here just collects a 403. */
  const { data: ownLoad } = useOwnQcLoad({ enabled: isQc });
  const [active, setActive] = useState<string>("waiting");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  /* Same pattern as the pipeline table: the row we already have renders the
   * panel instantly, the detail query then keeps it live. */
  const { data: selectedJob } = useJob(selectedJobId);
  const { data: selectedJobEvents } = useJobEvents(selectedJobId);

  const onScreen: JobDetail[] = Object.values(byKey).flatMap((q) => q.data?.items ?? []);
  const panelJob = selectedJob ?? onScreen.find((j) => j.id === selectedJobId);

  const group = GROUPS.find((g) => g.key === active) ?? GROUPS[0];
  const activeQuery = byKey[group.key as keyof typeof byKey];

  return (
    <div className="space-y-5">
      <ReviewerStatusCard user={user} load={ownLoad} />

      {/* The five counts, as the way *into* the table rather than as five
          separate tables. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {GROUPS.map((g, i) => {
          const total = byKey[g.key as keyof typeof byKey].data?.total ?? 0;
          const isActive = g.key === active;
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => setActive(g.key)}
              title={g.hint}
              className={`glass-card animate-fade-in-up p-4 text-left transition-all hover:-translate-y-0.5 ${
                isActive
                  ? "border-[var(--primary)] shadow-lg shadow-purple-900/20"
                  : "hover:border-[var(--primary)]"
              }`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
                  {g.label}
                </span>
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm ${g.iconWrapClass}`}
                >
                  <i className={g.icon} />
                </span>
              </div>
              <div
                className={`mt-2 font-mono text-2xl font-extrabold ${g.countClass ?? "text-[var(--text-main)]"}`}
              >
                {total}
              </div>
            </button>
          );
        })}
      </div>

      <div className="glass-card overflow-hidden">
        <div className="border-b border-[var(--border-color-subtle)] p-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--text-main)]">
            <i className={group.icon} /> {group.label}
            <span className="font-mono text-xs font-semibold text-[var(--text-dim)]">
              {activeQuery.data?.total ?? 0}
            </span>
          </h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{group.hint}</p>
        </div>

        <QcQueueTable
          jobs={activeQuery.data?.items ?? []}
          isLoading={activeQuery.isLoading}
          empty={group.empty}
          claimable={group.key === "unrouted" && isQc}
          selectedJobId={selectedJobId}
          onSelect={setSelectedJobId}
        />

        {(activeQuery.data?.total ?? 0) > GROUP_SIZE && (
          <p className="border-t border-[var(--border-color-subtle)] px-4 py-2.5 text-[11px] text-[var(--text-dim)]">
            Showing the first {GROUP_SIZE} of {activeQuery.data?.total}. The pipeline table pages
            through the rest.
          </p>
        )}
      </div>

      <JobDetailPanel
        open={Boolean(selectedJobId)}
        job={panelJob}
        events={selectedJobEvents}
        onClose={() => setSelectedJobId(null)}
      />
    </div>
  );
}
