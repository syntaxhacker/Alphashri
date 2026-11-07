/**
 * Alert sounds + tab-title flash for OI bursts — no assets, no network.
 *
 * A trader watching the chart is not looking at the toast rail. A critical
 * burst (fresh selling / liquidation) has to be audible: a two-tone chirp for
 * critical, one soft blip for watch. Everything is best-effort — a blocked
 * AudioContext (autoplay policy) or a browser without Web Audio must never
 * break the alert path.
 */

const MUTE_KEY = "nifty.alerts.muted";

/** Persisted mute state. Missing/unreadable storage = sound ON. */
export function alertsMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAlertsMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* private mode / quota — the in-memory toggle still works */
  }
}

type Ctor = typeof AudioContext;
let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const CtorImpl: Ctor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
  if (!CtorImpl) return null;
  if (!ctx) {
    try {
      ctx = new CtorImpl();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") {
    // Resumes only after a user gesture; a rejected promise is fine (the
    // browser will honour the next gesture).
    void ctx.resume().catch(() => undefined);
  }
  return ctx;
}

/** Call from a click/keydown so the first alert after load can actually play. */
export function unlockAlertAudio(): void {
  audioContext();
}

function tone(
  c: AudioContext,
  freq: number,
  delay: number,
  duration: number,
  peak: number,
): void {
  const osc = c.createOscillator();
  const gain = c.createGain();
  const t0 = c.currentTime + delay;
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export type AlertSoundSeverity = "critical" | "alert" | "watch";

/**
 * `critical` = rising two-tone (hard to miss), `alert` = one mid blip,
 * `watch` = one soft low blip. No-op while muted or without Web Audio.
 */
export function playAlertSound(severity: AlertSoundSeverity): void {
  if (alertsMuted()) return;
  const c = audioContext();
  if (!c) return;
  if (severity === "critical") {
    tone(c, 880, 0, 0.14, 0.10);
    tone(c, 1320, 0.16, 0.20, 0.10);
    tone(c, 1320, 0.40, 0.12, 0.06);
  } else if (severity === "alert") {
    tone(c, 760, 0, 0.12, 0.06);
  } else {
    tone(c, 520, 0, 0.10, 0.04);
  }
}

const TITLE_PREFIX = "🔔 ";
let titleBase = "";
let titleTimer: number | undefined;
/** The single live `focus` restore listener. Kept so a new flash can remove
 *  the previous one — otherwise every alert in an unfocused-then-focused tab
 *  left a listener (and its closure) behind for the life of the page. */
let titleFocusRestore: (() => void) | null = null;

/**
 * Prepend a bell + the alert to the tab title until the tab is looked at
 * again (or 30s passes). A user in another tab still sees the count.
 */
export function flashAlertTitle(text: string, ms = 30_000): void {
  if (typeof document === "undefined") return;
  if (!document.title.startsWith(TITLE_PREFIX)) titleBase = document.title;
  document.title = `${TITLE_PREFIX}${text}`;
  if (titleTimer !== undefined) {
    window.clearTimeout(titleTimer);
    titleTimer = undefined;
  }
  // Drop the previous flash's listener before installing this one.
  if (titleFocusRestore !== null) {
    window.removeEventListener("focus", titleFocusRestore);
    titleFocusRestore = null;
  }
  const restore = () => {
    document.title = titleBase || document.title.slice(TITLE_PREFIX.length);
    if (titleTimer !== undefined) {
      window.clearTimeout(titleTimer);
      titleTimer = undefined;
    }
    titleFocusRestore = null;
    window.removeEventListener("focus", restore);
  };
  titleFocusRestore = restore;
  titleTimer = window.setTimeout(restore, ms);
  window.addEventListener("focus", restore, { once: true });
}
