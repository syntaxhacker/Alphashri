/**
 * The Nifty chart's pure maths — the price scale guard, the mark-line model,
 * candle resampling and the EMA overlay.
 *
 * Split out of `NiftyChartPanel.tsx` so the panel only carries the component.
 * Nothing here touches React: every function is a plain derivation of the
 * report the caller already has, which is what lets the panel memoise them
 * and lets the maths be unit-tested on its own.
 */

import * as palette from "@/ui/palette";
import {
  AUTOSCALE_LEVEL_PCT,
  AUTOSCALE_RANGE_PAD_PCT,
} from "@/utils/chart/types";
import type { MarkLineData } from "@/utils/chart/types";
import { gexSideLevels, type GexSideLevel } from "./NiftyGexProfile";
import { sortByField } from "@/utils/ui-helpers";
import type {
  NiftyIntradayCandle,
  NiftyReport,
} from "@/types/niftyReport";
import type { ReplayCandle } from "@/types/replay";

/**
 * Max distance from spot (as a fraction of spot) at which a level is allowed
 * to widen the price scale. 0.6% ≈ 136 pts at a 22,740 spot — enough for the
 * GEX/pivot cluster around the tape, nowhere near the 22,500 fuel or 23,300
 * R2. Far levels are still drawn; they just never squash the candles.
 */
const SCALE_LEVEL_PCT = AUTOSCALE_LEVEL_PCT;

/** Extra band around the visible candle range, as a fraction of that range,
 *  that still counts as "visible" for scale purposes (i.e. ±5%). */
const SCALE_RANGE_PAD_PCT = AUTOSCALE_RANGE_PAD_PCT;

/** Two axis labels closer than this fraction of spot (≈23 pts at 22,740, or
 *  roughly one label height on the price gutter) would overlap; merge them. */
const LABEL_COLLISION_PCT = 0.001;

/** Filter `levels` to those within ±`pct` of `spot`. Pure and directly
 *  testable — the scale guard used by `buildMarkLines`. */
export function levelsWithinScale(
  levels: number[],
  spot: number,
  pct = SCALE_LEVEL_PCT,
): number[] {
  if (!Number.isFinite(spot) || spot <= 0) return [];
  const band = Math.abs(spot) * pct;
  return levels.filter(
    (v) => Number.isFinite(v) && v > 0 && Math.abs(v - spot) <= band,
  );
}

/** Session low/high from the candles actually charted (1m preferred, then the
 *  15m/EOD candles, then the OHLC summary). `null` when nothing usable. */
export function candlePriceRange(report: NiftyReport): { low: number; high: number } | null {
  const src =
    report.intraday && report.intraday.length > 0
      ? report.intraday
      : report.candles && report.candles.length > 0
        ? report.candles
        : null;
  if (src) {
    let low = Infinity;
    let high = -Infinity;
    for (const c of src) {
      if (Number.isFinite(c.low)) low = Math.min(low, c.low);
      if (Number.isFinite(c.high)) high = Math.max(high, c.high);
    }
    if (Number.isFinite(low) && Number.isFinite(high) && high > low) {
      return { low, high };
    }
  }
  const o = report.ohlc;
  if (o && Number.isFinite(o.low) && Number.isFinite(o.high) && o.high > o.low) {
    return { low: o.low, high: o.high };
  }
  return null;
}

/**
 * Price gap at which two gutter labels overlap for a given chart height.
 * A label row is ~20px, so the equivalent price gap is the session span
 * divided by the panel height, times 20px. Short panels (S = 180px) therefore
 * merge more aggressively than tall ones (XL = 760px). Pure and testable.
 */
export function labelGapPctFor(
  report: NiftyReport,
  height: number,
  rowPx = 20,
): number {
  const range = candlePriceRange(report);
  const span = range ? range.high - range.low : report.spot * 0.02;
  const gap = (span / Math.max(height, 1)) * rowPx;
  const spot = report.spot > 0 ? report.spot : 1;
  return Math.min(0.01, Math.max(LABEL_COLLISION_PCT, gap / spot));
}

