import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
  type LineWidth,
} from "lightweight-charts";
import * as palette from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import type { ReplayCandle, ReplayTrade } from "@/types/replay";
import type { MarkLineData, PriceAreaData, UnifiedLivePosition, VisibleBarsRange } from "@/utils/chart/types";
import {
  AUTOSCALE_LEVEL_PCT,
  AUTOSCALE_MAX_SPAN_FACTOR,
  AUTOSCALE_RANGE_PAD_PCT,
} from "@/utils/chart/types";
import { filterVisibleTrades } from "@/utils/chart/normalizeCommon";
import { tvTickMarkFormatter, tvTimeFormatter } from "@/utils/tvTimeFormat";
import { toEpochSeconds } from "@/utils/chart/time";

export interface TradingViewChartProps {
  candles: ReplayCandle[];
  trades?: ReplayTrade[];
  highlightedTradeId?: number | null;
  /** When a trade is highlighted, only that trade is plotted unless this is true. */
  showAllTrades?: boolean;
  onTradeClick?: (id: number) => void;
  height?: number;
  /** Horizontal levels (ORB high/low, pivots, 52W high/low, highlighted SL/TP) */
  markLines?: MarkLineData[];
  /** Horizontal price zones rendered as shaded rectangles. */
  priceAreas?: PriceAreaData[];
  /** EMA overlays, each aligned index-wise to `candles` */
  emaData?: { label: string; color: string; data: (number | null)[] }[];
  /** Amber dot markers pinned to a price (e.g. candle closes at max pain).
   *  Rendered as a line-less scatter series so the dot sits on the price. */
  touchMarkers?: {
    time: string;
    value: number;
    shape?: "circle" | "arrowUp" | "arrowDown";
    color?: string;
    position?: "aboveBar" | "belowBar";
    text?: string;
    size?: number;
  }[];
  /** RSI(period) series aligned index-wise to `candles`; rendered in its own pane. */
  rsiData?: { period: number; data: (number | null)[] };
  /** Active position entry / SL / TP levels */
  livePosition?: UnifiedLivePosition;
  /** Colour theme: "nt" = NinjaTrader high-contrast (tick-replay palette). */
  theme?: "default" | "nt";
  /** Price series style: "candles" (default) or a single close-price line. */
  chartType?: "candles" | "line";
  /** Draw larger, higher-contrast BUY/SELL pills over entry markers (opt-in). */
  entryLabels?: boolean;
  /** Notified once the chart is created (and again on recreate) so callers can draw overlays. */
  onChartReady?: (chart: IChartApi, candleSeries: ISeriesApi<"Candlestick">) => void;
  /** Extend the price scale to include `markLines` flagged `includeInScale`
   *  (default false). Opt-in so charts with far-away reference levels
   *  (e.g. 52W high) keep their candles readable; the Nifty report enables it
   *  so a GEX level outside the day's range is not silently clipped off-screen. */
  fitMarkLines?: boolean;
}

export interface TradingViewChartHandle {
  getChart: () => IChartApi | null;
  getCandleSeries: () => ISeriesApi<"Candlestick"> | null;
  fitContent: () => void;
  /** Zoom to an inclusive index window out of `total` bars (logical range). */
  zoomToIndexRange: (startIdx: number, endIdx: number, total?: number) => void;
  /** Zoom to a time window; falls back to fitContent when times are unparseable. */
  zoomToTimeRange: (fromTime: string, toTime: string) => void;
}

/** Buy unless explicitly a short/sell side. Accepts BUY/SELL and LONG/SHORT. */
function isBuySide(side?: string): boolean {
  const v = (side || "BUY").toUpperCase();
  return v !== "SELL" && v !== "SHORT";
}

function toLineStyle(type: string): LineStyle {
  switch (type) {
    case "dashed":
      return LineStyle.Dashed;
    case "dotted":
      return LineStyle.Dotted;
    case "largeDashed":
      return LineStyle.LargeDashed;
    case "sparseDotted":
      return LineStyle.SparseDotted;
    default:
      return LineStyle.Solid;
  }
}

function clampWidth(w?: number): LineWidth {
  const n = Math.round(w ?? 1);
  return (n < 1 ? 1 : n > 4 ? 4 : n) as LineWidth;
}

/**
 * Stable identities for the optional props' defaults.
 *
 * A `= []` default parameter allocates a new array on every render, so every
 * `useCallback`/`useEffect` that depends on it changes identity on every parent
 * render — which re-subscribed the time-scale handler, rebuilt the
 * `ResizeObserver` and re-registered the window `resize` listener on every
 * report poll. One constant per prop keeps those identities stable.
 */
const EMPTY_TRADES: ReplayTrade[] = [];
const EMPTY_MARK_LINES: MarkLineData[] = [];
const EMPTY_PRICE_AREAS: PriceAreaData[] = [];
const EMPTY_EMA: { label: string; color: string; data: (number | null)[] }[] = [];
const EMPTY_TOUCH_MARKERS: NonNullable<TradingViewChartProps["touchMarkers"]> = [];
/** Shared "no entry-label geometry" value (see `entryGeometry`). */
const EMPTY_ENTRY_GEOMETRY: { barTimes: number[]; byTime: Map<number, ReplayCandle> } = {
  barTimes: [],
  byTime: new Map(),
};

