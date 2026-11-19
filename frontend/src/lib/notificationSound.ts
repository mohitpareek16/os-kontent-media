/** The alert a new notification makes.
 *
 * Synthesised with the Web Audio API rather than shipped as an mp3: it is a
 * two-tone chime, an audio file for it would be a binary in the bundle that
 * nobody can review in a diff, and this way there is no second request that
 * can 404 on a slow deploy and leave the alert silent without anyone noticing.
 *
 * Deliberately loud and deliberately repeated. This fires for work landing on
 * somebody's plate — a hand-off, a change list, a scrapped project — and the
 * failure mode that matters is not hearing it.
 *
 * Browsers refuse to start audio before the user has interacted with the page
 * at all, and a rejected `AudioContext` throws rather than warning. So the
 * context is created lazily, unlocked on the first click or keypress anywhere
 * in the app (`primeNotificationSound`), and every call is wrapped: a silent
 * alert is a worse day, a thrown one is a broken app.
 */

let audioContext: AudioContext | null = null;
let primed = false;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) {
    try {
      audioContext = new Ctor();
    } catch {
      return null;
    }
  }
  return audioContext;
}

/** One note. `at` is an offset in seconds from now, so a chime is two of
 * these scheduled against the same clock rather than two `setTimeout`s that
 * drift apart under load. */
function tone(ctx: AudioContext, freq: number, at: number, duration: number, peak: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  // Triangle, not sine: it carries across a room over a fan and a call,
  // without the edge a square wave has at this volume.
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, ctx.currentTime + at);

  const start = ctx.currentTime + at;
  // Ramps rather than a bare on/off — an instant gain change is an audible
  // click on most hardware, which reads as a broken sound rather than a chime.
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/**
 * Call once from a real user gesture. Creating and resuming the context while
 * the browser is already listening to a click is the only reliable way to
 * have it ready when a notification arrives seconds later with no gesture
 * behind it.
 */
export function primeNotificationSound() {
  if (primed) return;
  primed = true;
  const ctx = getContext();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
}

/** Two rising chimes, twice. ~1.1s end to end. */
export function playNotificationSound() {
  const ctx = getContext();
  if (!ctx) return;

  try {
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    // A -> E -> A, then the same pair again after a beat. The repeat is what
    // makes it register as an alert rather than a UI blip.
    tone(ctx, 880, 0, 0.18, 0.55);
    tone(ctx, 1318.5, 0.13, 0.2, 0.6);
    tone(ctx, 880, 0.42, 0.18, 0.5);
    tone(ctx, 1318.5, 0.55, 0.26, 0.55);
  } catch {
    // No sound is survivable; an exception thrown out of a poll callback is not.
  }
}
