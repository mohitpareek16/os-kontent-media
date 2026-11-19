import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** 32 / 40 / 48px. Default md. */
  size?: Size;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-[var(--primary)] text-white shadow-[var(--shadow-card)] hover:bg-[var(--primary-hover)] border border-transparent",
  secondary:
    "bg-[var(--bg-card)] text-[var(--text-main)] border border-[var(--border-color)] hover:bg-[var(--bg-card-hover)] hover:border-[var(--text-dim)]",
  outline:
    "bg-transparent text-[var(--text-main)] border border-[var(--border-color)] hover:border-[var(--primary)] hover:text-[var(--primary-text)]",
  ghost:
    "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-pill)] border border-transparent",
  danger:
    "bg-[#B91C1C] text-white shadow-[var(--shadow-card)] hover:bg-[#991B1B] border border-transparent",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] rounded-lg",
  md: "h-10 px-4 text-sm rounded-[10px]",
  lg: "h-12 px-5 text-[15px] rounded-[10px]",
};

/** One button. Flat fill, no lift on hover (a translate shifts the control
 * out from under the cursor); the keyboard focus ring is global (index.css). */
export function Button({ variant = "primary", size = "md", className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-bold transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
}