/**
 * Content signature of the horizontal overlays.
 *
 * The report poll hands us brand-new arrays with identical content every cycle.
 * Rebuilding every price line for that (remove + create per level) churns the
 * series' price-line collection for nothing, so the overlay effect compares this
 * signature and skips the rebuild when nothing actually moved.
 */
export function markOverlaySignature(
  markLines: MarkLineData[] | undefined,
  livePosition?: UnifiedLivePosition,
  extra = "",
): string {
  const levels = (markLines ?? [])
    .map(
      (ml) =>
        `${ml.yAxis}|${ml.lineStyle.color}|${ml.lineStyle.width}|${ml.lineStyle.type}|${ml.label.formatter}|${ml.includeInScale ? 1 : 0}`,
    )
    .join(";");
  const live =
    livePosition != null
      ? `${livePosition.entry_price}|${livePosition.stop_loss ?? ""}|${livePosition.take_profit ?? ""}`
      : "";
  return `${extra}#${levels}#${live}`;
}

/**
 * Content signature of the candle + volume series.
 *
 * The report poll hands us a brand-new array with identical content every
 * tick, and `setData` re-serialises and re-pushes every bar. Rolling hash
 * over every field keeps this O(n) with no allocation; identical inputs
 * always produce the same signature.
 */
function candleSignature(candles: ReplayCandle[]): string {
  if (candles.length === 0) return "0";
  let h = 2166136261 >>> 0;
  const mixNum = (n: number) => {
    h = Math.imul(h ^ Math.round((Number.isFinite(n) ? n : 0) * 100), 16777619) >>> 0;
  };
  for (const c of candles) {
    const t = c.time;
    for (let i = 0; i < t.length; i++) {
      h = Math.imul(h ^ t.charCodeAt(i), 16777619) >>> 0;
    }
    mixNum(c.open);
    mixNum(c.high);
    mixNum(c.low);
    mixNum(c.close);
    mixNum(c.volume ?? 0);
  }
  return `${candles.length}|${h}`;
}

/**
 * Content signature of one EMA series' pushed points.
 *
 * The report poll hands us brand-new EMA arrays every cycle; `setData`
 * re-serialises every point even when nothing moved. Label + colour + the
 * exact (time, value) points that would be pushed keeps this O(n) and
 * lets the effect skip unchanged series.
 */
function emaDataSignature(
  ema: { label: string; color: string },
  points: LineData[],
): string {
  let h = 2166136261 >>> 0;
  const mixNum = (n: number) => {
    h = Math.imul(h ^ Math.round((Number.isFinite(n) ? n : 0) * 100), 16777619) >>> 0;
  };
  for (const p of points) {
    mixNum(p.time as number);
    mixNum(p.value);
  }
  return `${ema.label}|${ema.color}|${points.length}|${h}`;
}

/** Signature of the autoscale closure's inputs: rendered bars range, spot,
 *  included levels and the fit toggle. The provider captures exactly these,
 *  so an unchanged signature means an equivalent closure — skip re-applying. */
function autoscaleSignature(
  fitMarkLines: boolean,
  bars: VisibleBarsRange | null,
  spot: number,
  levels: number[],
): string {
  if (!fitMarkLines) return "off";
  const barsPart = bars ? `${bars.low}|${bars.high}` : "none";
  const spotPart = Number.isFinite(spot) ? String(spot) : "nan";
  return `on|${barsPart}|${spotPart}|${levels.join(",")}`;
}

/** Minimal shape of lightweight-charts' autoscale result used here. */
type AutoscaleRange = { priceRange: { minValue: number; maxValue: number } | null };

/** Min-low / max-high of the rendered candle window. `null` when empty. */
export function visibleBarsRange(
  candles: { low: number; high: number }[],
): VisibleBarsRange | null {
  let low = Infinity;
  let high = -Infinity;
  for (const c of candles) {
    if (Number.isFinite(c.low)) low = Math.min(low, c.low);
    if (Number.isFinite(c.high)) high = Math.max(high, c.high);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high) || !(high > low)) {
    return null;
  }
  return { low, high };
}

function validBarsRange(v: VisibleBarsRange | null | undefined): v is VisibleBarsRange {
  return (
    !!v &&
    Number.isFinite(v.low) &&
    Number.isFinite(v.high) &&
    v.high > v.low
  );
}

/**
 * True when a level may widen the price scale: within ±`levelPct` of spot, or
 * inside the visible bars' range ±`rangePadPct` of the bars' span. Mirrors the
 * panel-side `levelBelongsToScale` rule so the engine-side clamp agrees with
 * the `includeInScale` flags even when they are stale.
 */
export function levelWithinAutoscale(
  level: number,
  spot: number,
  bars: VisibleBarsRange | null,
  levelPct = AUTOSCALE_LEVEL_PCT,
  rangePadPct = AUTOSCALE_RANGE_PAD_PCT,
): boolean {
  if (!Number.isFinite(level) || level <= 0) return false;
  if (
    Number.isFinite(spot) &&
    spot > 0 &&
    Math.abs(level - spot) <= Math.abs(spot) * levelPct
  ) {
    return true;
  }
  if (!validBarsRange(bars)) return false;
  const pad = (bars.high - bars.low) * rangePadPct;
  return level >= bars.low - pad && level <= bars.high + pad;
}

