/**
 * Shared O(n) preprocessing for mapping engine timestamps onto a categorical
 * candle axis.
 *
 * `mapTrendlines` / `mapTimeSegment` (in `trendlineMapping`) re-parse the whole
 * candle time axis and linearly scan it for every trendline point they resolve.
 * A full chart build with sibling overlays calls them once per pattern group
 * and once per pivot — with ~700 daily candles that repeated full-axis work
 * dominates the build (measured ~21 ms, mostly `Date.parse` + linear nearest
 * scans).
 *
 * This module parses the axis once and answers exact/day/nearest lookups in
 * O(1)/O(log n) afterwards. The lookup semantics are byte-identical to
 * `trendlineMapping` (exact string → day for date-only strings → nearest
 * timestamp, ties resolved to the earliest candle), including on unsorted or
 * duplicate time axes — see `axisIndex.test.ts`, which diffs this module
 * against the originals.
 */
import type { Trendline } from "@/types/chartPatterns";
import { parseEngineTimestamp, type AxisPoint } from "./trendlineMapping";

/** Parsed view of a candle time axis, built once per chart build. */
export interface AxisIndex {
  readonly length: number;
  resolveIndex(t: string): number | undefined;
  nearestIndex(target: number): number | undefined;
  mapTrendlines(trendlines: Trendline[] | undefined): AxisPoint[][];
  mapTimeSegment(startT: string, startP: number, endT: string, endP: number): AxisPoint[];
}

function lowerBound(vals: number[], v: number): number {
  let lo = 0;
  let hi = vals.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (vals[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function createAxisIndex(times: string[]): AxisIndex {
  const length = times.length;
  const parsed: number[] = times.map((t) => parseEngineTimestamp(t));

  // Exact string → candle index (last duplicate wins, matching a fresh
  // `Map.set` per entry); day → first candle of the day.
  const exact = new Map<string, number>();
  const byDay = new Map<string, number>();
  times.forEach((t, i) => {
    exact.set(t, i);
    const day = t.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, i);
  });

  // Sorted (value, original index) runs over the finite parses, so nearest
  // lookups are binary searches instead of full-axis scans. Non-finite
  // parses can never win a nearest lookup (a NaN diff is never `<` the best).
  const sortedIndices: number[] = [];
  for (let i = 0; i < length; i++) {
    if (Number.isFinite(parsed[i])) sortedIndices.push(i);
  }
  sortedIndices.sort((a, b) => {
    const va = parsed[a]!;
    const vb = parsed[b]!;
    return va === vb ? a - b : va - vb;
  });
  const sortedValues: number[] = sortedIndices.map((i) => parsed[i]!);

  const nearestIndex = (target: number): number | undefined => {
    if (Number.isNaN(target) || sortedIndices.length === 0) return undefined;
    const lb = lowerBound(sortedValues, target);
    let bestIndex = -1;
    let bestDiff = Number.POSITIVE_INFINITY;
    // The minimum absolute difference is always achieved by the value run
    // immediately below `target` (or at `lb`) and/or the run starting at
    // `lb`; within a run the earliest candle is the one the original
    // full-axis scan would keep (strict `<` updates, original order).
    const considerRun = (runStart: number, value: number): void => {
      const diff = Math.abs(value - target);
      const idx = sortedIndices[runStart]!;
      if (diff < bestDiff || (diff === bestDiff && (bestIndex < 0 || idx < bestIndex))) {
        bestDiff = diff;
        bestIndex = idx;
      }
    };
    if (lb > 0) {
      const v = sortedValues[lb - 1]!;
      considerRun(lowerBound(sortedValues, v), v);
    }
    if (lb < sortedIndices.length) {
      considerRun(lb, sortedValues[lb]!);
    }
    return bestIndex >= 0 ? bestIndex : undefined;
  };

  const resolveIndex = (t: string): number | undefined => {
    const hit = exact.get(t);
    if (hit !== undefined) return hit;
    if (t.length <= 10) {
      const dayHit = byDay.get(t.slice(0, 10));
      if (dayHit !== undefined) return dayHit;
    }
    return nearestIndex(parseEngineTimestamp(t));
  };

  const mapTrendlines = (trendlines: Trendline[] | undefined): AxisPoint[][] => {
    if (!trendlines?.length || length === 0) return [];
    const mapped: AxisPoint[][] = [];
    for (const line of trendlines) {
      const points: AxisPoint[] = [];
      for (const point of line) {
        const index = resolveIndex(point.t);
        if (index !== undefined && index >= 0) points.push({ index, price: point.price });
      }
      if (points.length > 0) mapped.push(points);
    }
    return mapped;
  };

  const mapTimeSegment = (
    startT: string,
    startP: number,
    endT: string,
    endP: number,
  ): AxisPoint[] => {
    if (length === 0) return [];
    const t0 = parseEngineTimestamp(startT);
    const t1 = parseEngineTimestamp(endT);
    if (Number.isNaN(t0) || Number.isNaN(t1) || t1 < t0) return [];
    const wStart = parsed[0]!;
    const wEnd = parsed[length - 1]!;
    if (Number.isNaN(wStart) || Number.isNaN(wEnd)) return [];
    if (t1 < wStart || t0 > wEnd) return [];

    if (t1 === t0) {
      const i = nearestIndex(t0);
      if (i === undefined) return [];
      return [{ index: i, price: startP }];
    }

    const a = Math.max(t0, wStart);
    const b = Math.min(t1, wEnd);
    const slope = (endP - startP) / (t1 - t0);
    const pa = startP + slope * (a - t0);
    const pb = startP + slope * (b - t0);

    const ia = nearestIndex(a);
    const ib = nearestIndex(b);
    if (ia === undefined || ib === undefined) return [];
    if (ia === ib) return [{ index: ia, price: pa }];
    return [
      { index: ia, price: pa },
      { index: ib, price: pb },
    ];
  };

  return { length, resolveIndex, nearestIndex, mapTrendlines, mapTimeSegment };
}
