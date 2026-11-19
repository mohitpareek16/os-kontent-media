import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** Drops the card chrome (use inside something that already is a card). */
  bare?: boolean;
  className?: string;
}

/** "Nothing here" — an icon, one headline, one sentence of help, and at most
 * one action. Replaces the hand-written empty blocks on every list. */
export function EmptyState({
  icon = "ri-inbox-line",
  title,
  description,
  action,
  bare = false,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`${bare ? "" : "glass-card"} px-6 py-10 text-center ${className}`}>
      <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-pill)] text-2xl text-[var(--primary-text)]">
        <i className={icon} />
      </span>
      <p className="font-[var(--font-display)] text-[17px] font-bold text-[var(--text-main)]">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-md text-sm text-[var(--text-muted)]">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
