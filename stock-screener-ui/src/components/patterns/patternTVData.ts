import type {
  ChartCandle,
  ChartIndicators,
  PatternHitDTO,
  PatternOverlay,
  SRZone,
  TrendLine,
  TrendlinesView,
  Trendline,
} from "@/types/chartPatterns";
import { PATTERN_SERIES_COLORS } from "@/config/patterns";
import { NEGATIVE, POSITIVE } from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import { toEpochSeconds } from "@/utils/chart/time";
import { createAxisIndex } from "./axisIndex";
import {
  CROSSES_LEGEND_NAME,
  alignIndicatorCrosses,
  alignIndicatorSeries,
  alignSRZones,
  type IndicatorLineStyle,
} from "./patternIndicatorData";
import { resolveVisibleStandalone } from "./standaloneLines";

export const PATTERN_TV_COLORS: string[] = PATTERN_SERIES_COLORS;

/** @deprecated Use `@/utils/chart/time.toEpochSeconds` directly for new code. */
export const toTVTime = toEpochSeconds;

export interface TVCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  isPartial?: boolean;
}

export interface TVVolume {
  time: number;
  value: number;
  color: string;
}

export interface TVLevel {
  price: number;
  color: string;
  title: string;
  lineStyle: "solid" | "dashed";
  width: number;
}

export interface TVLinePoint {
  time: number;
  value: number;
}

export interface TVLine {
  points: TVLinePoint[];
  color: string;
  dashed: boolean;
  width: number;
  name: string;
  /** Stable series key, set for indicator lines so they can update in place. */
  id?: string;
  /** Legend grouping key (BB upper/middle/lower all use `"BB"`). */
  legendName?: string;
  /** Explicit stroke style; pattern lines keep the `dashed` boolean. */
  lineStyle?: IndicatorLineStyle;
  label?: string;
  /**
   * Whether this line draws an inline end label. Only a pattern group's first
   * boundary line is eligible (mirrors the ECharts fullscreen), so a pattern's
   * two boundaries never print the same name twice.
   */
  labelEligible?: boolean;
  /** Anchor the inline label at the line's first point (history) or last (selected). */
  labelAt?: "start" | "end";
}

export interface TVMarker {
  time: number;
  position: "aboveBar" | "belowBar" | "inBar" | "atPriceMiddle";
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  color: string;
  text: string;
  price?: number;
  size?: number;
  group?: "pivots" | "keypoints" | "crosses";
  /** Legend grouping key; golden/death crosses use `"Crosses"`. */
  legendName?: string;
}

