
const MUTE_KEY = "nifty.alerts.muted";

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
    void ctx.resume().catch(() => undefined);
  }
  return ctx;
}

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
let titleFocusRestore: (() => void) | null = null;

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
