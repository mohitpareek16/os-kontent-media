import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

import { useFocusTrap } from "@/hooks/useFocusTrap";

type DrawerWidth = "md" | "lg";

const WIDTH_CLASSES: Record<DrawerWidth, string> = {
  md: "max-w-md",
  lg: "max-w-2xl",
};

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Rendered inside the sticky header — a plain title, or richer content
   * (code + stage badge) when the caller needs it. */
  header: ReactNode;
  children: ReactNode;
  /** Pinned to the bottom, outside the scroll area — action bars belong
   * here so they stay reachable on a long panel. */
  footer?: ReactNode;
  width?: DrawerWidth;
}

/** Side panel that slides in from the right. Domain-blind on purpose: it
 * knows nothing about jobs, so the next thing that needs an inspector
 * (a pod, an editor's queue) reuses it instead of copying it. */
export function Drawer({ open, onClose, header, children, footer, width = "lg" }: DrawerProps) {
  const labelId = useId();
  const panelRef = useRef<HTMLElement>(null);
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end max-md:items-end">
      <div
        className="absolute inset-0 bg-black/50 animate-[fadeIn_0.15s_ease-out]"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
        className={`relative flex h-full w-full ${WIDTH_CLASSES[width]} flex-col border-l border-[var(--border-color)] bg-[var(--bg-card)] shadow-[var(--shadow-pop)] animate-[slideInRight_0.22s_cubic-bezier(0.16,1,0.3,1)] max-md:h-auto max-md:max-h-[92dvh] max-md:max-w-none max-md:animate-[slideInUp_0.25s_cubic-bezier(0.16,1,0.3,1)] max-md:rounded-t-3xl max-md:border-l-0 max-md:border-t`}
      >
        <header className="flex shrink-0 flex-col border-b border-[var(--border-color)] bg-[var(--bg-card)] max-md:rounded-t-3xl">
          <span aria-hidden className="mx-auto mt-2 h-1 w-9 rounded-full bg-[var(--border-color)] md:hidden" />
          <div className="flex items-start justify-between gap-4 px-6 py-4">
          <div id={labelId} className="min-w-0 flex-1">
            {header}
          </div>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--text-dim)] transition-colors hover:bg-[var(--bg-pill)] hover:text-[var(--text-main)]"
          >
            <i className="ri-close-line text-xl" />
          </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[var(--bg-app)] px-4 py-5 md:px-6" style={{ paddingBottom: "max(1.25rem, var(--safe-bottom))" }}>{children}</div>

        {footer && (
          <footer className="shrink-0 border-t border-[var(--border-color)] bg-[var(--bg-card)] px-6 py-4" style={{ paddingBottom: "max(1rem, var(--safe-bottom))" }}>
            {footer}
          </footer>
        )}
      </aside>
    </div>
  );
}
