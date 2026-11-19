import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { apiErrorMessage } from "@/components/ui/ErrorNote";

/** A rejected mutation used to leave nothing on screen at all: the wizard sat
 * there with the modal still open, the job list unchanged, and no word about
 * why — "deactivated editor", "already has 5 videos in hand" — so the only
 * reading available was that the click hadn't registered. `ErrorNote` covers
 * the case where the control is still on screen; this covers the rest, and
 * the two read the same because both take their words from
 * `apiErrorMessage()`.
 *
 * A failure toast stays until it is dismissed. Something that did not happen
 * is not news that expires — the person has to act on it. The same is true of
 * an `alert` toast, which is what an incoming notification raises: it is work
 * arriving on your plate, and it has to be crossed off by hand rather than
 * fading out while you were looking at another tab. */
type ToastVariant = "error" | "success" | "info" | "alert";

interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
  /** Alerts only: the bold first line, above `message`. */
  title?: string;
  /** Alerts only — overrides the per-variant default. */
  icon?: string;
  /** Alerts only: where clicking the body takes you. */
  to?: string;
  /** Run when the toast leaves, however it leaves. Used to mark the
   * underlying notification read so it cannot pop a second time. */
  onDismiss?: () => void;
  /** Caller-supplied identity, so the same event raised twice by two polls
   * is one toast rather than two. */
  dedupeKey?: string;
}

export interface AlertToast {
  /** Stable identity for this alert — a notification id. Raising the same
   * key twice is a no-op while the first is still on screen. */
  key: string;
  title: string;
  body: string;
  icon?: string;
  /** Route to open when the toast is clicked. */
  to?: string;
  onDismiss?: () => void;
  /** What "Dismiss all" should do instead of calling every `onDismiss` in
   * turn. The caller usually has a bulk endpoint for this — clearing twenty
   * notifications must not be twenty requests, which is a mistake this
   * codebase has already made once and fixed (see `markAllNotificationsRead`).
   * The most recently supplied one wins. */
  onDismissAll?: () => void;
}

interface ToastContextValue {
  /** Anything that isn't a failure — auto-dismisses. */
  notify: (message: string, variant?: "success" | "info") => void;
  /** A failed mutation. `fallback` is used when the server sent no `detail`. */
  notifyError: (error: unknown, fallback: string) => void;
  /** Something that has arrived and is waiting on the reader. Never
   * auto-dismisses; only the ✕ (or "Dismiss all") clears it. */
  notifyAlert: (alert: AlertToast) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 6000;
/** Past this many stacked alerts the individual crosses stop being a
 * reasonable ask, so a clear-everything control appears above them. */
const DISMISS_ALL_THRESHOLD = 3;

const VARIANT_STYLES: Record<ToastVariant, { wrap: string; icon: string }> = {
  // Solid card, 4px left border in the tone colour, tone-coloured icon (set
  // below via `iconClass`), 14px text in the normal text colour.
  error: {
    wrap: "border-[var(--border-color)] border-l-4 border-l-[var(--bad-text)] bg-[var(--bg-card)] text-[var(--text-main)]",
    icon: "ri-error-warning-fill text-[var(--bad-text)]",
  },
  success: {
    wrap: "border-[var(--border-color)] border-l-4 border-l-[var(--ok-text)] bg-[var(--bg-card)] text-[var(--text-main)]",
    icon: "ri-checkbox-circle-fill text-[var(--ok-text)]",
  },
  info: {
    wrap: "border-[var(--border-color)] border-l-4 border-l-[var(--text-dim)] bg-[var(--bg-card)] text-[var(--text-main)]",
    icon: "ri-information-fill text-[var(--text-dim)]",
  },
  alert: {
    // The brand purple, because an alert is the same "this is yours now"
    // signal the purple rows and the Mine tab carry.
    wrap: "border-[var(--border-color)] border-l-4 border-l-[var(--primary)] bg-[var(--bg-card)] text-[var(--text-main)]",
    icon: "ri-notification-3-fill text-[var(--primary)]",
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const navigate = useNavigate();
  /* Set by whoever raises alerts; see `AlertToast.onDismissAll`. A ref rather
     than state because changing it must not re-render the stack. */
  const bulkDismissAlerts = useRef<(() => void) | null>(null);

  /* The live toasts, and which ids have already run their `onDismiss`.
   *
   * Both are refs because dismissing has a side effect — it marks a
   * notification read on the server — and a `setState` updater must stay
   * pure: React re-invokes it (twice, under StrictMode, and again on a
   * concurrent re-render), so a mutation fired from inside one is a mutation
   * fired an unpredictable number of times. The `dismissed` set is the other
   * half of that: a toast can be crossed off and hit its own auto-dismiss in
   * the same tick, and the server call has to happen once. */
  const toastsRef = useRef<Toast[]>([]);
  toastsRef.current = toasts;
  const dismissed = useRef(new Set<number>());

  const runDismiss = useCallback((toast: Toast | undefined) => {
    if (!toast || dismissed.current.has(toast.id)) return;
    dismissed.current.add(toast.id);
    toast.onDismiss?.();
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      runDismiss(toastsRef.current.find((t) => t.id === id));
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [runDismiss],
  );

  /** Clear every toast of one variant. Alerts take the caller's bulk handler
   * when there is one, and fall back to firing each `onDismiss` — which is
   * correct but is N requests, so it is the fallback and not the path. */
  const dismissAll = useCallback(
    (variant: ToastVariant) => {
      const going = toastsRef.current.filter((t) => t.variant === variant);
      const bulk = variant === "alert" ? bulkDismissAlerts.current : null;
      if (bulk) {
        // The bulk handler covers all of them, so mark them done without
        // firing each one's own.
        going.forEach((t) => dismissed.current.add(t.id));
        bulk();
      } else {
        going.forEach(runDismiss);
      }
      setToasts((prev) => prev.filter((t) => t.variant !== variant));
    },
    [runDismiss],
  );

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = ++nextId.current;
      setToasts((prev) => {
        if (toast.dedupeKey && prev.some((t) => t.dedupeKey === toast.dedupeKey)) return prev;
        return [...prev, { ...toast, id }];
      });
      // Errors and alerts are both things somebody has to act on, so neither
      // expires on a timer.
      if (toast.variant !== "error" && toast.variant !== "alert") {
        window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
      }
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      notify: (message, variant = "info") => push({ message, variant }),
      notifyError: (error, fallback) =>
        push({ message: apiErrorMessage(error, fallback), variant: "error" }),
      notifyAlert: (alert) => {
        if (alert.onDismissAll) bulkDismissAlerts.current = alert.onDismissAll;
        push({
          variant: "alert",
          title: alert.title,
          message: alert.body,
          icon: alert.icon,
          to: alert.to,
          onDismiss: alert.onDismiss,
          dedupeKey: alert.key,
        });
      },
    }),
    [push],
  );

