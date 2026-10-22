/** One observation to test against a max-pain level. */
export interface MaxPainPoint {
  /** Price observed at that point (spot or candle close). */
  value: number;
  /** Max-pain level in force at that point; `null` when unavailable. */
  maxPain: number | null | undefined;
}

interface MaxPainTouch<T extends MaxPainPoint> {
  /** Position in the source array. */
  index: number;
  /** The original point (kept so callers can read extra fields). */
  point: T;
  value: number;
  maxPain: number;
  /** Absolute distance in points. */
  distance: number;
}

/** Default touch window (points). 10 pts covers a strike-granularity pin:
 *  NIFTY strikes step 50, so a close 5-10 pts off the pin still reads as a
 *  touch on the tape (e.g. 22,995 vs max pain 23,000). */
export const MAX_PAIN_TOUCH_TOL = 10;

/**
 * Points whose price sits within `tol` points of max pain (inclusive).
 *
 * Pure and shared by the heatmap (bucket spot vs bucket max pain) and the
 * chart (candle close vs report max pain) so both markers agree. Points with a
 * missing / non-finite max pain, or a non-finite price, are never touches.
 */
export function maxPainTouches<T extends MaxPainPoint>(
  points: readonly T[],
  tol = MAX_PAIN_TOUCH_TOL,
): MaxPainTouch<T>[] {
  const limit = Number.isFinite(tol) ? Math.max(0, tol) : MAX_PAIN_TOUCH_TOL;
  const out: MaxPainTouch<T>[] = [];
  points.forEach((point, index) => {
    const { value, maxPain } = point;
    if (!Number.isFinite(value) || maxPain == null || !Number.isFinite(maxPain)) return;
    const distance = Math.abs(value - maxPain);
    if (distance <= limit) out.push({ index, point, value, maxPain, distance });
  });
  return out;
}
