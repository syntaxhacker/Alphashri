export interface MaxPainPoint {
  value: number;
  maxPain: number | null | undefined;
}

interface MaxPainTouch<T extends MaxPainPoint> {
  index: number;
  point: T;
  value: number;
  maxPain: number;
  distance: number;
}

export function maxPainTouchTol(report: { spot?: number; strikes?: Array<{ strike: number }> }): number {
  const strikes = report.strikes ?? [];
  if (strikes.length < 2) return 10;
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

export const MAX_PAIN_TOUCH_TOL = 10;

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