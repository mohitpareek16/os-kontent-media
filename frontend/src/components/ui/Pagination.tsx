const PAGE_SIZES = [10, 25, 50, 100];

interface PaginationProps {
  page: number;
  pageSize: number;
  /** Rows matching the filters, from the server — not `items.length`. */
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  /** What a row is, for the summary line: "1–25 of 90 jobs". */
  noun?: string;
  className?: string;
}

/** The pager every list uses.
 *
 * It is deliberately dumb: it renders the numbers the server sent and reports
 * clicks. Each table used to own its own copy, count its own rows, and
 * disagree with the others about what "of 7" meant — the pipeline table said
 * "Page 1 / 1" while showing a locally-filtered slice of a 1000-row fetch.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  noun = "results",
  className = "",
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  const buttonClass =
    "h-8 min-w-8 px-2.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] text-[13px] font-bold transition-colors hover:border-[var(--primary)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[var(--border-color)]";

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13px] text-[var(--text-muted)] ${className}`}
    >
      <div className="flex items-center gap-3">
        <span>
          {total === 0 ? `No ${noun}` : `Showing ${first}–${last} of ${total} ${noun}`}
        </span>
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5 text-[var(--text-dim)]">
            <span className="sr-only">Rows per page</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-8 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-2 text-[13px] font-bold text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            per page
          </label>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onPageChange(1)} disabled={page <= 1} className={buttonClass}>
          <i className="ri-skip-back-mini-line" />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className={buttonClass}
        >
          Prev
        </button>
        <span className="num font-semibold">
          Page {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className={buttonClass}
        >
          Next
        </button>
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={page >= totalPages}
          className={buttonClass}
        >
          <i className="ri-skip-forward-mini-line" />
        </button>
      </div>
    </div>
  );
}
