export function RevisionCounter({ round }: { round: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold ${
        round >= 3 ? "text-[var(--accent-red)]" : "text-[var(--text-dim)]"
      }`}
    >
      <i className="ri-refresh-line" /> Round {round}
    </span>
  );
}
