import { useEffect, useState } from "react";

import { sendTestPush } from "@/api/notifications";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import {
  currentPushState,
  disablePush,
  enablePush,
  type PushState,
} from "@/lib/push";

/**
 * Turning desktop notifications on, and — the part that makes this worth
 * having — proving to yourself that they work.
 *
 * The test button exists because the only state worth testing is the one you
 * cannot test by pressing a button: the window minimised, the app behind
 * Premiere. So the alert is sent five seconds late, and the copy says to get
 * out of the way. Anything shorter is a test of a visible window; anything
 * much longer is a test nobody runs twice.
 *
 * It also says plainly what the browser will and will not do about sound,
 * because the alternative is somebody testing it three times and concluding
 * the feature is broken when it is doing exactly what it can.
 */
export function DesktopAlerts({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    void currentPushState().then(setState);
  }, []);

  const toggle = async () => {
    setBusy(true);
    try {
      const next = state === "on" ? await disablePush() : await enablePush();
      setState(next);
      if (next === "on") {
        toast.notify("Desktop alerts are on for this browser.", "success");
      } else if (next === "blocked") {
        toast.notify(
          "Your browser is blocking notifications for this site. Turn them back on in the padlock menu next to the address bar.",
          "info",
        );
      }
    } catch (error) {
      toast.notifyError(error, "Could not change desktop alerts.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const result = await sendTestPush(5);
      toast.notify(
        result.sent_to > 0
          ? `Minimise this window now — the alert lands in ${result.delay_seconds} seconds.`
          : "No browsers are registered for alerts on this account yet.",
        result.sent_to > 0 ? "success" : "info",
      );
    } catch (error) {
      toast.notifyError(error, "Could not send the test alert.");
    } finally {
      setTesting(false);
    }
  };

  if (state === null) return null;

  if (state === "unsupported") {
    return (
      <p className="text-xs text-[var(--text-dim)]">
        This browser cannot do desktop notifications. The in-app alerts still work while the app
        is open.
      </p>
    );
  }

  if (state === "unconfigured") {
    return (
      <p className="text-xs text-[var(--text-dim)]">
        Desktop alerts are not set up on this server yet.
      </p>
    );
  }

  const on = state === "on";

  return (
    <div className={compact ? "space-y-2" : "glass-card space-y-3 p-4"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-main)]">
            <i
              className={
                on
                  ? "ri-notification-3-fill text-[var(--accent-green)]"
                  : "ri-notification-off-line text-[var(--text-dim)]"
              }
            />
            Desktop alerts
          </p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            {state === "blocked" ? (
              <>
                Blocked in this browser. Open the padlock menu next to the address bar and allow
                notifications — nothing here can undo it for you.
              </>
            ) : on ? (
              <>Reaching you on this browser, even with the window minimised.</>
            ) : (
              <>Get told about a hand-off while the app is behind something else.</>
            )}
          </p>
        </div>

        {state !== "blocked" && (
          <Button
            variant={on ? "ghost" : "primary"}
            className="!px-2.5 !py-1.5 !text-xs"
            onClick={toggle}
            disabled={busy}
          >
            {busy ? (
              <>
                <i className="ri-loader-4-line animate-spin" /> Working...
              </>
            ) : on ? (
              <>
                <i className="ri-notification-off-line" /> Turn off
              </>
            ) : (
              <>
                <i className="ri-notification-3-line" /> Turn on
              </>
            )}
          </Button>
        )}
      </div>

      {on && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="!px-2.5 !py-1.5 !text-xs"
              onClick={test}
              disabled={testing}
            >
              {testing ? (
                <>
                  <i className="ri-loader-4-line animate-spin" /> Sending...
                </>
              ) : (
                <>
                  <i className="ri-volume-up-line" /> Send me a test alert in 5 seconds
                </>
              )}
            </Button>
            <span className="text-xs text-[var(--text-dim)]">Then minimise this window.</span>
          </div>

          {/* Said once, plainly, rather than left for somebody to work out by
              testing it three times. A web page genuinely cannot pick the
              sound Windows plays — only whether a page of ours is open to
              play its own on top. */}
          <p className="text-xs leading-relaxed text-[var(--text-dim)]">
            With the app open in a tab you get our chime as well as the system sound, even
            minimised. With every tab closed you get the system notification sound only — a
            website cannot choose that one. If you hear nothing at all, check that Focus assist
            (Do not disturb) is off in Windows.
          </p>
        </>
      )}
    </div>
  );
}
