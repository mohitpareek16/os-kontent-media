import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { useInstall } from "@/hooks/usePlatform";

/** "Put Kontent on your home screen."
 *
 * Android / Chrome gets a real install button. iPhone and iPad have no install
 * API — Safari only installs from the Share menu — so those get the three
 * steps. Hidden once the app is running from the home screen. */
export function InstallCard({ onDismiss }: { onDismiss?: () => void }) {
  const install = useInstall();
  const [busy, setBusy] = useState(false);

  if (install.installed) return null;

  return (
    <section
      aria-label="Install the app"
      className="glass-card flex items-start gap-3 border-[var(--primary)] p-4"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-xl font-extrabold text-white">
        K
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-bold text-[var(--text-main)]">Install Kontent on your phone</p>

        {install.canPrompt ? (
          <>
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">
              Opens full screen from your home screen, like any other app.
            </p>
            <Button
              size="sm"
              className="mt-3"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await install.promptInstall();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <i className="ri-download-2-line" /> Install app
            </Button>
          </>
        ) : install.needsManualSteps ? (
          <ol className="mt-1 space-y-1 text-sm text-[var(--text-muted)]">
            <li>
              1. Open this page in <strong>Safari</strong>.
            </li>
            <li>
              2. Tap the <strong>Share</strong> button <i className="ri-share-box-line align-[-2px]" />
            </li>
            <li>
              3. Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
            </li>
          </ol>
        ) : (
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">
            Open your browser menu <i className="ri-more-2-fill align-[-2px]" /> and choose{" "}
            <strong>Install app</strong> or <strong>Add to Home screen</strong>.
          </p>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--text-dim)] hover:bg-[var(--bg-pill)]"
        >
          <i className="ri-close-line text-xl" />
        </button>
      )}
    </section>
  );
}
