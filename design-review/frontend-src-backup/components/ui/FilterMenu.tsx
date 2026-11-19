import { useEffect, useRef, useState, type ReactNode } from "react";
import { matchesSearch } from "@/lib/matchesSearch";

export interface FilterOption<T extends string> {
  value: T;
  label: string;
  /** Optional swatch/badge classes, so a stage reads the same here as in the
   * table it filters. */
  className?: string;
}

interface FilterMenuProps<T extends string> {
  label: string;
  icon: string;
  options: FilterOption<T>[];
  selected: T[];
  onChange: (selected: T[]) => void;
  /** An extra control below the options — the "unassigned"/"unrouted" style
   * toggles that aren't one of the values. */
  footer?: ReactNode;
}

/** A multi-select dropdown that reports its selection and nothing else.
 *
 * Selecting nothing means "don't filter on this", which is why an empty array
 * is a valid state rather than "all boxes ticked": the query param is simply
 * omitted, and the server returns the unfiltered set.
 */
export function FilterMenu<T extends string>({
  label,
  icon,
  options,
  selected,
  onChange,
  footer,
}: FilterMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  /* A menu that only closes on its own button strands itself open behind
   * whatever you click next. */
  useEffect(() => {
    if (!open) return;
    const onDocumentDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocumentDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onDocumentDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const toggle = (value: T) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  const active = selected.length > 0;
  const visibleOptions = options.filter((option) => matchesSearch(option.label, query));

  return (
    <div className="relative w-full" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setQuery(""); }}
        aria-expanded={open}
        className={`flex w-full items-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ${
          active
            ? "border-[var(--primary)] bg-[var(--primary-glow-subtle)] text-[var(--primary-light)]"
            : "border-[var(--border-color)] bg-[var(--bg-pill)] text-[var(--text-muted)] hover:border-[var(--primary)] hover:text-[var(--primary-light)]"
        }`}
      >
        <i className={icon} />
        {label}
        {active && (
          <span className="rounded bg-[var(--primary)] px-1.5 font-mono text-[10px] text-white">
            {selected.length}
          </span>
        )}
        <i className={`${open ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} ml-auto`} />
      </button>

      {open && (
        <div className="absolute left-0 z-40 mt-1 w-full min-w-[13rem] rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel-solid)] p-1.5 shadow-xl">
          <input autoFocus type="search" aria-label={`Search ${label}`} placeholder={`Search ${label.toLowerCase()}...`} value={query} onChange={(event) => setQuery(event.target.value)} className="mb-1 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-2 text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]" />
          <div className="max-h-60 overflow-y-auto">
          {visibleOptions.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggle(option.value)}
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-[var(--text-muted)] hover:bg-[var(--bg-pill)]"
              >
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[9px] text-white ${
                    checked
                      ? "border-[var(--primary)] bg-[var(--primary)]"
                      : "border-[var(--border-color)]"
                  }`}
                >
                  {checked && <i className="ri-check-line" />}
                </span>
                <span className={`flex-1 font-semibold ${option.className ?? ""}`}>
                  {option.label}
                </span>
              </button>
            );
          })}
          {visibleOptions.length === 0 && <p className="px-2 py-3 text-xs text-[var(--text-muted)]">No matches</p>}
          </div>

          {footer && (
            <div className="mt-1 border-t border-[var(--border-color-subtle)] pt-1">{footer}</div>
          )}

          {active && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full rounded px-2 py-1.5 text-left text-[11px] font-semibold text-[var(--text-dim)] hover:bg-[var(--bg-pill)] hover:text-[var(--text-main)]"
            >
              Clear {label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
