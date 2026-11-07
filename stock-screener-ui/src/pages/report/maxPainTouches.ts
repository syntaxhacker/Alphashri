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

/**
 * Derive the max-pain touch tolerance from a report.
 * 20% of strike step, minimum 1 point.
 */
export function maxPainTouchTol(report: { spot?: number; strikes?: Array<{ strike: number }> }): number {
  const strikes = report.strikes ?? [];
  if (strikes.length < 2) return 10; // NIFTY fallback
  const unique = Array.from(new Set(strikes.map((s) => s.strike)))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  let minDiff = Infinity;
  for (let i = 1; i < unique.length; i++) {
    const diff = unique[i] - unique[i - 1];
    if (diff > 0 && diff < minDiff) minDiff = diff;
  }
  const strikeStep = Number.isFinite(minDiff) && minDiff > 0 ? minDiff : 50;
  return Math.max(1, Math.round(strikeStep * 0.2));
}

/** Legacy constant (NIFTY-calibrated). Kept for backward compatibility. */
export const MAX_PAIN_TOUCH_TOL = 10;

/**
 * Points whose price sits within `tol` points of max pain (inclusive).
 *
 * Pure and shared by the heatmap (bucket spot vs bucket max pain) and the
 * chart (candle close vs report max pain) so both markers agree. Points with a
 * missing / non-finite max pain, or a non-finite price, are never touches.
 *
 * @param points - Array of points with `value` and `maxPain` fields
 * @param tol - Tolerance in points (defaults to NIFTY-calibrated 10, or pass a report-derived value)
 * @param report - Optional report to derive tolerance from (overrides `tol` when provided)
 */
export function maxPainTouches<T extends MaxPainPoint>(
  points: readonly T[],
  tol: number | { spot?: number; strikes?: Array<{ strike: number }> } = MAX_PAIN_TOUCH_TOL,
  report?: { spot?: number; strikes?: Array<{ strike: number }> },
): MaxPainTouch<T>[] {
  let limit: number;
  if (typeof tol === "number") {
    limit = Number.isFinite(tol) ? Math.max(0, tol) : MAX_PAIN_TOUCH_TOL;
  } else {
    limit = maxPainTouchTol(tol);
  }
  // If report is provided separately, it overrides the tol-derived limit
  if (report) {
    limit = maxPainTouchTol(report);
  }

  const out: MaxPainTouch<T>[] = [];
  points.forEach((point, index) => {
    const { value, maxPain } = point;
    if (!Number.isFinite(value) || maxPain == null || !Number.isFinite(maxPain)) return;
    const distance = Math.abs(value - maxPain);
    if (distance <= limit) out.push({ index, point, value, maxPain, distance });
  });
  return out;
}