/** A support/resistance band ready for the zone primitive. Times are epochs. */
export interface TVRect {
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

/** An overlay bundle, optionally carrying instance identity (mirrors `SiblingOverlay`). */
export type TVSiblingOverlay = PatternOverlay & {
  start_date?: string | null;
  instanceKey?: string | null;
};

export interface BuildPatternTVDataInput {
  candles: ChartCandle[];
  hit?: PatternHitDTO | null;
  overlays?: TVSiblingOverlay[];
  trendLines?: TrendLine[];
  trendlinesView?: TrendlinesView;
  historyHits?: PatternHitDTO[];
  /** Server-computed indicator bundle; ignored when its timeframe disagrees. */
  indicators?: ChartIndicators | null;
  /** Server-computed support/resistance bands (view-only overlay). */
  srZones?: SRZone[];
  /** Chart timeframe used to reject an indicator bundle built for another TF. */
  timeframe?: string;
  /**
   * IANA zone used to pin *naive* candle timestamps. Defaults to IST; pass
   * `TZ_US` for a US session. Timestamps with an explicit offset are always
   * honoured as the true instant and are unaffected by this value.
   */
  timeZone?: string;
}

export interface BuildPatternTVDataResult {
  candles: TVCandle[];
  volume: TVVolume[];
  levels: TVLevel[];
  lines: TVLine[];
  /** Indicator overlays, separate so their series can update in place. */
  indicatorLines: TVLine[];
  markers: TVMarker[];
  zones: TVRect[];
}

function byTimeAsc(a: { time: number }, b: { time: number }): number {
  return a.time - b.time;
}

/**
 * Keep the last point per epoch and sort ascending. lightweight-charts throws
 * "data must be asc ordered by time" on duplicate times, which happens when a
 * trendline's two endpoints clamp onto the same candle (e.g. a pattern whose
 * start/end fall outside the visible window).
 */
function dedupeByTime(points: TVLinePoint[]): TVLinePoint[] {
  const byTime = new Map<number, TVLinePoint>();
  for (const p of points) byTime.set(p.time, p);
  return [...byTime.values()].sort(byTimeAsc);
}

export function buildPatternTVData({
  candles,
  hit,
  overlays,
  trendLines,
  trendlinesView = "both",
  historyHits = [],
  indicators,
  srZones,
  timeframe,
  timeZone,
}: BuildPatternTVDataInput): BuildPatternTVDataResult {
  const empty: BuildPatternTVDataResult = {
    candles: [],
    volume: [],
    levels: [],
    lines: [],
    indicatorLines: [],
    markers: [],
    zones: [],
  };
  const times = candles.map((c) => c.t);
  if (times.length === 0) return empty;

  // Axis parses once per build; every group/standalone lookup below reuses it.
  const axis = createAxisIndex(times);

  const epochs: number[] = times.map((t) => toEpochSeconds(t, timeZone));
  const epochAt = (index: number): number =>
    index >= 0 && index < epochs.length ? epochs[index]! : NaN;

  // Candles: dedupe by epoch (last bar wins), sorted ascending.
  const byEpoch = new Map<number, ChartCandle>();
  candles.forEach((c, i) => {
    const t = epochs[i]!;
    if (!Number.isFinite(t)) return;
    byEpoch.set(t, c);
  });
  const sortedEpochs = [...byEpoch.keys()].sort((a, b) => a - b);
  const sortedCandles = sortedEpochs.map((t) => byEpoch.get(t) as ChartCandle);
  const lastIndex = sortedCandles.length - 1;
  const tvCandles: TVCandle[] = sortedCandles.map((c, i) => ({
    time: sortedEpochs[i]!,
    open: c.o,
    high: c.h,
    low: c.l,
    close: c.c,
    // Only the newest bar can still be forming; a stale flag on an older bar
    // (e.g. after dedupe/reordering) must never restyle a completed candle.
    ...(i === lastIndex && c.is_partial === true ? { isPartial: true } : {}),
  }));
  const volume: TVVolume[] = sortedCandles.map((c, i) => ({
    time: sortedEpochs[i]!,
    value: c.v,
    color: c.c >= c.o ? withAlpha(POSITIVE, 0.9) : withAlpha(NEGATIVE, 0.9),
  }));

  const levels: TVLevel[] = [];

  const selectedId = hit?.pattern_id;
  const selectedStart = hit?.start_date ?? null;
  const isSelectedOverlay = (overlay: TVSiblingOverlay): boolean => {
    if (!selectedId || overlay.pattern_id !== selectedId) return false;
    if (overlay.instanceKey != null || (hit as { instanceKey?: string | null } | null)?.instanceKey != null) {
      return overlay.instanceKey === (hit as { instanceKey?: string | null } | null)?.instanceKey;
    }
    const overlayStart = overlay.start_date ?? null;
    if (selectedStart != null && overlayStart != null) return overlayStart === selectedStart;
    if (selectedStart != null && overlayStart == null) return false;
    return true;
  };
  const groups: Array<{ name: string; lines: Trendline[]; selected: boolean; labelAt?: "start" | "end" }> = [];
  if ((hit?.trendlines?.length ?? 0) > 0) {
    groups.push({
      name: hit?.pattern_name || "Pattern",
      lines: hit?.trendlines as Trendline[],
      selected: true,
    });
  }
  (overlays ?? []).forEach((overlay) => {
    if (!overlay?.trendlines?.length) return;
    if (isSelectedOverlay(overlay)) return;
    groups.push({
      name: overlay.pattern_name || overlay.pattern_id || "Pattern",
      lines: overlay.trendlines,
      selected: false,
      labelAt: "start",
    });
  });

  // Historical patterns from the chart's History selector. The selected hit is
  // already group 0, so the others are labelled P2, P3, ... in the legend.
  const selectedKey = hit ? `${hit.pattern_id}|${hit.start_date}` : null;
  let historyNo = 1;
  historyHits.forEach((h) => {
    if (!h?.trendlines?.length) return;
    if (selectedKey && `${h.pattern_id}|${h.start_date}` === selectedKey) return;
    historyNo += 1;
    groups.push({
      name: `P${historyNo} · ${h.pattern_name || h.pattern_id}`,
      lines: h.trendlines as Trendline[],
      selected: false,
      labelAt: "start",
    });
  });

  const nameCounts = new Map<string, number>();
  const lines: TVLine[] = [];
  groups.forEach((group, index) => {
    const mapped = axis.mapTrendlines(group.lines);
    if (mapped.length === 0) return;
    const color = PATTERN_TV_COLORS[index % PATTERN_TV_COLORS.length] as string;
    const seen = nameCounts.get(group.name) ?? 0;
    nameCounts.set(group.name, seen + 1);
    const name = seen === 0 ? group.name : `${group.name} (${seen + 1})`;
    mapped.forEach((points, lineIndex) => {
      const tvPoints = dedupeByTime(
        points
          .map((p) => ({ time: epochAt(p.index), value: p.price }))
          .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value)),
      );
      if (tvPoints.length === 0) return;
      // Only the group's first boundary line is labelled (ECharts fullscreen's
      // `lineIndex === 0` rule), so a pattern prints its name once.
      const labelEligible = lineIndex === 0;
      lines.push({
        points: tvPoints,
        color,
        dashed: !group.selected,
        width: group.selected ? 2 : 1,
        name,
        label: labelEligible ? name : undefined,
        labelEligible,
        labelAt: group.labelAt ?? "end",
      });
    });
  });

  const visibleStandalone = resolveVisibleStandalone(trendLines, hit, trendlinesView);
  visibleStandalone.forEach((line) => {
    const mapped = axis.mapStandaloneLine(line);
    if (!mapped) return;
    const { name, color, points } = mapped;
    const tvPoints = dedupeByTime(
      points
        .map((p) => ({ time: epochAt(p.index), value: p.price }))
        .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value)),
    );
    if (tvPoints.length === 0) return;
    lines.push({
      points: tvPoints,
      color,
      dashed: false,
      width: 1,
      name,
      label: `${name} · ${line.touches} touches`,
      labelEligible: true,
    });
  });
  lines.sort((a, b) => (a.points[0]?.time ?? 0) - (b.points[0]?.time ?? 0));

  const sameTimeframe = (a: unknown, b: string) =>
    typeof a === "string" && a.trim().toUpperCase() === b.trim().toUpperCase();
  const usableIndicators =
    indicators && (timeframe == null || sameTimeframe(indicators.timeframe, timeframe))
      ? indicators
      : null;

  const indicatorLines: TVLine[] = alignIndicatorSeries(usableIndicators, epochs, sortedEpochs).map(
    (series) => {
      // The BB band prints one tag (middle); its outer lines must never label.
      const labelEligible = series.id !== "bbUpper" && series.id !== "bbLower";
      return {
        points: series.points,
        color: series.color,
        dashed: series.lineStyle === "dashed",
        lineStyle: series.lineStyle,
        width: series.width,
        name: series.legendName,
        id: series.id,
        legendName: series.legendName,
        ...(labelEligible ? { label: series.legendName } : {}),
        labelEligible,
      };
    },
  );

  const markers: TVMarker[] = alignIndicatorCrosses(usableIndicators, sortedEpochs, {
    timeZone,
    skipPartialLast:
      usableIndicators?.partial_last === true ||
      sortedCandles[sortedCandles.length - 1]?.is_partial === true,
  }).map((cross) => {
    const golden = cross.kind === "golden";
    return {
      time: cross.time,
      position: golden ? "belowBar" : "aboveBar",
      shape: "square",
      color: golden ? POSITIVE : NEGATIVE,
      text: golden ? "GC" : "DC",
      group: "crosses",
      legendName: CROSSES_LEGEND_NAME,
    };
  });

  const zones: TVRect[] = alignSRZones(srZones, sortedEpochs, timeZone).map((zone) => ({
    kind: zone.kind,
    top: zone.top,
    bottom: zone.bottom,
    start: zone.start,
    end: zone.end,
    touches: zone.touches,
    score: zone.score,
    color: zone.color,
    legendName: zone.legendName,
  }));

  return { candles: tvCandles, volume, levels, lines, indicatorLines, markers, zones };
}

/** Compact on-canvas band label (`S 2,480 ×3`, `R 2,560 ×2`, `S/R testing`). */
export function srZoneLabel(zone: Pick<TVRect, "kind" | "touches">, formattedTop: string): string {
  if (zone.kind === "sr") return "S/R testing";
  const prefix = zone.kind === "support" ? "S" : "R";
  return `${prefix} ${formattedTop} ×${zone.touches}`;
}
