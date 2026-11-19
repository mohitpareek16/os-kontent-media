# Kontent Voice Notes — Install Guide

One codebase, two packages. `background/`, `content/`, `popup/` and `icons/`
are shared verbatim; only the manifest differs:

| File | Browser | Background |
| --- | --- | --- |
| `manifest.json` | Chrome / Edge / Brave (MV3) | `service_worker` |
| `manifest.firefox.json` | **Zen** / Firefox (MV3) | `scripts` (event page) |

Zen is a Firefox fork, so it runs Gecko WebExtensions — a Chrome build will
not install in it, and vice-versa.

## Build

```bash
cd extension
./build.sh            # both; or ./build.sh zen | ./build.sh chrome
```

Produces:

```
dist/zen/      dist/kontent-voice-notes-zen.xpi
dist/chrome/   dist/kontent-voice-notes-chrome.zip
```

## Install in Zen

**For testing (no signing, gone on restart):**

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → pick `extension/dist/zen/manifest.json`

**For the team (permanent):** Zen enforces Mozilla's add-on signing, so a
permanent install needs a signed XPI. Sign it as *unlisted* (self-distributed,
not published on AMO) with API keys from
<https://addons.mozilla.org/developers/addon/api/key/>:

```bash
npx web-ext sign --channel=unlisted \
  --source-dir=dist/zen \
  --api-key=<JWT issuer> --api-secret=<JWT secret>
```

The signed `.xpi` lands in `web-ext-artifacts/` — share that file, and
teammates install it by dragging it onto Zen (or via
`about:addons` → gear → *Install Add-on From File…*).

## Install in Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → pick `extension/dist/chrome/`

For the team, upload `dist/kontent-voice-notes-chrome.zip` to the Chrome Web
Store dashboard (or distribute the folder and have everyone load it unpacked).

## First run — both browsers

1. Click the extension icon, type **Your Name** and **Your Email**, hit
   **Save**, then **Confirm & lock**. Saving also asks for permission to reach
   the server — accept it, otherwise uploads fail. The dot turns green when the
   server answers `/api/health`.

   **Identity is set once and cannot be edited afterwards** — both fields go
   read-only, and there is no reset button. Every note carries the name and
   email, and an author who changes halfway through a review is worse than no
   author at all. If someone mistypes, see *Fixing a mistyped identity* below.

   There is no server field: the address is hardcoded as `SERVER_URL` in
   `popup/popup.js` and `background/service-worker.js`. If the server ever
   moves, change it in **both** files and in the `host_permissions` /
   `optional_host_permissions` entries of **both** manifests.
2. Open a Frame.io review page. A purple mic bubble appears **top-right** (drag
   to move — the position is remembered — click to open).
3. First recording triggers Zen/Chrome's microphone prompt for the frame.io
   host — choose **Allow**, and tick *Remember this decision* in Zen.
4. Click any note in the list to jump the video to that moment and hear the
   note over the paused frame. Clicking it again stops.

### Fixing a mistyped identity

The lock is deliberate, so the only way out is to clear the extension's
storage:

- **Zen / Firefox** — `about:debugging#/runtime/this-firefox` → *Inspect* on
  the add-on → in the console run `browser.storage.local.clear()`. A temporary
  add-on also drops its storage when you remove and re-load it.
- **Chrome** — right-click the icon → *Inspect Popup* → console →
  `chrome.storage.local.clear()`.

Then reopen the popup and enter the details again. Notes already recorded keep
the old name — fix those from the Voice Notes admin page.

### If the bubble doesn't appear in Zen

Two things to check, in order:

1. **The host is covered.** The content script only injects on
   `app.frame.io`, `next.frame.io` and `f.io`. Frame.io V4 review links open on
   `next.frame.io` (that's what this app generates); a link on any other host
   gets no bubble. Add the host to `content_scripts.matches` *and*
   `host_permissions` in **both** manifests if a new one shows up.
2. **Permissions are granted.** Firefox MV3 can leave host permissions
   ungranted. Open `about:addons` → *Kontent Voice Notes* → **Permissions** and
   make sure frame.io access is enabled. Then reload the tab.

### If the popup says "Cannot reach server"

Press **Save** once — that click is the user gesture that grants access to the
server origin, and the check re-runs straight after.

The server sits behind a Let's Encrypt cert on `ops.kontentmedia.in` and 301s
every plain-http request, so `SERVER_URL` must stay https on the domain: a
bare-IP URL cannot work — http gets redirected, and https on the IP fails the
certificate hostname check.

### If the popup itself doesn't open

Clicking the toolbar icon opening nothing usually means the popup script threw
before rendering. Right-click the icon → **Inspect Popup** (Chrome) or check
`about:debugging` → *Inspect* (Zen) and read the console. Also confirm the icon
you're clicking is this extension's — in both browsers a temporary add-on often
lands inside the puzzle-piece / extensions menu rather than on the toolbar.

## Gecko-specific notes

Things that had to change for Zen, worth remembering when editing the shared
code:

- **`browser` vs `chrome`.** Every script starts with
  `const api = globalThis.browser ?? globalThis.chrome;`. Firefox's `chrome.*`
  namespace is callback-only, so `await chrome.storage.local.get(...)` silently
  breaks there — always go through `api`.
- **No service worker.** Gecko MV3 uses `background.scripts`. Both contexts are
  ephemeral, so the background still keeps zero state in globals.
- **Mixed content.** The default server is https now, but a self-hosted one may
  not be. Audio is therefore still fetched in the background and handed to the
  page as a `data:` URL (`FETCH_AUDIO`) — never a raw http URL, which Zen would
  block on an https frame.io page.
- **`FileReader` doesn't exist in a Chrome service worker**, so the background
  base64-encodes blobs via `arrayBuffer()` instead.
- **Scrollbars.** `::-webkit-scrollbar` is ignored by Gecko; the notes list also
  sets `scrollbar-width` / `scrollbar-color`.
- **Icons** are rendered from `icons/icon.svg`. To regenerate:
  `for s in 16 32 48 128; do rsvg-convert -w $s -h $s icon.svg -o icon-$s.png; done`

Validate the Gecko build before shipping — it should report 0 errors,
0 warnings:

```bash
npx web-ext lint --source-dir=dist/zen --self-hosted
```
