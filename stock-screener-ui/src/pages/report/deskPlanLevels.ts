
import type { NiftyReport, NiftyWall } from "@/types/niftyReport";
import { formatReportNum } from "./reportFormat";

export function fmtDeskNum(value: number | null | undefined, digits = 0): string {
  return formatReportNum(value, { digits, minDigits: digits });
}

export const TOUCH_TOLERANCE_PCT = 0.0015;
export const MIN_STOP_PTS = 8;
export const STOP_BUFFER_PCT = 0.0008;
export const MIN_RR = 1.5;
export const PROJECT_R = 2;
export const CHASE_PTS = 30;
export const CHASE_PREMIUM_PCT = 5;
export const RICH_IV_RV = 1.15;

export function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

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

function nearestLevel(
  levels: Array<number | null | undefined>,
  level: number,
  side: "below" | "above",
): number | null {
  let best: number | null = null;
  for (const raw of levels) {
    const n = positive(raw);
    if (n === null) continue;
    if (side === "below" ? n >= level : n <= level) continue;
    if (best === null || (side === "below" ? n > best : n < best)) best = n;
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

  const support =
    spot === null
      ? null
      : nearestLevel(
          [pivots?.s1, gexLevels?.fuelDown?.strike, ...putWalls, session.low, maxPain],
          spot,
          "below",
        );

  const resistance =
    spot === null
      ? null
      : nearestLevel(
          [pivots?.r1, gexLevels?.resistance?.strike, ...callWalls, maxPain, session.high],
          spot,
          "above",
        );

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
