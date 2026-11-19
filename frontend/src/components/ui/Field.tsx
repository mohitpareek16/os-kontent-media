import type { ReactNode } from "react";

interface FieldProps {
  /** Visible label, above the control. Sentence case; put "(optional)" here
   * rather than in a placeholder, which disappears as soon as you type. */
  label: ReactNode;
  htmlFor?: string;
  help?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A labelled form control: label above, then the control, then help or an
 * error. Wrap `Input` / `Select` / `SearchableSelect` in it. */
export function Field({ label, htmlFor, help, error, children, className = "" }: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-bold text-[var(--text-main)]">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-[var(--bad-text)]">
          <i className="ri-error-warning-fill" /> {error}
        </p>
      ) : help ? (
        <p className="mt-1.5 text-xs text-[var(--text-dim)]">{help}</p>
      ) : null}
    </div>
  );
}
