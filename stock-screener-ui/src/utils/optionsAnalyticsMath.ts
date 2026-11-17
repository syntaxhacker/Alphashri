/**
 * Pure aggregation over the normalized options-analytics DTO. No fetch, no
 * store, no DOM: every function is a function of its arguments alone, so a tab
 * switch or a leg edit repaints without another request.
 *
 * Missing is missing. An absent iv/delta stays `null` all the way through — a
 * zero would be read as a real 0-vol point and would bend every fit.
 */

import type { AnalyticsIvPoint, OptionsAnalytics } from "../api/optionsAnalytics";
import { SURFACE_MAX_STRIKES } from "../config/optionsAnalytics";

export type OptionSide = "CE" | "PE";

export interface SmilePoint {
  moneyness: number;
  strike: number;
  iv: number;
  delta: number | null;
}

export interface TermPoint {
  dte: number;
  iv: number;
}

export type TermMode = "atm" | "rr25" | "bf25";

export interface SurfaceCell {
  /** Lattice strike the cell is plotted at (aligned across expiries). */
  strike: number;
  expiry: string;
  iv: number;
  delta: number | null;
  /** Strike the iv was actually read from when a nearest fill was used. */
  matchedStrike: number;
}

export interface SurfaceGrid {
  strikes: number[];
  expiries: string[];
  /** Only present cells — missing intersections are omitted, never zeroed. */
  cells: SurfaceCell[];
  coverage: number;
  total: number;
  tick: number | null;
}

const finitePositive = (value: number | null): value is number =>
  value != null && Number.isFinite(value) && value > 0;

const finite = (value: number | null): value is number => value != null && Number.isFinite(value);

/** OTM legs only: CE at/above spot, PE at/below spot. No zero-fill. */
export function smilePoints(
  rows: readonly AnalyticsIvPoint[],
  spot: number,
  side: OptionSide,
): SmilePoint[] {
  if (!finitePositive(spot)) return [];
  const out: SmilePoint[] = [];
  for (const row of rows) {
    if (!finitePositive(row.strike) || !finitePositive(row.iv)) continue;
    if (side === "CE" && row.strike < spot) continue;
    if (side === "PE" && row.strike > spot) continue;
    if (row.delta != null && Number.isFinite(row.delta)) {
      if (side === "CE" && row.delta <= 0) continue;
      if (side === "PE" && row.delta >= 0) continue;
    }
    out.push({
      strike: row.strike,
      moneyness: Math.log(row.strike / spot),
      iv: row.iv,
      delta: finite(row.delta) ? row.delta : null,
    });
  }
  out.sort((a, b) => a.strike - b.strike);
  return out;
}

function ivForMode(
  expiry: { atmIv: number | null; rr25: number | null; bf25: number | null },
  mode: TermMode,
): number | null {
  if (mode === "rr25") return expiry.rr25;
  if (mode === "bf25") return expiry.bf25;
  return expiry.atmIv;
}

/**
 * ATM IV (or a 25Δ wing) by DTE. The backend's per-expiry aggregates are the
 * primary source; the standalone `term` series is the fallback for a partial
 * payload. Fewer than two finite points is not a term structure.
 */
export function termPoints(data: OptionsAnalytics, mode: TermMode = "atm"): TermPoint[] {
  const build = (dte: number | null, iv: number | null): TermPoint | null =>
    dte != null && Number.isFinite(dte) && dte >= 0 && finite(iv) ? { dte, iv } : null;

  const out: TermPoint[] = [];
  const seen = new Set<number>();
  for (const expiry of data.expiries) {
    const point = build(expiry.dte, ivForMode(expiry, mode));
    if (!point || seen.has(point.dte)) continue;
    seen.add(point.dte);
    out.push(point);
  }
  if (out.length < 2 && Array.isArray(data.term)) {
    for (const item of data.term) {
      const point = build(item.dte, ivForMode(item, mode));
      if (!point) continue;
      const at = out.findIndex((entry) => entry.dte === point.dte);
      if (at >= 0) out[at] = point;
      else out.push(point);
    }
  }
  out.sort((a, b) => a.dte - b.dte);
  return out.length >= 2 ? out : [];
}

/**
 * Least-squares slope with x = expiry ordinal (0,1,2…), so the unit is vol
 * points per expiry, not per calendar day.
 */
export function termSlope(points: readonly TermPoint[]): number | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.dte - b.dte);
  const n = sorted.length;
  const meanY = sorted.reduce((sum, point) => sum + point.iv, 0) / n;
  const meanX = (n - 1) / 2;
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = i - meanX;
    covariance += dx * (sorted[i].iv - meanY);
    variance += dx * dx;
  }
  if (!(variance > 0)) return null;
  const slope = covariance / variance;
  return Number.isFinite(slope) ? slope : null;
}

export function formatVp(vp: number | null | undefined, digits = 1): string {
  if (vp == null || !Number.isFinite(vp)) return "—";
  return `${vp < 0 ? "-" : "+"}${Math.abs(vp).toFixed(digits)} vp`;
}

