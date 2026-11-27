
import * as palette from "@/ui/palette";
import {
  AUTOSCALE_LEVEL_PCT,
  AUTOSCALE_RANGE_PAD_PCT,
} from "@/utils/chart/types";
import type { MarkLineData } from "@/utils/chart/types";
import { gexSideLevels, type GexSideLevel } from "./NiftyGexProfile";
import { sortByField, formatNumberIN } from "@/utils/ui-helpers";
import type {
  NiftyIntradayCandle,
  NiftyReport,
} from "@/types/niftyReport";
import type { ReplayCandle } from "@/types/replay";

const SCALE_LEVEL_PCT = AUTOSCALE_LEVEL_PCT;

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

function labelCodes(formatter: string): string[] {
  return formatter
    .split("·")
    .map((part) => part.trim().split(/\s+/)[0] ?? "")
    .filter((code) => code.length > 0);
}

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

/** Gutter level label: whole index points, Indian-grouped (`MP 22,700`),
 *  matching the pivot labels. Raw `${strike}` printed `MP 22700` beside
 *  `CW 23,000` — two number formats in one price gutter. */
function fmtMarkLevel(value: number): string {
  return formatNumberIN(Math.round(value));
}

/** Classify a wall strike relative to spot. */
export type WallSide = "above" | "below";

/** Classify a wall strike relative to spot. */
export function wallSide(strike: number, spot: number): WallSide {
  return strike > spot ? "above" : "below";
}

/** Build the label code for a call/put wall based on side vs spot. */
export function wallCode(isCall: boolean, side: WallSide, isFallbackPrimary: boolean): string {
  if (isCall) {
    if (side === "above") return "CW"; // call above spot = resistance (never fallback for calls above)
    return isFallbackPrimary ? "CW (BELOW)" : "CW↓"; // fallback = no calls above at all
  } else {
    if (side === "below") return "PW"; // put below spot = support (never fallback for puts below)
    return isFallbackPrimary ? "PW (ABOVE)" : "PW↑"; // fallback = no puts below at all
  }
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
  // `walls` are the heaviest OI across the chain (CW/PW); `wallsNear` are the
  // nearest actionable strikes and carry the NEAR prefix so the two concepts
  // never look like the same line.
  const allCalls = sortByField(report.walls?.calls ?? [], "oi", "desc");
  const allPuts = sortByField(report.walls?.puts ?? [], "oi", "desc");

  const callsAbove = allCalls.filter((w) => wallSide(w.strike, report.spot) === "above");
  const callsBelow = allCalls.filter((w) => wallSide(w.strike, report.spot) === "below");
  const primaryCall = callsAbove[0] ?? allCalls[0];
  let secondaryCall: (typeof allCalls)[0] | undefined;
  if (callsAbove.length >= 2) {
    secondaryCall = callsAbove[1];
  } else if (callsAbove.length === 1) {
    secondaryCall = callsBelow[0];
  } else {
    secondaryCall = callsBelow[1];
  }

  const putsBelow = allPuts.filter((w) => wallSide(w.strike, report.spot) === "below");
  const putsAbove = allPuts.filter((w) => wallSide(w.strike, report.spot) === "above");
  const primaryPut = putsBelow[0] ?? allPuts[0];
  let secondaryPut: (typeof allPuts)[0] | undefined;
  if (putsBelow.length >= 2) {
    secondaryPut = putsBelow[1];
  } else if (putsBelow.length === 1) {
    secondaryPut = putsAbove[0];
  } else {
    secondaryPut = putsAbove[1];
  }

  if (primaryCall) {
    const side = wallSide(primaryCall.strike, report.spot);
    const isFallbackPrimary = callsAbove.length === 0; // no calls above → this primary is fallback
    lines.push({
      yAxis: primaryCall.strike,
      includeInScale: inScale(primaryCall.strike),
      lineStyle: { color: palette.NEGATIVE, type: "dashed", width: 1 },
      label: {
        position: "insideEndTop",
        formatter: `${wallCode(true, side, isFallbackPrimary)} ${fmtMarkLevel(primaryCall.strike)}`,
      },
    });
    used.push(primaryCall.strike);
  }
  if (secondaryCall && secondaryCall.strike !== primaryCall?.strike) {
    const side = wallSide(secondaryCall.strike, report.spot);
    // Secondary is never fallback primary
    lines.push({
      yAxis: secondaryCall.strike,
      includeInScale: inScale(secondaryCall.strike),
      lineStyle: { color: palette.NEGATIVE, type: "dashed", width: 1 },
      label: {
        position: "insideEndTop",
        formatter: `${wallCode(true, side, false)} ${fmtMarkLevel(secondaryCall.strike)}`,
      },
    });
    used.push(secondaryCall.strike);
  }

  if (primaryPut) {
    const side = wallSide(primaryPut.strike, report.spot);
    const isFallbackPrimary = putsBelow.length === 0; // no puts below → this primary is fallback
    lines.push({
      yAxis: primaryPut.strike,
      includeInScale: inScale(primaryPut.strike),
      lineStyle: { color: palette.POSITIVE, type: "dashed", width: 1 },
      label: {
        position: "insideEndTop",
        formatter: `${wallCode(false, side, isFallbackPrimary)} ${fmtMarkLevel(primaryPut.strike)}`,
      },
    });
    used.push(primaryPut.strike);
  }
  if (secondaryPut && secondaryPut.strike !== primaryPut?.strike) {
    const side = wallSide(secondaryPut.strike, report.spot);
    // Secondary is never fallback primary
    lines.push({
      yAxis: secondaryPut.strike,
      includeInScale: inScale(secondaryPut.strike),
      lineStyle: { color: palette.POSITIVE, type: "dashed", width: 1 },
      label: {
        position: "insideEndTop",
        formatter: `${wallCode(false, side, false)} ${fmtMarkLevel(secondaryPut.strike)}`,
      },
    });
    used.push(secondaryPut.strike);
  }
  // Near walls: same line style, explicit NEAR code so a 23,900 near wall is
  // never confused with the 24,000 max-OI wall. Skipped when the max wall is
  // already on that strike (it is the same level, not a second one).
  const nearCalls = sortByField(report.wallsNear?.calls ?? [], "oi", "desc").slice(0, 1);
  const nearPuts = sortByField(report.wallsNear?.puts ?? [], "oi", "desc").slice(0, 1);
  for (const w of nearCalls) {
    if (!fresh(w.strike)) continue;
    lines.push({
      yAxis: w.strike,
      includeInScale: inScale(w.strike),
      lineStyle: { color: palette.NEGATIVE, type: "dotted", width: 1 },
      label: { position: "insideEndTop", formatter: `NEAR CW ${fmtMarkLevel(w.strike)}` },
    });
    used.push(w.strike);
  }
  for (const w of nearPuts) {
    if (!fresh(w.strike)) continue;
    lines.push({
      yAxis: w.strike,
      includeInScale: inScale(w.strike),
      lineStyle: { color: palette.POSITIVE, type: "dotted", width: 1 },
      label: { position: "insideEndTop", formatter: `NEAR PW ${fmtMarkLevel(w.strike)}` },
    });
    used.push(w.strike);
  }
  if (Number.isFinite(report.maxPain) && report.maxPain > 0) {
    lines.push({
      yAxis: report.maxPain,
      includeInScale: inScale(report.maxPain),
      lineStyle: { color: palette.PRIMARY, type: "solid", width: 2 },
      label: { position: "insideEndTop", formatter: `MP ${fmtMarkLevel(report.maxPain)}` },
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
          formatter: `${code} ${fmtMarkLevel(value)}`,
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
