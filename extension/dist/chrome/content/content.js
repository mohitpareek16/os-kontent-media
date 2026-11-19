/**
 * Kontent Voice Notes — Content Script
 *
 * Injected into Frame.io review pages.  Creates a draggable floating bubble
 * that lets reviewers record voice notes with timestamps.
 *
 * Architecture:
 *   - All UI is inside a Shadow DOM (isolation from Frame.io styles).
 *   - Audio recording uses the MediaRecorder API (microphone).
 *   - Network calls go through the background script via runtime.sendMessage().
 *   - Video timestamp is read directly from the <video> element on the page.
 *
 * Runs unchanged on Chrome and on Firefox/Zen.
 */

(function () {
  'use strict';

  // Guard: only run once, and only on pages that look like a review page.
  if (document.getElementById('kvn-root')) return;

  // Firefox exposes the promise-based `browser` namespace; Chrome only `chrome`.
  const api = globalThis.browser ?? globalThis.chrome;

  // ── State ──────────────────────────────────────────────────────────

  let videoEl = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingStartTime = 0;
  let recordTimerInterval = null;
  let capturedTimestamp = 0;
  let notes = [];
  let panelOpen = false;
  let isRecording = false;

  // ── Shadow DOM host ────────────────────────────────────────────────

  const host = document.createElement('div');
  host.id = 'kvn-root';
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'closed' });

  // Inject styles directly into shadow DOM
  const style = document.createElement('style');
  style.textContent = STYLES();
  shadow.appendChild(style);

  // ── Build UI ───────────────────────────────────────────────────────

  const container = document.createElement('div');
  container.className = 'kvn-container';
  shadow.appendChild(container);

  // — Floating bubble —
  const bubble = document.createElement('button');
  bubble.className = 'kvn-bubble';
  bubble.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
  bubble.title = 'Kontent Voice Notes';
  container.appendChild(bubble);

  // — Notes panel —
  const panel = document.createElement('div');
  panel.className = 'kvn-panel';
  panel.innerHTML = `
    <div class="kvn-panel-header">
      <div class="kvn-panel-title">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
        Voice Notes
      </div>
      <div class="kvn-header-actions">
        <button class="kvn-export-btn" id="kvn-export-btn" disabled>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span id="kvn-export-label">Export</span>
        </button>
        <button class="kvn-panel-close" id="kvn-close-btn">&times;</button>
      </div>
    </div>
    <div class="kvn-recorder" id="kvn-recorder">
      <div class="kvn-timestamp-display" id="kvn-ts-display">
        Video: <span id="kvn-current-ts">0:00</span>
      </div>
      <button class="kvn-record-btn" id="kvn-record-btn">
        <span class="kvn-rec-dot"></span>
        <span id="kvn-record-label">Record Note</span>
      </button>
      <div class="kvn-record-timer" id="kvn-record-timer" style="display:none">
        <span class="kvn-rec-pulse"></span>
        <span id="kvn-timer-text">0:00</span>
      </div>
    </div>
    <div class="kvn-notes-list" id="kvn-notes-list">
      <div class="kvn-notes-empty" id="kvn-empty-msg">No voice notes yet for this video</div>
    </div>
    <div class="kvn-status" id="kvn-status"></div>
  `;
  container.appendChild(panel);

  // ── Element refs ───────────────────────────────────────────────────

  const closeBtn = panel.querySelector('#kvn-close-btn');
  const exportBtn = panel.querySelector('#kvn-export-btn');
  const exportLabel = panel.querySelector('#kvn-export-label');
  const recordBtn = panel.querySelector('#kvn-record-btn');
  const recordLabel = panel.querySelector('#kvn-record-label');
  const recordTimer = panel.querySelector('#kvn-record-timer');
  const timerText = panel.querySelector('#kvn-timer-text');
  const currentTsEl = panel.querySelector('#kvn-current-ts');
  const notesList = panel.querySelector('#kvn-notes-list');
  const emptyMsg = panel.querySelector('#kvn-empty-msg');
  const statusEl = panel.querySelector('#kvn-status');

  // ── Draggable bubble ───────────────────────────────────────────────

  let isDragging = false;
  let dragStartX, dragStartY, bubbleStartX, bubbleStartY;
  // Default position: top-right corner, clear of Frame.io's own player
  // controls along the bottom of the page.
  const BUBBLE_SIZE = 56;
  const BUBBLE_MARGIN = 20;
  let bubbleX = window.innerWidth - BUBBLE_SIZE - BUBBLE_MARGIN;
  let bubbleY = BUBBLE_MARGIN;
  placeBubble();

  function placeBubble() {
    // Clamp on every move so a resize (or a restored position from a wider
    // window) can't strand the bubble off-screen.
    bubbleX = Math.max(0, Math.min(window.innerWidth - BUBBLE_SIZE, bubbleX));
    bubbleY = Math.max(0, Math.min(window.innerHeight - BUBBLE_SIZE, bubbleY));
    bubble.style.left = bubbleX + 'px';
    bubble.style.top = bubbleY + 'px';
  }

  // Restore where this reviewer last dragged it.
  (async () => {
    try {
      const { kvn_bubble_pos } = await api.storage.local.get('kvn_bubble_pos');
      if (kvn_bubble_pos && typeof kvn_bubble_pos.x === 'number') {
        bubbleX = kvn_bubble_pos.x;
        bubbleY = kvn_bubble_pos.y;
        placeBubble();
      }
    } catch { /* storage unavailable — the default corner is fine */ }
  })();

  window.addEventListener('resize', () => {
    placeBubble();
    if (panelOpen) positionPanel();
  });

  bubble.addEventListener('pointerdown', (e) => {
    isDragging = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    bubbleStartX = bubbleX;
    bubbleStartY = bubbleY;
    bubble.setPointerCapture(e.pointerId);
  });

  bubble.addEventListener('pointermove', (e) => {
    if (!bubble.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) isDragging = true;
    if (isDragging) {
      bubbleX = bubbleStartX + dx;
      bubbleY = bubbleStartY + dy;
      placeBubble();
      positionPanel();
    }
  });

  bubble.addEventListener('pointerup', (e) => {
    bubble.releasePointerCapture(e.pointerId);
    if (isDragging) {
      // Remember it, so the bubble doesn't jump back to the corner on the
      // next page in the review.
      api.storage.local.set({ kvn_bubble_pos: { x: bubbleX, y: bubbleY } })
        .catch(() => { /* not worth surfacing */ });
    } else {
      togglePanel();
    }
  });

  closeBtn.addEventListener('click', () => togglePanel(false));

  // ── Panel positioning ──────────────────────────────────────────────

  const PANEL_W = 340;
  const PANEL_H = 480;

  function positionPanel() {
    // Panel opens toward the center of the screen from the bubble, then is
    // clamped — from the default top-right corner it drops down-and-left, and
    // from a bubble dragged near an edge it stays on screen either way.
    const openLeft = bubbleX > window.innerWidth / 2;
    const openUp = bubbleY > window.innerHeight / 2;
    const left = openLeft ? bubbleX - (PANEL_W - 10) : bubbleX + BUBBLE_SIZE + 9;
    const top = openUp ? bubbleY + BUBBLE_SIZE - PANEL_H : bubbleY;

    panel.style.left = Math.max(8, Math.min(window.innerWidth - PANEL_W - 8, left)) + 'px';
    panel.style.top = Math.max(8, Math.min(window.innerHeight - PANEL_H - 8, top)) + 'px';
  }

  function togglePanel(force) {
    panelOpen = force !== undefined ? force : !panelOpen;
    panel.classList.toggle('kvn-panel-open', panelOpen);
    if (panelOpen) {
      positionPanel();
      loadNotes();
      startTimestampPolling();
    } else {
      stopTimestampPolling();
      // Closing the panel silences whatever note was playing — otherwise it
      // keeps talking over a video you can no longer see it attached to.
      stopPlayback();
    }
  }

  // ── Video element detection ────────────────────────────────────────

  /**
   * Every <video> in this document, including the ones inside open shadow
   * roots.  `document.querySelector('video')` cannot see through a shadow
   * boundary, and Frame.io's V4 player mounts inside one.
   */
  function collectVideos(root, out) {
    for (const v of root.querySelectorAll('video')) out.push(v);
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) collectVideos(el.shadowRoot, out);
    }
    return out;
  }

  /**
   * How likely this element is to be the player the reviewer is watching.
   *
   * Frame.io's review page holds several <video> elements at once — the
   * hover-scrub thumbnails in the asset rail, comment attachments, and a
   * hidden preloader for the next asset.  `querySelector('video')` returned
   * whichever came first in the DOM, and seeking a 0×0 thumbnail looks
   * exactly like "clicking the note does nothing".
   */
  function scoreVideo(v) {
    const rect = v.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area < 2500) return -1; // thumbnails and display:none stubs

    const style = getComputedStyle(v);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return -1;

    let score = area;
    if (Number.isFinite(v.duration) && v.duration > 0) score *= 4; // real media, not a poster
    if (v.readyState >= 1) score *= 2;
    if (!v.paused) score *= 2;      // the one actually being watched
    if (v.currentTime > 0) score *= 1.5;
    return score;
  }

  // A deep scan walks every element in the page, so it is not something to do
  // on the 250 ms timestamp poll — the cached element is re-validated instead
  // and only a detached (or newly beaten) one triggers another sweep.
  let lastVideoScan = 0;
  const VIDEO_RESCAN_MS = 1000;

  function findVideo(force) {
    const cached = videoEl && videoEl.isConnected && scoreVideo(videoEl) > 0 ? videoEl : null;
    if (cached && !force) return cached;
    if (!force && Date.now() - lastVideoScan < VIDEO_RESCAN_MS) return null;

    lastVideoScan = Date.now();
    let best = null;
    let bestScore = 0;
    for (const v of collectVideos(document, [])) {
      const score = scoreVideo(v);
      if (score > bestScore) { best = v; bestScore = score; }
    }
    videoEl = best;
    return videoEl;
  }

  // ── Seeking ────────────────────────────────────────────────────────

  // Frame rate on a 24 fps cut is ~42 ms; anything inside a tenth of a second
  // landed on the intended frame.
  const SEEK_EPSILON = 0.1;

  /**
   * Where the element will actually accept being moved to.
   *
   * Frame.io streams long assets over MSE, and assigning a `currentTime`
   * outside `seekable` is silently clamped by the browser — usually back to
   * the start.  Clamping here means we ask for something reachable, and the
   * verification below can tell a refused seek from a clamped one.
   */
  function seekTarget(v, seconds) {
    let t = Number(seconds);
    if (!Number.isFinite(t) || t < 0) t = 0;

    const ranges = v.seekable;
    if (ranges && ranges.length) {
      const start = ranges.start(0);
      const end = ranges.end(ranges.length - 1);
      if (t < start) t = start;
      if (t > end) t = end;
    } else if (Number.isFinite(v.duration) && v.duration > 0) {
      t = Math.min(t, Math.max(0, v.duration - 0.05));
    }
    return t;
  }

  function once(el, event, timeoutMs) {
    return new Promise((resolve) => {
      const done = () => { el.removeEventListener(event, done); clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, timeoutMs);
      el.addEventListener(event, done, { once: true });
    });
  }

  /**
   * Move the player to `seconds` and confirm it stuck.
   *
   * A single `video.currentTime = x` is not enough here for three separate
   * reasons, all of which show up as a click that does nothing:
   *   - before `loadedmetadata` the assignment is dropped on the floor;
   *   - a streamed asset clamps the value to its buffered range;
   *   - the player's own state can win a race and write its playhead back.
   * So the assignment is retried, each time re-reading where the element
   * actually landed, and the caller is told which of these it hit.
   */
  async function seekVideo(seconds) {
    const v = findVideo(true);
    if (!v) return { ok: false, reason: 'no-video' };

    // Stop first so the frame under the note stays put while the note plays,
    // and so playback can't drift past the target during the seek below.
    v.pause();

    // A player still resolving its manifest has nowhere to seek to yet.
    if (v.readyState < 1) {
      await once(v, 'loadedmetadata', 3000);
      if (v.readyState < 1) return { ok: false, reason: 'not-loaded' };
    }

    const requested = Math.max(0, Number(seconds) || 0);
    let clamped = false;

    for (let attempt = 0; attempt < 4; attempt++) {
      const target = seekTarget(v, requested);
      v.currentTime = target;

      // `seeked` is the authoritative signal; the timeout covers a player that
      // ignored the assignment outright and so never fires one.
      await once(v, 'seeked', 400 + attempt * 300);

      if (Math.abs(v.currentTime - target) <= SEEK_EPSILON) {
        v.pause(); // again: a player that auto-resumes after a seek would run on
        if (Math.abs(target - requested) <= SEEK_EPSILON) {
          return { ok: true, at: v.currentTime, requested };
        }
        // The player took the seek, but only as far as it can currently reach.
        // Keep retrying rather than reporting success from the wrong frame —
        // the seekable range grows as the asset buffers.
        clamped = true;
      }
    }

    return { ok: false, reason: clamped ? 'clamped' : 'refused', at: v.currentTime, requested };
  }

  const SEEK_FAILURE_MESSAGE = {
    'no-video': 'No video player found on this page',
    'not-loaded': 'Player has not loaded yet — try again',
    'clamped': 'Player would not seek that far (not buffered yet)',
    'refused': 'Player refused to seek',
  };

  /**
   * Seek, and if this frame holds no player, ask the other frames of the tab.
   *
   * The panel and the player are not guaranteed to be in the same document:
   * the content script runs in every frame, so the bubble you clicked may be
   * the top page's while Frame.io renders the player in a child frame.
   */
  async function seekAnywhere(seconds) {
    const local = await seekVideo(seconds);
    if (local.ok || local.reason !== 'no-video') return local;

    // Only frames that hold a player answer, so any reply beats "no-video"
    // here — including a failed one, which names the real problem.
    const relayed = await sendToSW('BROADCAST_SEEK', { seconds });
    return relayed.ok && relayed.data?.result ? relayed.data.result : local;
  }

  // Serve a seek asked for by the panel in another frame of this tab.
  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'KVN_SEEK') return;
    // Only the frame that actually holds a player answers.  The broadcast
    // reaches every frame but keeps just the first reply, so a frame with
    // nothing to seek has to stay silent rather than win the race with a
    // "no video here".
    if (!findVideo(true)) return;
    seekVideo(message.payload.seconds).then(sendResponse);
    return true;
  });

  let tsPollInterval = null;

  function startTimestampPolling() {
    stopTimestampPolling();
    const tick = () => {
      const v = findVideo();
      currentTsEl.textContent = v ? formatTime(v.currentTime) : '—';
    };
    tick(); // don't leave the panel showing a stale time for the first 250 ms
    tsPollInterval = setInterval(tick, 250);
  }

  function stopTimestampPolling() {
    if (tsPollInterval) {
      clearInterval(tsPollInterval);
      tsPollInterval = null;
    }
  }

  // (No MutationObserver: findVideo() re-validates its cached element on every
  // call and re-scans when it goes stale, which covers Frame.io swapping the
  // player out for the next asset without watching every DOM mutation on the
  // page.)

  // ── Recording ──────────────────────────────────────────────────────

  recordBtn.addEventListener('click', async () => {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  });

  async function startRecording() {
    const v = findVideo(true);
    capturedTimestamp = v ? v.currentTime : 0;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        handleRecordingComplete();
      };

      mediaRecorder.start();
      isRecording = true;
      recordingStartTime = Date.now();

      recordBtn.classList.add('kvn-recording');
      recordLabel.textContent = 'Stop & Save';
      recordTimer.style.display = 'flex';
      updateRecordTimer();
      recordTimerInterval = setInterval(updateRecordTimer, 100);

      showStatus('Recording...', 'recording');
    } catch (err) {
      console.error('[KVN] Mic access failed:', err);
      showStatus('Microphone access denied', 'error');
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    isRecording = false;
    clearInterval(recordTimerInterval);
    recordBtn.classList.remove('kvn-recording');
    recordLabel.textContent = 'Record Note';
    recordTimer.style.display = 'none';
  }

  function updateRecordTimer() {
    const elapsed = (Date.now() - recordingStartTime) / 1000;
    timerText.textContent = formatTime(elapsed);
  }

  async function handleRecordingComplete() {
    const mimeType = mediaRecorder?.mimeType || 'audio/webm';
    const blob = new Blob(audioChunks, { type: mimeType });
    const durationSeconds = (Date.now() - recordingStartTime) / 1000;

    showStatus('Uploading...', 'info');

    // Convert blob to base64 for message passing (blobs can't cross the
    // content-script ↔ service-worker boundary).
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result.split(',')[1];
      try {
        const response = await sendToSW('UPLOAD_NOTE', {
          videoUrl: window.location.href,
          videoTitle: document.title,
          timestampSeconds: capturedTimestamp,
          durationSeconds: durationSeconds,
          audioBase64: base64,
          mimeType: mimeType,
        });

        if (response.ok) {
          showStatus('Saved!', 'success');
          await loadNotes();
        } else {
          showStatus('Upload failed: ' + (response.error || 'Unknown'), 'error');
        }
      } catch (err) {
        showStatus('Upload failed', 'error');
      }
    };
    reader.readAsDataURL(blob);
  }

  // ── Notes list ─────────────────────────────────────────────────────

  async function loadNotes() {
    try {
      const resp = await sendToSW('FETCH_NOTES', { videoUrl: window.location.href });
      if (resp.ok) {
        notes = resp.data;
        renderNotes();
      }
    } catch (err) {
      console.error('[KVN] Failed to load notes:', err);
    }
  }

  // One playing note at a time — a per-item reference let two notes talk over
  // each other, which is unusable on a video you are also trying to watch.
  let currentAudio = null;
  let playingNoteId = null;

  function stopPlayback() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    playingNoteId = null;
    notesList.querySelectorAll('.kvn-note-playing')
      .forEach(el => el.classList.remove('kvn-note-playing'));
  }

  /**
   * Take the video to the note's moment and play the note over the paused
   * frame — you look at what was being talked about while you hear it.
   */
  async function openNote(note, item) {
    // A second click on the playing note is "stop", not "seek here again".
    if (playingNoteId === note.id) { stopPlayback(); return; }
    stopPlayback();

    // Seeking and fetching the audio are independent — running them together
    // means a player that takes a moment to settle doesn't delay playback.
    const seeking = seekAnywhere(note.timestamp_seconds);

    const resp = await sendToSW('FETCH_AUDIO', { noteId: note.id });

    const seek = await seeking;
    if (!seek.ok) {
      console.warn('[KVN] Seek failed:', seek);
      showStatus(SEEK_FAILURE_MESSAGE[seek.reason] || 'Could not seek the video', 'error');
    }

    if (!resp.ok) { showStatus('Could not load audio', 'error'); return; }

    // The panel may have re-rendered while the audio was being fetched.
    if (!item.isConnected) return;

    currentAudio = new Audio(resp.data);
    playingNoteId = note.id;
    item.classList.add('kvn-note-playing');
    currentAudio.onended = stopPlayback;
    currentAudio.play().catch(() => {
      stopPlayback();
      showStatus('Could not play audio', 'error');
    });
  }

  function renderNotes() {
    stopPlayback();
    // Remove old note items (keep empty msg and status)
    notesList.querySelectorAll('.kvn-note-item').forEach(el => el.remove());
    emptyMsg.style.display = notes.length === 0 ? 'block' : 'none';
    exportBtn.disabled = notes.length === 0 || isExporting;
    exportBtn.title = notes.length
      ? `Download all ${notes.length} note${notes.length > 1 ? 's' : ''} for this video as a .zip`
      : 'Nothing to export yet';

    notes.forEach((note) => {
      const item = document.createElement('div');
      item.className = 'kvn-note-item';

      const ts = formatTime(note.timestamp_seconds);
      const dur = formatTime(note.duration_seconds);
      const by = note.recorded_by || 'Anonymous';
      const date = new Date(note.created_at).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      });

      // The markup is a static template; every server-supplied value below is
      // written with textContent so a note author's name can never inject HTML.
      item.innerHTML = `
        <div class="kvn-note-top">
          <button class="kvn-note-ts">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
            <span class="kvn-note-ts-text"></span>
          </button>
          <span class="kvn-note-dur"></span>
          <button class="kvn-note-play" title="Play this note">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10,8 16,12 10,16" fill="currentColor"/></svg>
          </button>
          <button class="kvn-note-del" title="Delete note">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
        <div class="kvn-note-meta">
          <span class="kvn-note-by"></span> · <span class="kvn-note-date"></span>
        </div>
      `;

      item.title = `Go to ${ts} and play this note`;
      item.querySelector('.kvn-note-ts-text').textContent = ts;
      item.querySelector('.kvn-note-dur').textContent = dur;
      item.querySelector('.kvn-note-by').textContent = by;
      item.querySelector('.kvn-note-date').textContent = date;

      // The whole row is the target — seek there and play the note. The
      // timestamp chip and the play button are just the visible affordances
      // for it, so they do the same thing rather than half of it.
      item.addEventListener('click', () => openNote(note, item));
      item.querySelector('.kvn-note-play').addEventListener('click', (e) => {
        e.stopPropagation();
        openNote(note, item);
      });

      // Delete — the one control on the row that must not seek.
      item.querySelector('.kvn-note-del').addEventListener('click', async (e) => {
        e.stopPropagation();
        const resp = await sendToSW('DELETE_NOTE', { noteId: note.id });
        if (resp.ok) {
          showStatus('Deleted', 'success');
          await loadNotes();
        }
      });

      notesList.insertBefore(item, emptyMsg);
    });
  }

  // ── Export ─────────────────────────────────────────────────────────

  let isExporting = false;

  exportBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (isExporting || notes.length === 0) return;

    isExporting = true;
    exportBtn.disabled = true;
    stopPlayback();

    try {
      const files = [];
      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        exportLabel.textContent = `${i + 1}/${notes.length}`;
        showStatus(`Downloading note ${i + 1} of ${notes.length}…`, 'progress');

        const resp = await sendToSW('FETCH_AUDIO', { noteId: note.id });
        if (!resp.ok) throw new Error(`note ${i + 1}: ${resp.error || 'download failed'}`);

        files.push({ name: noteFileName(note, i), bytes: dataUrlToBytes(resp.data) });
      }

      // An index alongside the audio: the filenames carry the timestamp, but
      // this is what you can actually paste into a sheet or a ticket.
      files.push({ name: 'notes.csv', bytes: new TextEncoder().encode(buildIndexCsv(files)) });

      showStatus('Zipping…', 'progress');
      downloadBlob(buildZip(files), `${exportBaseName()}.zip`);
      showStatus(`Exported ${notes.length} note${notes.length > 1 ? 's' : ''}`, 'success');
    } catch (err) {
      console.error('[KVN] Export failed:', err);
      showStatus('Export failed: ' + (err.message || err), 'error');
    } finally {
      isExporting = false;
      exportLabel.textContent = 'Export';
      exportBtn.disabled = notes.length === 0;
    }
  });

  /**
   * The Frame.io asset id, which is what the server already groups notes by.
   * `video_key` looks like `frameio:asset:<id>`; anything it could not
   * recognise falls back to a URL, which is not a filename.
   */
  function exportBaseName() {
    const key = notes[0]?.video_key || '';
    const match = key.match(/^frameio:(?:asset|presentation):(.+)$/);
    if (match) return sanitise(match[1]);
    return sanitise(key.replace(/^url:/, '').replace(/^https?:\/\//, '')) || 'voice-notes';
  }

  // Index-first so the archive lists in video order, and the timestamp in the
  // name so a file is identifiable once it has been dragged out of the folder.
  function noteFileName(note, index) {
    const seq = String(index + 1).padStart(3, '0');
    const ts = formatTime(note.timestamp_seconds).replace(':', 'm').replace('.', 's');
    const by = sanitise(note.recorded_by || 'Anonymous');
    const ext = (note.audio_filename || '').match(/\.[a-z0-9]+$/i)?.[0] || '.webm';
    return `${seq}_${ts}_${by}${ext}`;
  }

  function sanitise(value) {
    return String(value).replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  function buildIndexCsv(files) {
    const rows = [['#', 'timestamp', 'timestamp_seconds', 'duration', 'recorded_by', 'email', 'recorded_at', 'file']];
    notes.forEach((note, i) => {
      rows.push([
        i + 1,
        formatTime(note.timestamp_seconds),
        note.timestamp_seconds,
        formatTime(note.duration_seconds),
        note.recorded_by || 'Anonymous',
        note.recorded_by_email || '',
        note.created_at,
        files[i].name,
      ]);
    });
    return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  function csvCell(value) {
    const s = String(value ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function dataUrlToBytes(dataUrl) {
    const raw = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    // Must be in the page's document, not the shadow root — a click on a
    // detached anchor does not start a download in every browser.
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking immediately can cancel the download before it has been read.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ── Minimal ZIP writer ─────────────────────────────────────────────
  //
  // Stored (uncompressed) entries only.  Opus/Vorbis audio is already
  // compressed, so DEFLATE would buy a percent or two in exchange for
  // shipping a compression library into a content script.

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function buildZip(files) {
    const encoder = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    const body = [];
    const central = [];
    let offset = 0;
    let centralSize = 0;

    for (const file of files) {
      const name = encoder.encode(file.name);
      const crc = crc32(file.bytes);
      const size = file.bytes.length;

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);      // version needed to extract
      local.setUint16(6, 0x0800, true);  // flag: filenames are UTF-8
      local.setUint16(8, 0, true);       // method: stored
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, name.length, true);
      body.push(new Uint8Array(local.buffer), name, file.bytes);

      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);      // version made by
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, 0, true);
      entry.setUint16(12, dosTime, true);
      entry.setUint16(14, dosDate, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, size, true);
      entry.setUint32(24, size, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, offset, true); // offset of this entry's local header
      central.push(new Uint8Array(entry.buffer), name);

      offset += 30 + name.length + size;
      centralSize += 46 + name.length;
    }

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...body, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  // ── Helpers ────────────────────────────────────────────────────────

  async function sendToSW(type, payload) {
    try {
      // Promise form works on both Chrome MV3 and Firefox/Zen.
      const response = await api.runtime.sendMessage({ type, payload });
      return response || { ok: false, error: 'No response' };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  // m:ss.mmm — a note is pinned to a frame, not to a second, and
  // `video.currentTime` is fractional to begin with.
  function formatTime(seconds) {
    const total = Math.max(0, seconds || 0);
    const m = Math.floor(total / 60);
    const s = Math.floor(total % 60);
    const ms = Math.floor((total % 1) * 1000);
    return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  function showStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = 'kvn-status kvn-status-' + type;
    statusEl.style.display = 'block';
    // 'recording' and 'progress' describe something still happening — they are
    // cleared by whatever replaces them, not by a timer.
    if (type !== 'recording' && type !== 'progress') {
      setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
    }
  }

  function getSupportedMimeType() {
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const m of preferred) {
      if (MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }

  // ── Inline Styles (Shadow DOM) ─────────────────────────────────────

  function STYLES() {
    return `
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      .kvn-container {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
        font-size: 13px;
        color: #e2e8f0;
        pointer-events: auto;
      }

      /* ── Floating Bubble ── */
      .kvn-bubble {
        position: fixed;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: linear-gradient(135deg, #7c3aed, #6d28d9);
        border: 2px solid rgba(167, 139, 250, 0.4);
        color: white;
        cursor: grab;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow:
          0 4px 20px rgba(124, 58, 237, 0.45),
          0 0 40px rgba(124, 58, 237, 0.15);
        transition: transform 0.15s, box-shadow 0.15s;
        z-index: 999999;
        pointer-events: auto;
        touch-action: none;
      }
      .kvn-bubble:hover {
        transform: scale(1.08);
        box-shadow:
          0 6px 28px rgba(124, 58, 237, 0.55),
          0 0 50px rgba(124, 58, 237, 0.2);
      }
      .kvn-bubble:active { cursor: grabbing; }

      /* ── Panel ── */
      .kvn-panel {
        position: fixed;
        width: 340px;
        max-height: 480px;
        background: linear-gradient(180deg, #1e1b2e 0%, #151320 100%);
        border: 1px solid rgba(139, 92, 246, 0.25);
        border-radius: 16px;
        box-shadow:
          0 20px 60px rgba(0,0,0,0.6),
          0 0 40px rgba(124, 58, 237, 0.1);
        display: flex;
        flex-direction: column;
        opacity: 0;
        pointer-events: none;
        transform: scale(0.92) translateY(8px);
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        z-index: 999998;
        overflow: hidden;
      }
      .kvn-panel-open {
        opacity: 1;
        pointer-events: auto;
        transform: scale(1) translateY(0);
      }

      .kvn-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        border-bottom: 1px solid rgba(139, 92, 246, 0.15);
        background: rgba(124, 58, 237, 0.06);
      }
      .kvn-panel-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 700;
        font-size: 14px;
        color: #c4b5fd;
        letter-spacing: 0.01em;
      }
      .kvn-header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .kvn-export-btn {
        display: flex;
        align-items: center;
        gap: 5px;
        background: rgba(124, 58, 237, 0.18);
        border: 1px solid rgba(139, 92, 246, 0.3);
        border-radius: 7px;
        color: #c4b5fd;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.02em;
        padding: 4px 9px;
        cursor: pointer;
        transition: all 0.15s;
        font-family: inherit;
      }
      .kvn-export-btn:hover:not(:disabled) {
        background: rgba(124, 58, 237, 0.35);
        border-color: #a78bfa;
        color: #ede9fe;
      }
      .kvn-export-btn:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .kvn-panel-close {
        background: none;
        border: none;
        color: #9ca3af;
        font-size: 20px;
        cursor: pointer;
        padding: 0 4px;
        line-height: 1;
        transition: color 0.15s;
      }
      .kvn-panel-close:hover { color: #f87171; }

      /* ── Recorder ── */
      .kvn-recorder {
        padding: 14px 16px;
        border-bottom: 1px solid rgba(139, 92, 246, 0.12);
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .kvn-timestamp-display {
        font-size: 11px;
        color: #9ca3af;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .kvn-timestamp-display span {
        color: #a78bfa;
        font-family: 'SF Mono', 'Fira Code', monospace;
        font-size: 13px;
      }

      .kvn-record-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 10px 16px;
        border: none;
        border-radius: 10px;
        background: linear-gradient(135deg, #7c3aed, #6d28d9);
        color: white;
        font-weight: 700;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.15s;
        letter-spacing: 0.01em;
      }
      .kvn-record-btn:hover {
        background: linear-gradient(135deg, #8b5cf6, #7c3aed);
        transform: translateY(-1px);
        box-shadow: 0 4px 16px rgba(124, 58, 237, 0.35);
      }
      .kvn-record-btn.kvn-recording {
        background: linear-gradient(135deg, #dc2626, #b91c1c);
      }
      .kvn-record-btn.kvn-recording:hover {
        background: linear-gradient(135deg, #ef4444, #dc2626);
        box-shadow: 0 4px 16px rgba(220, 38, 38, 0.35);
      }

      .kvn-rec-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #fca5a5;
      }
      .kvn-recording .kvn-rec-dot {
        animation: kvn-pulse 1s ease-in-out infinite;
      }

      .kvn-record-timer {
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: 'SF Mono', 'Fira Code', monospace;
        font-size: 14px;
        font-weight: 700;
        color: #fca5a5;
      }
      .kvn-rec-pulse {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ef4444;
        animation: kvn-pulse 1s ease-in-out infinite;
      }

      @keyframes kvn-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.4; transform: scale(0.8); }
      }

      /* ── Notes List ── */
      .kvn-notes-list {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
        min-height: 80px;
        max-height: 260px;
        /* Firefox/Zen: standard scrollbar styling (::-webkit-* is ignored). */
        scrollbar-width: thin;
        scrollbar-color: rgba(139, 92, 246, 0.35) transparent;
      }
      .kvn-notes-list::-webkit-scrollbar {
        width: 5px;
      }
      .kvn-notes-list::-webkit-scrollbar-track {
        background: transparent;
      }
      .kvn-notes-list::-webkit-scrollbar-thumb {
        background: rgba(139, 92, 246, 0.25);
        border-radius: 3px;
      }

      .kvn-notes-empty {
        text-align: center;
        color: #6b7280;
        padding: 24px 16px;
        font-size: 12px;
      }

      .kvn-note-item {
        padding: 10px 12px;
        margin-bottom: 6px;
        background: rgba(124, 58, 237, 0.06);
        border: 1px solid rgba(139, 92, 246, 0.1);
        border-radius: 10px;
        transition: all 0.15s;
        cursor: pointer;
      }
      .kvn-note-item:hover {
        background: rgba(124, 58, 237, 0.12);
        border-color: rgba(139, 92, 246, 0.2);
      }
      /* The note currently playing over the paused frame. */
      .kvn-note-item.kvn-note-playing {
        background: rgba(124, 58, 237, 0.2);
        border-color: #a78bfa;
      }
      .kvn-note-playing .kvn-note-play {
        color: #c4b5fd;
        border-color: rgba(139, 92, 246, 0.45);
      }

      .kvn-note-top {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .kvn-note-ts {
        display: flex;
        align-items: center;
        gap: 5px;
        background: rgba(124, 58, 237, 0.2);
        border: 1px solid rgba(139, 92, 246, 0.25);
        color: #c4b5fd;
        padding: 3px 8px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 700;
        font-family: 'SF Mono', 'Fira Code', monospace;
        cursor: pointer;
        transition: all 0.15s;
      }
      .kvn-note-ts:hover {
        background: rgba(124, 58, 237, 0.35);
        border-color: #a78bfa;
      }
      .kvn-note-ts svg { color: #a78bfa; }

      .kvn-note-dur {
        font-size: 11px;
        color: #6b7280;
        font-family: 'SF Mono', 'Fira Code', monospace;
        flex: 1;
      }

      .kvn-note-play, .kvn-note-del {
        background: none;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 6px;
        color: #9ca3af;
        padding: 4px 6px;
        cursor: pointer;
        transition: all 0.15s;
        display: flex;
        align-items: center;
      }
      .kvn-note-play:hover {
        color: #a78bfa;
        border-color: rgba(139, 92, 246, 0.3);
        background: rgba(124, 58, 237, 0.1);
      }
      .kvn-note-del:hover {
        color: #f87171;
        border-color: rgba(248, 113, 113, 0.3);
        background: rgba(248, 113, 113, 0.08);
      }

      .kvn-note-meta {
        margin-top: 6px;
        font-size: 10px;
        color: #6b7280;
        padding-left: 2px;
      }

      /* ── Status bar ── */
      .kvn-status {
        padding: 8px 16px;
        font-size: 11px;
        font-weight: 600;
        text-align: center;
        display: none;
      }
      .kvn-status-success { color: #34d399; background: rgba(16, 185, 129, 0.08); }
      .kvn-status-error { color: #f87171; background: rgba(248, 113, 113, 0.08); }
      .kvn-status-info { color: #93c5fd; background: rgba(59, 130, 246, 0.08); }
      .kvn-status-recording { color: #fca5a5; background: rgba(239, 68, 68, 0.08); }
      .kvn-status-progress { color: #c4b5fd; background: rgba(124, 58, 237, 0.1); }
    `;
  }
})();
