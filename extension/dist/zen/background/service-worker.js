/**
 * Kontent Voice Notes — Background Script
 *
 * Runs as a service worker on Chrome (MV3) and as an event page on
 * Firefox/Zen (MV3 `background.scripts`).  Both are ephemeral, so state is
 * never stored in global variables — we read/write storage.local instead.
 *
 * All network requests from the content script are routed through here,
 * because the background context is not bound by the page's CORS or
 * mixed-content rules.  The content script sends messages; this script
 * handles them and relays back the response.
 */

// Firefox exposes the promise-based `browser` namespace; Chrome only `chrome`.
const api = globalThis.browser ?? globalThis.chrome;

// The one team server.  Kept in sync with popup/popup.js — the two contexts
// are separate scripts and Chrome's MV3 service worker can't share a plain
// module with the popup.  Must stay https on the domain: the server 301s
// plain http, and the bare IP fails the TLS hostname check.
const SERVER_URL = 'https://ops.kontentmedia.in';

// ── Message router ─────────────────────────────────────────────────────

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = MESSAGE_HANDLERS[message.type];
  if (!handler) return;

  (async () => {
    try {
      const result = await handler(message, sender);
      sendResponse({ ok: true, data: result });
    } catch (err) {
      console.error(`[KVN-SW] ${message.type} failed:`, err);
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();

  return true; // keeps the channel open for the async response
});


// ── Helpers ────────────────────────────────────────────────────────────

/** Name + email the reviewer locked in once via the popup. */
async function getIdentity() {
  const { kvn_user_name, kvn_user_email } = await api.storage.local.get([
    'kvn_user_name',
    'kvn_user_email',
  ]);
  return { name: kvn_user_name || null, email: kvn_user_email || null };
}

/**
 * Base64-encodes a Blob without FileReader — that API does not exist inside
 * a Chrome service worker, so we go through an ArrayBuffer instead.
 */
async function blobToDataUrl(blob, fallbackType) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000; // stay under the argument limit of String.fromCharCode
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return `data:${blob.type || fallbackType};base64,${btoa(binary)}`;
}


// ── Message handlers ───────────────────────────────────────────────────

const MESSAGE_HANDLERS = {

  /**
   * UPLOAD_NOTE — multipart upload of audio + metadata.
   * message.payload: { videoUrl, videoTitle, timestampSeconds, durationSeconds, audioBase64, mimeType }
   */
  async UPLOAD_NOTE(message) {
    const p = message.payload;
    const identity = await getIdentity();

    // Convert base64 audio back to a Blob.
    const raw = atob(p.audioBase64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const blob = new Blob([bytes], { type: p.mimeType || 'audio/webm' });

    // Firefox may record ogg/opus where Chrome records webm — name the part
    // after whatever MediaRecorder actually produced.
    // (These are the extensions _safe_ext() accepts in voice_notes.py.)
    const ext = (p.mimeType || '').includes('ogg') ? 'ogg'
      : (p.mimeType || '').includes('mp4') ? 'm4a'
      : 'webm';

    const form = new FormData();
    form.append('audio', blob, `voice-note.${ext}`);
    form.append('video_url', p.videoUrl);
    if (p.videoTitle) form.append('video_title', p.videoTitle);
    form.append('timestamp_seconds', String(p.timestampSeconds || 0));
    form.append('duration_seconds', String(p.durationSeconds || 0));
    if (identity.name) form.append('recorded_by', identity.name);
    if (identity.email) form.append('recorded_by_email', identity.email);

    const res = await fetch(`${SERVER_URL}/api/voice-notes/`, {
      method: 'POST',
      body: form,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upload failed (${res.status}): ${text}`);
    }

    return await res.json();
  },

  /**
   * FETCH_NOTES — get all notes for a video URL.
   * message.payload: { videoUrl }
   */
  async FETCH_NOTES(message) {
    const url = `${SERVER_URL}/api/voice-notes/?video_url=${encodeURIComponent(message.payload.videoUrl)}`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`Fetch notes failed (${res.status})`);
    }

    return await res.json();
  },

  /**
   * DELETE_NOTE — delete a single note by ID.
   * message.payload: { noteId }
   */
  async DELETE_NOTE(message) {
    const res = await fetch(`${SERVER_URL}/api/voice-notes/${message.payload.noteId}`, {
      method: 'DELETE',
    });

    if (!res.ok && res.status !== 204) {
      throw new Error(`Delete failed (${res.status})`);
    }

    return true;
  },

  /**
   * FETCH_AUDIO — downloads a note's audio and returns it as a data: URL.
   *
   * We deliberately do not hand the raw server URL to the content script.
   * Fetching here and passing back a data: URL means the audio rides on the
   * permission this extension already holds, instead of the frame.io page
   * having to reach the server itself.
   *
   * message.payload: { noteId }
   */
  async FETCH_AUDIO(message) {
    const res = await fetch(`${SERVER_URL}/api/voice-notes/${message.payload.noteId}/audio`);

    if (!res.ok) {
      throw new Error(`Fetch audio failed (${res.status})`);
    }

    return await blobToDataUrl(await res.blob(), 'audio/webm');
  },

  /**
   * BROADCAST_SEEK — ask every frame of the sender's tab to seek its player.
   *
   * The panel and the player need not live in the same document: the content
   * script runs in all frames, so the reviewer may be clicking the top page's
   * bubble while Frame.io renders the video inside a child frame.  A content
   * script cannot talk to its siblings, so the round trip goes through here.
   *
   * message.payload: { seconds }
   */
  async BROADCAST_SEEK(message, sender) {
    const tabId = sender?.tab?.id;
    if (tabId === undefined) return { result: null };

    // No frameId — this fans out to every frame in the tab. Frames holding no
    // player stay silent (only one reply is ever kept, and a fast "nothing
    // here" would beat the answer that matters), so whatever comes back is
    // from a frame that really has the video.
    const reply = await api.tabs.sendMessage(tabId, {
      type: 'KVN_SEEK',
      payload: { seconds: message.payload.seconds },
    }).catch(() => null); // no frame responded

    return { result: reply || null };
  },

  /**
   * GET_CONFIG — returns server URL and reviewer identity for the content
   * script.
   */
  async GET_CONFIG() {
    const identity = await getIdentity();
    return {
      serverUrl: SERVER_URL,
      userName: identity.name,
      userEmail: identity.email,
    };
  },
};
