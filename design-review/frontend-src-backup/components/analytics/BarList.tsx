export interface BarListItem {
  label: string;
  value: number;
  colorClassName?: string;
}

interface BarListProps {
  items: BarListItem[];
  formatValue?: (value: number) => string;
}

// Each row direct-labels its own category, so identity never rests on color
// alone even when every bar carries a different hue (e.g. stage colors).
export function BarList({ items, formatValue = (v) => String(v) }: BarListProps) {
  if (items.length === 0) return <p className="text-sm text-[var(--text-dim)]">No data yet.</p>;
  const max = Math.max(1, ...items.map((item) => item.value));

  return (
    <div className="space-y-2.5">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3 text-sm">
          <span className="w-32 shrink-0 truncate text-[var(--text-muted)]">{item.label}</span>
          <div className="h-4 flex-1 overflow-hidden rounded-full bg-[var(--bg-pill)]">
            <div
              className={`h-full rounded-full transition-all duration-500 ${item.colorClassName ?? "bg-[var(--primary)]"}`}
              style={{ width: `${Math.max(4, (item.value / max) * 100)}%` }}
            />
          </div>
          <span className="w-12 shrink-0 text-right font-mono text-xs font-semibold text-[var(--text-muted)]">
            {formatValue(item.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
