import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

import { useFocusTrap } from "@/hooks/useFocusTrap";

type ModalSize = "sm" | "lg" | "xl" | "full";

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: "max-w-lg",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
  full: "max-w-[min(90vw,1280px)]",
};

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: ModalSize;
}

export function Modal({ open, onClose, title, children, size = "sm" }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

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
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/50"
      onMouseDown={(e) => {
        // Backdrop click closes; clicks inside the dialog never reach here.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="pointer-events-none flex min-h-full items-center justify-center p-4 text-center">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={`pointer-events-auto flex w-full flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-6 text-left shadow-[var(--shadow-pop)] animate-[fadeIn_0.2s_ease-out] ${SIZE_CLASSES[size]}`}
        >
          <div className="mb-4 flex shrink-0 items-center justify-between gap-4">
            <h2 id={titleId} className="text-lg font-bold text-[var(--text-main)]">
              {title}
            </h2>
            <button
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-dim)] transition-colors hover:bg-[var(--bg-pill)] hover:text-[var(--text-main)]"
              onClick={onClose}
              aria-label="Close"
            >
              <i className="ri-close-line text-xl" />
            </button>
          </div>
          <div>{children}</div>
        </div>
      </div>
    </div>
  );
}
