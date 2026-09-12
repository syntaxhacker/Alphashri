import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
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
import Box from "@mui/material/Box";
import * as palette from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import type { ReplayCandle, ReplayTrade } from "@/types/replay";
import type { MarkLineData, UnifiedLivePosition } from "@/utils/chart/types";
import { filterVisibleTrades } from "@/utils/chart/normalizeCommon";

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
  /** EMA overlays, each aligned index-wise to `candles` */
  emaData?: { label: string; color: string; data: (number | null)[] }[];
  /** Active position entry / SL / TP levels */
  livePosition?: UnifiedLivePosition;
  /** Colour theme: "nt" = NinjaTrader high-contrast (tick-replay palette). */
  theme?: "default" | "nt";
  /** Draw larger, higher-contrast BUY/SELL pills over entry markers (opt-in). */
  entryLabels?: boolean;
  /** Notified once the chart is created (and again on recreate) so callers can draw overlays. */
  onChartReady?: (chart: IChartApi, candleSeries: ISeriesApi<"Candlestick">) => void;
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

const toTime = (t: string): Time => (new Date(t.replace(" ", "T")).getTime() / 1000) as Time;

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

// Distinct, high-contrast entry label colors (different from candle bodies).
const ENTRY_BUY_COLOR = "#38BDF8";
const ENTRY_SELL_COLOR = "#FF9F43";

