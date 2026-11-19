import {
  fetchPushKey,
  subscribeToPush,
  unsubscribeFromPush,
  type PushSubscriptionPayload,
} from "@/api/notifications";

/**
 * Desktop notifications — registering for them, and the browser-facing half
 * of turning them on and off.
 *
 * The problem this solves is specific. The in-app chime is raised by a
 * 15-second poll, and Chrome throttles a background tab's timers to about
 * once a minute — harder once the window is minimised. So the alert fires
 * reliably when you are already looking at the app and unreliably when you
 * are not, which is exactly backwards. Push is an out-of-band wake-up: the
 * push service reaches the service worker whether or not a tab is open, and
 * whether or not any timer would have run.
 *
 * What it cannot do, so nobody has to discover it by testing: **the browser
 * does not choose the sound.** `Notification.sound` is not implemented in
 * Chrome and a service worker has no audio context, so an OS notification
 * plays whatever Windows or macOS is set to play. Our own, louder chime comes
 * from a page — which still works with the window minimised, because audio is
 * not throttled the way timers are. So: app open somewhere, window minimised
 * → OS notification *and* our chime. Every tab closed → OS notification with
 * the system sound only.
 */

export type PushState =
  /** This browser cannot do it at all — no service workers, no PushManager. */
  | "unsupported"
  /** The server has no VAPID keys configured. */
  | "unconfigured"
  /** Supported and configured; nobody has been asked yet. */
  | "off"
  /** Registered and receiving. */
  | "on"
  /** The person said no, in the browser. Only they can undo it, in site
   * settings — asking again does nothing, which is why the UI has to say so
   * rather than offering the button again. */
  | "blocked";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Register the worker, or return the one already running.
 *
 * Idempotent: the browser returns the existing registration for the same
 * scope, so calling this on every load costs nothing.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    // A worker that will not register means no desktop alerts. The in-app
    // toast is unaffected, so this is not worth breaking the app over.
    return null;
  }
}

/** Where this browser stands right now, without asking it for anything. */
export async function currentPushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const { enabled } = await fetchPushKey();
  if (!enabled) return "unconfigured";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";

  const registration = await navigator.serviceWorker.getRegistration("/");
  const existing = await registration?.pushManager.getSubscription();
  return existing ? "on" : "off";
}

/**
 * Ask for permission, subscribe, and tell the server.
 *
 * The prompt is raised here — from a button click — and never on load.
 * Chrome permanently penalises an origin that asks cold, and a permission
 * somebody dismissed without reading is one they cannot be asked for again.
 */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";

  const { public_key: publicKey, enabled } = await fetchPushKey();
  if (!enabled || !publicKey) return "unconfigured";

  const permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "off";

  const registration = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  if (!registration) return "unsupported";

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      // Required by Chrome, and honest: every push this app sends results in
      // a notification somebody sees. Silent pushes are what the flag exists
      // to stop, and we do not want one.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  await subscribeToPush(toPayload(subscription));
  return "on";
}

/** Unsubscribe this browser, and forget it server-side.
 *
 * Both halves, in that order. Dropping only the server row leaves the browser
 * holding a subscription nothing will ever push to; dropping only the browser
 * one leaves a row that fails forever until a 410 prunes it.
 */
export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await unsubscribeFromPush(toPayload(subscription)).catch(() => {});
    await subscription.unsubscribe().catch(() => {});
  }
  return Notification.permission === "denied" ? "blocked" : "off";
}

/**
 * Re-register a browser that is already subscribed.
 *
 * Called on every load, for the case that reads as a bug and is not: a
 * subscription can be rotated by the browser, and the database row can be
 * pruned after a 410. Re-sending the current one is cheap (the endpoint
 * upserts on `endpoint`) and it is what keeps "I turned this on last month"
 * true today.
 */
export async function refreshSubscription(): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await subscribeToPush(toPayload(subscription)).catch(() => {});
}

function toPayload(subscription: PushSubscription): PushSubscriptionPayload {
  // `toJSON()` is the only way to read the keys — they are not exposed as
  // properties, and `getKey()` returns raw ArrayBuffers that would have to be
  // base64ed by hand.
  const json = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  return {
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
    user_agent: navigator.userAgent.slice(0, 400),
  };
}

/** The VAPID key travels as url-safe base64 and `applicationServerKey` wants
 * bytes. Padding has to be put back before `atob` will take it — this is the
 * standard dance, and getting it wrong fails as an opaque
 * `InvalidAccessError` at subscribe time rather than anywhere near here. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  // The buffer is allocated explicitly so its type is `ArrayBuffer` rather
  // than `ArrayBufferLike` — `applicationServerKey` will not take a view that
  // might be over a SharedArrayBuffer.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}
