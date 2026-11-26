import type { ChartIndicators, IndicatorSeriesId, SRZone } from "@/types/chartPatterns";
import * as palette from "@/ui/palette";
import { sessionDateKey, toEpochSeconds } from "@/utils/chart/time";

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
  bars_since_touch?: number;
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

/** Session date of an epoch in the chart's zone (IST when the caller omits it). */
function zoneSessionKey(epoch: number, timeZone?: string): string {
  return sessionDateKey(new Date(epoch * 1000).toISOString(), timeZone) ?? "";
}

/**
 * Session date with a UTC fallback for the series builder, which does not
 * thread the display zone. NSE and US cash sessions never cross UTC midnight,
 * so grouping by UTC date still isolates one trading session per day.
 */
function seriesSessionKey(epoch: number, timeZone?: string): string {
  return sessionDateKey(new Date(epoch * 1000).toISOString(), timeZone ?? "UTC") ?? "";
}

/**
 * Intraday axes repeat a session within the same date range; daily/weekly bars
 * are sessions themselves, where a break per bar would swallow the value.
 */
function hasIntradayCadence(sortedEpochs: readonly number[]): boolean {
  const deltas: number[] = [];
  for (let i = 1; i < sortedEpochs.length; i++) {
    const delta = sortedEpochs[i]! - sortedEpochs[i - 1]!;
    if (delta > 0) deltas.push(delta);
  }
  if (deltas.length === 0) return false;
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)]! < 12 * 60 * 60;
}

/**
 * Join index-aligned indicator values onto the deduped/sorted candle axis.
 * `sourceEpochs` is the payload's candle order (the order `values` follows);
 * series with a length mismatch or unknown id are dropped defensively.
 *
 * Session-resetting studies (VWAP) carry a whitespace `{ time }` point at the
 * first bar of every new session, so lightweight-charts does not bridge the
 * overnight gap. The first bar's value is consumed by that gap point.
 */
export function alignIndicatorSeries(
  indicators: ChartIndicators | null | undefined,
  sourceEpochs: readonly number[],
  sortedEpochs: readonly number[],
  options: { timeZone?: string } = {},
): AlignedIndicatorSeries[] {
  if (!indicators || indicators.aligned !== "candles" || sortedEpochs.length === 0) {
    return [];
  }
  const byEpoch = epochIndex(sortedEpochs);
  const sortedIndexBySource = sourceEpochs.map((time) => byEpoch.get(time) ?? -1);
  const aligned = new Map<IndicatorSeriesId, AlignedIndicatorSeries>();
  const seriesList = Array.isArray(indicators.series) ? indicators.series : [];
  const intraday = hasIntradayCadence(sortedEpochs);

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

    const sessionBreak = series.id === "vwap" && intraday;
    const sessions = sessionBreak
      ? sortedEpochs.map((time) => seriesSessionKey(time, options.timeZone))
      : null;
    const points: IndicatorPoint[] = [];
    let lastSession: string | null = null;
    values.forEach((value, i) => {
      const time = sortedEpochs[i]!;
      if (sessions) {
        const session = sessions[i]!;
        if (lastSession != null && session !== lastSession && points.length > 0) {
          // Whitespace point: `{ time }` with no value is the library's gap.
          points.push({ time } as IndicatorPoint);
          lastSession = session;
          return;
        }
        lastSession = session;
      }
      if (value == null) return;
      points.push({ time, value });
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
 * Clamp bands to the drawn candle window and snap their session dates onto real
 * candle epochs (lightweight-charts only resolves exact time-scale points).
 *
 * The backend stamps zones with calendar dates, not instants: an intraday
 * window starting 09:15 must begin at that session's first bar, not at midnight.
 * Start is the first bar whose local date is >= `start_date`; end is the last
 * bar whose local date is <= `end_date` (so weekend/holiday edges snap to the
 * nearest session). Intraday zones also carry exact `start_time`/`end_time`
 * timestamps, which are preferred over the session dates when both parse.
 * Bands with no overlapping session or an invalid price range are dropped.
 */
export function alignSRZones(
  zones: SRZone[] | null | undefined,
  sortedEpochs: readonly number[],
  timeZone?: string,
): AlignedSRZone[] {
  if (!Array.isArray(zones) || zones.length === 0 || sortedEpochs.length === 0) return [];
  const sessionKeys = sortedEpochs.map((epoch) => zoneSessionKey(epoch, timeZone));
  const out: AlignedSRZone[] = [];

  for (const zone of zones) {
    if (!zone) continue;
    const kind = zone.kind;
    if (kind !== "support" && kind !== "resistance" && kind !== "sr") continue;
    if (!isFiniteNumber(zone.top) || !isFiniteNumber(zone.bottom)) continue;
    const top = Math.max(zone.top, zone.bottom);
    const bottom = Math.min(zone.top, zone.bottom);
    if (!(top > bottom)) continue;

    let startIndex = -1;
    let endIndex = -1;
    const startTime = zone.start_time ? toEpochSeconds(zone.start_time, timeZone) : NaN;
    const endTime = zone.end_time ? toEpochSeconds(zone.end_time, timeZone) : NaN;

    if (Number.isFinite(startTime) && Number.isFinite(endTime)) {
      const from = Math.min(startTime, endTime);
      const to = Math.max(startTime, endTime);
      for (let i = 0; i < sortedEpochs.length; i++) {
        if (sortedEpochs[i]! >= from) {
          startIndex = i;
          break;
        }
      }
      for (let i = sortedEpochs.length - 1; i >= 0; i--) {
        if (sortedEpochs[i]! <= to) {
          endIndex = i;
          break;
        }
      }
    } else {
      const rawStart = sessionDateKey(zone.start_date, timeZone);
      const rawEnd = sessionDateKey(zone.end_date, timeZone);
      if (!rawStart || !rawEnd) continue;
      const from = rawStart <= rawEnd ? rawStart : rawEnd;
      const to = rawStart <= rawEnd ? rawEnd : rawStart;

      for (let i = 0; i < sessionKeys.length; i++) {
        if (sessionKeys[i]! >= from) {
          startIndex = i;
          break;
        }
      }
      for (let i = sessionKeys.length - 1; i >= 0; i--) {
        if (sessionKeys[i]! <= to) {
          endIndex = i;
          break;
        }
      }
    }
    if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) continue;

    out.push({
      kind,
      top,
      bottom,
      start: sortedEpochs[startIndex]!,
      end: sortedEpochs[endIndex]!,
      touches: isFiniteNumber(zone.touches) ? zone.touches : 0,
      score: isFiniteNumber(zone.score) ? zone.score : 0,
      ...(isFiniteNumber(zone.bars_since_touch)
        ? { bars_since_touch: zone.bars_since_touch }
        : {}),
      color: SR_ZONE_COLORS[kind],
      legendName: SR_ZONE_LEGEND_NAMES[kind],
    });
  }

  return out;
}
