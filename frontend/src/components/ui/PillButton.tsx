import type { ButtonHTMLAttributes } from "react";

interface PillButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean;
}

/** The small selected/unselected pill used by filter strips and segmented
 * controls (role filters, account status, pod status). Selected = the tinted
 * primary state used everywhere else in the app. */
export function PillButton({ active, className = "", ...props }: PillButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "border border-[var(--primary)] bg-[var(--bg-pill)] text-[var(--primary-text)]"
          : "border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-main)]"
      } ${className}`}
      {...props}
    />
  );
}
