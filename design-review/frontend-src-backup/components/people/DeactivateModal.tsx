import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useOpenWork, useSetAccountActive } from "@/hooks/useUsers";
import { roleLabel } from "@/lib/roles";
import type { User } from "@/types";

/**
 * The confirm step for switching an account off — and, deliberately, the
 * place the consequences are spelled out rather than implied.
 *
 * Deactivation does not touch a single job. It stops the person logging in
 * and takes them out of every picker and out of QC routing, which is exactly
 * what offboarding needs — but the four cuts they were holding stay assigned
 * to them, in the pod, unmoved. That is not a bug to fix here (reassigning a
 * leaver's work is a TL's decision, one job at a time), it is a fact the
 * person pressing the button has to be told, with the number.
 *
 * Reactivation reuses the same dialog: the same authority, the same record,
 * and the same question — "are you sure this is the right row".
 */
export function DeactivateModal({
  person,
  onClose,
}: {
  /** Null closes it. The row being acted on, not an id, because everything
   * here is written in their name and role. */
  person: User | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const setActive = useSetAccountActive();
  const toast = useToast();
  /* Only asked once the dialog is open — it is a question about one row, at
     the moment it matters, not a column on the directory. */
  const { data: openWork, isLoading: loadingWork } = useOpenWork(person?.id ?? null);

  const reactivating = person ? !person.is_active : false;

  const submit = () => {
    if (!person) return;
    setActive.mutate(
      { userId: person.id, active: reactivating, reason },
      {
        onSuccess: () => {
          toast.notify(
            reactivating
              ? `${person.name} can log in again.`
              : `${person.name} has been deactivated. Their history stays on every job they touched.`,
            "success",
          );
          setReason("");
          onClose();
        },
        onError: (error) =>
          toast.notifyError(
            error,
            reactivating
              ? "Could not reactivate this account."
              : "Could not deactivate this account.",
          ),
      },
    );
  };

  const stranded =
    openWork && (openWork.editing > 0 || openWork.reviewing > 0 || openWork.leading_pods > 0);

  return (
    <Modal
      open={Boolean(person)}
      onClose={onClose}
      title={reactivating ? "Reactivate this account" : "Deactivate this account"}
    >
      {person && (
        <div className="space-y-4">
          <div className="rounded-xl bg-[var(--bg-pill)] p-3">
            <p className="text-sm font-bold text-[var(--text-main)]">{person.name}</p>
            <p className="text-xs text-[var(--text-muted)]">
              {roleLabel(person)} · {person.email}
            </p>
          </div>

          {reactivating ? (
            <p className="text-xs text-[var(--text-muted)]">
              They will be able to log in again, and will start appearing in editor pickers and
              QC routing from the next assignment onwards.
            </p>
          ) : (
            <>
              <ul className="space-y-1.5 text-xs text-[var(--text-muted)]">
                <li className="flex items-start gap-1.5">
                  <i className="ri-login-circle-line mt-px text-[var(--accent-red)]" />
                  They can no longer log in.
                </li>
                <li className="flex items-start gap-1.5">
                  <i className="ri-user-forbid-line mt-px text-[var(--accent-red)]" />
                  They drop out of editor pickers and QC routing.
                </li>
                <li className="flex items-start gap-1.5">
                  <i className="ri-history-line mt-px text-[var(--text-dim)]" />
                  Nothing is deleted — every job, review and comment still names them.
                </li>
              </ul>

              {/* The number that actually changes the decision. */}
              {loadingWork ? (
                <p className="text-xs text-[var(--text-dim)]">
                  <i className="ri-loader-4-line animate-spin" /> Checking what they still hold...
                </p>
              ) : stranded ? (
                <div className="rounded-xl bg-[var(--accent-amber-bg)] p-3 text-xs text-[var(--accent-amber)]">
                  <p className="font-bold">
                    <i className="ri-alert-line" /> This work stays with them
                  </p>
                  <p className="mt-1">
                    {[
                      openWork.editing > 0 &&
                        `${openWork.editing} video${openWork.editing === 1 ? "" : "s"} being cut`,
                      openWork.reviewing > 0 &&
                        `${openWork.reviewing} review${openWork.reviewing === 1 ? "" : "s"} in their QC queue`,
                      openWork.leading_pods > 0 &&
                        `${openWork.leading_pods} client pod${openWork.leading_pods === 1 ? "" : "s"} they lead`,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    . Deactivating does not reassign any of it — a TL has to hand it over.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-[var(--text-dim)]">
                  Nothing open is assigned to them right now.
                </p>
              )}
            </>
          )}

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
              Reason <span className="normal-case text-[var(--text-dim)]">(optional)</span>
            </label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder={
                reactivating ? "Rejoined the team" : "Left the company — last day 15 Sep"
              }
            />
            <p className="mt-1 text-[11px] text-[var(--text-dim)]">
              Recorded against your name either way, so the directory can say who did this.
            </p>
          </div>

          <ErrorNote
            error={setActive.error}
            fallback="Could not change this account's status."
          />

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={setActive.isPending}>
              Cancel
            </Button>
            <Button
              variant={reactivating ? "primary" : "danger"}
              onClick={submit}
              disabled={setActive.isPending}
            >
              {setActive.isPending ? (
                <>
                  <i className="ri-loader-4-line animate-spin" /> Saving...
                </>
              ) : reactivating ? (
                <>
                  <i className="ri-user-follow-line" /> Reactivate {person.name.split(" ")[0]}
                </>
              ) : (
                <>
                  <i className="ri-forbid-2-line" /> Deactivate {person.name.split(" ")[0]}
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