export interface ExtendAutoscaleOptions {
  /** Last price. When supplied (finite), levels outside the ±`levelPct` spot
   *  band and outside the bars' range ±`rangePadPct` pad are dropped instead
   *  of widening the scale. Omit to widen with every positive level. */
  spot?: number;
  /** Rendered-window range: the floor the result must cover, and the span the
   *  `maxFactor` cap is measured against. Defaults to the incoming range. */
  barsRange?: VisibleBarsRange | null;
  levelPct?: number;
  rangePadPct?: number;
  /** Max final span as a multiple of the bars' span (default 1.3). */
  maxFactor?: number;
}

/**
 * Widen an autoscale range so near overlay levels are inside it — anchored on
 * the **visible bars' range**, never on the last price alone.
 *
 * Price lines do not participate in lightweight-charts' autoscale, so a level
 * below the session low would be drawn off-screen and look missing. But the
 * engine can hand us a tight last-price-anchored range, so the rendered
 * window's min-low / max-high is always floored in first. Levels that pass
 * the spot/range filter may then widen the axis up to `maxFactor`× the bars'
 * span; anything beyond that is clamped (proportionally split between the
 * below/above extensions), and far levels are left to the edge badges.
 */
export function extendAutoscaleWithLevels<T extends AutoscaleRange>(
  info: T | null,
  levels: number[],
  opts: ExtendAutoscaleOptions = {},
): T | null {
  const {
    spot,
    levelPct = AUTOSCALE_LEVEL_PCT,
    rangePadPct = AUTOSCALE_RANGE_PAD_PCT,
    maxFactor = AUTOSCALE_MAX_SPAN_FACTOR,
  } = opts;
  const incoming =
    info?.priceRange &&
    Number.isFinite(info.priceRange.minValue) &&
    Number.isFinite(info.priceRange.maxValue)
      ? info.priceRange
      : null;
  const bars = validBarsRange(opts.barsRange)
    ? opts.barsRange
    : incoming && incoming.maxValue > incoming.minValue
      ? { low: incoming.minValue, high: incoming.maxValue }
      : null;
  if (!bars) {
    // No bar base to anchor on: widen the incoming range with every positive
    // level (legacy behaviour), or pass through when there is nothing.
    if (!incoming) return info;
    let { minValue, maxValue } = incoming;
    for (const v of levels) {
      if (!Number.isFinite(v) || v <= 0) continue;
      minValue = Math.min(minValue, v);
      maxValue = Math.max(maxValue, v);
    }
    return { ...info, priceRange: { minValue, maxValue } };
  }
  const filterLevels = spot != null;
  let lo = incoming ? Math.min(incoming.minValue, bars.low) : bars.low;
  let hi = incoming ? Math.max(incoming.maxValue, bars.high) : bars.high;
  for (const v of levels) {
    if (!Number.isFinite(v) || v <= 0) continue;
    if (
      filterLevels &&
      !levelWithinAutoscale(v, spot as number, bars, levelPct, rangePadPct)
    ) {
      continue;
    }
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  // Cap: the final span stays within maxFactor× the bars' span while always
  // covering the bars. The over-budget extension is split proportionally so a
  // one-sided level cannot steal the other side's room.
  const barsSpan = bars.high - bars.low;
  const maxSpan = barsSpan * maxFactor;
  if (hi - lo > maxSpan) {
    const needBelow = Math.max(0, bars.low - lo);
    const needAbove = Math.max(0, hi - bars.high);
    const total = needBelow + needAbove;
    if (total > 0) {
      const budget = Math.max(0, maxSpan - barsSpan);
      lo = bars.low - (needBelow / total) * budget;
      hi = bars.high + (needAbove / total) * budget;
    }
  }
  return { ...info, priceRange: { minValue: lo, maxValue: hi } };
}

// Distinct, high-contrast entry/exit label colors (different from candle bodies).
const ENTRY_BUY_COLOR = "#38BDF8";
const ENTRY_SELL_COLOR = "#FF9F43";
const EXIT_TP_COLOR = "#00E676";
const EXIT_SL_COLOR = "#FF5252";
const EXIT_OTHER_COLOR = "#FFD166";

// Muted volume tints — deliberately lower-contrast than the candles so volume
// never competes with price action.
const NT_VOL_UP = "rgba(148, 163, 184, 0.40)";
const NT_VOL_DOWN = "rgba(100, 116, 139, 0.40)";

export const TradingViewChart = forwardRef<TradingViewChartHandle, TradingViewChartProps>(function TradingViewChart({
  candles,
  trades = EMPTY_TRADES,
  highlightedTradeId,
  showAllTrades,
  height,
  markLines = EMPTY_MARK_LINES,
  priceAreas = EMPTY_PRICE_AREAS,
  emaData = EMPTY_EMA,
  touchMarkers = EMPTY_TOUCH_MARKERS,
  rsiData,
  livePosition,
  theme = "default",
  chartType = "candles",
  entryLabels = false,
  onChartReady,
  fitMarkLines = false,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const emaSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  /** `label|color` signature of the EMA series currently attached. */
  const emaSigRef = useRef<string>("");
  /** Per-series content signature of the EMA data currently pushed. */
  const emaDataSigRef = useRef<string[]>([]);
  /** Signature of the price lines currently attached (see `markOverlaySignature`). */
  const markSigRef = useRef<string | null>(null);
  /** Signature of the candle/volume data currently pushed (see `candleSignature`). */
  const dataSigRef = useRef<string | null>(null);
  /** Signature of the applied autoscale closure inputs (see `autoscaleSignature`). */
  const autoscaleSigRef = useRef<string | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiPriceLinesRef = useRef<IPriceLine[]>([]);
  const heightRef = useRef(height);
  const onReadyRef = useRef(onChartReady);
  onReadyRef.current = onChartReady;
  /** Latest mark lines for the (memoised) overlay painter — see `drawEntryLabels`. */
  const markLinesRef = useRef(markLines);
  markLinesRef.current = markLines;
  const overlayRef = useRef<HTMLCanvasElement>(null);
  /** Pending pan/zoom/resize redraw frame — cancelled on cleanup. */
  const rafRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);

  // create chart once — not on height/candles.
  // With an explicit height -> fixed size (page-level charts). Without -> autoSize
  // so the chart fills its flex container (paper Trade History panel).
  useEffect(() => {
    if (!containerRef.current) return;
    const fixedHeight = heightRef.current;
    const nt = theme === "nt";
    const c = {
      bg: nt ? palette.NT_BG : palette.BG,
      grid: nt ? palette.NT_GRID : palette.BORDER,
      text: nt ? "#E5E7EB" : palette.TEXT,
      bull: nt ? palette.NT_CANDLE_BULL : palette.MARKER_BORDER,
      bear: nt ? palette.NT_CANDLE_BEAR : palette.SCALE_BLUE[6],
      volMuted: withAlpha(palette.TEXT_MUTED, 0.3),
      volUp: nt ? NT_VOL_UP : withAlpha(palette.POSITIVE, 0.9),
      volDown: nt ? NT_VOL_DOWN : withAlpha(palette.NEGATIVE, 0.9),
    };
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: c.bg }, textColor: c.text },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      ...(fixedHeight != null
        ? { width: containerRef.current.clientWidth, height: fixedHeight }
        : { autoSize: true }),
      timeScale: { borderColor: c.grid, timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 5, tickMarkFormatter: tvTickMarkFormatter },
      localization: { locale: "en-IN", timeFormatter: tvTimeFormatter },
      rightPriceScale: { borderColor: c.grid },
      crosshair: { mode: 1 },
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    const candleSeries = chartType === "line"
      ? chart.addSeries(LineSeries, {
          color: nt ? "#E5E7EB" : palette.PRIMARY,
          lineWidth: 2 as LineWidth,
          priceLineVisible: false,
          lastValueVisible: true,
        })
      : chart.addSeries(CandlestickSeries, {
          upColor: c.bull,
          downColor: c.bear,
          borderColor: c.bear,
          borderUpColor: c.bull,
          borderDownColor: c.bear,
          wickUpColor: c.bull,
          wickDownColor: c.bear,
          borderVisible: !nt,
          wickVisible: true,
        });
    candleSeriesRef.current = candleSeries as unknown as ISeriesApi<"Candlestick">;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: c.volMuted,
      priceScaleId: "",
      priceFormat: { type: "volume" },
    });
    volumeSeriesRef.current = volumeSeries as any;
    (volumeSeries as any).priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    const markers = createSeriesMarkers(candleSeries, []);
    markersRef.current = markers;
    onReadyRef.current?.(chart, candleSeries as any);
    setReady(true);

    let ro: ResizeObserver | null = null;
    if (fixedHeight != null) {
      ro = new ResizeObserver(() => {
        if (containerRef.current && chartRef.current) {
          chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
        }
      });
      ro.observe(containerRef.current);
    }

    return () => {
      setReady(false);
      ro?.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      // The markers plugin is attached to the (now destroyed) candle series:
      // drop the reference so nothing can push into a dead primitive, and so the
      // marker effect re-applies markers after a recreate (`ready` dep).
      markersRef.current = null;
      priceLinesRef.current = [];
      markSigRef.current = null;
      dataSigRef.current = null;
      autoscaleSigRef.current = null;
      emaSeriesRef.current = [];
      emaSigRef.current = "";
      emaDataSigRef.current = [];
      rsiSeriesRef.current = null;
      rsiPriceLinesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, chartType]);

  // height updates without recreate (fixed-height mode only)
  useEffect(() => {
    heightRef.current = height;
    if (height != null) chartRef.current?.applyOptions({ height });
  }, [height]);

  // RSI pane (pane 1, below the candles) — only when rsiData is supplied.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (rsiSeriesRef.current) {
      rsiPriceLinesRef.current.forEach((l) => {
        try { rsiSeriesRef.current?.removePriceLine(l); } catch { /* noop */ }
      });
      rsiPriceLinesRef.current = [];
      try { chart.removeSeries(rsiSeriesRef.current); } catch { /* noop */ }
      rsiSeriesRef.current = null;
    }

    const data = rsiData?.data;
    if (!rsiData || !data || data.length === 0 || candles.length === 0) return;

    const nt = theme === "nt";
    const series = chart.addSeries(
      LineSeries,
      {
        color: nt ? "#E5E7EB" : palette.PRIMARY,
        lineWidth: 1 as LineWidth,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
      },
      1,
    );
    rsiSeriesRef.current = series;

    const points = data
      .map((v, i) => (v == null || !isFinite(v) || !candles[i] ? null : { time: toEpochSeconds(candles[i].time), value: v }))
      .filter((d): d is LineData => d !== null)
      .sort((a, b) => (a.time as number) - (b.time as number));
    series.setData(points);
    series.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });

    const addGuide = (value: number, color: string) => {
      rsiPriceLinesRef.current.push(
        series.createPriceLine({
          price: value,
          color,
          lineWidth: 1 as LineWidth,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: String(value),
        }),
      );
    };
    addGuide(70, nt ? "#FF5252" : palette.NEGATIVE);
    addGuide(30, nt ? "#00E676" : palette.POSITIVE);

    const panes = chart.panes();
    if (panes.length > 1) {
      panes[0].setStretchFactor(3);
      panes[1].setStretchFactor(1);
    }
  }, [rsiData, candles, theme, ready]);

  useImperativeHandle(ref, () => ({
    getChart: () => chartRef.current,
    getCandleSeries: () => candleSeriesRef.current,
    fitContent: () => chartRef.current?.timeScale().fitContent(),
    zoomToIndexRange: (startIdx: number, endIdx: number, total?: number) => {
      const chart = chartRef.current;
      if (!chart) return;
      const lastIdx = total != null && total > 0 ? total - 1 : endIdx + 1;
      const from = Math.max(0, startIdx) - 0.5;
      const to = Math.min(lastIdx, endIdx) + 0.5;
      chart.timeScale().setVisibleLogicalRange({ from, to });
    },
    zoomToTimeRange: (fromTime: string, toTime: string) => {
      const chart = chartRef.current;
      if (!chart) return;
      const from = toEpochSeconds(fromTime);
      const to = toEpochSeconds(toTime);
      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        chart.timeScale().fitContent();
        return;
      }
      chart.timeScale().setVisibleRange({ from, to });
    },
  }), []);

  // simple per docs: setData on candles change, fitContent once
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
    const dataSig = `${theme}|${chartType}|${candleSignature(candles)}`;
    if (dataSigRef.current === dataSig) return;
    dataSigRef.current = dataSig;
    if (candles.length === 0) {
      candleSeriesRef.current.setData([]);
      volumeSeriesRef.current.setData([]);
      return;
    }
    if (chartType === "line") {
      const lineData: LineData[] = candles
        .map((c) => ({ time: toEpochSeconds(c.time), value: c.close }))
        .sort((a, b) => (a.time as number) - (b.time as number));
      candleSeriesRef.current.setData(lineData as any);
    } else {
      const candleData: CandlestickData[] = candles
        .map((c) => ({
          time: toEpochSeconds(c.time),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
        .sort((a, b) => (a.time as number) - (b.time as number));
      candleSeriesRef.current.setData(candleData);
    }

    // Index/indicator symbols carry no volume — an all-zero histogram leaves a
    // stray zero baseline + "0" last-value tag, so hide the series instead.
    const hasVolume = candles.some((c) => (c.volume ?? 0) > 0);
    volumeSeriesRef.current.applyOptions({
      visible: hasVolume,
      lastValueVisible: hasVolume,
    });

    const volData: HistogramData[] = candles
      .map((c) => ({
        time: toEpochSeconds(c.time),
        value: c.volume,
        color: c.close >= c.open
          ? (theme === "nt" ? NT_VOL_UP : withAlpha(palette.POSITIVE, 0.9))
          : (theme === "nt" ? NT_VOL_DOWN : withAlpha(palette.NEGATIVE, 0.9)),
      }))
      .sort((a: any, b: any) => (a.time as number) - (b.time as number));
    volumeSeriesRef.current.setData(volData as any);
  }, [candles, theme, chartType]);

  // Horizontal overlay levels: ORB / pivots / 52W / highlighted SL-TP / position.
  //
  // Split in two. The **price lines** only rebuild when their content actually
  // changes — the report poll hands us new arrays with identical content, and
  // remove+create per level on every poll churned the series' price-line
  // collection (and its axis pane views) for no visual change. The
  // **autoscale provider** is refreshed whenever the candles move, because it
  // captures the rendered window's range.
  const markSig = useMemo(
    () => markOverlaySignature(markLines, livePosition, `${theme}|${fitMarkLines ? 1 : 0}`),
    [markLines, livePosition, theme, fitMarkLines],
  );

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    if (markSigRef.current === markSig) return;
    markSigRef.current = markSig;

    priceLinesRef.current.forEach((l) => {
      try {
        series.removePriceLine(l);
      } catch {
        /* noop */
      }
    });
    priceLinesRef.current = [];

    const nt = theme === "nt";
    const add = (price: number | undefined, color: string, width: number | undefined, style: LineStyle, title: string, axisLabelVisible = true) => {
      if (price == null || !isFinite(price) || price <= 0) return;
      const line = series.createPriceLine({
        price,
        color,
        lineWidth: clampWidth(width),
        lineStyle: style,
        axisLabelVisible,
        title,
        // NT: solid bright badge with dark text = maximum contrast on the axis.
        ...(nt ? { axisLabelColor: color, axisLabelTextColor: palette.NT_BG } : {}),
      });
      priceLinesRef.current.push(line);
    };

    markLines.forEach((ml) => {
      // Far reference levels stay as lines (still discoverable via the left
      // edge badges below) but their gutter label + in-chart title are
      // suppressed: an off-screen line's title pins to the panel edge, so
      // three far lines above the tape (FLIP 23,250 / R1 / R2) stacked
      // unreadably at the top edge instead of merging.
      const near = !fitMarkLines || ml.includeInScale !== false;
      add(ml.yAxis, ml.lineStyle.color, ml.lineStyle.width, toLineStyle(ml.lineStyle.type), near ? ml.label.formatter : "", near);
    });

    if (livePosition) {
      add(livePosition.entry_price, palette.PRIMARY, 1, LineStyle.Solid, `Entry ${livePosition.entry_price}`);
      if (livePosition.stop_loss && livePosition.stop_loss > 0) {
        add(livePosition.stop_loss, palette.NEGATIVE, 1, LineStyle.Dashed, `SL ${livePosition.stop_loss}`);
      }
      if (livePosition.take_profit && livePosition.take_profit > 0) {
        add(livePosition.take_profit, palette.POSITIVE, 1, LineStyle.Dashed, `TP ${livePosition.take_profit}`);
      }
    }
  }, [markSig, markLines, livePosition, theme, fitMarkLines, ready]);

  // Horizontal levels do not affect lightweight-charts' autoscale, so only
  // near levels (flagged `includeInScale`) are folded into the candle
  // series' range. Far reference levels stay drawn but must not stretch the
  // axis: a 22,500 fuel line under a 22,700 low used to push the whole
  // session into the lower third of the panel.
  //
  // The provider is anchored on the rendered window's min-low / max-high
  // (not the last price): the engine can hand back a tight last-price
  // slice, and without the bars floor the early session bars clip above
  // the panel. Level widening stays capped at 1.3× the bars' span.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    const bars = fitMarkLines ? visibleBarsRange(candles) : null;
    const spot =
      fitMarkLines && candles.length > 0 ? candles[candles.length - 1].close : NaN;
    const levels = fitMarkLines
      ? markLines
          .filter((ml) => ml.includeInScale)
          .map((ml) => ml.yAxis)
          .filter((v) => Number.isFinite(v) && v > 0)
      : [];
    const sig = autoscaleSignature(fitMarkLines, bars, spot, levels);
    if (autoscaleSigRef.current === sig) return;
    autoscaleSigRef.current = sig;
    if (!fitMarkLines) {
      series.applyOptions({ autoscaleInfoProvider: undefined });
      return;
    }
    series.applyOptions({
      autoscaleInfoProvider:
        !bars && levels.length === 0
          ? undefined
          : (original) =>
              extendAutoscaleWithLevels(original(), levels, {
                spot,
                barsRange: bars,
              }),
    });
    // Near levels add at most ±5% around the candles; 5% margins each side
    // keep the visible axis at ~1.2× the session range instead of the
    // default 10% (which left the tape looking cramped).
    series.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.05 } });
  }, [markLines, fitMarkLines, candles, ready]);

  // EMA overlays (line series aligned to candles).
  //
  // Reuse the existing series when the EMA *set* (label/colour) is unchanged and
  // only push new data: the poll rebuilt both line series (addSeries +
  // removeSeries) every cycle even though the overlay never changed. Each
  // series' pushed points are signature-checked, so unchanged data skips
  // `setData` too.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const wanted = candles.length === 0 ? EMPTY_EMA : emaData;
    const sig = wanted.map((ema) => `${ema.label}|${ema.color}`).join(",");
    const reusable =
      emaSeriesRef.current.length === wanted.length && emaSigRef.current === sig;
    if (!reusable) {
      emaSeriesRef.current.forEach((s) => {
        try {
          chart.removeSeries(s);
        } catch {
          /* noop */
        }
      });
      emaSeriesRef.current = [];
      emaSigRef.current = sig;
      emaDataSigRef.current = [];
      for (const ema of wanted) {
        emaSeriesRef.current.push(
          chart.addSeries(LineSeries, {
            color: ema.color,
            lineWidth: 1 as LineWidth,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          }),
        );
      }
    }
    if (wanted.length === 0) return;

    emaSeriesRef.current.forEach((series, i) => {
      const ema = wanted[i];
      if (!ema) return;
      const data: LineData[] = ema.data
        .map((v, idx) =>
          v == null || !isFinite(v) || !candles[idx] ? null : { time: toEpochSeconds(candles[idx].time), value: v },
        )
        .filter((d): d is LineData => d !== null)
        .sort((a, b) => (a.time as number) - (b.time as number));
      const dsig = emaDataSignature(ema, data);
      if (emaDataSigRef.current[i] === dsig) return;
      emaDataSigRef.current[i] = dsig;
      series.setData(data);
    });
  }, [emaData, candles, ready]);

  // markers — lightweight-charts v5 uses createSeriesMarkers plugin, not series.setMarkers
  useEffect(() => {
    if (!markersRef.current) return;
    const visibleTrades = filterVisibleTrades(trades, highlightedTradeId, showAllTrades);
    const markers = visibleTrades
      .filter((t) => t.entry_time)
      .map((t) => {
        const isBuy = isBuySide(t.side);
        const isHighlighted = highlightedTradeId === (t as any).id;
        return {
          time: toEpochSeconds(t.entry_time),
          position: isBuy ? ("belowBar" as const) : ("aboveBar" as const),
          color: isBuy ? ENTRY_BUY_COLOR : ENTRY_SELL_COLOR,
          shape: isBuy ? ("arrowUp" as const) : ("arrowDown" as const),
          text: entryLabels ? "" : (isHighlighted ? `★ ${t.side} ${t.entry_price}` : `${t.side}`),
          size: isHighlighted ? 2 : 1,
        };
      });
    const exitMarkers = visibleTrades
      .filter((t) => t.exit_time)
      .map((t) => {
        const isHighlighted = highlightedTradeId === (t as any).id;
        const isBuy = isBuySide(t.side);
        return {
          time: toEpochSeconds(t.exit_time),
          position: (isBuy ? "aboveBar" : "belowBar") as "aboveBar" | "belowBar",
          color: t.exit_reason === "TP" ? EXIT_TP_COLOR : t.exit_reason === "SL" ? EXIT_SL_COLOR : EXIT_OTHER_COLOR,
          shape: "circle" as const,
          text: entryLabels ? "" : (isHighlighted ? `✕ ${t.exit_reason} ${t.exit_price}` : `${t.exit_reason}`),
        };
      });
    // Max-pain touch dots ride the candle series' marker plugin (v5 series
    // markers) so the amber circle is anchored to the bar that touched the pin.
    // A line-less scatter series was tried first but a single-point series does
    // not reliably paint its point markers.
    const touchMarkerList = (touchMarkers ?? [])
      .filter((m) => Number.isFinite(m.value))
      .map((m) => ({
        time: toEpochSeconds(m.time),
        position: (m.position ?? "belowBar") as "aboveBar" | "belowBar",
        color: m.color ?? palette.WARNING,
        shape: (m.shape ?? "circle") as "circle" | "arrowUp" | "arrowDown",
        text: m.text ?? "",
        size: m.size ?? 1,
      }));
    const allMarkers = [...markers, ...exitMarkers, ...touchMarkerList].sort(
      (a, b) => (a.time as number) - (b.time as number),
    );
    try {
      markersRef.current.setMarkers(allMarkers as any);
    } catch {
      /* noop */
    }
  }, [trades, highlightedTradeId, showAllTrades, entryLabels, touchMarkers, ready]);

  // Larger BUY/SELL pills over entry markers (opt-in): lightweight-charts marker
  // text size is fixed, so draw our own canvas labels for readability.
  // Sorted bar times + time→candle index, rebuilt only when the candle set
  // changes — the overlay redraws on every pan/zoom frame and must not re-sort.
  // Skipped entirely when `entryLabels` is off (the common case: the report
  // chart), so a new candle array per poll does not rebuild it either.
  const entryGeometry = useMemo(() => {
    if (!entryLabels) return EMPTY_ENTRY_GEOMETRY;
    const barTimes = candles
      .map((c) => toEpochSeconds(c.time) as number)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const byTime = new Map<number, ReplayCandle>();
    for (const c of candles) {
      const tn = toEpochSeconds(c.time) as number;
      if (Number.isFinite(tn)) byTime.set(tn, c);
    }
    return { barTimes, byTime };
  }, [candles, entryLabels]);

  const drawEntryLabels = useCallback(() => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const parent = canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
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
    if (!chart || !series || rect.width === 0) return;

    // Draw price zones first so trade labels remain readable above them. The
    // canvas follows the chart's price scale on every pan/zoom redraw.
    for (const area of priceAreas || []) {
      if (!Number.isFinite(area.from) || !Number.isFinite(area.to)) continue;
      const fromY = series.priceToCoordinate(area.from);
      const toY = series.priceToCoordinate(area.to);
      if (fromY == null && toY == null) continue;
      const y1 = fromY ?? toY!;
      const y2 = toY ?? fromY!;
      const top = Math.max(0, Math.min(y1, y2));
      const bottom = Math.min(rect.height, Math.max(y1, y2));
      if (bottom <= top) continue;
      ctx.fillStyle = area.color;
      ctx.fillRect(0, top, rect.width, bottom - top);
      if (area.borderColor) {
        ctx.strokeStyle = area.borderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, top + 0.5, Math.max(0, rect.width - 1), Math.max(0, bottom - top - 1));
      }
      if (area.label) {
        ctx.font = "700 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.fillStyle = area.borderColor || "#E5E7EB";
        ctx.fillText(area.label, 6, Math.max(8, top + Math.min(14, (bottom - top) / 2)));
      }
    }

    // Far mark lines are intentionally excluded from the price scale, so
    // their horizontal line sits off-screen. Keep them discoverable as small
    // edge badges (top = above the visible range, bottom = below) instead of
    // silently dropping the level.
    if (fitMarkLines) {
      const lines = markLinesRef.current;
      const above: MarkLineData[] = [];
      const below: MarkLineData[] = [];
      for (const ml of lines) {
        const y = series.priceToCoordinate(ml.yAxis);
        if (y == null || !Number.isFinite(y)) continue;
        if (y < 0) above.push(ml);
        else if (y > rect.height) below.push(ml);
      }
      // Left edge — deliberately away from the right-hand price gutter so an
      // edge badge can never overlap a price-line label/axis value. Bottom
      // badges also stop above the time axis so they never cover its ticks.
      const xLeft = 6;
      const timeScale = typeof chart.timeScale === "function" ? chart.timeScale() : null;
      const timeAxisH =
        timeScale && typeof (timeScale as any).height === "function"
          ? (timeScale as any).height()
          : 0;
      const bottomEdge = rect.height - Math.max(0, timeAxisH) - 4;
      ctx.font = "600 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      const rowH = 14;
      const rowGap = 2;
      const drawEdge = (items: MarkLineData[], atTop: boolean) => {
        const shown = items.slice(0, 4);
        shown.forEach((ml, i) => {
          const label = `${atTop ? "↑" : "↓"} ${ml.label.formatter}`;
          const tw = ctx.measureText(label).width;
          const bw = tw + 10;
          const cy = atTop
            ? 4 + i * (rowH + rowGap) + rowH / 2
            : bottomEdge - (shown.length - i) * (rowH + rowGap) + rowH / 2;
          ctx.fillStyle = "rgba(8,8,8,0.88)";
          ctx.fillRect(xLeft, cy - rowH / 2, bw, rowH);
          ctx.fillStyle = ml.lineStyle.color;
          ctx.fillText(label, xLeft + 5, cy + 0.5);
        });
      };
      drawEdge(above, true);
      drawEdge(below, false);
    }

    if (!entryLabels) return;

    const visible = filterVisibleTrades(trades, highlightedTradeId, showAllTrades);
    ctx.font = "700 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    const { barTimes, byTime } = entryGeometry;
    // Trades may carry an intraday entry time while bars are daily — snap to the
    // nearest candle time that actually exists on the scale.
    const snapTime = (secs: number): number | null => {
      if (barTimes.length === 0) return null;
      let lo = 0, hi = barTimes.length - 1, ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (barTimes[mid] <= secs) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      return ans >= 0 ? barTimes[ans] : barTimes[0];
    };

    // Rounded pill with dark fill + colored border/text, drawn above/below a price.
    const drawPill = (x: number, y: number, label: string, color: string, above: boolean) => {
      const tw = ctx.measureText(label).width;
      const padX = 6;
      const h = 18;
      const w = tw + padX * 2;
      const bx = x - w / 2;
      const by = above ? y - 14 - h : y + 14;
      const r = 4;
      ctx.fillStyle = "rgba(8,8,8,0.92)";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(bx + r, by);
      ctx.arcTo(bx + w, by, bx + w, by + h, r);
      ctx.arcTo(bx + w, by + h, bx, by + h, r);
      ctx.arcTo(bx, by + h, bx, by, r);
      ctx.arcTo(bx, by, bx + w, by, r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(label, bx + padX, by + h / 2 + 0.5);
    };

    const coordFor = (timeStr: string, isBuy: boolean, price: number, isExit: boolean) => {
      const snapped = snapTime(toEpochSeconds(timeStr) as number);
      if (snapped == null) return null;
      const x = chart.timeScale().timeToCoordinate(snapped as Time);
      const bar = byTime.get(snapped);
      // entries sit beyond the bar on the entry side; exits on the opposite side
      const anchor = bar
        ? ((isBuy === isExit) ? bar.high : bar.low)
        : price;
      const y = series.priceToCoordinate(anchor);
      if (x == null || y == null) return null;
      return { x, y };
    };

    for (const t of visible) {
      const isBuy = isBuySide(t.side);

      if (t.entry_time) {
        const c = coordFor(t.entry_time, isBuy, t.entry_price, false);
        if (c) drawPill(c.x, c.y, isBuy ? "BUY" : "SELL", isBuy ? ENTRY_BUY_COLOR : ENTRY_SELL_COLOR, !isBuy);
      }

      if (t.exit_time) {
        const reason = (t.exit_reason || "EXIT").toUpperCase();
        const color = reason.startsWith("TP") ? EXIT_TP_COLOR : reason.startsWith("SL") ? EXIT_SL_COLOR : EXIT_OTHER_COLOR;
        const c = coordFor(t.exit_time, isBuy, t.exit_price ?? t.entry_price, true);
        if (c) drawPill(c.x, c.y, reason, color, isBuy);
      }
    }
  }, [entryLabels, trades, highlightedTradeId, showAllTrades, entryGeometry, priceAreas, markSig, fitMarkLines]);

  useEffect(() => { drawEntryLabels(); }, [drawEntryLabels, ready]);

  // Pan/zoom/resize redraws are coalesced into a single pending frame:
  // without this every event queued its own RAF, each retaining the
  // previous `drawEntryLabels` closure (and its candle arrays) until the
  // frame fired — and a frame pending across cleanup drew on a dead canvas.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const onRedraw = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        drawEntryLabels();
      });
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRedraw);
    const parent = overlayRef.current?.parentElement;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onRedraw) : null;
    if (parent && ro) ro.observe(parent);
    window.addEventListener("resize", onRedraw);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      // The chart-creation effect's cleanup runs first and has already called
      // `chart.remove()`. Unsubscribing from a removed chart throws, and a
      // throw here would skip the ResizeObserver/ window-listener teardown —
      // leaving both (and this closure's candle arrays) alive forever.
      if (chartRef.current === chart) {
        try {
          chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRedraw);
        } catch {
          /* chart already disposed */
        }
      }
      ro?.disconnect();
      window.removeEventListener("resize", onRedraw);
    };
  }, [drawEntryLabels, ready]);

  // fit once on mount / symbol change
  useEffect(() => {
    if (candles.length) chartRef.current?.timeScale().fitContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles.length === 0 ? 0 : candles[0]?.time]);

  return (
    <div
      className="flex flex-col h-full min-w-0 relative"
      style={{ width: "100%", flex: 1, minHeight: 0, position: "relative" }}
    >
      <div ref={containerRef} className="w-full flex-1 min-h-0 relative" data-testid="tradingview-chart" style={{ width: "100%", flex: 1, minHeight: 0, position: "relative", ...(height != null ? { height } : {}) }} />
      <canvas ref={overlayRef} aria-hidden="true" data-testid="tradingview-overlay" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 3 }} />
    </div>
  );
});
