/**
 * The numbers the desk plan is built on — the structural levels (support,
 * resistance, walls, session extremes) and the thresholds that shape them.
 *
 * Pure and total: a report missing `gex`, `pivots` or `strikes` still yields
 * a usable set of levels, with absent values reported as `null`.
 */

import type { NiftyReport, NiftyWall } from "@/types/niftyReport";
import { formatReportNum } from "./reportFormat";

/** Indian-grouped number, no decimals by default (levels are index points). */
export function fmtDeskNum(value: number | null | undefined, digits = 0): string {
  return formatReportNum(value, { digits, minDigits: digits });
}

/** Touches of a level count when the wick comes within this much of it. */
export const TOUCH_TOLERANCE_PCT = 0.0015;
/** Stop sits beyond the trigger by the larger of 8 index points or 0.08%. */
export const MIN_STOP_PTS = 8;
export const STOP_BUFFER_PCT = 0.0008;
/** A target must pay at least this much for the risk taken. */
export const MIN_RR = 1.5;
/** When no structural target pays, project this multiple of risk. */
export const PROJECT_R = 2;
/** A 5-min run beyond this many index points is a chase, not an entry. */
export const CHASE_PTS = 30;
/** Premium already up this much since the reference open is a chase too. */
export const CHASE_PREMIUM_PCT = 5;
/** IV/RV above this is "rich" — buying premium into a level has no edge. */
export const RICH_IV_RV = 1.15;

export function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Positive-only numeric (price, strike, OI, IV); zero/absent → null. */
export function positive(value: unknown): number | null {
  const n = finite(value);
  return n !== null && n > 0 ? n : null;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function mean(values: number[]): number | null {
  return values.length > 0
    ? values.reduce((sum, v) => sum + v, 0) / values.length
    : null;
}

export function topWall(list: NiftyWall[] | undefined | null): NiftyWall | null {
  if (!Array.isArray(list)) return null;
  let best: NiftyWall | null = null;
  for (const row of list) {
    const strike = positive(row?.strike);
    if (strike === null) continue;
    const oi = positive(row?.oi) ?? 0;
    if (best === null || oi > best.oi) best = { strike, oi };
  }
  return best;
}

/** Highest level strictly below `level` (nearest support / next target down). */
function nearestBelow(
  levels: Array<number | null | undefined>,
  level: number,
): number | null {
  let best: number | null = null;
  for (const raw of levels) {
    const n = positive(raw);
    if (n === null || n >= level) continue;
    if (best === null || n > best) best = n;
  }
  return best;
}

/** Lowest level strictly above `level` (nearest resistance / next target up). */
function nearestAbove(
  levels: Array<number | null | undefined>,
  level: number,
): number | null {
  let best: number | null = null;
  for (const raw of levels) {
    const n = positive(raw);
    if (n === null || n <= level) continue;
    if (best === null || n < best) best = n;
  }
  return best;
}

interface SessionExtremes {
  low: number | null;
  high: number | null;
}

function sessionExtremes(report: NiftyReport): SessionExtremes {
  let low: number | null = null;
  let high: number | null = null;
  const candles = Array.isArray(report.intraday) ? report.intraday : [];
  for (const candle of candles) {
    const l = positive(candle?.low);
    const h = positive(candle?.high);
    if (l !== null && (low === null || l < low)) low = l;
    if (h !== null && (high === null || h > high)) high = h;
  }
  // The exchange day-OHLC (quote feed) and the 1-minute chart candles come from
  // different feeds: late in a slide the quote low can print below every chart
  // bar (live: spot 22,698 under a 22,700 candle low while ohlc.low is 22,695).
  // Folding the OHLC extremes in — min for the low, max for the high — keeps
  // the desk on the true traded extreme instead of a stale candle level, which
  // previously pushed the bear trigger down to the far GEX fuel (22,500).
  // Replay frames / old snapshots with no intraday bars still fall back to the
  // day OHLC, the same source the stat strip uses.
  const ohlcLow = positive(report.ohlc?.low);
  const ohlcHigh = positive(report.ohlc?.high);
  if (ohlcLow !== null && (low === null || ohlcLow < low)) low = ohlcLow;
  if (ohlcHigh !== null && (high === null || ohlcHigh > high)) high = ohlcHigh;
  return { low, high };
}

/** Every wall strike, not just the biggest one — the nearest wall is the level. */
export function wallStrikes(list: NiftyWall[] | undefined | null): number[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((row) => positive(row?.strike))
    .filter((strike): strike is number => strike !== null);
}

export interface Levels {
  spot: number | null;
  support: number | null;
  resistance: number | null;
  sessionLow: number | null;
  sessionHigh: number | null;
  /** Confirmation for a downside break: the lower of support and session low. */
  downsideBreak: number | null;
  callWalls: number[];
  putWalls: number[];
  maxPain: number | null;
}

export function computeLevels(report: NiftyReport): Levels {
  const spot = positive(report.spot);
  const pivots = report.pivots ?? null;
  const gexLevels = report.gex?.levels;
  const callWalls = wallStrikes(report.walls?.calls);
  const putWalls = wallStrikes(report.walls?.puts);
  const maxPain = positive(report.maxPain);
  const session = sessionExtremes(report);

  // Call walls (all strikes, not only the top-OI one) and max pain are the
  // levels a rally has to reclaim; the old "top wall" pick skipped the nearer
  // wall and pushed the bull trigger hundreds of points away from spot. The
  // session high joins them: a high printed above spot is the first supply the
  // rally has to clear, symmetric to the session low on the support side.
  const support =
    spot === null
      ? null
      : nearestBelow(
          [pivots?.s1, gexLevels?.fuelDown?.strike, ...putWalls, session.low, maxPain],
          spot,
        );

  const resistance =
    spot === null
      ? null
      : nearestAbove(
          [pivots?.r1, gexLevels?.resistance?.strike, ...callWalls, maxPain, session.high],
          spot,
        );

  // A downside break needs the weaker of the two: price has already traded the
  // session low, so that is the level a close below confirms distribution.
  const downsideBreak =
    support === null
      ? session.low
      : session.low === null
        ? support
        : Math.min(support, session.low);

  return {
    spot,
    support,
    resistance,
    sessionLow: session.low,
    sessionHigh: session.high,
    downsideBreak,
    callWalls,
    putWalls,
    maxPain,
  };
}
