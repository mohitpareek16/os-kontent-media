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
      <p className="text-[13px] font-semibold text-[var(--text-dim)]">{label}</p>
      <p
        className={`num mt-1 text-[30px] font-bold leading-tight ${
          tone === "critical" ? "text-[var(--bad-text)]" : "text-[var(--text-main)]"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-[var(--text-dim)]">{hint}</p>}
    </>
  );

  if (!onClick) return <div className="glass-card p-4">{body}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="glass-card card-interactive p-4 text-left"
    >
      {body}
    </button>
  );
}
