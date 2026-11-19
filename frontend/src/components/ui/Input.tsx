import type { InputHTMLAttributes } from "react";

/** 44px text field. Keyboard focus draws the global focus ring plus a
 * primary border; the placeholder is a hint, never the label (see Field). */
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return (
    <input
      className={`h-11 w-full rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-input)] px-3.5 text-[15px] text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-dim)] focus:border-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...rest}
    />
  );
}
