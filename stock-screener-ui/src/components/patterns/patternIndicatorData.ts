import type { ChartIndicators, IndicatorSeriesId, SRZone } from "@/types/chartPatterns";
import * as palette from "@/ui/palette";
import { toEpochSeconds } from "@/utils/chart/time";

export type IndicatorLineStyle = "solid" | "dashed" | "dotted";

export interface IndicatorSeriesMeta {
  legendName: string;
  color: string;
  lineStyle: IndicatorLineStyle;
  width: number;
}

/**
 * Presentation contract for every indicator id. BB upper/middle/lower share a
 * legend name (one toggle hides the band) while keeping distinct stable ids.
 */
export const INDICATOR_SERIES_META: Readonly<Record<IndicatorSeriesId, IndicatorSeriesMeta>> = {
  sma20: {
    legendName: "SMA20",
    color: palette.INDICATOR_BLUE_A,
    lineStyle: "solid",
    width: 1,
  },
  sma50: {
    legendName: "SMA50",
    color: palette.INDICATOR_LINE,
    lineStyle: "solid",
    width: 1,
  },
  sma200: {
    legendName: "SMA200",
    color: palette.PIVOT_PP,
    lineStyle: "solid",
    width: 1,
  },
  bbUpper: {
    legendName: "BB",
    color: palette.PIVOT_S2,
    lineStyle: "dashed",
    width: 1,
  },
  bbMiddle: {
    legendName: "BB",
    color: palette.PIVOT_S2,
    lineStyle: "dashed",
    width: 1,
  },
  bbLower: {
    legendName: "BB",
    color: palette.PIVOT_S2,
    lineStyle: "dashed",
    width: 1,
  },
  vwap: {
    legendName: "VWAP",
    color: palette.SCALE_YELLOW[0]!,
    lineStyle: "dotted",
    width: 1,
  },
};

/** Draw order: averages, then the band, then VWAP. */
export const INDICATOR_SERIES_ORDER: readonly IndicatorSeriesId[] = [
  "sma20",
  "sma50",
  "sma200",
  "bbUpper",
  "bbMiddle",
  "bbLower",
  "vwap",
];

/** Single legend toggle for every golden/death cross marker. */
export const CROSSES_LEGEND_NAME = "Crosses";

export const SR_ZONE_LEGEND_NAMES: Readonly<Record<SRZone["kind"], string>> = {
  support: "Support",
  resistance: "Resistance",
  sr: "S/R",
};

export const SR_ZONE_COLORS: Readonly<Record<SRZone["kind"], string>> = {
  support: palette.POSITIVE,
  resistance: palette.NEGATIVE,
  sr: palette.WARNING,
};

export interface IndicatorPoint {
  time: number;
  value: number;
}

export interface AlignedIndicatorSeries extends IndicatorSeriesMeta {
  id: IndicatorSeriesId;
  points: IndicatorPoint[];
}

export interface AlignedIndicatorCross {
  time: number;
  kind: "golden" | "death";
}

