import type { ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Modal } from "@/components/ui/Modal";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What actually happens, in plain language — not "are you sure?". */
  description: ReactNode;
  confirmLabel: string;
  confirmIcon?: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
  /** Rendered inside the dialog so a rejected action explains itself where
   * the user is looking, instead of closing and losing the message. */
  error?: unknown;
  errorFallback?: string;
  variant?: "danger" | "primary";
}

/** One confirm step for every destructive action — deactivating an account,
 * churning a client, removing a pod member. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmIcon = "ri-alert-line",
  onConfirm,
  onCancel,
  pending = false,
  error,
  errorFallback = "That didn't go through.",
  variant = "danger",
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-[var(--border-color-subtle)] bg-[var(--bg-pill)] p-3">
          <i
            className={`${variant === "danger" ? "ri-error-warning-line text-[var(--accent-red)]" : "ri-information-line text-[var(--primary)]"} mt-0.5 text-base`}
          />
          <div className="text-xs leading-relaxed text-[var(--text-muted)]">{description}</div>
        </div>

        <ErrorNote error={error} fallback={errorFallback} />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button variant={variant} onClick={onConfirm} disabled={pending}>
            {pending ? (
              <>
                <i className="ri-loader-4-line animate-spin" /> Working...
              </>
            ) : (
              <>
                <i className={confirmIcon} /> {confirmLabel}
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
