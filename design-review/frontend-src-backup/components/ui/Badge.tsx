import type { ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  className?: string;
}

export function Badge({ children, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-0.5 text-xs font-semibold ${
        className || "border-[var(--border-color)] bg-[var(--bg-pill)] text-[var(--text-muted)]"
      }`}
    >
      {children}
    </span>
  );
}
