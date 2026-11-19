import type { ButtonHTMLAttributes } from "react";

interface PillButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean;
}

/** The small selected/unselected pill used by every filter strip and
 * segmented control in the app (role filters, account status, pod status).
 * It was three copies of the same className string before. */
export function PillButton({ active, className = "", ...props }: PillButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "bg-[var(--primary)] text-white shadow-sm shadow-[var(--primary-glow-subtle)]"
          : "border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:border-[var(--border-color-hover)] hover:text-[var(--text-main)]"
      } ${className}`}
      {...props}
    />
  );
}
