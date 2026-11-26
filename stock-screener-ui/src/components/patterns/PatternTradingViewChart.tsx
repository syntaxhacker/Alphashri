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
  type TVRect,
  type TVSiblingOverlay,
} from "./patternTVData";
import { ZONE_BORDER_ALPHA, ZoneBandPrimitive } from "./ZoneBandPrimitive";
import { CROSSES_LEGEND_NAME } from "./patternIndicatorData";
import { chartPriceLocale } from "./chartFormat";
import { KEY_POINTS_LEGEND_NAME, PIVOT_LEGEND_NAME } from "@/config/patterns";
import { MARKET_TIME_ZONE, type ChartMarket } from "@/utils/chart/time";
import { tvDateBadgeLabel, tvTickMarkFormatter, tvTimeFormatter } from "@/utils/tvTimeFormat";

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

interface CrossMarkerEntry {
  marker: TVMarker;
  /** Candle index, used to clip crosses to the visible logical range. */
  index: number;
}

interface MarkerCache {
  data: BuildPatternTVDataResult;
  hidden: ReadonlySet<string>;
  /** Visible non-cross markers, pre-sorted by time. */
  others: TVMarker[];
  /** Visible, non-partial crosses in candle order. */
  crosses: CrossMarkerEntry[];
}

interface CachedLineLabel {
  series: { priceToCoordinate?: (price: number) => number | null };
  time: TVLine["points"][number]["time"];
  value: number;
  text: string;
  color: string;
  width: number;
  height: number;
}

interface CachedZoneLabel {
  zone: TVRect;
  fullText: string;
  compactText: string;
  fallbackTexts: string[];
}

interface CachedIndicatorLabel {
  id: string;
  label: string;
  color: string;
  series: { priceToCoordinate?: (price: number) => number | null };
  value: number;
}

interface OverlayLabelCache {
  data: BuildPatternTVDataResult;
  hidden: ReadonlySet<string>;
  locale: string;
  lines: CachedLineLabel[];
  zones: CachedZoneLabel[];
  indicators: CachedIndicatorLabel[];
  lastCandleTime: number | null;
  /** Text width cache; labels are measured once per data/locale change. */
  measure: (text: string) => number;
}

/** `Intl.NumberFormat` construction is expensive; reuse one set per locale. */
const PRICE_FORMATS = new Map<
  string,
  { full: Intl.NumberFormat; compact: Intl.NumberFormat; short: Intl.NumberFormat }
>();

function priceFormatsFor(locale: string) {
  let formats = PRICE_FORMATS.get(locale);
  if (!formats) {
    formats = {
      full: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
      compact: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
      short: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
    };
    PRICE_FORMATS.set(locale, formats);
  }
  return formats;
}

/** Minimum band height (px) that earns an S/R label pill. */
export const ZONE_LABEL_MIN_BAND_HEIGHT = 12;
/** A zone pill may never cover more than this share of the plot width. */
export const ZONE_LABEL_MAX_WIDTH_RATIO = 0.45;
/** Height of the zone pill, including its border. */
export const ZONE_LABEL_HEIGHT = 14;
/** Charts narrower than this use every compact-mode reduction (labels, fit). */
export const COMPACT_CHART_WIDTH = 640;
/** Charts narrower than this use the compact (touch-count-free) label. */
export const ZONE_LABEL_COMPACT_WIDTH = COMPACT_CHART_WIDTH;
/** Time-axis padding (px) at each edge so first/last tick labels stay whole. */
export const TIME_AXIS_EDGE_PADDING_PX = 18;
/** Bars reserved after the newest bar (kept in sync with createChart). */
const TIME_SCALE_RIGHT_OFFSET = 12;
/** Compact charts fit at most this many recent bars so bars stay ~1 px wide. */
export const COMPACT_INITIAL_BAR_CAP = 300;
/** A 3h/4h window longer than this is treated as a multi-month view. */
const MULTI_MONTH_SPAN_SECONDS = 60 * 24 * 60 * 60;
/** Badge gains a year once the visible window spans more than this. */
const DATE_BADGE_YEAR_SPAN_SECONDS = 330 * 24 * 60 * 60;

