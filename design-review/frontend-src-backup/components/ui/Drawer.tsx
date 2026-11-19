import { useEffect } from "react";
import type { ReactNode } from "react";

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
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px] animate-[fadeIn_0.15s_ease-out]"
        onClick={onClose}
      />

      <aside
        className={`relative flex h-full w-full ${WIDTH_CLASSES[width]} flex-col border-l border-[var(--border-color)] bg-[var(--bg-app)] shadow-2xl animate-[slideInRight_0.22s_cubic-bezier(0.16,1,0.3,1)]`}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border-color)] bg-[var(--bg-header)] px-6 py-4 backdrop-blur-md">
          <div className="min-w-0 flex-1">{header}</div>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-dim)] transition-colors hover:bg-[var(--bg-pill)] hover:text-[var(--text-main)]"
          >
            <i className="ri-close-line text-lg" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {footer && (
          <footer className="shrink-0 border-t border-[var(--border-color)] bg-[var(--bg-header)] px-6 py-4 backdrop-blur-md">
            {footer}
          </footer>
        )}
      </aside>
    </div>
  );
}
