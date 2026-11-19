import type { BotToolFrame } from "@/api/chat";
import type { ChatToolCall } from "@/types";

/** Tool names are the backend's; these are what a TL should read. A chip
 * saying `get_person_performance` tells them nothing about whether to trust
 * the answer. */
const TOOL_LABELS: Record<string, string> = {
  resolve_entity: "Finding who you meant",
  get_pod_health: "Reading client delivery stats",
  get_person_performance: "Reading one person's numbers",
  find_jobs: "Searching jobs",
  get_job_timeline: "Reading a job's history",
  get_team_capacity: "Checking team capacity",
  list_pods: "Reading every client's numbers",
  compare_editors: "Comparing the team's delivery record",
  get_pod_team: "Reading who works on this client",
  get_delivery_trend: "Reading deliveries over time",
  get_intake_trend: "Reading incoming job volume",
  list_brand_assets: "Checking the client's brand kit",
  search_voice_notes: "Searching voice notes",
  render_chart: "Drawing the chart",
};

export function toolLabel(name: string) {
  return TOOL_LABELS[name] ?? name.replace(/_/g, " ");
}

interface ToolActivityProps {
  /** Live frames while the answer is being produced… */
  frames?: BotToolFrame[];
  /** …or the recorded calls once it's saved. Same chips either way. */
  calls?: ChatToolCall[];
}

/** Shows what the bot actually looked at. This is not decoration: a refused
 * lookup is the difference between "there is no data" and "you can't see
 * that data", and the answer alone doesn't always make that clear. */
export function ToolActivity({ frames, calls }: ToolActivityProps) {
  const items = frames
    ? frames.map((f) => ({ name: f.name, state: f.status }))
    : (calls ?? []).map((c) => ({ name: c.name, state: c.ok ? "done" : "refused" }));

  if (!items.length) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, index) => (
        <span
          key={`${item.name}-${index}`}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
            item.state === "refused"
              ? "border-[var(--accent-red)]/30 bg-[var(--accent-red-bg)] text-[var(--accent-red)]"
              : "border-[var(--border-color)] bg-[var(--bg-pill)] text-[var(--text-muted)]"
          }`}
        >
          <i
            className={
              item.state === "running"
                ? "ri-loader-4-line animate-spin"
                : item.state === "refused"
                  ? "ri-lock-line"
                  : "ri-check-line"
            }
          />
          {toolLabel(item.name)}
          {item.state === "refused" && " — not permitted"}
        </span>
      ))}
    </div>
  );
}