/** True only for a measured width below the compact breakpoint. */
export function isCompactChartWidth(width: number | null | undefined): boolean {
  return (
    typeof width === "number" && Number.isFinite(width) && width > 0 && width < COMPACT_CHART_WIDTH
  );
}

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
 * Options for the initial logical range. Below `COMPACT_CHART_WIDTH` the data
 * window is capped to the most recent `maxBars` bars so 500-bar intraday
 * series are not squeezed into sub-pixel candles.
 */
export interface InitialVisibleRangeOptions {
  /** Container width; compact only when measured and below 640. */
  chartWidth?: number;
  /** Data bars kept by the compact window (default 300). */
  maxBars?: number;
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
  options: InitialVisibleRangeOptions = {},
): { from: number; to: number } | null {
  if (!Number.isFinite(barCount) || barCount <= 0) return null;
  if (!Number.isFinite(paneWidth) || paneWidth <= edgePaddingPx * 2) return null;
  const offset = Number.isFinite(rightOffset) && rightOffset > 0 ? rightOffset : 0;
  const requestedBars = options.maxBars;
  const maxBars =
    typeof requestedBars === "number" && Number.isFinite(requestedBars) && requestedBars >= 1
      ? Math.floor(requestedBars)
      : COMPACT_INITIAL_BAR_CAP;
  const compact = isCompactChartWidth(options.chartWidth);
  const fullSlots = Math.max(1, barCount - 1 + offset);
  // The compact budget includes rightOffset and both padding gutters, so the
  // visible span (and therefore the bar count on screen) never exceeds ~300.
  // Short series (fewer bars than the budget) keep the normal full fit.
  const capped = compact && fullSlots > maxBars;
  const slots = capped ? maxBars : fullSlots;
  const padBars = Math.ceil((edgePaddingPx * slots) / Math.max(1, paneWidth - edgePaddingPx * 2));
  const visibleBars = capped
    ? Math.max(1, Math.min(barCount, slots - offset - 2 * padBars))
    : barCount;
  const firstVisible = barCount - visibleBars;
  return { from: firstVisible - padBars, to: barCount - 1 + offset + padBars };
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

/**
 * Compact charts render the colored cross shapes without their `GC`/`DC`
 * text; the Crosses legend still explains the colours and the marker's
 * low/high position is unchanged, so hover and crosshair behaviour is intact.
 */
export function suppressCrossMarkerText(markers: readonly TVMarker[]): TVMarker[] {
  let changed = false;
  const result = markers.map((marker) => {
    if (marker.group !== "crosses" || marker.text === "") return marker;
    changed = true;
    return { ...marker, text: "" };
  });
  return changed ? result : (markers as TVMarker[]);
}

/** First cross whose candle index is >= `value`. */
function lowerBoundCross(entries: readonly CrossMarkerEntry[], value: number): number {
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (entries[mid]!.index < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First cross whose candle index is > `value`. */
function upperBoundCross(entries: readonly CrossMarkerEntry[], value: number): number {
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (entries[mid]!.index <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Merge sorted non-cross markers with a sorted cross slice, no re-sort. */
function mergeVisibleMarkers(
  others: readonly TVMarker[],
  crosses: readonly CrossMarkerEntry[],
  start: number,
  count: number,
): TVMarker[] {
  const merged = Array.from({ length: others.length + count }) as TVMarker[];
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < others.length && j < count) {
    const other = others[i]!;
    const cross = crosses[start + j]!.marker;
    if (other.time <= cross.time) {
      merged[k++] = other;
      i++;
    } else {
      merged[k++] = cross;
      j++;
    }
  }
  while (i < others.length) merged[k++] = others[i++]!;
  while (j < count) merged[k++] = crosses[start + j++]!.marker;
  return merged;
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

  // Pan/zoom fires the visible-range callback on every frame. Marker selection
  // and overlay label metadata are data/hidden dependent, so cache them and
  // only recompute the range-dependent slice per frame.
  let markerCache: MarkerCache | null = null;
  let markerGeneration = 0;
  let markerRangeKey = "";
  let overlayCache: OverlayLabelCache | null = null;
  let overlayFrame = 0;
  let overlayGeometryDirty = true;
  let overlaySize: { width: number; height: number } | null = null;
  let overlayDpr = 0;
  // Double-buffered label rects: clear only regions painted last frame.
  let overlayDrawnRects: LabelRect[] = [];
  let overlayScratchRects: LabelRect[] = [];

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
    // Resolve the tick's pane coordinate so the formatter can skip labels that
    // would be clipped after a user zoom/pan removes the initial edge padding.
    let x: number | null = null;
    let paneWidth: number | null = null;
    const ts = chart?.timeScale();
    if (ts && typeof ts.timeToCoordinate === "function" && typeof ts.width === "function") {
      try {
        x = ts.timeToCoordinate(time as never);
        paneWidth = ts.width();
      } catch {
        x = null;
        paneWidth = null;
      }
    }
    return tvTickMarkFormatter(time, kind, timeZoneRef, { timeframe, multiMonth, x, paneWidth });
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
      overlayGeometryDirty = true;
      scheduleOverlayDraw();
    });
    ro.observe(containerEl);

    const ts = created.timeScale();
    if (typeof ts.subscribeVisibleLogicalRangeChange === "function") {
      // Pan/zoom only changes the visible slice and the overlay coordinates;
      // both are cheap once the per-data caches are warm.
      const onRangeChange = () => {
        updateMarkers();
        scheduleOverlayDraw();
      };
      const onResize = () => {
        overlayGeometryDirty = true;
        updateMarkers();
        scheduleOverlayDraw();
      };
      ts.subscribeVisibleLogicalRangeChange(onRangeChange);
      window.addEventListener("resize", onResize);
      const parentRo = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
      if (containerEl && parentRo) parentRo.observe(containerEl);
      onCleanup(() => {
        ts.unsubscribeVisibleLogicalRangeChange?.(onRangeChange);
        parentRo?.disconnect();
        window.removeEventListener("resize", onResize);
        if (overlayFrame) {
          cancelAnimationFrame(overlayFrame);
          overlayFrame = 0;
        }
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
      markerCache = null;
      overlayCache = null;
      overlaySize = null;
      overlayDrawnRects = [];
      overlayScratchRects = [];
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

  /** Container width, falling back to the pane width in test/zero-layout hosts. */
  const chartWidthPx = (): number => {
    const measured = containerEl?.clientWidth ?? 0;
    if (Number.isFinite(measured) && measured > 0) return measured;
    const ts = chart?.timeScale();
    const pane = ts && typeof ts.width === "function" ? ts.width() : 0;
    return Number.isFinite(pane) && pane > 0 ? pane : 0;
  };

  /**
   * Fit once, then add whitespace before/after the bars so the first and last
   * tick labels are not centred on — and clipped by — the plot edges. Compact
   * charts keep only the newest ~300 bars so 1m/5m candles stay readable;
   * panning left reveals the older bars. Pan/zoom are untouched after this.
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
      TIME_AXIS_EDGE_PADDING_PX,
      {
        chartWidth: chartWidthPx(),
        maxBars: COMPACT_INITIAL_BAR_CAP,
      },
    );
    if (range) ts.setVisibleLogicalRange(range);
  };

  /** Data/hidden-dependent marker index; rebuilt only when either changes. */
  const buildMarkerCache = (
    d: BuildPatternTVDataResult,
    hiddenSet: ReadonlySet<string>,
  ): MarkerCache => {
    const partial = partialTime();
    const indexByTime = new Map<number, number>();
    d.candles.forEach((c, i) => indexByTime.set(c.time, i));
    const others: TVMarker[] = [];
    const crosses: CrossMarkerEntry[] = [];
    for (const marker of d.markers) {
      if (hiddenSet.has(markerLegendName(marker))) continue;
      if (marker.group !== "crosses") {
        others.push(marker);
        continue;
      }
      if (partial != null && marker.time === partial) continue;
      const index = indexByTime.get(marker.time);
      if (index == null) continue;
      crosses.push({ marker, index });
    }
    others.sort((a, b) => a.time - b.time);
    crosses.sort((a, b) => a.index - b.index);
    markerGeneration += 1;
    return { data: d, hidden: hiddenSet, others, crosses };
  };

  const updateMarkers = () => {
    const plugin = markers;
    if (!plugin) return;
    const d = data();
    if (!markerCache || markerCache.data !== d || markerCache.hidden !== hiddenRef) {
      markerCache = buildMarkerCache(d, hiddenRef);
      markerRangeKey = "";
    }
    const cache = markerCache;

    // Binary-search the visible candle range instead of walking all markers.
    const range = visibleLogicalRange();
    let start = 0;
    let end = cache.crosses.length;
    if (range) {
      start = lowerBoundCross(cache.crosses, range.from - 0.5);
      end = upperBoundCross(cache.crosses, range.to + 0.5);
    }
    let count = end - start;
    if (count > MAX_VISIBLE_CROSSES) {
      start = end - MAX_VISIBLE_CROSSES;
      count = MAX_VISIBLE_CROSSES;
    }
    if (count < 0) count = 0;

    // Crosses only enter/leave at range boundaries; skip the chart API when
    // the visible marker set (and compact label mode) is unchanged.
    const compactLabels = isCompactChartWidth(chartWidthPx());
    const key = `${markerGeneration}:${start}:${count}:${compactLabels ? "c" : "w"}`;
    if (key === markerRangeKey) return;
    markerRangeKey = key;

    let shown: TVMarker[];
    if (count === 0) {
      shown = cache.others;
    } else if (cache.others.length === 0) {
      shown = Array.from({ length: count }) as TVMarker[];
      for (let i = 0; i < count; i++) shown[i] = cache.crosses[start + i]!.marker;
    } else {
      shown = mergeVisibleMarkers(cache.others, cache.crosses, start, count);
    }
    if (compactLabels) shown = suppressCrossMarkerText(shown);
    try {
      plugin.setMarkers(shown as never);
    } catch {
      /* noop */
    }
    setVisibleCrossCount(count);
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

  /** Build the data/hidden/locale-scoped label metadata once, then reuse it. */
  const buildOverlayCache = (
    ctx: CanvasRenderingContext2D,
    d: BuildPatternTVDataResult,
    hiddenSet: ReadonlySet<string>,
    locale: string,
  ): OverlayLabelCache => {
    const measured = new Map<string, number>();
    const measure = (text: string): number => {
      let width = measured.get(text);
      if (width == null) {
        width = ctx.measureText(text).width;
        measured.set(text, width);
      }
      return width;
    };
    const formats = priceFormatsFor(locale);

    const lines: CachedLineLabel[] = [];
    d.lines.forEach((line, i) => {
      if (!line.labelEligible || hiddenSet.has(line.name)) return;
      // Keep the runtime guard: test doubles and future library builds may omit
      // the coordinate mapper, and the label pass must not throw without it.
      const series: { priceToCoordinate?: (p: number) => number | null } | undefined = lineSeries[i];
      if (!series || typeof series.priceToCoordinate !== "function") return;
      const anchor = line.labelAt === "start" ? line.points[0] : line.points[line.points.length - 1];
      if (!anchor) return;
      const text = line.label ?? line.name;
      lines.push({
        series,
        time: anchor.time,
        value: anchor.value,
        text,
        color: line.color,
        width: measure(text) + 8,
        height: 16,
      });
    });

    const zones: CachedZoneLabel[] = [];
    d.zones.forEach((zone) => {
      if (hiddenSet.has(zone.legendName)) return;
      zones.push({
        zone,
        fullText: srZoneLabel(zone, formats.full.format(zone.top)),
        compactText: srZoneLabel(zone, formats.compact.format(zone.top), true),
        fallbackTexts: [
          srZoneLabel(zone, formats.short.format(zone.top), true),
          zone.kind === "sr" ? "S/R" : zone.kind === "support" ? "S" : "R",
        ],
      });
    });

    const indicators: CachedIndicatorLabel[] = [];
    d.indicatorLines.forEach((line) => {
      if (!line.labelEligible || !line.id) return;
      if (hiddenSet.has(line.legendName ?? line.name)) return;
      const series = indicatorLineSeries.get(line.id);
      if (!series || typeof series.priceToCoordinate !== "function") return;
      const anchor = lastValuedPoint(line.points);
      if (!anchor) return;
      indicators.push({
        id: line.id,
        label: line.label ?? line.name,
        color: line.color,
        series,
        value: anchor.value,
      });
    });

    const candles = d.candles;
    const lastCandle = candles[candles.length - 1];
    return {
      data: d,
      hidden: hiddenSet,
      locale,
      lines,
      zones,
      indicators,
      lastCandleTime: lastCandle ? lastCandle.time : null,
      measure,
    };
  };

  /** Coalesce multiple range/resize events into one overlay paint. */
  const scheduleOverlayDraw = (geometryDirty = false) => {
    if (geometryDirty) overlayGeometryDirty = true;
    if (overlayFrame) return;
    overlayFrame = requestAnimationFrame(() => {
      overlayFrame = 0;
      drawEndLabels();
    });
  };

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
    if (!overlaySize || overlayGeometryDirty) {
      const rect = parent ? parent.getBoundingClientRect() : canvas.getBoundingClientRect();
      overlaySize = { width: rect.width, height: rect.height };
      overlayGeometryDirty = false;
    }
    const width = overlaySize.width;
    const height = overlaySize.height;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const cw = Math.round(width * dpr);
    const ch = Math.round(height * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      // Assigning width/height clears the canvas; no stale pills to erase.
      overlayDrawnRects = [];
      overlayDpr = dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Clear only the pills painted last frame instead of the whole overlay.
    for (const rect of overlayDrawnRects) {
      ctx.clearRect(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4);
    }
    overlayScratchRects.length = 0;
    if (width === 0 || height === 0) {
      overlayDrawnRects = overlayScratchRects;
      overlayScratchRects = [];
      return;
    }
    const ts = chart.timeScale();
    if (typeof ts.timeToCoordinate !== "function") return;
    ctx.font = `600 ${typeSize("micro")}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    const d = data();
    if (
      !overlayCache ||
      overlayCache.data !== d ||
      overlayCache.hidden !== hiddenRef ||
      overlayCache.locale !== localeRef ||
      overlayDpr !== dpr
    ) {
      overlayCache = buildOverlayCache(ctx, d, hiddenRef, localeRef);
    }
    const cache = overlayCache;
    const placed = overlayScratchRects;
    const paneWidth = typeof ts.width === "function" ? ts.width() : width;
    const timeAxisHeight = typeof ts.height === "function" ? ts.height() : 0;
    const paneHeight = Math.max(1, height - timeAxisHeight);

    // Compact charts often end on a bare day (`23`) or month (`Nov`) tick. A
    // subdued bottom-right badge names the newest visible bar without adding
    // another axis label (so the edge-clipping suppression stays untouched).
    let dateBadge: { text: string; rect: LabelRect } | null = null;
    if (isCompactChartWidth(width)) {
      const range = visibleLogicalRange();
      const candles = cache.data.candles;
      if (range && candles.length > 0) {
        const lastIndex = Math.max(0, Math.min(candles.length - 1, Math.floor(range.to)));
        const firstIndex = Math.max(0, Math.min(lastIndex, Math.ceil(range.from)));
        const last = candles[lastIndex]!;
        const first = candles[firstIndex]!;
        const includeYear = Math.abs(last.time - first.time) > DATE_BADGE_YEAR_SPAN_SECONDS;
        const text = tvDateBadgeLabel(last.time as Time, timeZoneRef, { includeYear });
        if (text) {
          const w = cache.measure(text) + 10;
          const rect = {
            x: Math.max(0, paneWidth - w - 4),
            y: Math.max(0, paneHeight - 16 - 4),
            w,
            h: 16,
          };
          dateBadge = { text, rect };
          placed.push(rect);
        }
      }
    }

    for (const label of cache.lines) {
      const x = ts.timeToCoordinate?.(label.time as never);
      const y = label.series.priceToCoordinate!(label.value);
      if (x == null || y == null) continue;
      const { text, color, width: w, height: h } = label;
      const padX = 4;
      // Sit the label just left of the line's last point so it never collides
      // with the library's right-axis price-line titles (Breakout/Stop/Target).
      let bx = Math.max(0, Math.min(x - w - 6, Math.max(0, width - w)));
      let by = Math.min(Math.max(y - h / 2, 0), Math.max(0, height - h));
      for (let guard = 0; guard < 12; guard++) {
        const clash = placed.some(
          (p) => bx < p.x + p.w && bx + w > p.x && by < p.y + p.h && by + h > p.y,
        );
        if (!clash) break;
        if (bx - (w + 4) >= 0) {
          bx -= w + 4;
        } else if (bx + w + 4 + w <= width) {
          bx += w + 4;
        } else {
          by = Math.min(by + h + 2, Math.max(0, height - h));
        }
      }
      placed.push({ x: bx, y: by, w, h });
      ctx.fillStyle = "rgba(8,8,8,0.92)";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.fillRect(bx, by, w, h);
      ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
      ctx.fillStyle = color;
      ctx.fillText(text, bx + padX, by + h / 2 + 0.5);
    }

    // Indicator tags live only in the blank gutter after the newest bar (never
    // on the data, never from LWC's price scale).
    const lastBarX =
      cache.lastCandleTime != null ? ts.timeToCoordinate?.(cache.lastCandleTime as never) : null;
    if (lastBarX != null && lastBarX >= 0 && lastBarX <= paneWidth) {
      const timeScaleOptions = typeof ts.options === "function" ? ts.options() : null;
      const barSpacing = timeScaleOptions?.barSpacing ?? 6;
      // Half a bar clears the newest candle body; rightOffset guarantees the
      // tags right of this point sit on blank canvas.
      const gutterLeft = Math.min(paneWidth - 4, lastBarX + Math.max(barSpacing / 2, 2));
      const candidates: IndicatorTagCandidate[] = [];
      for (const indicator of cache.indicators) {
        const y = indicator.series.priceToCoordinate!(indicator.value);
        if (y == null || y < 0 || y > height) continue;
        candidates.push({
          id: indicator.id,
          label: indicator.label,
          color: indicator.color,
          y,
        });
      }

      const { tags } = layoutIndicatorTags(candidates, {
        paneWidth,
        paneHeight: height,
        gutterLeft,
        placed,
        measure: (text) => cache.measure(text) + 8,
      });
      for (const tag of tags) {
        placed.push(tag);
        ctx.fillStyle = "rgba(8,8,8,0.92)";
        ctx.strokeStyle = tag.color;
        ctx.lineWidth = 1;
        ctx.fillRect(tag.x, tag.y, tag.w, tag.h);
        ctx.strokeRect(tag.x + 0.5, tag.y + 0.5, tag.w - 1, tag.h - 1);
        ctx.fillStyle = tag.color;
        ctx.fillText(tag.label, tag.x + 4, tag.y + tag.h / 2 + 0.5);
      }
    }

    const zones = cache.zones;
    if (zones.length > 0) {
      // Every visible band gets a tag (the 12 px gate is only the helper's
      // default): 1W/1M bands are often a few pixels tall yet still carry a
      // useful price. Overlapping tags are stacked by findVerticalSlot below.
      const minBandHeight = 0;
      const zoneSeries = candleSeries;
      if (zoneSeries && typeof zoneSeries.priceToCoordinate === "function") {
        for (const { zone, fullText, compactText, fallbackTexts } of zones) {
          const xStart = ts.timeToCoordinate?.(zone.start as never);
          const xEnd = ts.timeToCoordinate?.(zone.end as never);
          const yTop = zoneSeries.priceToCoordinate(zone.top);
          const yBottom = zoneSeries.priceToCoordinate(zone.bottom);
          if (xStart == null || xEnd == null || yTop == null || yBottom == null) continue;
          if (xEnd < 0 || xStart > paneWidth) continue;
          if (Math.max(yTop, yBottom) < 0 || Math.min(yTop, yBottom) > paneHeight) continue;

          const padX = 4;
          const placement = layoutZoneLabel(
            { fullText, compactText, fallbackTexts, xStart, topY: yTop, bottomY: yBottom },
            {
              chartWidth: width,
              paneWidth,
              paneHeight,
              minBandHeight,
              measure: (text) => cache.measure(text) + padX * 2,
            },
          );
          if (!placement) continue;
          // Keep labels readable even when two bands sit on top of each other;
          // the first free slot wins, with the band centre as the fallback.
          const by =
            findVerticalSlot(
              placed,
              placement.x,
              placement.w,
              placement.y,
              placement.h,
              paneHeight,
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
        }
      }
    }

    // Badge reserved above so every other label avoids it; painted last so a
    // crowded zone/label pass can never hide the date.
    if (dateBadge) {
      const { text, rect } = dateBadge;
      ctx.fillStyle = "rgba(8,8,8,0.82)";
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = withAlpha(palette.BORDER, 0.8);
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
      ctx.fillStyle = palette.TEXT_MUTED;
      ctx.fillText(text, rect.x + 5, rect.y + rect.h / 2 + 0.5);
    }

    // Swap the rect buffers so the next frame erases exactly what was painted.
    const previous = overlayDrawnRects;
    overlayDrawnRects = placed;
    overlayScratchRects = previous;
    overlayScratchRects.length = 0;
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
