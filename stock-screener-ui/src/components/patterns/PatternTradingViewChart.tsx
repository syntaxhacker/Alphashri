import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  TickMarkType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineWidth,
  type Time,
} from "lightweight-charts";
import Box from "@mui/material/Box";
import * as palette from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import type {
  ChartCandle,
  PatternHitDTO,
  TrendLine,
  TrendlinesView,
} from "@/types/chartPatterns";
import { buildPatternTVData, type TVSiblingOverlay } from "./patternTVData";
import { PIVOT_LEGEND_NAME } from "@/config/patterns";
import { formatISTCrosshair, formatISTTick } from "@/utils/istChartTime";

export interface PatternTradingViewChartProps {
  hit: PatternHitDTO | null;
  candles: ChartCandle[];
  overlays?: TVSiblingOverlay[];
  trendLines?: TrendLine[];
  trendlinesView?: TrendlinesView;
  /** Pattern names (see `buildPatternTVData(...).lines[].name`) hidden from the chart. */
  hiddenNames?: ReadonlySet<string>;
  /** Fixed pixel height, or `"100%"` (default) to fill the flex parent. */
  height?: number | string;
}

function clampWidth(w?: number): LineWidth {
  const n = Math.round(w ?? 1);
  return (n < 1 ? 1 : n > 4 ? 4 : n) as LineWidth;
}

/** Stable empty set so the visibility effect never sees a new reference. */
const EMPTY_HIDDEN: ReadonlySet<string> = new Set<string>();

/** Crosshair time label — IST (lightweight-charts otherwise shows UTC). */
function tvTimeFormatter(time: Time): string {
  return typeof time === "number" ? formatISTCrosshair(time) : "";
}

/** Axis tick labels — IST, granularity-aware. */
function tvTickMarkFormatter(time: Time, tickMarkType: TickMarkType): string {
  if (typeof time !== "number") return "";
  switch (tickMarkType) {
    case TickMarkType.Year:
      return formatISTTick(time, "year");
    case TickMarkType.Month:
      return formatISTTick(time, "month");
    case TickMarkType.DayOfMonth:
      return formatISTTick(time, "day");
    case TickMarkType.TimeWithSeconds:
      return formatISTTick(time, "timeSeconds");
    default:
      return formatISTTick(time, "time");
  }
}

/**
 * TradingView (lightweight-charts v5) adapter that draws a detected
 * chart-pattern the same way the ECharts fullscreen does: real OHLCV candles +
 * volume, pattern boundary trendlines (selected solid, siblings dashed),
 * standalone TLS/TLR segments, horizontal breakout/target/stop levels, and
 * pivot markers. Pure mapping lives in `patternTVData.ts`.
 */
