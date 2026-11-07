/**
 * Pre-move score history + armed spans.
 *
 * The EDA on 2026-10-26 exposed two problems with the raw score: it armed at
 * 13:10 (9 min early) but fell back to 3 by 13:15 as the put-writing window
 * aged out, then re-armed at 13:25 — AFTER the move. A raw line is spiky and
 * misleading; a latched "armed" state is what a trader actually needs.
 *
 * Pure: no React, no clock.
 */

export interface PreMovePoint {
  /** Epoch ms. */
  t: number;
  score: number;
  spot: number | null;
  /** Component keys active at this sample. */
  comps: string[];
}

export interface ArmedSpan {
  from: number;
  to: number;
}

export const PREMOVE_HISTORY_MAX = 180; // 30 min at 10 s

export function appendPreMove(
  history: PreMovePoint[],
  point: PreMovePoint,
  max = PREMOVE_HISTORY_MAX,
): PreMovePoint[] {
  const last = history[history.length - 1];
  if (last && last.t === point.t) return history;
  const next = [...history, point];
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * Armed spans with a latch: once the score reaches `threshold`, the setup stays
 * armed for `latchMin` minutes unless the score collapses to ≤2.
 */
export function armedSpans(
  points: PreMovePoint[],
  threshold = 5,
  latchMin = 10,
): ArmedSpan[] {
  const spans: ArmedSpan[] = [];
  let until = 0;
  let open: number | null = null;
  for (const p of points) {
    if (p.score >= threshold) until = Math.max(until, p.t + latchMin * 60_000);
    // A collapse resets immediately: a false arming must not stay sticky.
    if (p.score <= 2) until = 0;
    const armed = p.t < until;
    if (armed && open === null) open = p.t;
    if (!armed && open !== null) {
      spans.push({ from: open, to: p.t });
      open = null;
    }
  }
  if (open !== null && points.length > 0) {
    spans.push({ from: open, to: points[points.length - 1].t });
  }
  return spans;
}
