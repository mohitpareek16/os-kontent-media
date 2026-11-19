import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-gradient-to-br from-[var(--primary)] to-[var(--primary-hover)] text-white shadow-md shadow-[var(--primary-glow-subtle)] hover:shadow-lg hover:shadow-[var(--primary-glow)] hover:-translate-y-0.5 border border-transparent",
  secondary:
    "bg-[var(--bg-card)] text-[var(--text-main)] border border-[var(--border-color)] hover:border-[var(--border-color-hover)] hover:bg-[var(--bg-card-hover)]",
  outline:
    "bg-transparent text-[var(--text-main)] border border-[var(--border-color)] hover:border-[var(--primary)] hover:text-[var(--primary)]",
  ghost: "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-pill)] border border-transparent",
  danger:
    "bg-gradient-to-br from-rose-600 to-rose-700 text-white shadow-md shadow-rose-900/20 hover:shadow-lg hover:-translate-y-0.5 border border-transparent",
};

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
}