function tickOf(expiries: OptionsAnalytics["expiries"]): number | null {
  let tick = Number.POSITIVE_INFINITY;
  for (const expiry of expiries) {
    const strikes = expiry.points
      .map((point) => point.strike)
      .filter(finitePositive)
      .sort((a, b) => a - b);
    for (let i = 1; i < strikes.length; i += 1) {
      const gap = strikes[i] - strikes[i - 1];
      if (gap > 0 && gap < tick) tick = gap;
    }
  }
  return Number.isFinite(tick) ? tick : null;
}

function lattice(strikes: number[], maxCols: number): number[] {
  if (strikes.length <= maxCols) return strikes;
  if (maxCols <= 1) return strikes.slice(0, 1);
  const out: number[] = [];
  for (let i = 0; i < maxCols; i += 1) {
    out.push(strikes[Math.round((i * (strikes.length - 1)) / (maxCols - 1))]);
  }
  return out;
}

/**
 * Strike × expiry iv grid. Columns come from the front expiry (sampled to
 * `maxCols`); a different expiry fills a column only at the exact strike or a
 * nearest strike within one tick. Unfillable intersections are omitted.
 */
export function surfaceGrid(data: OptionsAnalytics, maxCols = SURFACE_MAX_STRIKES): SurfaceGrid {
  const expiries = data.expiries;
  const base = expiries[0];
  const rawStrikes = base
    ? base.points.map((point) => point.strike).filter(finitePositive)
    : [];
  const strikes = lattice([...new Set(rawStrikes)].sort((a, b) => a - b), Math.max(1, maxCols));
  const labels = expiries.map((expiry) => expiry.date);
  const tick = tickOf(expiries);
  const tolerance = tick != null && tick > 0 ? tick + 1e-9 : 1e-9;
  const cells: SurfaceCell[] = [];

  for (const expiry of expiries) {
    const quoteable = expiry.points.filter(
      (point) => finitePositive(point.strike) && finitePositive(point.iv),
    );
    for (const target of strikes) {
      let best: AnalyticsIvPoint | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const point of quoteable) {
        const distance = Math.abs(point.strike - target);
        if (distance >= bestDistance) continue;
        bestDistance = distance;
        best = point;
      }
      if (!best || bestDistance > tolerance) continue;
      const match: AnalyticsIvPoint = best;
      cells.push({
        strike: target,
        expiry: expiry.date,
        iv: match.iv as number,
        delta: finite(match.delta) ? match.delta : null,
        matchedStrike: match.strike,
      });
    }
  }

  return {
    strikes,
    expiries: labels,
    cells,
    coverage: cells.length,
    total: strikes.length * expiries.length,
    tick,
  };
}

/**
 * 25Δ call iv minus 25Δ put iv (positive = calls rich). Both wings need a delta
 * near ±0.25 and a finite positive iv; without both there is no risk reversal.
 */
export function riskReversal(points: readonly AnalyticsIvPoint[]): number | null {
  const target = 0.25;
  const tolerance = 0.1;
  let call: number | null = null;
  let put: number | null = null;
  let callDistance = Number.POSITIVE_INFINITY;
  let putDistance = Number.POSITIVE_INFINITY;

  for (const point of points) {
    if (!finitePositive(point.iv) || !finite(point.delta)) continue;
    const delta = point.delta;
    if (delta > 0 && delta >= target - tolerance && delta <= target + tolerance) {
      const distance = Math.abs(delta - target);
      if (distance < callDistance) {
        callDistance = distance;
        call = point.iv;
      }
    } else if (delta < 0 && delta >= -(target + tolerance) && delta <= -(target - tolerance)) {
      const distance = Math.abs(delta + target);
      if (distance < putDistance) {
        putDistance = distance;
        put = point.iv;
      }
    }
  }

  if (call == null || put == null) return null;
  const rr = (call as number) - (put as number);
  return Number.isFinite(rr) ? rr : null;
}

/**
 * Repaint gate: a stable string for the painted smile. Spot is quantized to
 * one option tick (or 0.05% of spot when no tick is known) so a sub-tick drift
 * does not dispose every chart on each poll.
 */
export function ivSignature(
  rows: readonly AnalyticsIvPoint[],
  spot: number | null = null,
  tick: number | null = null,
): string {
  let prefix = "";
  if (finitePositive(spot)) {
    const step = finitePositive(tick) ? (tick as number) : (spot as number) * 0.0005;
    const quantized = step > 0 ? Math.round((spot as number) / step) * step : spot;
    prefix = `${quantized.toFixed(2)}|`;
  }
  const ordered = [...rows].sort((a, b) => a.strike - b.strike);
  const parts: string[] = [];
  for (const point of ordered) {
    if (!Number.isFinite(point.strike) || !finitePositive(point.iv)) continue;
    parts.push(`${point.strike}|${point.iv.toFixed(1)}`);
  }
  return prefix + parts.join(";");
}
