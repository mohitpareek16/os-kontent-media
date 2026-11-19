/**
 * Kontent Voice Notes — Popup Settings Script
 *
 * Asks once for the reviewer's name and email, then locks both: every note
 * carries them, and a note whose author changes halfway through a review is
 * worse than no name at all.  There is no unlock — see README-install.md for
 * the storage-clear escape hatch if someone mistypes.
 *
 * The server is fixed at SERVER_URL (background/service-worker.js hardcodes
 * the same value).  There is one team server, and letting people type an
 * address only ever produced unreachable ones.
 *
 * On Firefox/Zen (MV3) host permissions are *not* granted at install time,
 * so saving also asks for access to the server origin — the click on "Save"
 * is the user gesture that makes the request allowed.
 */

// Firefox exposes the promise-based `browser` namespace; Chrome only `chrome`.
const api = globalThis.browser ?? globalThis.chrome;

// The server sits behind a Let's Encrypt cert and 301s every plain-http
// request, so this must stay https on the domain — the bare IP fails the TLS
// hostname check.  Keep in sync with background/service-worker.js.
const SERVER_URL = 'https://ops.kontentmedia.in';

// Deliberately loose: any domain, one @, a dot in the host.  This catches the
// typo that matters ("milan@kontentmedia" or a bare name) without turning into
// a spec-compliant email parser, which no regex is anyway.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const nameInput = document.getElementById('user-name');
const emailInput = document.getElementById('user-email');
const saveBtn = document.getElementById('save-btn');
const statusMsg = document.getElementById('status-msg');
const connDot = document.getElementById('conn-dot');
const connText = document.getElementById('conn-text');
const lockedNote = document.getElementById('locked-note');
const confirmBox = document.getElementById('confirm-box');
const confirmIdentity = document.getElementById('confirm-identity');
const confirmYes = document.getElementById('confirm-yes');
const confirmNo = document.getElementById('confirm-no');

// ── Load ─────────────────────────────────────────────────────────────

(async () => {
  const { kvn_user_name, kvn_user_email, kvn_identity_locked } =
    await api.storage.local.get([
      'kvn_user_name',
      'kvn_user_email',
      'kvn_identity_locked',
    ]);

  nameInput.value = kvn_user_name || '';
  emailInput.value = kvn_user_email || '';
  if (kvn_identity_locked) lockIdentity();

  // Drop the address left over from when the server was user-editable, so
  // nothing can read a stale (and now unreachable) one out of storage.
  await api.storage.local.remove('kvn_server_url');
  await checkConnection();
})();


// ── Save — two steps, because there is no way back ───────────────────

saveBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  const email = emailInput.value.trim();

  if (!name) return showError('Enter your name');
  if (!EMAIL_RE.test(email)) return showError('Enter a valid email address');

  confirmIdentity.textContent = `${name} · ${email}`;
  confirmBox.hidden = false;
  saveBtn.hidden = true;
  statusMsg.textContent = '';
});

confirmNo.addEventListener('click', () => {
  confirmBox.hidden = true;
  saveBtn.hidden = false;
});

confirmYes.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  const email = emailInput.value.trim();

  // Ask for access to the server origin while we still have the user gesture
  // from this click.  Already-granted origins resolve true immediately; a
  // rejection is not fatal, so the identity is still saved.
  const granted = await ensureOriginPermission(SERVER_URL);

  await api.storage.local.set({
    kvn_user_name: name,
    kvn_user_email: email,
    kvn_identity_locked: true,
  });

  confirmBox.hidden = true;
  lockIdentity();

  statusMsg.classList.remove('status-error');
  statusMsg.textContent = granted
    ? '✓ Saved'
    : '✓ Saved — but access to the server was not granted';

  await checkConnection();
});


function lockIdentity() {
  nameInput.disabled = true;
  emailInput.disabled = true;
  saveBtn.hidden = true;
  confirmBox.hidden = true;
  lockedNote.hidden = false;
}

function showError(message) {
  statusMsg.classList.add('status-error');
  statusMsg.textContent = message;
  setTimeout(() => {
    statusMsg.textContent = '';
    statusMsg.classList.remove('status-error');
  }, 2500);
}


// ── Host permission ──────────────────────────────────────────────────

async function ensureOriginPermission(url) {
  let origin;
  try {
    origin = new URL(url).origin + '/*';
  } catch {
    return false; // not a valid URL; checkConnection will surface the problem
  }

  try {
    if (await api.permissions.contains({ origins: [origin] })) return true;
    return await api.permissions.request({ origins: [origin] });
  } catch (err) {
    console.warn('[KVN] Permission request failed:', err);
    return false;
  }
}


// ── Connection check ─────────────────────────────────────────────────

async function checkConnection() {
  connDot.className = 'dot';
  connText.textContent = 'Checking...';

  try {
    const res = await fetch(`${SERVER_URL}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      connDot.className = 'dot connected';
      connText.textContent = 'Connected to server';
    } else {
      connDot.className = 'dot error';
      connText.textContent = `Server responded with ${res.status}`;
    }
  } catch (err) {
    connDot.className = 'dot error';
    connText.textContent = 'Cannot reach server — press Save to grant access';
  }
}