  const alertCount = toasts.filter((t) => t.variant === "alert").length;

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-5 right-5 z-[100] flex max-h-[calc(100vh-2.5rem)] w-[min(24rem,calc(100vw-2.5rem))] flex-col gap-2 overflow-y-auto"
      >
        {alertCount > DISMISS_ALL_THRESHOLD && (
          <button
            type="button"
            onClick={() => dismissAll("alert")}
            className="pointer-events-auto sticky top-0 z-10 flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2 text-[13px] font-bold text-[var(--text-muted)] shadow-[var(--shadow-pop)] transition-colors hover:text-[var(--text-main)]"
          >
            <i className="ri-check-double-line" /> Dismiss all {alertCount} notifications
          </button>
        )}

        {toasts.map((toast) => {
          const style = VARIANT_STYLES[toast.variant];
          const clickable = Boolean(toast.to);
          return (
            <div
              key={toast.id}
              role={toast.variant === "success" || toast.variant === "info" ? "status" : "alert"}
              className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm font-semibold shadow-[var(--shadow-pop)] animate-fade-in-up ${style.wrap}`}
            >
              <i className={`${toast.icon ? `${toast.icon} text-[var(--primary)]` : style.icon} mt-px shrink-0 text-xl`} />

              {/* The body is a button only when there is somewhere to go —
                  a click target that does nothing reads as a broken toast. */}
              <div
                className={`min-w-0 flex-1 leading-relaxed ${clickable ? "cursor-pointer" : ""}`}
                onClick={
                  clickable
                    ? () => {
                        navigate(toast.to!);
                        dismiss(toast.id);
                      }
                    : undefined
                }
              >
                {toast.title && (
                  <span className="block font-bold text-[var(--text-main)]">{toast.title}</span>
                )}
                <span
                  className={`block ${toast.title ? "mt-0.5 text-[var(--text-muted)]" : ""}`}
                >
                  {toast.message}
                </span>
                {clickable && (
                  <span className="mt-1 block text-xs font-semibold text-[var(--primary-text)]">
                    Click to open · ✕ to dismiss
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss"
                className="shrink-0 text-[var(--text-dim)] transition-colors hover:text-[var(--text-main)]"
              >
                <i className="ri-close-line text-lg" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}
