/** Shimmering placeholder blocks. They hold the layout while data loads, so a
 * list doesn't jump when it arrives (replaces "Loading…" spinner lines). */
export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} style={style} />;
}

/** `rows` table-ish rows: a title bar, a sub-line and a pill on the right. */
export function SkeletonRows({ rows = 4, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="glass-card overflow-hidden">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={`flex items-center gap-4 px-4 py-3.5 ${i ? "border-t border-[var(--border-color-subtle)]" : ""}`}
        >
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
          <Skeleton className="h-6 w-20 !rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** `count` card-shaped blocks (board columns, pod grids). */
export function SkeletonCards({ count = 3, className = "h-28" }: { count?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={`w-full !rounded-[10px] ${className}`} />
      ))}
    </div>
  );
}
