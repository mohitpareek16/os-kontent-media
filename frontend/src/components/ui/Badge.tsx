import type { ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  /** Colour classes (bg + text). Defaults to the neutral chip. */
  className?: string;
  title?: string;
}

/** A 24px pill. Pass tone classes via `className` (use the semantic tokens:
 * `bg-[var(--ok-bg)] text-[var(--ok-text)]`, `--warn-*`, `--bad-*`). */
export function Badge({ children, className = "", title }: BadgeProps) {
  return (
    <span
      title={title}
      className={`inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-bold ${
        className || "bg-[var(--bg-pill)] text-[var(--text-main)]"
      }`}
    >
      {children}
    </span>
  );
}