export function PatternTradingViewChart({
  hit,
  candles,
  overlays,
  trendLines,
  trendlinesView = "both",
  hiddenNames,
  height = "100%",
}: PatternTradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);
  const priceLinesRef = useRef<Array<{ name: string; line: IPriceLine }>>([]);
  const hiddenRef = useRef<ReadonlySet<string>>(hiddenNames ?? EMPTY_HIDDEN);

  const data = useMemo(
    () => buildPatternTVData({ candles, hit, overlays, trendLines, trendlinesView }),
    [candles, hit, overlays, trendLines, trendlinesView],
  );

  // Create the chart once; data/overlays update in the effect below.
  useEffect(() => {
    if (!containerRef.current) return;
    const initialHeight = containerRef.current.clientHeight || 360;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: palette.BG }, textColor: palette.TEXT },
      grid: { vertLines: { color: palette.BORDER }, horzLines: { color: palette.BORDER } },
      width: containerRef.current.clientWidth,
      height: initialHeight,
      timeScale: {
        borderColor: palette.BORDER,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 5,
        tickMarkFormatter: tvTickMarkFormatter,
      },
      localization: { locale: "en-IN", timeFormatter: tvTimeFormatter },
      rightPriceScale: { borderColor: palette.BORDER },
      crosshair: { mode: 1 },
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    // Same default candle scheme as the paper-trading chart: white up bars,
    // blue down bars (`TradingViewChart`'s default theme).
    const bull = palette.MARKER_BORDER;
    const bear = palette.SCALE_BLUE[6];
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: bull,
      downColor: bear,
      borderUpColor: bull,
      borderDownColor: bear,
      wickUpColor: bull,
      wickDownColor: bear,
      borderVisible: true,
      wickVisible: true,
    });
    candleSeriesRef.current = candleSeries as unknown as ISeriesApi<"Candlestick">;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: withAlpha(palette.TEXT_MUTED, 0.3),
      priceScaleId: "",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeriesRef.current = volumeSeries as unknown as ISeriesApi<"Histogram">;
    (volumeSeries as unknown as ISeriesApi<"Histogram">).priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    markersRef.current = createSeriesMarkers(candleSeries, []);

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight || initialHeight,
        });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      lineSeriesRef.current = [];
      markersRef.current = null;
      priceLinesRef.current = [];
    };
  }, []);

  // Explicit numeric height updates without recreate; `"100%"` is driven by the
  // ResizeObserver above (which measures the flex parent).
  useEffect(() => {
    if (typeof height === "number") chartRef.current?.applyOptions({ height });
  }, [height]);

  // Paint candles, volume, levels, boundary/TLS-TLR lines and pivots on data change.
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries) return;

    candleSeries.setData(data.candles as never);
    volumeSeries.setData(data.volume as never);

    priceLinesRef.current.forEach(({ line }) => {
      try {
        candleSeries.removePriceLine(line);
      } catch {
        /* noop */
      }
    });
    priceLinesRef.current = [];
    data.levels.forEach((level) => {
      const hidden = hiddenRef.current.has(level.title);
      const line = candleSeries.createPriceLine({
        price: level.price,
        color: level.color,
        lineWidth: clampWidth(level.width),
        lineStyle: level.lineStyle === "dashed" ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: !hidden,
        title: level.title,
        ...(hidden ? { lineVisible: false } : {}),
      });
      priceLinesRef.current.push({ name: level.title, line });
    });

    lineSeriesRef.current.forEach((s) => {
      try {
        chart.removeSeries(s);
      } catch {
        /* noop */
      }
    });
    lineSeriesRef.current = [];
    data.lines.forEach((line) => {
      const series = chart.addSeries(LineSeries, {
        color: line.color,
        lineWidth: clampWidth(line.width),
        lineStyle: line.dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      series.setData(line.points as never);
      if (hiddenRef.current.has(line.name)) series.applyOptions({ visible: false });
      lineSeriesRef.current.push(series);
    });

    try {
      markersRef.current?.setMarkers(
        hiddenRef.current.has(PIVOT_LEGEND_NAME) ? [] : (data.markers as never),
      );
    } catch {
      /* noop */
    }

    chart.timeScale().fitContent();
  }, [data]);

  // End labels: draw each line's name at its last point on a transparent canvas
  // overlay (same technique as TradingViewChart's entry pills). Coordinates
  // come from the chart scale + the line's own series; missing coordinates are
  // skipped. Redrawn on data change, pan/zoom and resize via the effects below.
  const drawEndLabels = useCallback(() => {
    const chart = chartRef.current;
    const canvas = overlayRef.current;
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
    const ts = chart.timeScale() as unknown as {
      timeToCoordinate?: (t: unknown) => number | null;
    };
    if (typeof ts.timeToCoordinate !== "function") return;
    ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    data.lines.forEach((line, i) => {
      if (!line.labelEligible || hiddenRef.current.has(line.name)) return;
      const series = lineSeriesRef.current[i] as unknown as
        | { priceToCoordinate?: (p: number) => number | null }
        | undefined;
      if (!series || typeof series.priceToCoordinate !== "function") return;
      const last = line.points[line.points.length - 1];
      if (!last) return;
      const x = ts.timeToCoordinate?.(last.time as never);
      const y = series.priceToCoordinate(last.value);
      if (x == null || y == null) return;
      const text = line.label ?? line.name;
      const padX = 4;
      const h = 16;
      const w = ctx.measureText(text).width + padX * 2;
      // Sit the label just left of the line's last point so it never collides
      // with the library's right-axis price-line titles (Breakout/Stop/Target).
      const bx = Math.max(0, Math.min(x - w - 6, Math.max(0, rect.width - w)));
      let by = Math.min(Math.max(y - h / 2, 0), Math.max(0, rect.height - h));
      // Nudge overlapping labels apart (keeps every label visible, unlike
      // ECharts' hideOverlap) so the right-edge titles never stack up.
      for (let guard = 0; guard < 12; guard++) {
        const clash = placed.some(
          (p) => bx < p.x + p.w && bx + w > p.x && by < p.y + p.h && by + h > p.y,
        );
        if (!clash) break;
        by = Math.min(by + h + 2, Math.max(0, rect.height - h));
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
  }, [data]);

  useEffect(() => {
    drawEndLabels();
  }, [drawEndLabels]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const ts = chart.timeScale() as unknown as {
      subscribeVisibleLogicalRangeChange?: (h: () => void) => void;
      unsubscribeVisibleLogicalRangeChange?: (h: () => void) => void;
    };
    if (typeof ts.subscribeVisibleLogicalRangeChange !== "function") return;
    const onRedraw = () => requestAnimationFrame(drawEndLabels);
    ts.subscribeVisibleLogicalRangeChange(onRedraw);
    const parent = overlayRef.current?.parentElement;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onRedraw) : null;
    if (parent && ro) ro.observe(parent);
    window.addEventListener("resize", onRedraw);
    return () => {
      ts.unsubscribeVisibleLogicalRangeChange?.(onRedraw);
      ro?.disconnect();
      window.removeEventListener("resize", onRedraw);
    };
  }, [drawEndLabels]);

  // Legend toggles: show/hide a pattern's line series in place (no recreate) and
  // repaint the end-label overlay so hidden lines drop their inline labels too.
  useEffect(() => {
    const next = hiddenNames ?? EMPTY_HIDDEN;
    hiddenRef.current = next;
    lineSeriesRef.current.forEach((series, i) => {
      const line = data.lines[i];
      if (!line) return;
      series.applyOptions({ visible: !next.has(line.name) });
    });
    priceLinesRef.current.forEach(({ name, line }) => {
      const hidden = next.has(name);
      line.applyOptions({ lineVisible: !hidden, axisLabelVisible: !hidden });
    });
    try {
      markersRef.current?.setMarkers(
        next.has(PIVOT_LEGEND_NAME) ? [] : (data.markers as never),
      );
    } catch {
      /* noop */
    }
    drawEndLabels();
  }, [hiddenNames, data, drawEndLabels]);

  return (
    <Box
      data-testid="patterns-tv-chart"
      sx={{ width: "100%", height, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}
    >
      <Box ref={containerRef} sx={{ width: "100%", flex: 1, minHeight: 0, position: "relative" }} />
      <canvas
        ref={overlayRef}
        aria-hidden="true"
        data-testid="patterns-tv-overlay"
        style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 3 }}
      />
    </Box>
  );
}
