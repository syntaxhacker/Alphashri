import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineWidth,
  type TickMarkType,
  type Time,
} from "lightweight-charts";
import { typeSize } from "@/ui";
import * as palette from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import type {
  ChartCandle,
  ChartIndicators,
  PatternHitDTO,
  SRZone,
  TrendLine,
  TrendlinesView,
} from "@/types/chartPatterns";
import {
  buildPatternTVData,
  srZoneLabel,
  type BuildPatternTVDataResult,
  type TVLine,
  type TVMarker,
  type TVSiblingOverlay,
} from "./patternTVData";
import { ZONE_BORDER_ALPHA, ZoneBandPrimitive } from "./ZoneBandPrimitive";
import { CROSSES_LEGEND_NAME } from "./patternIndicatorData";
import { chartPriceLocale } from "./chartFormat";
import { KEY_POINTS_LEGEND_NAME, PIVOT_LEGEND_NAME } from "@/config/patterns";
import { MARKET_TIME_ZONE, type ChartMarket } from "@/utils/chart/time";
import { tvTickMarkFormatter, tvTimeFormatter } from "@/utils/tvTimeFormat";

export interface PatternTradingViewChartProps {
  hit: PatternHitDTO | null;
  candles: ChartCandle[];
  overlays?: TVSiblingOverlay[];
  trendLines?: TrendLine[];
  trendlinesView?: TrendlinesView;
  historyHits?: PatternHitDTO[];
  hiddenNames?: ReadonlySet<string>;
  /**
   * Pre-built overlay data (host builds once per payload). When omitted the
   * chart builds from `candles`/`hit`/`indicators`/`srZones` itself.
   */
  data?: BuildPatternTVDataResult;
  indicators?: ChartIndicators | null;
  srZones?: SRZone[];
  /** Chart timeframe; also rejects an indicator bundle built for another TF. */
  timeframe?: string;
  /** Symbol identity for the fit-once guard when no `hit` is supplied. */
  symbol?: string;
  /** Fixed pixel height, or `"100%"` (default) to fill the flex parent. */
  height?: number | string;
  timeZone?: string;
  market?: ChartMarket;
}

function clampWidth(w?: number): LineWidth {
  const n = Math.round(w ?? 1);
  return (n < 1 ? 1 : n > 4 ? 4 : n) as LineWidth;
}

/** Stable empty set so the visibility effect never sees a new reference. */
const EMPTY_HIDDEN: ReadonlySet<string> = new Set<string>();

const CANDLE_UP = palette.MARKER_BORDER;
const CANDLE_DOWN = palette.SCALE_BLUE[6] ?? palette.NEGATIVE;
const PARTIAL_OPACITY = 0.4;

/** Crosses are noise past a dozen; keep the most recent visible ones. */
export const MAX_VISIBLE_CROSSES = 12;

/** On-canvas indicator tag order; lower wins a slot when space is tight. */
const INDICATOR_LABEL_PRIORITY: readonly string[] = [
  "sma20",
  "sma50",
  "sma200",
  "bbMiddle",
  "vwap",
];

interface LabelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Minimum band height (px) that earns an S/R label pill. */
export const ZONE_LABEL_MIN_BAND_HEIGHT = 12;
/** A zone pill may never cover more than this share of the plot width. */
export const ZONE_LABEL_MAX_WIDTH_RATIO = 0.45;
/** Height of the zone pill, including its border. */
export const ZONE_LABEL_HEIGHT = 14;
/** Charts narrower than this use the compact (touch-count-free) label. */
export const ZONE_LABEL_COMPACT_WIDTH = 640;
/** Time-axis padding (px) at each edge so first/last tick labels stay whole. */
export const TIME_AXIS_EDGE_PADDING_PX = 18;
/** Bars reserved after the newest bar (kept in sync with createChart). */
const TIME_SCALE_RIGHT_OFFSET = 12;
/** A 3h/4h window longer than this is treated as a multi-month view. */
const MULTI_MONTH_SPAN_SECONDS = 60 * 24 * 60 * 60;

export interface ZoneLabelCandidate {
  /** Wide label, e.g. `S 264.27 ×12`. */
  fullText: string;
  /** Narrow label without the touch count, e.g. `S 264.3`. */
  compactText: string;
  /** Progressively shorter fallbacks when even the compact label is too wide. */
  fallbackTexts?: readonly string[];
  /** Band's left edge in plot coordinates. */
  xStart: number;
  topY: number;
  bottomY: number;
}

export interface ZoneLabelPlacement extends LabelRect {
  text: string;
  compact: boolean;
}