export interface AlignedSRZone {
  kind: SRZone["kind"];
  top: number;
  bottom: number;
  start: number;
  end: number;
  touches: number;
  score: number;
  color: string;
  legendName: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasSeriesId(id: string): id is IndicatorSeriesId {
  return Object.prototype.hasOwnProperty.call(INDICATOR_SERIES_META, id);
}

/** Epoch → ascending candle index; duplicate epochs resolve to the last bar. */
function epochIndex(sortedEpochs: readonly number[]): Map<number, number> {
  const index = new Map<number, number>();
  sortedEpochs.forEach((time, i) => index.set(time, i));
  return index;
}

function nearestEpoch(sortedEpochs: readonly number[], target: number): number | undefined {
  if (sortedEpochs.length === 0) return undefined;
  let lo = 0;
  let hi = sortedEpochs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedEpochs[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  const after = sortedEpochs[lo]!;
  const before = sortedEpochs[lo - 1];
  if (before !== undefined && Math.abs(before - target) <= Math.abs(after - target)) {
    return before;
  }
  return after;
}

/**
 * Join index-aligned indicator values onto the deduped/sorted candle axis.
 * `sourceEpochs` is the payload's candle order (the order `values` follows);
 * series with a length mismatch or unknown id are dropped defensively.
 */
export function alignIndicatorSeries(
  indicators: ChartIndicators | null | undefined,
  sourceEpochs: readonly number[],
  sortedEpochs: readonly number[],
): AlignedIndicatorSeries[] {
  if (!indicators || indicators.aligned !== "candles" || sortedEpochs.length === 0) {
    return [];
  }
  const byEpoch = epochIndex(sortedEpochs);
  const sortedIndexBySource = sourceEpochs.map((time) => byEpoch.get(time) ?? -1);
  const aligned = new Map<IndicatorSeriesId, AlignedIndicatorSeries>();
  const seriesList = Array.isArray(indicators.series) ? indicators.series : [];

  for (const series of seriesList) {
    if (!series || !hasSeriesId(series.id) || aligned.has(series.id)) continue;
    if (!Array.isArray(series.values) || series.values.length !== sourceEpochs.length) {
      continue;
    }
    const values: (number | null)[] = sortedEpochs.map(() => null);
    let hasValue = false;
    series.values.forEach((value, i) => {
      const sortedIndex = sortedIndexBySource[i]!;
      if (sortedIndex < 0) return;
      if (isFiniteNumber(value)) {
        values[sortedIndex] = value;
        hasValue = true;
      } else {
        values[sortedIndex] = null;
      }
    });
    if (!hasValue) continue;

    const points: IndicatorPoint[] = [];
    values.forEach((value, i) => {
      if (value == null) return;
      points.push({ time: sortedEpochs[i]!, value });
    });
    if (points.length === 0) continue;
    aligned.set(series.id, {
      id: series.id,
      ...INDICATOR_SERIES_META[series.id],
      points,
    });
  }

  return INDICATOR_SERIES_ORDER.flatMap((id) => {
    const series = aligned.get(id);
    return series ? [series] : [];
  });
}

/**
 * Resolve cross timestamps onto exact candle epochs. A cross that does not land
 * on a candle (stale/foreign epoch) is dropped, as is one on the still-forming
 * final bar.
 */
export function alignIndicatorCrosses(
  indicators: ChartIndicators | null | undefined,
  sortedEpochs: readonly number[],
  options: { timeZone?: string; skipPartialLast?: boolean } = {},
): AlignedIndicatorCross[] {
  if (
    !indicators ||
    indicators.aligned !== "candles" ||
    !Array.isArray(indicators.crosses) ||
    indicators.crosses.length === 0
  ) {
    return [];
  }
  const epochs = new Set(sortedEpochs);
  const last = sortedEpochs[sortedEpochs.length - 1];
  const skipLast = options.skipPartialLast ?? indicators.partial_last === true;
  const seen = new Set<string>();
  const out: AlignedIndicatorCross[] = [];

  for (const cross of indicators.crosses) {
    if (!cross || (cross.kind !== "golden" && cross.kind !== "death")) continue;
    const time = toEpochSeconds(cross.t, options.timeZone);
    if (!Number.isFinite(time) || !epochs.has(time)) continue;
    if (skipLast && time === last) continue;
    const key = `${time}|${cross.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ time, kind: cross.kind });
  }

  return out.sort((a, b) => a.time - b.time);
}

/**
 * Clamp bands to the drawn candle window and snap their edges onto real candle
 * epochs (lightweight-charts only resolves exact time-scale points). Bands with
 * no overlap or an invalid price range are dropped.
 */
export function alignSRZones(
  zones: SRZone[] | null | undefined,
  sortedEpochs: readonly number[],
  timeZone?: string,
): AlignedSRZone[] {
  if (!Array.isArray(zones) || zones.length === 0 || sortedEpochs.length === 0) return [];
  const first = sortedEpochs[0]!;
  const last = sortedEpochs[sortedEpochs.length - 1]!;
  const out: AlignedSRZone[] = [];

  for (const zone of zones) {
    if (!zone) continue;
    const kind = zone.kind;
    if (kind !== "support" && kind !== "resistance" && kind !== "sr") continue;
    if (!isFiniteNumber(zone.top) || !isFiniteNumber(zone.bottom)) continue;
    const top = Math.max(zone.top, zone.bottom);
    const bottom = Math.min(zone.top, zone.bottom);
    if (!(top > bottom)) continue;

    const rawStart = toEpochSeconds(zone.start_date, timeZone);
    const rawEnd = toEpochSeconds(zone.end_date, timeZone);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;
    const lo = Math.min(rawStart, rawEnd);
    const hi = Math.max(rawStart, rawEnd);
    if (hi < first || lo > last) continue;

    const start = nearestEpoch(sortedEpochs, Math.max(lo, first));
    const end = nearestEpoch(sortedEpochs, Math.min(hi, last));
    if (start == null || end == null || end < start) continue;

    out.push({
      kind,
      top,
      bottom,
      start,
      end,
      touches: isFiniteNumber(zone.touches) ? zone.touches : 0,
      score: isFiniteNumber(zone.score) ? zone.score : 0,
      color: SR_ZONE_COLORS[kind],
      legendName: SR_ZONE_LEGEND_NAMES[kind],
    });
  }

  return out;
}
