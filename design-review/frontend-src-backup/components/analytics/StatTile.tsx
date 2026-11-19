/** A number with a label. Optionally a way into the rows behind it: pass
 * `onClick` and the tile becomes a button, which is what every other stat card
 * in the app already is — a count you cannot open is a dead end. */
export function StatTile({
  label,
  value,
  tone = "default",
  hint,
  onClick,
  title,
}: {
  label: string;
  value: string;
  tone?: "default" | "critical";
  /** One line under the number, saying what clicking it opens. */
  hint?: string;
  onClick?: () => void;
  title?: string;
}) {
  const body = (
    <>
      <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">{label}</p>
      <p
        className={`mt-1.5 font-mono text-2xl font-extrabold ${
          tone === "critical" ? "text-[var(--accent-red)]" : "text-[var(--text-main)]"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-[var(--text-muted)]">{hint}</p>}
    </>
  );

  if (!onClick) return <div className="glass-card p-4">{body}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="glass-card p-4 text-left transition-all hover:-translate-y-0.5"
    >
      {body}
    </button>
  );
}
