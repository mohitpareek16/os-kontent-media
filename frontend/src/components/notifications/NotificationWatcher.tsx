import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useToast } from "@/components/ui/Toast";
import {
  UNREAD_WATCH_PARAMS,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/hooks/useNotifications";
import { playNotificationSound, primeNotificationSound } from "@/lib/notificationSound";
import { describeNotification } from "@/lib/notificationText";
import { refreshSubscription } from "@/lib/push";

/** Faster than the 30s the tables poll at. A hand-off you hear about half a
 * minute late is still fine; this is the one query where the delay is the
 * whole point of the feature. */
const POLL_MS = 15_000;

/** Ids already announced, kept across reloads.
 *
 * Without this, every refresh re-announces the whole unread list: you would
 * come back from lunch to eleven chimes for things you had already seen pop
 * this morning. Bounded so a long-lived session cannot grow it forever. */
const SEEN_KEY = "km_seen_notifications";
const SEEN_LIMIT = 300;

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>) {
  try {
    // Newest kept: the tail is what a fresh notification could collide with.
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-SEEN_LIMIT)));
  } catch {
    // Private mode, quota, whatever. Losing the memory means a duplicate
    // chime at worst — not a reason to take the app down.
  }
}

/**
 * Pops every newly-arrived notification as a toast that has to be crossed
 * off, and makes a noise while doing it.
 *
 * Mounted once, in the layout, so it runs on every screen — the point is to
 * reach somebody who is looking at the pipeline table, not at their inbox.
 *
 * Crossing a toast off marks that notification read on the server. That is
 * what stops it coming back: the watcher only ever looks at unread rows, so
 * a toast dismissed without reading it would re-announce itself on the next
 * poll, which is a notification you cannot get rid of.
 *
 * The first poll after a page load is treated as history, not as news —
 * every id in it is recorded as seen without a toast or a sound. Otherwise
 * every refresh would be an alarm.
 */
export function NotificationWatcher() {
  const queryClient = useQueryClient();
  /* The same params the bell's unread count uses, so the two are one query
     and one request — see `UNREAD_WATCH_PARAMS`. Its page size doubles as how
     many unread rows this watches: the toast stack is for what arrived while
     you were looking at the screen, not a second inbox. */
  const { data } = useNotifications(UNREAD_WATCH_PARAMS, { refetchInterval: POLL_MS });
  const toast = useToast();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const seenRef = useRef<Set<string> | null>(null);
  const seededRef = useRef(false);

  /* Browsers refuse to play audio until the user has interacted with the
   * page, and the notification that needs the sound arrives with no gesture
   * behind it. So the audio context is unlocked on the first click or
   * keypress anywhere, whenever that happens to be. */
  useEffect(() => {
    const prime = () => primeNotificationSound();
    window.addEventListener("pointerdown", prime, { once: true });
    window.addEventListener("keydown", prime, { once: true });
    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
  }, []);

  /* The service worker is the fast path now.
   *
   * A push reaches the browser whether or not a timer would have run, so the
   * moment one arrives this refetches the inbox — the toast then appears
   * immediately instead of up to POLL_MS later, and the poll below goes back
   * to being the fallback it should always have been.
   *
   * The worker decides whether we also make a noise. It only sets
   * `playSound` when no window is visible: a page you are looking at gets its
   * chime from the toast path below, and doing both is one event that pings
   * twice. Audio in a hidden tab is not throttled the way `setInterval` is,
   * which is the whole reason this works with the window minimised. */
  /* Re-send this browser's existing subscription on every load.
   *
   * It reads like a no-op and is not: a browser can rotate a subscription,
   * and the server prunes a row the moment a push service answers 410. Both
   * leave somebody who turned alerts on last month quietly receiving nothing.
   * The endpoint upserts, so this costs one request and keeps that promise
   * true. It does nothing at all unless permission is already granted — it
   * never raises a prompt. */
  useEffect(() => {
    void refreshSubscription();
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "kontent-push") return;
      if (event.data.playSound) playNotificationSound();
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [queryClient]);

  useEffect(() => {
    if (!data) return;
    if (!seenRef.current) seenRef.current = loadSeen();
    const seen = seenRef.current;

    const fresh = data.items.filter((n) => !seen.has(n.id));
    data.items.forEach((n) => seen.add(n.id));
    saveSeen(seen);

    // First response of the session: this is the backlog, not an event.
    if (!seededRef.current) {
      seededRef.current = true;
      return;
    }
    if (fresh.length === 0) return;

    // One sound for the batch. A stage change can notify more than one
    // person about more than one thing in the same second, and four chimes
    // on top of each other is noise, not an alert.
    playNotificationSound();

    // Oldest first, so the newest ends up nearest the bottom of the stack
    // where the eye already is.
    [...fresh].reverse().forEach((n) => {
      const { headline, icon } = describeNotification(n);
      toast.notifyAlert({
        key: n.id,
        title: headline,
        // Both lines come off the row now, rendered once on the server, so
        // the toast, the inbox and the OS notification cannot word the same
        // event three ways (`services/notification_text.py`).
        body: n.body,
        icon,
        to: n.pod_id && !n.job_id ? `/pods/${n.pod_id}/brand-assets?history=1` : `/jobs/${n.job_id}`,
        // Dismissing is the acknowledgement. Without this the same row comes
        // back on the next poll, because it is still unread.
        onDismiss: () => markRead.mutate(n.id),
        // Clearing a stack of twenty is one request, not twenty — and it
        // clears the whole inbox, including anything past the rows on screen.
        onDismissAll: () => markAllRead.mutate(),
      });
    });
    // `markRead` and `toast` are stable enough to leave out; re-running this
    // on a new mutation object would re-announce the same batch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return null;
}
