import * as palette from "@/ui/palette";
import type { NiftyReport } from "@/types/niftyReport";
import type { ReplayCandle } from "@/types/replay";
import { sortByField } from "@/utils/ui-helpers";
import { wallCode, wallSide } from "./niftyChartMath";
import { fmtStrike, num } from "./NiftyDepthMap.format";

export const DEPTH_WINDOW = 750;

export const DEPTH_MAX_ROWS = 31;

const LEVEL_DEDUPE_PTS = 25;

const CANDLE_PAD_PCT = 0.0015;

export interface DepthRow {
  strike: number;
  ceOi: number;
  peOi: number;
}

export interface DayStats {
  hi: number | null;
  lo: number | null;
  changePct: number | null;
  last: number | null;
}

export interface LevelLine {
  name: string;
  value: number;
  color: string;
  type: "dashed" | "solid" | "dotted";
  width: string;
}

export function buildDepthRows(report: NiftyReport): DepthRow[] {
  const strikes = Array.isArray(report?.strikes) ? report.strikes : [];
  const spot = num(report?.spot);
  const inWindow = sortByField(
    strikes
      .filter((s) => s && Number.isFinite(Number(s.strike)) && Math.abs(Number(s.strike) - spot) <= DEPTH_WINDOW)
      .map((s) => ({
        strike: Number(s.strike),
        ceOi: num(s?.ce?.oi),
        peOi: num(s?.pe?.oi),
      })),
    "strike",
    "asc",
  );
  if (inWindow.length <= DEPTH_MAX_ROWS) return inWindow;
  return inWindow
    .slice()
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
    .slice(0, DEPTH_MAX_ROWS)
    .sort((a, b) => a.strike - b.strike);
}

export function findOiPoc(report: NiftyReport): number | null {
  const strikes = Array.isArray(report?.strikes) ? report.strikes : [];
  let best: number | null = null;
  let bestTotal = -Infinity;
  for (const s of strikes) {
    if (!s || !Number.isFinite(Number(s.strike))) continue;
    const total = num(s?.ce?.oi) + num(s?.pe?.oi);
    if (total > bestTotal) {
      bestTotal = total;
      best = Number(s.strike);
    }
  }
  return best;
}

export function dayStats(report: NiftyReport): DayStats {
  const empty: DayStats = { hi: null, lo: null, changePct: null, last: null };
  const candles = Array.isArray(report?.candles) ? report.candles : [];
  const valid = candles.filter(
    (c) =>
      c &&
      Number.isFinite(Number(c.high)) &&
      Number.isFinite(Number(c.low)) &&
      Number.isFinite(Number(c.close)),
  );
  if (valid.length === 0) return empty;
  const hi = Math.max(...valid.map((c) => Number(c.high)));
  const lo = Math.min(...valid.map((c) => Number(c.low)));
  const first = Number(valid[0].close);
  const last = Number(valid[valid.length - 1].close);
  return {
    hi,
    lo,
    changePct: first !== 0 ? ((last - first) / first) * 100 : null,
    last,
  };
}

/**
 * Candle `time` strings are IST wall-clock without an offset
 * ("2026-10-12T09:15:00"). Interpret them as Asia/Kolkata so the epoch is
 * correct regardless of host TZ; pass through values that already carry one.
 * Numeric input is tolerated (epoch ms, or epoch seconds below 1e12);
 * anything unparseable ("", "NaT", garbage) yields NaN so callers can drop
 * the candle instead of rendering a blank/misaligned time label.
 */
export function candleEpochMs(t: string | number): number {
  if (typeof t === "number") {
    if (!Number.isFinite(t)) return NaN;
    return t < 1e12 ? t * 1000 : t;
  }
  if (typeof t !== "string" || t.trim().length === 0) return NaN;
  const s = t.trim();
  if (/^nat$/i.test(s)) return NaN;
  const hasTz = /Z|[+-]\d{2}:?\d{2}$/.test(s);
  const iso = !hasTz && s.length === 19 ? `${s}+05:30` : s;
  return new Date(iso).getTime();
}

/** Candles need valid OHLC *and* a parseable time: the candlestick series is
 * index-coupled to its category x-axis, so dropping a candle from one array
 * only would shift every later time label. */
export function chartCandles(report: NiftyReport): ReplayCandle[] {
  return (Array.isArray(report?.candles) ? report.candles : []).filter(
    (c) =>
      c &&
      Number.isFinite(Number(c.open)) &&
      Number.isFinite(Number(c.close)) &&
      Number.isFinite(Number(c.high)) &&
      Number.isFinite(Number(c.low)) &&
      Number.isFinite(candleEpochMs(c.time)),
  );
}

/** Candle extremes only, padded ±0.15% — bar/tag extents never stretch the
 * price axis, so out-of-range bars clip instead of crushing the candles. */