/** True when a level is close enough to spot (or to the visible candle range
 *  plus a small pad) to be worth folding into the price scale. */
export function levelBelongsToScale(
  level: number,
  spot: number,
  range: { low: number; high: number } | null,
): boolean {
  if (levelsWithinScale([level], spot).length > 0) return true;
  if (!range) return false;
  const pad = (range.high - range.low) * SCALE_RANGE_PAD_PCT;
  return level >= range.low - pad && level <= range.high + pad;
}

/** Codes in one formatter ("CW", "R1", "FLIP", "GFUEL↓", …) — used when
 *  merging a colliding label onto the neighbouring line. Handles already
 *  merged labels (`CW 23,000 · GRES`) by returning both codes. */
function labelCodes(formatter: string): string[] {
  return formatter
    .split("·")
    .map((part) => part.trim().split(/\s+/)[0] ?? "")
    .filter((code) => code.length > 0);
}

/**
 * Merge labels that would render on top of each other. Price lines closer
 * than `LABEL_COLLISION_PCT * spot` (~34 pts at 22,740) share one gutter
 * label instead of stacking unreadable tokens: the first line keeps its
 * price + style, later codes are appended (`PP 22,970 · MP`). Duplicate lines
 * inside the cluster are dropped — the same behaviour the GEX merge already
 * used for `CW 23,000 · GRES`, now applied to every mark line.
 */
export function mergeCollidingLabels(
  lines: MarkLineData[],
  spot: number,
  pct = LABEL_COLLISION_PCT,
): MarkLineData[] {
  if (lines.length < 2) return lines;
  const ref =
    Number.isFinite(spot) && spot > 0
      ? spot
      : Math.max(...lines.map((l) => l.yAxis));
  const gap = Math.abs(ref) * pct;
  if (!Number.isFinite(gap) || gap <= 0) return lines;

  const sorted = [...lines].sort((a, b) => a.yAxis - b.yAxis);
  const out: MarkLineData[] = [];
  for (const line of sorted) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(line.yAxis - prev.yAxis) <= gap) {
      const extra = labelCodes(line.label.formatter).filter(
        (code) => !prev.label.formatter.includes(code),
      );
      out[out.length - 1] = {
        ...prev,
        includeInScale: prev.includeInScale || line.includeInScale,
        label: {
          ...prev.label,
          formatter: extra.length
            ? `${prev.label.formatter} · ${extra.join(" · ")}`
            : prev.label.formatter,
        },
      };
      continue;
    }
    out.push({ ...line });
  }
  return out;
}

