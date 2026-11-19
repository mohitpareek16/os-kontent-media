import type { ReactNode } from "react";

type ModalSize = "sm" | "lg" | "xl" | "full";

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: "max-w-lg",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
  full: "max-w-[90vw]",
};

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: ModalSize;
}

export function Modal({ open, onClose, title, children, size = "sm" }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-sm">
      <div className="flex min-h-full items-center justify-center p-4 text-center">
        <div className={`bg-[var(--bg-card-hover)] border border-[var(--border-color)] rounded-2xl shadow-2xl w-full ${SIZE_CLASSES[size]} animate-[fadeIn_0.2s_ease-out] p-6 flex flex-col text-left`} style={{ background: "var(--bg-card-hover)" }}>
          <div className="mb-4 flex items-center justify-between shrink-0">
            <h2 className="text-base font-bold text-[var(--text-main)]">{title}</h2>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-dim)] transition-colors hover:bg-[var(--bg-pill)] hover:text-[var(--text-main)]"
              onClick={onClose}
              aria-label="Close"
            >
              <i className="ri-close-line text-lg" />
            </button>
          </div>
          <div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
