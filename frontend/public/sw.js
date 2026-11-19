/* Kontent OS service worker — the part of the app that runs when the app
 * is not open.
 *
 * It exists for exactly one thing: receiving a push and turning it into a
 * notification the operating system shows. It deliberately does not cache
 * anything, intercept any fetch, or make the app work offline. A service
 * worker that serves stale assets is how a deploy ships to half the team,
 * and nobody here asked for offline.
 *
 * Plain JavaScript in `public/`, not TypeScript through the bundler: it has
 * to be served from the site root at a stable path (`/sw.js`) for its scope
 * to cover the whole app, and a hashed filename cannot be that. It has no
 * imports for the same reason — everything it needs is in the push payload,
 * which the server built with `services/notification_text.py`, so the
 * sentence in an OS notification is the same sentence as in the inbox.
 *
 * Nothing here plays a sound directly — a service worker cannot; it has no
 * audio context. Two things make the noise:
 *   1. The OS notification itself, with whatever sound Windows or macOS is
 *      set to use. A web page cannot choose that one.
 *   2. Our own chime, played by a *page* that is still open. Chrome throttles
 *      background timers, which is why polling failed, but it does not
 *      throttle audio — so a minimised window with a tab open still rings
 *      properly. That is what the postMessage below is for.
 */

self.addEventListener("install", () => {
  // Take over immediately rather than waiting for every tab to close. This
  // worker has no cached assets that a half-updated client could disagree
  // with, and waiting would mean a fresh deploy did not deliver notifications
  // until everyone had quit the app.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/* A pass-through fetch handler. It never calls `respondWith`, so every request
 * goes to the network exactly as before and nothing is cached — it exists only
 * because some Android Chrome versions treat a service worker without one as
 * "not installable" and hide the Install App option. */
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A payload we cannot read is still worth surfacing — something happened
    // and this person was meant to know about it.
  }

  const title = payload.title || "Kontent OS";
  const options = {
    body: payload.body || "Something needs your attention.",
    // The notification's own id from the server. Two deliveries of one event
    // — a push and, seconds later, the in-app poll — collapse onto each other
    // instead of stacking up as duplicates.
    tag: payload.tag || "kontent-os",
    renotify: true,
    // This app notifies about work landing on somebody's plate: a hand-off, a
    // change list, a scrapped project. None of those should quietly time out
    // on screen while the person is away from the desk.
    requireInteraction: true,
    icon: "/icons/icon-192.png",
    badge: "/icons/favicon-32.png",
    data: { url: payload.url || "/notifications" },
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);

      // Ask any open page to play the chime — but only if none of them is
      // actually on screen. A visible tab gets its own toast and its own
      // sound from the poll; chiming here as well would double it.
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const anyVisible = clients.some((c) => c.visibilityState === "visible");
      for (const client of clients) {
        client.postMessage({
          type: "kontent-push",
          // A hidden page plays the sound. A visible one just refreshes its
          // inbox, so the toast appears now rather than up to 15s later.
          playSound: !anyVisible,
        });
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/notifications";

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Focus a tab that is already open and steer it, rather than opening a
      // fourth copy of the app. Somebody who clicks five notifications should
      // not end up with five windows.
      for (const client of clients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(target);
            } catch {
              // Cross-origin or a client that refuses to navigate. Being
              // focused on the app is most of the way there.
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })()
  );
});