export function candleYRange(candles: ReplayCandle[]): { min: number; max: number } {
  let yMin = 0;
  let yMax = 1;
  const candleVals = candles.flatMap((c) => [Number(c.high), Number(c.low)]);
  if (candleVals.length > 0) {
    const lo = Math.min(...candleVals);
    const hi = Math.max(...candleVals);
    if (hi > lo) {
      yMin = lo * (1 - CANDLE_PAD_PCT);
      yMax = hi * (1 + CANDLE_PAD_PCT);
    } else {
      yMin = lo - 50;
      yMax = hi + 50;
    }
  }
  return { min: yMin, max: yMax };
}

export function oiChangeByStrike(report: NiftyReport): Map<number, number> {
  return new Map<number, number>(
    (Array.isArray(report?.strikes) ? report.strikes : [])
      .filter((s) => s && Number.isFinite(Number(s.strike)))
      .map((s) => [Number(s.strike), num(s?.ce?.oiChange) + num(s?.pe?.oiChange)]),
  );
}

/**
 * Strikes that earn an outside-end bar label: top-3 by CE OI plus top-3 by
 * PE OI (union, so at most 6). Everything else stays unlabeled.
 */
export function topOiLabelStrikes(rows: DepthRow[]): number[] {
  const top3 = (pick: (r: DepthRow) => number): number[] =>
    rows
      .slice()
      .sort((a, b) => pick(b) - pick(a))
      .slice(0, 3)
      .map((r) => r.strike);
  return [...new Set([...top3((r) => r.ceOi), ...top3((r) => r.peOi)])];
}

/**
 * Level tags in placement-priority order (Spot > MP > CW/PW > OI-POC >
 * Hi/Lo), skipping any tag within 25pts of an already-placed one — the same
 * dedupe rule the report panel uses.
 */
export function levelLines(report: NiftyReport, stats: DayStats, poc: number | null): LevelLine[] {
  const spot = num(report?.spot);
  const ordered: LevelLine[] = [];
  if (Number.isFinite(spot) && spot > 0) {
    ordered.push({ name: `Spot ${fmtStrike(spot)}`, value: spot, color: palette.TEXT, type: "solid", "width": "1px" });
  }
  if (Number.isFinite(Number(report?.maxPain)) && Number(report.maxPain) > 0) {
    ordered.push({ name: `MP ${fmtStrike(Number(report.maxPain))}`, value: Number(report.maxPain), color: palette.PRIMARY, type: "solid", "width": "2px" });
  }
  const calls = [...(report?.walls?.calls ?? [])].sort((a, b) => num(b?.oi) - num(a?.oi)).slice(0, 2);
  const puts = [...(report?.walls?.puts ?? [])].sort((a, b) => num(b?.oi) - num(a?.oi)).slice(0, 2);
  for (const w of calls) {
    if (!Number.isFinite(Number(w?.strike))) continue;
    const strike = Number(w.strike);
    const ws = wallSide(strike, spot);
    const tag = wallCode(true, ws, false);
    ordered.push({ name: `${tag} ${fmtStrike(strike)}`, value: strike, color: palette.NEGATIVE, type: "dashed", "width": "1px" });
  }
  for (const w of puts) {
    if (!Number.isFinite(Number(w?.strike))) continue;
    const strike = Number(w.strike);
    const ws = wallSide(strike, spot);
    const tag = wallCode(false, ws, false);
    ordered.push({ name: `${tag} ${fmtStrike(strike)}`, value: strike, color: palette.POSITIVE, type: "dashed", "width": "1px" });
  }
  if (poc != null && Number.isFinite(poc)) {
    ordered.push({ name: `OI POC ${fmtStrike(poc)}`, value: poc, color: palette.WARNING, type: "solid", "width": "2px" });
  }
  if (stats.hi != null) {
    ordered.push({ name: `Hi ${fmtStrike(stats.hi)}`, value: stats.hi, color: palette.TEXT_MUTED, type: "dotted", "width": "1px" });
  }
  if (stats.lo != null) {
    ordered.push({ name: `Lo ${fmtStrike(stats.lo)}`, value: stats.lo, color: palette.TEXT_MUTED, type: "dotted", "width": "1px" });
  }
  const used: number[] = [];
  const out: LevelLine[] = [];
  for (const line of ordered) {
    if (!used.every((u) => Math.abs(u - line.value) > LEVEL_DEDUPE_PTS)) continue;
    used.push(line.value);
    out.push(line);
  }
  return out;
}

/**
 * ECharts ordinal scales match series values to categories by *string*
 * identity — a numeric 2-D value ([oi, 22350]) silently fails the lookup and
 * renders nothing. All consumers Number() the key back before row lookup.
 */
export const depthKey = (strike: number): string => String(strike);
