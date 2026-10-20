/**
 * Replay coverage — how much of the 09:15–15:29 session the recorded frames
 * actually cover.
 *
 * The replay log only contains the minutes the recorder managed to capture.
 * On a day where the Upstox token arrived late (2026-10-19) the frames start
 * at 10:33 and have dozens of one- to two-minute holes. Playback jumps a hole
 * in a single tick, which looks like a stutter, so the UI needs to say *why*:
 * a percentage, the missing minutes, the holes, and the jump after each frame.
 */

/** Session open, minute of day (09:15 IST). */
export const SESSION_START_MIN = 9 * 60 + 15;
/** Last recorded minute (15:29 IST) — 15:30 belongs to the closing auction. */
export const SESSION_END_MIN = 15 * 60 + 29;
/** 09:15 → 15:29 inclusive = 375 one-minute bars. */
export const SESSION_MINUTES = SESSION_END_MIN - SESSION_START_MIN + 1;

export interface ReplayGap {
  /** Minute of day of the first missing minute. */
  start: number;
  /** Minute of day of the last missing minute. */
  end: number;
  minutes: number;
}

export interface ReplayCoverage {
  sessionMinutes: number;
  /** Distinct in-session minutes that have a frame. */
  recorded: number;
  /** sessionMinutes − recorded. */
  missing: number;
  /** 0–100, one decimal (0.8 for 3/375). */
  pct: number;
  firstMin: number | null;
  lastMin: number | null;
  /** Missing runs across the whole session, including before/after the frames. */
  gaps: ReplayGap[];
  largestGap: ReplayGap | null;
  /** Minutes skipped between frame i and i+1 (0 = contiguous). */
  stepMissing: number[];
}

/** `"2026-10-19T10:33:00+05:30"` or `"10:33"` → minute of day (633), else null. */
export function minuteOfDay(t: string): number | null {
  const m = /(?:^|[T ])(\d{2}):(\d{2})/.exec(t || "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) {
    return null;
  }
  return h * 60 + min;
}

/** Minute of day → `"HH:MM"`. */
export function minuteLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function inSession(min: number): number | null {
  return min < SESSION_START_MIN || min > SESSION_END_MIN ? null : min;
}

export function computeReplayCoverage(
  frames: ReadonlyArray<{ t: string }> | null | undefined,
): ReplayCoverage {
  const raw = (frames ?? [])
    .map((f) => minuteOfDay(f.t))
    .map((m) => (m === null ? null : inSession(m)))
    .filter((m): m is number => m !== null);

  const unique = Array.from(new Set(raw)).sort((a, b) => a - b);
  const recorded = unique.length;
  const missing = SESSION_MINUTES - recorded;

  // Gaps across the whole session: before the first frame, between frames,
  // after the last one. An empty day is one gap covering the session.
  const present = new Set(unique);
  const gaps: ReplayGap[] = [];
  let runStart: number | null = null;
  for (let m = SESSION_START_MIN; m <= SESSION_END_MIN; m++) {
    if (!present.has(m)) {
      if (runStart === null) runStart = m;
    } else if (runStart !== null) {
      gaps.push({ start: runStart, end: m - 1, minutes: m - runStart });
      runStart = null;
    }
  }
  if (runStart !== null) {
    gaps.push({
      start: runStart,
      end: SESSION_END_MIN,
      minutes: SESSION_END_MIN - runStart + 1,
    });
  }

  const largestGap = gaps.reduce<ReplayGap | null>(
    (best, g) => (best === null || g.minutes > best.minutes ? g : best),
    null,
  );

  // Jump size after each frame, in served order (what playback will skip).
  const stepMissing = raw.slice(0, -1).map((m, i) => Math.max(0, raw[i + 1] - m - 1));

  return {
    sessionMinutes: SESSION_MINUTES,
    recorded,
    missing,
    pct: recorded === 0 ? 0 : Math.round((recorded / SESSION_MINUTES) * 1000) / 10,
    firstMin: unique.length ? unique[0] : null,
    lastMin: unique.length ? unique[unique.length - 1] : null,
    gaps,
    largestGap,
    stepMissing,
  };
}

/** Traffic-light tone for a coverage percentage. */
export function coverageTone(pct: number): "good" | "warn" | "bad" {
  if (pct >= 98) return "good";
  if (pct >= 85) return "warn";
  return "bad";
}
