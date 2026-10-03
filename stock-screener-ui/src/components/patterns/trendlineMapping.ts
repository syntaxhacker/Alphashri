import type { Trendline } from "@/types/chartPatterns";

export interface AxisPoint {
  index: number;
  price: number;
}

/**
 * Parse a timestamp the way the engine means it: engine trendline points are
 * naive `"YYYY-MM-DD HH:MM"` strings in IST, while candle timestamps are full
 * ISO with an explicit offset. `Date.parse("2026-05-04T09:15")` interprets the
 * value in the *browser's* local zone, so the same chart shifts by hours on a
 * UTC/CI machine. Appending `+05:30` when no offset is present pins naive
 * strings to IST explicitly, keeping boundaries/pivots stable everywhere.
 */
export function parseEngineTimestamp(t: string): number {
  const trimmed = t.trim();
  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:?\d{2}$/.test(trimmed)) return Date.parse(trimmed);
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return Date.parse(`${trimmed}T00:00:00+05:30`);
  return Date.parse(`${trimmed.replace(" ", "T")}+05:30`);
}
/**
 * Map a trendline's `{t, price}` points onto a categorical candle `times` axis.
 *
 * Trendline timestamps come from the engine (`"YYYY-MM-DD HH:MM"`) while candle
 * timestamps are full ISO (`"YYYY-MM-DDTHH:MM:SS+00:00"`), and the candle window
 * is downsampled — so we match by exact string, then by day, then by nearest
 * timestamp. This guarantees the pattern boundary is always drawn.
 */
export function mapTrendlines(trendlines: Trendline[] | undefined, times: string[]): AxisPoint[][] {
  if (!trendlines?.length || times.length === 0) return [];

  const exact = new Map<string, number>();
  const byDay = new Map<string, number>();
  const parsed = times.map((t) => parseEngineTimestamp(t));
  times.forEach((t, i) => {
    exact.set(t, i);
    const day = t.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, i);
  });

  const nearest = (t: string): number | undefined => {
    const target = parseEngineTimestamp(t);
    if (Number.isNaN(target)) return undefined;
    let best = -1;
    let bestDiff = Number.POSITIVE_INFINITY;
    parsed.forEach((value, i) => {
      const diff = Math.abs(value - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    });
    return best >= 0 ? best : undefined;
  };

  const mapped: AxisPoint[][] = [];
  for (const line of trendlines) {
    const points: AxisPoint[] = [];
    for (const point of line) {
      let index = exact.get(point.t);
      // Only fall back to a day match for date-only strings (legacy overlays); a
      // timed string must never collapse onto the first candle of the day.
      if (index === undefined && point.t.length <= 10) index = byDay.get(point.t.slice(0, 10));
      if (index === undefined) index = nearest(point.t);
      if (index !== undefined && index >= 0) points.push({ index, price: point.price });
    }
    if (points.length > 0) mapped.push(points);
  }
  return mapped;
}

/** Expand mapped points into a null-padded data array aligned to the x-axis. */
export function pointsToSeriesData(points: AxisPoint[], length: number): Array<number | null> {
  const data: Array<number | null> = Array.from({ length }, () => null);
  for (const point of points) {
    if (point.index >= 0 && point.index < length) data[point.index] = point.price;
  }
  return data;
}