/**
 * Choose and place one zone label. Bands shorter than
 * `ZONE_LABEL_MIN_BAND_HEIGHT` are skipped unless the caller lowers the gate
 * (the chart does, so tiny 1W/1M bands still get a readable tag).
 * Width is capped at `ZONE_LABEL_MAX_WIDTH_RATIO` of the plot; when the chosen
 * label does not fit, shorter variants are used instead of dropping the label.
 */
export function layoutZoneLabel(
  candidate: ZoneLabelCandidate,
  geometry: {
    chartWidth: number;
    paneWidth: number;
    paneHeight: number;
    measure: (text: string) => number;
    minBandHeight?: number;
  },
): ZoneLabelPlacement | null {
  const bandHeight = Math.abs(candidate.bottomY - candidate.topY);
  const minBandHeight = geometry.minBandHeight ?? ZONE_LABEL_MIN_BAND_HEIGHT;
  if (!(bandHeight >= minBandHeight)) return null;

  const compact = geometry.chartWidth < ZONE_LABEL_COMPACT_WIDTH;
  const maxWidth = Math.max(0, geometry.paneWidth * ZONE_LABEL_MAX_WIDTH_RATIO);
  const preferred = compact
    ? [candidate.compactText, ...(candidate.fallbackTexts ?? [])]
    : [candidate.fullText, candidate.compactText, ...(candidate.fallbackTexts ?? [])];
  const variants = [...new Set(preferred.filter((text) => text.length > 0))];
  if (variants.length === 0) return null;

  const text =
    variants.find((value) => geometry.measure(value) <= maxWidth) ?? variants[variants.length - 1]!;
  const h = ZONE_LABEL_HEIGHT;
  const w = geometry.measure(text);
  const x = Math.max(0, Math.min(candidate.xStart + 4, Math.max(0, geometry.paneWidth - w - 2)));
  const y = Math.max(
    0,
    Math.min(
      (candidate.topY + candidate.bottomY) / 2 - h / 2,
      Math.max(0, geometry.paneHeight - h),
    ),
  );
  return { text, compact, x, y, w, h };
}

/**
 * Logical range with leading/trailing whitespace so the first/last time tick
 * is not centred on the plot edge. `rightOffset` bars are kept and extra
 * padding is added on both sides in pixels.
 */
export function initialVisibleLogicalRange(
  barCount: number,
  rightOffset: number,
  paneWidth: number,
  edgePaddingPx: number = TIME_AXIS_EDGE_PADDING_PX,
): { from: number; to: number } | null {
  if (!Number.isFinite(barCount) || barCount <= 0) return null;
  if (!Number.isFinite(paneWidth) || paneWidth <= edgePaddingPx * 2) return null;
  const offset = Number.isFinite(rightOffset) && rightOffset > 0 ? rightOffset : 0;
  const slots = Math.max(1, barCount - 1 + offset);
  const padBars = Math.ceil((edgePaddingPx * slots) / Math.max(1, paneWidth - edgePaddingPx * 2));
  return { from: -padBars, to: barCount - 1 + offset + padBars };
}

function overlaps(
  placed: readonly LabelRect[],
  bx: number,
  by: number,
  w: number,
  h: number,
): boolean {
  return placed.some((p) => bx < p.x + p.w && bx + w > p.x && by < p.y + p.h && by + h > p.y);
}

/** Nearest free vertical slot, or null when every slot collides. */
function findVerticalSlot(
  placed: readonly LabelRect[],
  bx: number,
  w: number,
  desiredY: number,
  h: number,
  paneHeight: number,
): number | null {
  const maxY = Math.max(0, paneHeight - h);
  const start = Math.min(Math.max(desiredY, 0), maxY);
  const step = h + 2;
  for (let guard = 0; guard <= 24; guard++) {
    const candidates = guard === 0 ? [start] : [start + guard * step, start - guard * step];
    for (const by of candidates) {
      if (by < 0 || by > maxY) continue;
      if (!overlaps(placed, bx, by, w, h)) return by;
    }
  }
  return null;
}

export interface IndicatorTagCandidate {
  id: string;
  label: string;
  color: string;
  /** Anchor price coordinate; the tag stacks around this row. */
  y: number;
}

export interface ChartTagRect extends LabelRect {
  id: string;
  label: string;
  color: string;
}

const MA_TAG_IDS = new Set(["sma20", "sma50", "sma200"]);

