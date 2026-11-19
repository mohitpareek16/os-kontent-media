export interface TabItem<K extends string = string> {
  key: K;
  label: string;
  /** Server-side count for the tab; `undefined` renders "—". */
  count?: number | null;
  /** Count pill turns red (e.g. Overdue > 0). */
  alert?: boolean;
  icon?: string;
  title?: string;
}

interface TabBarProps<K extends string> {
  tabs: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Hide counts entirely (tabs without a number). */
  showCounts?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** The one "selected" style for tabs/filters across the app: tinted label,
 * 2px primary underline, count in a pill. Horizontal scroll on narrow
 * screens (no scrollbar). */
export function TabBar<K extends string>({
  tabs,
  value,
  onChange,
  showCounts = true,
  className = "",
  "aria-label": ariaLabel,
}: TabBarProps<K>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex gap-1 overflow-x-auto border-b border-[var(--border-color)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {tabs.map((tab) => {
        const selected = tab.key === value;
        const pillClass = tab.alert && (tab.count ?? 0) > 0
          ? "bg-[var(--bad-bg)] text-[var(--bad-text)]"
          : selected
            ? "bg-[var(--bg-pill)] text-[var(--primary-text)]"
            : "bg-[var(--bg-card-hover)] text-[var(--text-muted)] border border-[var(--border-color)]";
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            title={tab.title}
            onClick={() => onChange(tab.key)}
            className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-3 text-sm font-bold transition-colors ${
              selected
                ? "border-[var(--primary)] text-[var(--primary-text)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]"
            }`}
          >
            {tab.icon && <i className={tab.icon} />}
            {tab.label}
            {showCounts && (
              <span className={`num rounded-full px-2 text-xs font-bold leading-5 ${pillClass}`}>
                {tab.count ?? "—"}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface SegmentedProps<K extends string> {
  options: { key: K; label: string; icon?: string; count?: number | null }[];
  value: K;
  onChange: (key: K) => void;
  "aria-label"?: string;
}

/** Compact segmented control (Table | Board, Editors | QC). */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
}: SegmentedProps<K>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex shrink-0 overflow-hidden rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-card)]"
    >
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.key)}
            className={`flex h-10 items-center gap-1.5 px-3.5 text-[13px] font-bold transition-colors ${
              selected
                ? "bg-[var(--bg-pill)] text-[var(--primary-text)]"
                : "text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-main)]"
            }`}
          >
            {option.icon && <i className={option.icon} />}
            {option.label}
            {option.count !== undefined && (
              <span className="num text-xs font-semibold opacity-75">{option.count ?? "—"}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
