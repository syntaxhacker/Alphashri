
export interface PreMovePoint {
  /** Epoch ms. */
  t: number;
  score: number;
  spot: number | null;
  comps: string[];
}

export interface ArmedSpan {
  from: number;
  to: number;
}

export const PREMOVE_HISTORY_MAX = 180;

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