export function buildMarkLines(
  report: NiftyReport,
  withGex = false,
  labelGapPct = LABEL_COLLISION_PCT,
): MarkLineData[] {
  const lines: MarkLineData[] = [];
  const used: number[] = [];
  const fresh = (s: number) => !used.some((u) => Math.abs(u - s) <= 25);
  // Levels far from the tape stay drawn but must not widen the price scale:
  // otherwise a 22,500 fuel line + 23,300 R2 stretch the axis to ~800 pts and
  // squash a ~420-pt session into the lower third of the panel.
  const session = candlePriceRange(report);
  const inScale = (level: number) =>
    levelBelongsToScale(level, report.spot, session);

  // Call/put walls and max pain as horizontal price LINES. These were shaded
  // price zones previously; the bands were too heavy, so they are lines now.
  const topCalls = sortByField(report.walls.calls, "oi", "desc").slice(0, 2);
  const topPuts = sortByField(report.walls.puts, "oi", "desc").slice(0, 2);
  for (const w of topCalls) {
    lines.push({
      yAxis: w.strike,
      includeInScale: inScale(w.strike),
      lineStyle: { color: palette.NEGATIVE, type: "dashed", width: 1 },
      label: { position: "insideEndTop", formatter: `CW ${w.strike}` },
    });
    used.push(w.strike);
  }
  for (const w of topPuts) {
    lines.push({
      yAxis: w.strike,
      includeInScale: inScale(w.strike),
      lineStyle: { color: palette.POSITIVE, type: "dashed", width: 1 },
      label: { position: "insideEndTop", formatter: `PW ${w.strike}` },
    });
    used.push(w.strike);
  }
  if (Number.isFinite(report.maxPain) && report.maxPain > 0) {
    lines.push({
      yAxis: report.maxPain,
      includeInScale: inScale(report.maxPain),
      lineStyle: { color: palette.PRIMARY, type: "solid", width: 2 },
      label: { position: "insideEndTop", formatter: `MP ${report.maxPain}` },
    });
    used.push(report.maxPain);
  }

  // Prior-session pivots: PP anchors the day (solid muted); resistance above
  // (dashed red) and support below (dashed green). Levels are computed by the
  // backend (`pivots` block, null-safe); nulls are skipped and anything that
  // lands within 25 pts of an already-drawn line is de-duped like GEX tags.
  const pivot = report.pivots;
  if (pivot) {
    const levels: [string, number | null, string, string][] = [
      ["PP", pivot.pp, palette.TEXT_MUTED, "solid"],
      ["R1", pivot.r1, palette.NEGATIVE, "dashed"],
      ["R2", pivot.r2, palette.NEGATIVE, "dashed"],
      ["S1", pivot.s1, palette.POSITIVE, "dashed"],
      ["S2", pivot.s2, palette.POSITIVE, "dashed"],
    ];
    for (const [code, value, color, lineType] of levels) {
      if (value === null || !Number.isFinite(value) || !fresh(value)) continue;
      lines.push({
        yAxis: value,
        includeInScale: inScale(value),
        lineStyle: { color, type: lineType, width: 1 },
        label: {
          position: "insideEndTop",
          formatter: `${code} ${Math.round(value).toLocaleString("en-IN")}`,
        },
      });
      used.push(value);
    }
  }

  // Optional live GEX overlay: flip + spot-relative gamma levels. A
  // positive-gamma strike is a pin magnet on ITS side (support below spot,
  // resistance above); a negative-gamma strike is move fuel on that side, so it
  // is tagged GFUEL and never mislabelled support/resistance (the old code
  // called the global minimum "GRES" even when it sat below spot).
  if (!withGex || !report.gex) {
    return mergeCollidingLabels(lines, report.spot, labelGapPct);
  }

  /**
   * A GEX level is the live, actionable reading, so it must never disappear
   * just because a top wall / max-pain / pivot line happens to sit on the same
   * strike. That was the 2026-10-21 bug: GRES 23,000 collided with `CW 23,000`
   * and GFUEL 22,500 with `PW 22,500`, so the overlay silently dropped both
   * while the legend kept advertising them. Collisions now merge the tags into
   * one line at the GEX price (GEX style wins), keeping the gutter dense.
   */
  const addGex = (code: string, level: number, color: string, type: string) => {
    if (!Number.isFinite(level) || level <= 0) return;
    const idx = lines.findIndex((l) => Math.abs(l.yAxis - level) <= 25);
    const lineStyle = { color, type, width: 1 };
    if (idx >= 0) {
      const prior = lines[idx];
      lines[idx] = {
        yAxis: level,
        lineStyle,
        includeInScale: inScale(level),
        label: {
          position: prior.label.position,
          formatter: `${prior.label.formatter} · ${code}`,
        },
      };
    } else {
      lines.push({
        yAxis: level,
        lineStyle,
        includeInScale: inScale(level),
        label: { position: "insideEndTop", formatter: `${code} ${level}` },
      });
    }
  };

  const g = report.gex;
  if (g) {
    if (g.zeroCross != null && Number.isFinite(g.zeroCross)) {
      addGex("FLIP", g.zeroCross, palette.WARNING, "dotted");
    }
    const sides = gexSideLevels(g, report.spot);
    for (const level of [sides.below, sides.above]) {
      if (!level) continue;
      addGex(gexLineTag(level), level.strike, gexLineColor(level), "solid");
    }
  }
  return mergeCollidingLabels(lines, report.spot, labelGapPct);
}

