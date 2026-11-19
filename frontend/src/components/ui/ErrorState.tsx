import { useState } from "react";

import { apiErrorMessage } from "@/components/ui/ErrorNote";
import { Button } from "@/components/ui/Button";

interface ErrorStateProps {
  /** What failed, as a noun phrase: "your inbox", "this job". */
  what: string;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}

/** Block-level load failure: what failed, one helpful sentence, "Try again",
 * and the server's own message tucked behind "Show details". (Use
 * `ErrorNote` for inline mutation errors under a control.) */
export function ErrorState({ what, error, onRetry, className = "" }: ErrorStateProps) {
  const [showDetails, setShowDetails] = useState(false);
  const detail = error ? apiErrorMessage(error, "") : "";

  return (
    <div
      role="alert"
      className={`glass-card flex items-start gap-3 border-[var(--bad-bg)] p-5 ${className}`}
    >
      <i className="ri-error-warning-fill mt-0.5 text-2xl text-[var(--bad-text)]" />
      <div className="min-w-0 flex-1">
        <p className="font-bold text-[var(--text-main)]">Couldn't load {what}</p>
        <p className="mt-0.5 text-sm text-[var(--text-muted)]">
          Check your connection and try again. If it keeps happening, tell your team lead.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {onRetry && (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              <i className="ri-refresh-line" /> Try again
            </Button>
          )}
          {detail && (
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="text-[13px] font-semibold text-[var(--text-dim)] hover:text-[var(--text-main)]"
            >
              {showDetails ? "Hide details" : "Show details"}
            </button>
          )}
        </div>
        {showDetails && detail && (
          <p className="mt-2 rounded-lg bg-[var(--bg-pill)] px-3 py-2 font-mono text-xs text-[var(--text-muted)]">
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}
