import { BarList } from "@/components/analytics/BarList";
import type { UserCapacity } from "@/types";

/** Videos held right now, per editor, across every pod they work in.
 *
 * Counted in videos rather than weight points, and the difference was not
 * cosmetic: the bar used to plot `weighted_load` — two points a job — against
 * `max_concurrent_jobs`, which is a count. An editor holding three of their
 * five allowed videos drew as six against five, in red, and read as somebody
 * to take work off. Points belong to QC2 and nothing else
 * (docs/12-qc2-load-model.md). */
export function CapacityBar({ capacities }: { capacities: UserCapacity[] }) {
  const items = capacities
    .slice()
    .sort((a, b) => b.open_count - a.open_count)
    .map((c) => ({
      label: c.name,
      value: c.open_count,
      colorClassName: c.open_count >= c.max_concurrent_jobs ? "bg-rose-500" : "bg-indigo-500",
    }));

  return <BarList items={items} formatValue={(v) => `${v}`} />;
}