/** Chart tag for one spot-relative GEX level. */
function gexLineTag(level: GexSideLevel): string {
  if (level.kind === "support") return "GSUP";
  if (level.kind === "resistance") return "GRES";
  return level.side === "below" ? "GFUEL↓" : "GFUEL↑";
}

/** Chart colour for one spot-relative GEX level. */
function gexLineColor(level: GexSideLevel): string {
  if (level.kind === "support") return palette.POSITIVE;
  if (level.kind === "resistance") return palette.NEGATIVE;
  return palette.WARNING;
}

/** One candle timestamp split into wall-clock parts. `offset` keeps the
 *  source's timezone suffix (e.g. "+05:30") so bucket timestamps stay on the
 *  same timezone semantics as the candles they were built from. */
interface CandleClock {
  day: string;
  hh: number;
  mm: number;
  offset: string;
}

function parseCandleClock(time: string): CandleClock | null {
  const m =
    /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}):(\d{2})(?::\d{2})?(Z|[+-]\d{2}:?\d{2})?/.exec(
      time,
    );
  if (!m) return null;
  return {
    day: m[1],
    hh: Number(m[2]),
    mm: Number(m[3]),
    offset: m[4] ?? "",
  };
}

/**
 * Resample candles into `minutes` bars for the Nifty chart timeframe toggle.
 * Buckets key on `floor(minutesSinceMidnight / minutes)` per calendar day —
 * the candle's own wall clock, never UTC math — so NSE's 09:15 open stays
 * bucket-aligned for both 5m and 15m. OHLCV folds first-open / max-high /
 * min-low / last-close / summed-volume per bucket. 1m returns the input
 * element-for-element (intraday candles may lack `volume`, which the chart
 * treats as 0; resampled buckets always carry a summed volume). Candles whose
 * timestamp cannot be parsed are skipped — they have no bucket to join.
 */
export function resampleCandles(
  candles: (NiftyIntradayCandle | ReplayCandle)[],
  minutes: number,
): ReplayCandle[] {
  // Normalize once: intraday candles may lack `volume` (the chart treats it
  // as 0); resampled buckets always carry a summed volume.
  const src: ReplayCandle[] = candles.map((c): ReplayCandle =>
    "volume" in c ? c : { ...c, volume: 0 },
  );
  if (minutes <= 1) return src;
  const out: ReplayCandle[] = [];
  let curDay = "";
  let curBucket = -1;
  let cur: ReplayCandle | null = null;
  const flush = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  for (const c of src) {
    const clock = parseCandleClock(c.time);
    if (!clock) continue;
    const bucket = Math.floor((clock.hh * 60 + clock.mm) / minutes);
    if (cur && curDay === clock.day && curBucket === bucket) {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
    } else {
      flush();
      const start = bucket * minutes;
      const hh = String(Math.floor(start / 60)).padStart(2, "0");
      const mm = String(start % 60).padStart(2, "0");
      curDay = clock.day;
      curBucket = bucket;
      cur = {
        time: `${clock.day}T${hh}:${mm}:00${clock.offset}`,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      };
    }
  }
  flush();
  return out;
}

/**
 * EMA(period) over `closes`, aligned index-wise. Seeded with the mean of the
 * first `period` closes, then recursive; points before the seed are `null`.
 * Pure, so the panel recomputes it on the displayed (resampled) candles and
 * the overlays always match the charted timeframe.
 */
export function emaSeries(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = closes.map(() => null);
  if (period < 1 || closes.length < period) return out;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}