function tagPriority(id: string): number {
  const index = INDICATOR_LABEL_PRIORITY.indexOf(id);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * Lay out indicator tags in the blank gutter after the last bar. Individual
 * tags are used when they fit; a crowded narrow chart collapses to at most
 * two aggregate rows (MAs / BB / VWAP) so data is never covered.
 */
export function layoutIndicatorTags(
  candidates: readonly IndicatorTagCandidate[],
  geometry: {
    paneWidth: number;
    paneHeight: number;
    /** First x after the newest candle; tags must not start left of this. */
    gutterLeft: number;
    placed?: readonly LabelRect[];
    measure: (text: string) => number;
    maxCompactRows?: number;
  },
): { tags: ChartTagRect[]; compact: boolean } {
  const h = 16;
  const sorted = [...candidates].sort((a, b) => tagPriority(a.id) - tagPriority(b.id));
  const available = geometry.paneWidth - geometry.gutterLeft - 4;
  if (available < 8 || sorted.length === 0) return { tags: [], compact: false };

  const measured = sorted.map((candidate) => ({
    ...candidate,
    w: geometry.measure(candidate.label),
  }));
  const anyOverflow = measured.some((candidate) => candidate.w > available);
  const verticalOverflow = measured.length * (h + 2) > geometry.paneHeight - 8;
  const compact = (anyOverflow && measured.length >= 3) || (measured.length >= 4 && verticalOverflow);

  let rows: Array<{ id: string; label: string; color: string; y: number }>;
  if (compact) {
    const mas = sorted.filter((candidate) => MA_TAG_IDS.has(candidate.id));
    const bb = sorted.find((candidate) => candidate.id === "bbMiddle");
    const vwap = sorted.find((candidate) => candidate.id === "vwap");
    rows = [
      ...(mas.length > 0
        ? [{ id: "mas", label: "MAs", color: mas[0]!.color, y: mas[0]!.y }]
        : []),
      ...(bb ? [{ id: bb.id, label: "BB", color: bb.color, y: bb.y }] : []),
      ...(vwap ? [{ id: vwap.id, label: "VWAP", color: vwap.color, y: vwap.y }] : []),
    ].slice(0, geometry.maxCompactRows ?? 2);
  } else {
    rows = measured.map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      color: candidate.color,
      y: candidate.y,
    }));
  }

  const placed: LabelRect[] = [...(geometry.placed ?? [])];
  const tags: ChartTagRect[] = [];
  for (const row of rows) {
    const w = geometry.measure(row.label);
    if (w > available) continue;
    const x = geometry.paneWidth - w - 4;
    if (x < geometry.gutterLeft) continue;
    const y = findVerticalSlot(placed, x, w, row.y - h / 2, h, geometry.paneHeight);
    if (y == null) continue;
    const rect: ChartTagRect = { ...row, x, y, w, h };
    placed.push(rect);
    tags.push(rect);
  }
  return { tags, compact };
}

function markerLegendName(marker: TVMarker): string {
  if (marker.legendName) return marker.legendName;
  if (marker.group === "crosses") return CROSSES_LEGEND_NAME;
  return marker.group === "keypoints" ? KEY_POINTS_LEGEND_NAME : PIVOT_LEGEND_NAME;
}

function visibleMarkers(markers: TVMarker[], hidden: ReadonlySet<string>): TVMarker[] {
  return markers.filter((marker) => !hidden.has(markerLegendName(marker)));
}

function lineStyleOf(line: TVLine): LineStyle {
  if (line.lineStyle === "dashed") return LineStyle.Dashed;
  if (line.lineStyle === "dotted") return LineStyle.Dotted;
  return line.dashed ? LineStyle.Dashed : LineStyle.Solid;
}

/** Session breaks are `{ time }` points; end labels must anchor on real values. */
function lastValuedPoint(points: TVLine["points"]): TVLine["points"][number] | undefined {
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i]!;
    if (Number.isFinite(point.value)) return point;
  }
  return undefined;
}