export const TradingViewChart = forwardRef<TradingViewChartHandle, TradingViewChartProps>(function TradingViewChart({
  candles,
  trades = [],
  highlightedTradeId,
  showAllTrades,
  height,
  markLines,
  emaData,
  livePosition,
  theme = "default",
  entryLabels = false,
  onChartReady,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const emaSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const heightRef = useRef(height);
  const onReadyRef = useRef(onChartReady);
  onReadyRef.current = onChartReady;
  const overlayRef = useRef<HTMLCanvasElement>(null);
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
      volUp: nt ? palette.NT_FVG_BULL_STROKE : withAlpha(palette.POSITIVE, 0.9),
      volDown: nt ? palette.NT_FVG_BEAR_STROKE : withAlpha(palette.NEGATIVE, 0.9),
    };
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: c.bg }, textColor: c.text },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      ...(fixedHeight != null
        ? { width: containerRef.current.clientWidth, height: fixedHeight }
        : { autoSize: true }),
      timeScale: { borderColor: c.grid, timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 5 },
      rightPriceScale: { borderColor: c.grid },
      crosshair: { mode: 1 },
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
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
    candleSeriesRef.current = candleSeries as any;

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
      priceLinesRef.current = [];
      emaSeriesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // height updates without recreate (fixed-height mode only)
  useEffect(() => {
    heightRef.current = height;
    if (height != null) chartRef.current?.applyOptions({ height });
  }, [height]);

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
      const t = (s: string) => (new Date(s.replace(" ", "T")).getTime() / 1000) as Time;
      const from = t(fromTime);
      const to = t(toTime);
      if (!Number.isFinite(from as number) || !Number.isFinite(to as number)) {
        chart.timeScale().fitContent();
        return;
      }
      chart.timeScale().setVisibleRange({ from, to });
    },
  }), []);

  // simple per docs: setData on candles change, fitContent once
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
    if (candles.length === 0) {
      candleSeriesRef.current.setData([]);
      volumeSeriesRef.current.setData([]);
      return;
    }
    const candleData: CandlestickData[] = candles
      .map((c) => ({
        time: toTime(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    candleSeriesRef.current.setData(candleData);

    const volData: HistogramData[] = candles
      .map((c) => ({
        time: toTime(c.time),
        value: c.volume,
        color: c.close >= c.open
          ? (theme === "nt" ? palette.NT_FVG_BULL_STROKE : withAlpha(palette.POSITIVE, 0.9))
          : (theme === "nt" ? palette.NT_FVG_BEAR_STROKE : withAlpha(palette.NEGATIVE, 0.9)),
      }))
      .sort((a: any, b: any) => (a.time as number) - (b.time as number));
    volumeSeriesRef.current.setData(volData as any);
  }, [candles, theme]);

  // horizontal overlay levels: ORB / pivots / 52W / highlighted SL-TP / position
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    priceLinesRef.current.forEach((l) => {
      try {
        series.removePriceLine(l);
      } catch {
        /* noop */
      }
    });
    priceLinesRef.current = [];

    const nt = theme === "nt";
    const add = (price: number | undefined, color: string, width: number | undefined, style: LineStyle, title: string) => {
      if (price == null || !isFinite(price) || price <= 0) return;
      const line = series.createPriceLine({
        price,
        color,
        lineWidth: clampWidth(width),
        lineStyle: style,
        axisLabelVisible: true,
        title,
        // NT: solid bright badge with dark text = maximum contrast on the axis.
        ...(nt ? { axisLabelColor: color, axisLabelTextColor: palette.NT_BG } : {}),
      });
      priceLinesRef.current.push(line);
    };

    (markLines || []).forEach((ml) => {
      add(ml.yAxis, ml.lineStyle.color, ml.lineStyle.width, toLineStyle(ml.lineStyle.type), ml.label.formatter);
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
  }, [markLines, livePosition, theme]);

  // EMA overlays (line series aligned to candles)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    emaSeriesRef.current.forEach((s) => {
      try {
        chart.removeSeries(s);
      } catch {
        /* noop */
      }
    });
    emaSeriesRef.current = [];

    if (!emaData || emaData.length === 0 || candles.length === 0) return;

    emaData.forEach((ema) => {
      const series = chart.addSeries(LineSeries, {
        color: ema.color,
        lineWidth: 1 as LineWidth,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      const data: LineData[] = ema.data
        .map((v, i) =>
          v == null || !isFinite(v) || !candles[i] ? null : { time: toTime(candles[i].time), value: v },
        )
        .filter((d): d is LineData => d !== null)
        .sort((a, b) => (a.time as number) - (b.time as number));
      series.setData(data);
      emaSeriesRef.current.push(series);
    });
  }, [emaData, candles]);

  // markers — lightweight-charts v5 uses createSeriesMarkers plugin, not series.setMarkers
  useEffect(() => {
    if (!markersRef.current) return;
    const visibleTrades = filterVisibleTrades(trades, highlightedTradeId, showAllTrades);
    const markers = visibleTrades
      .filter((t) => t.entry_time)
      .map((t) => {
        const isBuy = t.side === "BUY";
        const isHighlighted = highlightedTradeId === (t as any).id;
        return {
          time: toTime(t.entry_time),
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
        return {
          time: toTime(t.exit_time),
          position: "aboveBar" as const,
          color: t.exit_reason === "TP" ? palette.POSITIVE : t.exit_reason === "SL" ? palette.NEGATIVE : palette.MARKER_EOD,
          shape: "circle" as const,
          text: isHighlighted ? `✕ ${t.exit_reason} ${t.exit_price}` : `${t.exit_reason}`,
        };
      });
    const allMarkers = [...markers, ...exitMarkers].sort((a, b) => (a.time as number) - (b.time as number));
    try {
      markersRef.current.setMarkers(allMarkers as any);
    } catch {
      /* noop */
    }
  }, [trades, highlightedTradeId, showAllTrades, entryLabels]);

  // Larger BUY/SELL pills over entry markers (opt-in): lightweight-charts marker
  // text size is fixed, so draw our own canvas labels for readability.
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
    if (!entryLabels || !chart || !series || rect.width === 0) return;

    const visible = filterVisibleTrades(trades, highlightedTradeId, showAllTrades);
    ctx.font = "700 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    // Trades may carry an intraday entry time while bars are daily — snap to the
    // nearest candle time that actually exists on the scale.
    const barTimes = candles
      .map((c) => toTime(c.time) as number)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const snapTime = (secs: number): number | null => {
      if (barTimes.length === 0) return null;
      let lo = 0, hi = barTimes.length - 1, ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (barTimes[mid] <= secs) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      return ans >= 0 ? barTimes[ans] : barTimes[0];
    };

    const byTime = new Map<number, (typeof candles)[number]>();
    for (const c of candles) {
      const tn = toTime(c.time) as number;
      if (Number.isFinite(tn)) byTime.set(tn, c);
    }

    for (const t of visible) {
      if (!t.entry_time) continue;
      const snapped = snapTime(toTime(t.entry_time) as number);
      if (snapped == null) continue;
      const x = chart.timeScale().timeToCoordinate(snapped as Time);
      const isBuy = (t.side || "BUY").toUpperCase() !== "SELL";
      // Anchor to the bar's low/high so the pill sits clear of the candles.
      const bar = byTime.get(snapped);
      const anchorPrice = bar ? (isBuy ? bar.low : bar.high) : t.entry_price;
      const y = series.priceToCoordinate(anchorPrice);
      if (x == null || y == null) continue;
      const label = isBuy ? "BUY" : "SELL";
      const color = isBuy ? ENTRY_BUY_COLOR : ENTRY_SELL_COLOR;
      const tw = ctx.measureText(label).width;
      const padX = 6;
      const h = 18;
      const w = tw + padX * 2;
      const bx = x - w / 2;
      const by = isBuy ? y + 14 : y - 14 - h;
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
    }
  }, [entryLabels, trades, highlightedTradeId, showAllTrades, candles]);

  useEffect(() => { drawEntryLabels(); }, [drawEntryLabels, ready]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const onRedraw = () => requestAnimationFrame(drawEntryLabels);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRedraw);
    const parent = overlayRef.current?.parentElement;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onRedraw) : null;
    if (parent && ro) ro.observe(parent);
    window.addEventListener("resize", onRedraw);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRedraw);
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
    <Box sx={{ width: "100%", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
      <Box ref={containerRef} sx={{ width: "100%", flex: 1, minHeight: 0, position: "relative", ...(height != null ? { height } : {}) }} data-testid="tradingview-chart" />
      <canvas ref={overlayRef} aria-hidden="true" data-testid="tradingview-overlay" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 3 }} />
    </Box>
  );
});
