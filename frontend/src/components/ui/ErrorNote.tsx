/** FastAPI answers a rejected mutation with `{ "detail": "..." }`, and those
 * messages are the useful part — "They still have 3 open job(s) in this pod",
 * "Cannot demote the last active Owner". Swallowing them behind a generic
 * "something went wrong" throws away the only thing that tells the user what
 * to do next, so every mutation surface in the app reads the detail through
 * this one helper. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } } | null)?.response?.data
    ?.detail;

  if (typeof detail === "string" && detail.trim()) return detail.trim();

  // 422s from pydantic arrive as a list of {loc, msg} objects.
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (item as { msg?: unknown })?.msg)
      .filter((msg): msg is string => typeof msg === "string" && msg.trim().length > 0);
    if (messages.length) return messages.join(", ");
  }

  return fallback;
}

interface ErrorNoteProps {
  /** Anything falsy renders nothing, so callers can pass `mutation.error`. */
  error: unknown;
  /** Shown only when the server didn't send a `detail` we can read. */
  fallback: string;
  className?: string;
}

export function ErrorNote({ error, fallback, className = "" }: ErrorNoteProps) {
  if (!error) return null;

  return (
    <p
      role="alert"
      className={`flex items-start gap-1.5 rounded-lg bg-[var(--bad-bg)] px-3 py-2 text-[13px] font-semibold text-[var(--bad-text)] ${className}`}
    >
      <i className="ri-error-warning-line mt-px shrink-0" />
      <span>{apiErrorMessage(error, fallback)}</span>
    </p>
  );
}

/** The green counterpart — a one-line "that worked" under the same control. */
export function SuccessNote({ message, className = "" }: { message: string; className?: string }) {
  return (
    <p
      role="status"
      className={`flex items-start gap-1.5 rounded-lg bg-[var(--ok-bg)] px-3 py-2 text-[13px] font-semibold text-[var(--ok-text)] ${className}`}
    >
      <i className="ri-check-line mt-px shrink-0" />
      <span>{message}</span>
    </p>
  );
}