export function PatternTradingViewChart(props: PatternTradingViewChartProps) {
  let containerEl: HTMLDivElement | undefined;
  let overlayEl: HTMLCanvasElement | undefined;
  let chart: IChartApi | null = null;
  let candleSeries: ISeriesApi<"Candlestick"> | null = null;
  let volumeSeries: ISeriesApi<"Histogram"> | null = null;
  let lineSeries: ISeriesApi<"Line">[] = [];
  let indicatorLineSeries = new Map<string, ISeriesApi<"Line">>();
  let zonesPrimitive: ZoneBandPrimitive | null = null;
  let markers: ISeriesMarkersPluginApi<Time> | null = null;
  let priceLines: Array<{ name: string; line: IPriceLine }> = [];
  let hiddenRef: ReadonlySet<string> = props.hiddenNames ?? EMPTY_HIDDEN;
  let fittedKey: string | null = null;
  const [visibleCrossCount, setVisibleCrossCount] = createSignal(0);

  const timeZoneOf = () => props.timeZone ?? MARKET_TIME_ZONE.india;
  // The chart is created once; the callbacks read this ref so a zone change
  // repaints the axis without rebuilding the series (and losing pan/zoom).
  let timeZoneRef = timeZoneOf();
  let localeRef = chartPriceLocale(props.market);
  const tickFormatter = (time: Time, kind: TickMarkType) => {
    const timeframe = props.timeframe ?? props.hit?.timeframe;
    const range = visibleLogicalRange();
    const candles = data().candles;
    let multiMonth = false;
    if (range && candles.length > 1) {
      const from = Math.max(0, Math.floor(range.from));
      const to = Math.min(candles.length - 1, Math.ceil(range.to));
      if (to > from) {
        multiMonth = candles[to]!.time - candles[from]!.time > MULTI_MONTH_SPAN_SECONDS;
      }
    }
    return tvTickMarkFormatter(time, kind, timeZoneRef, { timeframe, multiMonth });
  };
  const crosshairFormatter = (time: Time) => tvTimeFormatter(time, timeZoneRef);

  const trendlinesView = () => props.trendlinesView ?? "both";
  const data = createMemo<BuildPatternTVDataResult>(() => {
    const prebuilt = props.data;
    if (prebuilt) return prebuilt;
    return buildPatternTVData({
      candles: props.candles,
      hit: props.hit,
      overlays: props.overlays,
      trendLines: props.trendLines,
      trendlinesView: trendlinesView(),
      historyHits: props.historyHits,
      indicators: props.indicators,
      srZones: props.srZones,
      timeframe: props.timeframe,
      timeZone: timeZoneOf(),
    });
  });
  const partialTime = createMemo(() => data().candles.find((c) => c.isPartial)?.time ?? null);
  const hidden = () => props.hiddenNames ?? EMPTY_HIDDEN;
  const activeIndicatorCount = createMemo(
    () =>
      data().indicatorLines.filter((line) => !hidden().has(line.legendName ?? line.name)).length,
  );
  const visibleZoneCount = createMemo(
    () => data().zones.filter((zone) => !hidden().has(zone.legendName)).length,
  );
  const indicatorIds = createMemo(() =>
    data()
      .indicatorLines.flatMap((line) => (line.id ? [line.id] : []))
      .join(","),
  );
  const labelEligibleIndicatorIds = createMemo(() =>
    data()
      .indicatorLines.filter((line) => line.labelEligible)
      .flatMap((line) => (line.id ? [line.id] : []))
      .join(","),
  );
  const identityKey = (d: BuildPatternTVDataResult): string => {
    const first = d.candles[0]?.time ?? 0;
    const last = d.candles[d.candles.length - 1]?.time ?? 0;
    const symbol = props.symbol ?? props.hit?.symbol ?? "";
    const timeframe = props.timeframe ?? props.hit?.timeframe ?? "";
    return `${symbol}|${timeframe}|${first}|${last}`;
  };

  onMount(() => {
    if (!containerEl) return;
    const initialHeight = containerEl.clientHeight || 360;
    const created = createChart(containerEl, {
      layout: { background: { type: ColorType.Solid, color: palette.CHART_TV_BG }, textColor: palette.TEXT },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      width: containerEl.clientWidth,
      height: initialHeight,
      timeScale: {
        borderColor: palette.BORDER,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: TIME_SCALE_RIGHT_OFFSET,
        barSpacing: 5,
        tickMarkFormatter: tickFormatter,
      },
      localization: { locale: localeRef, timeFormatter: crosshairFormatter },
      rightPriceScale: {
        borderColor: palette.BORDER,
        // Keep the top and bottom axis ticks fully inside the pane; without
        // this the price-scale edge label is clipped by the card border.
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      crosshair: { mode: 1 },
      handleScroll: true,
      handleScale: true,
    });
    chart = created;

    const bull = CANDLE_UP;
    const bear = CANDLE_DOWN;
    const candles = created.addSeries(CandlestickSeries, {
      upColor: bull,
      downColor: bear,
      borderUpColor: bull,
      borderDownColor: bear,
      wickUpColor: bull,
      wickDownColor: bear,
      borderVisible: true,
      wickVisible: true,
    });
    candleSeries = candles;

    const volume = created.addSeries(HistogramSeries, {
      color: withAlpha(palette.TEXT_MUTED, 0.3),
      priceScaleId: "",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries = volume;
    volume.priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    markers = createSeriesMarkers(candles, []);

    const zonePrimitive = new ZoneBandPrimitive();
    if (typeof candles.attachPrimitive === "function") {
      candles.attachPrimitive(zonePrimitive);
      zonesPrimitive = zonePrimitive;
    }

    const ro = new ResizeObserver(() => {
      if (containerEl && chart) {
        chart.applyOptions({
          width: containerEl.clientWidth,
          height: containerEl.clientHeight || initialHeight,
        });
      }
    });
    ro.observe(containerEl);

    const ts = created.timeScale();
    if (typeof ts.subscribeVisibleLogicalRangeChange === "function") {
      const onRedraw = () => {
        updateMarkers();
        requestAnimationFrame(drawEndLabels);
      };
      ts.subscribeVisibleLogicalRangeChange(onRedraw);
      window.addEventListener("resize", onRedraw);
      const parentRo = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onRedraw) : null;
      if (containerEl && parentRo) parentRo.observe(containerEl);
      onCleanup(() => {
        ts.unsubscribeVisibleLogicalRangeChange?.(onRedraw);
        parentRo?.disconnect();
        window.removeEventListener("resize", onRedraw);
      });
    }

    onCleanup(() => {
      ro.disconnect();
      if (zonesPrimitive && typeof candles.detachPrimitive === "function") {
        try {
          candles.detachPrimitive(zonesPrimitive);
        } catch {
          /* noop */
        }
        zonesPrimitive = null;
      }
      created.remove();
      chart = null;
      candleSeries = null;
      volumeSeries = null;
      lineSeries = [];
      indicatorLineSeries.clear();
      markers = null;
      priceLines = [];
    });
  });

  // Rebind the axis/crosshair formatters when the session zone changes (fresh
  // callbacks repaint the time scale) and the number locale when the market does.
  createEffect(() => {
    const nextZone = timeZoneOf();
    const nextLocale = chartPriceLocale(props.market);
    const zoneChanged = nextZone !== timeZoneRef;
    const localeChanged = nextLocale !== localeRef;
    if (!zoneChanged && !localeChanged) return;
    timeZoneRef = nextZone;
    localeRef = nextLocale;
    chart?.applyOptions({
      ...(zoneChanged ? { timeScale: { tickMarkFormatter: tickFormatter } } : {}),
      localization: {
        ...(zoneChanged ? { timeFormatter: crosshairFormatter } : {}),
        locale: nextLocale,
      },
    });
  });

  // Explicit numeric height updates without recreate; `"100%"` is driven by the
  // ResizeObserver above (which measures the flex parent).
  createEffect(() => {
    const h = props.height;
    if (typeof h === "number") chart?.applyOptions({ height: h });
  });

  const visibleLogicalRange = () => {
    const ts = chart?.timeScale();
    if (!ts || typeof ts.getVisibleLogicalRange !== "function") return null;
    try {
      return ts.getVisibleLogicalRange();
    } catch {
      return null;
    }
  };

  /**
   * Fit once, then add whitespace before/after the bars so the first and last
   * tick labels are not centred on — and clipped by — the plot edges. Pan/zoom
   * are untouched after this initial range is applied.
   */
  const fitContentWithTimePadding = () => {
    const ts = chart?.timeScale();
    if (!ts) return;
    ts.fitContent();
    if (typeof ts.width !== "function" || typeof ts.setVisibleLogicalRange !== "function") {
      return;
    }
    const paneWidth = ts.width();
    const timeScaleOptions = typeof ts.options === "function" ? ts.options() : null;
    const range = initialVisibleLogicalRange(
      data().candles.length,
      timeScaleOptions?.rightOffset ?? TIME_SCALE_RIGHT_OFFSET,
      paneWidth,
    );
    if (range) ts.setVisibleLogicalRange(range);
  };

  const updateMarkers = () => {
    const plugin = markers;
    if (!plugin) return;
    const d = data();
    const partial = partialTime();
    const range = visibleLogicalRange();
    const indexByTime = new Map<number, number>();
    d.candles.forEach((c, i) => indexByTime.set(c.time, i));

    const others: TVMarker[] = [];
    const crosses: TVMarker[] = [];
    for (const marker of d.markers) {
      if (marker.group !== "crosses") {
        others.push(marker);
        continue;
      }
      if (partial != null && marker.time === partial) continue;
      const index = indexByTime.get(marker.time);
      if (index == null) continue;
      if (range && (index < range.from - 0.5 || index > range.to + 0.5)) continue;
      crosses.push(marker);
    }
    const capped =
      crosses.length > MAX_VISIBLE_CROSSES ? crosses.slice(-MAX_VISIBLE_CROSSES) : crosses;
    const merged = [...others, ...capped].sort((a, b) => a.time - b.time);
    const shown = visibleMarkers(merged, hiddenRef);
    try {
      plugin.setMarkers(shown as never);
    } catch {
      /* noop */
    }
    setVisibleCrossCount(shown.filter((marker) => marker.group === "crosses").length);
  };

  // Indicator series are reconciled by stable id: toggles only flip `visible`.
  const syncIndicatorLines = (lines: TVLine[]) => {
    const instance = chart;
    if (!instance) return;
    const keep = new Set<string>();
    for (const line of lines) {
      if (!line.id) continue;
      keep.add(line.id);
      let series = indicatorLineSeries.get(line.id);
      if (!series) {
        series = instance.addSeries(LineSeries, {
          title: "",
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        indicatorLineSeries.set(line.id, series);
      }
      // Reassert the quiet axis options: the series id must never reach the
      // price scale as a tag, and only the overlay canvas labels indicators.
      series.applyOptions({
        color: line.color,
        lineWidth: clampWidth(line.width),
        lineStyle: lineStyleOf(line),
        title: "",
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        visible: !hiddenRef.has(line.legendName ?? line.name),
      });
      series.setData(line.points as never);
    }
    for (const [id, series] of indicatorLineSeries) {
      if (keep.has(id)) continue;
      try {
        instance.removeSeries(series);
      } catch {
        /* noop */
      }
      indicatorLineSeries.delete(id);
    }
  };

  const syncZones = () => {
    zonesPrimitive?.setZones(data().zones.filter((zone) => !hiddenRef.has(zone.legendName)));
  };

  // Paint candles, volume, levels, boundary/TLS-TLR lines, indicators and zones.
  createEffect(() => {
    const d = data();
    const candle = candleSeries;
    const volume = volumeSeries;
    if (!chart || !candle || !volume) return;

    // lightweight-charts supports per-bar colour overrides: fade the still
    // forming bar so it reads as provisional without disturbing closed candles.
    const partial = partialTime();
    const candleData =
      partial == null
        ? d.candles
        : d.candles.map((c) => {
            if (c.time !== partial) return c;
            const fill = withAlpha(
              c.close >= c.open ? CANDLE_UP : CANDLE_DOWN,
              PARTIAL_OPACITY,
            );
            return { ...c, color: fill, borderColor: fill, wickColor: fill };
          });
    candle.setData(candleData as never);
    volume.setData(d.volume as never);

    priceLines.forEach(({ line }) => {
      try {
        candle.removePriceLine(line);
      } catch {
        /* noop */
      }
    });
    priceLines = [];
    d.levels.forEach((level) => {
      const hidden = hiddenRef.has(level.title);
      const line = candle.createPriceLine({
        price: level.price,
        color: level.color,
        lineWidth: clampWidth(level.width),
        lineStyle: level.lineStyle === "dashed" ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: !hidden,
        title: level.title,
        ...(hidden ? { lineVisible: false } : {}),
      });
      priceLines.push({ name: level.title, line });
    });

    lineSeries.forEach((s) => {
      try {
        chart!.removeSeries(s);
      } catch {
        /* noop */
      }
    });
    lineSeries = [];
    d.lines.forEach((line) => {
      const series = chart!.addSeries(LineSeries, {
        color: line.color,
        lineWidth: clampWidth(line.width),
        lineStyle: lineStyleOf(line),
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      series.setData(line.points as never);
      if (hiddenRef.has(line.name)) series.applyOptions({ visible: false });
      lineSeries.push(series);
    });

    syncIndicatorLines(d.indicatorLines);
    updateMarkers();
    syncZones();

    // Refit only when the symbol/timeframe/window identity changes, never on a
    // legend toggle or an overlay-only data update.
    const nextKey = identityKey(d);
    if (nextKey !== fittedKey) {
      fittedKey = nextKey;
      fitContentWithTimePadding();
    }
  });

  // End labels: draw each line's name at its last point on a transparent canvas
  // overlay (same technique as TradingViewChart's entry pills). Coordinates
  // come from the chart scale + the line's own series; missing coordinates are
  // skipped. Redrawn on data change, pan/zoom and resize via the effects below.
  const drawEndLabels = () => {
    const canvas = overlayEl;
    if (!canvas || !chart) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      ctx = null;
    }
    if (!ctx) return;
    const parent = canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : canvas.getBoundingClientRect();
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const cw = Math.round(rect.width * dpr);
    const ch = Math.round(rect.height * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (rect.width === 0 || rect.height === 0) return;
    const ts = chart.timeScale();
    if (typeof ts.timeToCoordinate !== "function") return;
    ctx.font = `600 ${typeSize("micro")}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const placed: LabelRect[] = [];
    data().lines.forEach((line, i) => {
      if (!line.labelEligible || hiddenRef.has(line.name)) return;
      // Keep the runtime guard: test doubles and future library builds may omit
      // the coordinate mapper, and the label pass must not throw without it.
      const series: { priceToCoordinate?: (p: number) => number | null } | undefined = lineSeries[i];
      if (!series || typeof series.priceToCoordinate !== "function") return;
      const anchor = line.labelAt === "start" ? line.points[0] : line.points[line.points.length - 1];
      if (!anchor) return;
      const x = ts.timeToCoordinate?.(anchor.time as never);
      const y = series.priceToCoordinate(anchor.value);
      if (x == null || y == null) return;
      const text = line.label ?? line.name;
      const padX = 4;
      const h = 16;
      const w = ctx.measureText(text).width + padX * 2;
      // Sit the label just left of the line's last point so it never collides
      // with the library's right-axis price-line titles (Breakout/Stop/Target).
      let bx = Math.max(0, Math.min(x - w - 6, Math.max(0, rect.width - w)));
      let by = Math.min(Math.max(y - h / 2, 0), Math.max(0, rect.height - h));
      for (let guard = 0; guard < 12; guard++) {
        const clash = placed.some(
          (p) => bx < p.x + p.w && bx + w > p.x && by < p.y + p.h && by + h > p.y,
        );
        if (!clash) break;
        if (bx - (w + 4) >= 0) {
          bx -= w + 4;
        } else if (bx + w + 4 + w <= rect.width) {
          bx += w + 4;
        } else {
          by = Math.min(by + h + 2, Math.max(0, rect.height - h));
        }
      }
      placed.push({ x: bx, y: by, w, h });
      ctx.fillStyle = "rgba(8,8,8,0.92)";
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 1;
      ctx.fillRect(bx, by, w, h);
      ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
      ctx.fillStyle = line.color;
      ctx.fillText(text, bx + padX, by + h / 2 + 0.5);
    });

    // Indicator tags live only in the blank gutter after the newest bar (never
    // on the data, never from LWC's price scale).
    const paneWidth = typeof ts.width === "function" ? ts.width() : rect.width;
    const candles = data().candles;
    const lastCandle = candles[candles.length - 1];
    const lastBarX = lastCandle ? ts.timeToCoordinate?.(lastCandle.time as never) : null;
    if (lastBarX != null && lastBarX >= 0 && lastBarX <= paneWidth) {
      const timeScaleOptions = typeof ts.options === "function" ? ts.options() : null;
      const barSpacing = timeScaleOptions?.barSpacing ?? 6;
      // Half a bar clears the newest candle body; rightOffset guarantees the
      // tags right of this point sit on blank canvas.
      const gutterLeft = Math.min(paneWidth - 4, lastBarX + Math.max(barSpacing / 2, 2));
      const candidates: IndicatorTagCandidate[] = [];
      data().indicatorLines.forEach((line) => {
        if (!line.labelEligible || !line.id) return;
        if (hiddenRef.has(line.legendName ?? line.name)) return;
        const series = indicatorLineSeries.get(line.id);
        if (!series || typeof series.priceToCoordinate !== "function") return;
        const anchor = lastValuedPoint(line.points);
        if (!anchor) return;
        const y = series.priceToCoordinate(anchor.value);
        if (y == null || y < 0 || y > rect.height) return;
        candidates.push({ id: line.id, label: line.label ?? line.name, color: line.color, y });
      });

      const { tags } = layoutIndicatorTags(candidates, {
        paneWidth,
        paneHeight: rect.height,
        gutterLeft,
        placed,
        measure: (text) => ctx.measureText(text).width + 8,
      });
      tags.forEach((tag) => {
        placed.push(tag);
        ctx.fillStyle = "rgba(8,8,8,0.92)";
        ctx.strokeStyle = tag.color;
        ctx.lineWidth = 1;
        ctx.fillRect(tag.x, tag.y, tag.w, tag.h);
        ctx.strokeRect(tag.x + 0.5, tag.y + 0.5, tag.w - 1, tag.h - 1);
        ctx.fillStyle = tag.color;
        ctx.fillText(tag.label, tag.x + 4, tag.y + tag.h / 2 + 0.5);
      });
    }

    const zones = data().zones;
    if (zones.length === 0) return;
    const priceFormat = new Intl.NumberFormat(localeRef, { maximumFractionDigits: 2 });
    const compactPriceFormat = new Intl.NumberFormat(localeRef, { maximumFractionDigits: 1 });
    const shortPriceFormat = new Intl.NumberFormat(localeRef, { maximumFractionDigits: 0 });
    const zonePaneHeight =
      typeof ts.height === "function" ? Math.max(1, rect.height - ts.height()) : rect.height;
    // Every visible band gets a tag (the 12 px gate is only the helper's
    // default): 1W/1M bands are often a few pixels tall yet still carry a
    // useful price. Overlapping tags are stacked by findVerticalSlot below.
    const minBandHeight = 0;
    zones.forEach((zone) => {
      if (hiddenRef.has(zone.legendName)) return;
      const series = candleSeries;
      if (!series || typeof series.priceToCoordinate !== "function") return;
      const xStart = ts.timeToCoordinate?.(zone.start as never);
      const xEnd = ts.timeToCoordinate?.(zone.end as never);
      const yTop = series.priceToCoordinate(zone.top);
      const yBottom = series.priceToCoordinate(zone.bottom);
      if (xStart == null || xEnd == null || yTop == null || yBottom == null) return;
      if (xEnd < 0 || xStart > paneWidth) return;
      if (Math.max(yTop, yBottom) < 0 || Math.min(yTop, yBottom) > zonePaneHeight) return;

      const padX = 4;
      const placement = layoutZoneLabel(
        {
          fullText: srZoneLabel(zone, priceFormat.format(zone.top)),
          compactText: srZoneLabel(zone, compactPriceFormat.format(zone.top), true),
          fallbackTexts: [
            srZoneLabel(zone, shortPriceFormat.format(zone.top), true),
            zone.kind === "sr" ? "S/R" : zone.kind === "support" ? "S" : "R",
          ],
          xStart,
          topY: yTop,
          bottomY: yBottom,
        },
        {
          chartWidth: rect.width,
          paneWidth,
          paneHeight: zonePaneHeight,
          minBandHeight,
          measure: (text) => ctx.measureText(text).width + padX * 2,
        },
      );
      if (!placement) return;
      // Keep labels readable even when two bands sit on top of each other; the
      // first free slot wins, with the band centre as the guaranteed fallback.
      const by =
        findVerticalSlot(
          placed,
          placement.x,
          placement.w,
          placement.y,
          placement.h,
          zonePaneHeight,
        ) ?? placement.y;
      const { x: bx, w, h } = placement;
      placed.push({ x: bx, y: by, w, h });
      ctx.fillStyle = "rgba(8,8,8,0.92)";
      ctx.strokeStyle = withAlpha(zone.color, ZONE_BORDER_ALPHA);
      ctx.lineWidth = 1;
      ctx.fillRect(bx, by, w, h);
      ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
      ctx.fillStyle = zone.color;
      ctx.fillText(placement.text, bx + padX, by + h / 2 + 0.5);
    });
  };

  createEffect(() => {
    data();
    drawEndLabels();
  });

  // Legend toggles: show/hide a pattern's line series in place (no recreate) and
  // repaint the end-label overlay so hidden lines drop their inline labels too.
  createEffect(() => {
    const next = props.hiddenNames ?? EMPTY_HIDDEN;
    hiddenRef = next;
    const d = data();
    lineSeries.forEach((series, i) => {
      const line = d.lines[i];
      if (!line) return;
      series.applyOptions({ visible: !next.has(line.name) });
    });
    priceLines.forEach(({ name, line }) => {
      const hidden = next.has(name);
      line.applyOptions({ lineVisible: !hidden, axisLabelVisible: !hidden });
    });
    indicatorLineSeries.forEach((series, id) => {
      const line = d.indicatorLines.find((candidate) => candidate.id === id);
      if (!line) return;
      series.applyOptions({ visible: !next.has(line.legendName ?? line.name) });
    });
    updateMarkers();
    syncZones();
    drawEndLabels();
  });

  return (
    <div
      data-testid="patterns-tv-chart"
      data-partial={partialTime() != null ? "true" : undefined}
      data-active-indicators={String(activeIndicatorCount())}
      data-indicator-ids={indicatorIds()}
      data-label-eligible-indicators={labelEligibleIndicatorIds()}
      data-visible-crosses={String(visibleCrossCount())}
      data-visible-zones={String(visibleZoneCount())}
      className="relative flex min-h-0 w-full flex-col"
      style={{ height: typeof props.height === "number" ? `${props.height}px` : (props.height ?? "100%") }}
    >
      <Show when={partialTime() != null}>
        <span
          data-testid="patterns-tv-partial-badge"
          className="pointer-events-none absolute right-2 top-1 z-[4] rounded-fin border px-1.5 py-0.5 font-mono text-ui-micro font-semibold uppercase tracking-wide"
          style={{
            color: palette.WARNING,
            "border-color": withAlpha(palette.WARNING, 0.5),
            "background-color": withAlpha(palette.BG, 0.85),
          }}
          title="The last candle is still forming"
        >
          Forming
        </span>
      </Show>
      <div ref={(el) => (containerEl = el)} className="relative min-h-0 w-full flex-1" />
      <canvas
        ref={(el) => (overlayEl = el)}
        aria-hidden="true"
        data-testid="patterns-tv-overlay"
        style={{ position: "absolute", inset: "0", "pointer-events": "none", "z-index": 3 }}
      />
    </div>
  );
}
