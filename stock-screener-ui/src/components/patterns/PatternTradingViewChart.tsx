import { createEffect, createMemo, onCleanup, onMount } from "solid-js";
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
  type LineWidth,
} from "lightweight-charts";
import * as palette from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import type {
  ChartCandle,
  PatternHitDTO,
  TrendLine,
  TrendlinesView,
} from "@/types/chartPatterns";
import { buildPatternTVData, type TVMarker, type TVSiblingOverlay } from "./patternTVData";
import { KEY_POINTS_LEGEND_NAME, PIVOT_LEGEND_NAME } from "@/config/patterns";
import { tvTickMarkFormatter, tvTimeFormatter } from "@/utils/tvTimeFormat";

export interface PatternTradingViewChartProps {
  hit: PatternHitDTO | null;
  candles: ChartCandle[];
  overlays?: TVSiblingOverlay[];
  trendLines?: TrendLine[];
  trendlinesView?: TrendlinesView;
  /** Last N hits (newest first) to draw as historical patterns. */
  historyHits?: PatternHitDTO[];
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

function visibleMarkers(markers: TVMarker[], hidden: ReadonlySet<string>): TVMarker[] {
  return markers.filter((marker) =>
    marker.group === "keypoints"
      ? !hidden.has(KEY_POINTS_LEGEND_NAME)
      : !hidden.has(PIVOT_LEGEND_NAME),
  );
}

/**
 * TradingView (lightweight-charts v5) adapter that draws a detected
 * chart-pattern the same way the ECharts fullscreen does: real OHLCV candles +
 * volume, pattern boundary trendlines (selected solid, siblings dashed),
 * standalone TLS/TLR segments, horizontal breakout/target/stop levels, and
 * pivot markers. Pure mapping lives in `patternTVData.ts`.
 */
export function PatternTradingViewChart(props: PatternTradingViewChartProps) {
  let containerEl: HTMLDivElement | undefined;
  let overlayEl: HTMLCanvasElement | undefined;
  let chart: IChartApi | null = null;
  let candleSeries: ISeriesApi<"Candlestick"> | null = null;
  let volumeSeries: ISeriesApi<"Histogram"> | null = null;
  let lineSeries: ISeriesApi<"Line">[] = [];
  let markers: ReturnType<typeof createSeriesMarkers> | null = null;
  let priceLines: Array<{ name: string; line: IPriceLine }> = [];
  let hiddenRef: ReadonlySet<string> = props.hiddenNames ?? EMPTY_HIDDEN;

  const trendlinesView = () => props.trendlinesView ?? "both";
  const data = createMemo(() =>
    buildPatternTVData({
      candles: props.candles,
      hit: props.hit,
      overlays: props.overlays,
      trendLines: props.trendLines,
      trendlinesView: trendlinesView(),
      historyHits: props.historyHits,
    }),
  );

  // Create the chart once; data/overlays update in the effect below.
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
    chart = created;

    // Same default candle scheme as the paper-trading chart: white up bars,
    // blue down bars (`TradingViewChart`'s default theme).
    const bull = palette.MARKER_BORDER;
    const bear = palette.SCALE_BLUE[6];
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
    candleSeries = candles as unknown as ISeriesApi<"Candlestick">;

    const volume = created.addSeries(HistogramSeries, {
      color: withAlpha(palette.TEXT_MUTED, 0.3),
      priceScaleId: "",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries = volume as unknown as ISeriesApi<"Histogram">;
    (volume as unknown as ISeriesApi<"Histogram">).priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    markers = createSeriesMarkers(candles, []);

    const ro = new ResizeObserver(() => {
      if (containerEl && chart) {
        chart.applyOptions({
          width: containerEl.clientWidth,
          height: containerEl.clientHeight || initialHeight,
        });
      }
    });
    ro.observe(containerEl);

    const ts = created.timeScale() as unknown as {
      subscribeVisibleLogicalRangeChange?: (h: () => void) => void;
      unsubscribeVisibleLogicalRangeChange?: (h: () => void) => void;
    };
    if (typeof ts.subscribeVisibleLogicalRangeChange === "function") {
      const onRedraw = () => requestAnimationFrame(drawEndLabels);
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
      created.remove();
      chart = null;
      candleSeries = null;
      volumeSeries = null;
      lineSeries = [];
      markers = null;
      priceLines = [];
    });
  });

  // Explicit numeric height updates without recreate; `"100%"` is driven by the
  // ResizeObserver above (which measures the flex parent).
  createEffect(() => {
    const h = props.height;
    if (typeof h === "number") chart?.applyOptions({ height: h });
  });

  // Paint candles, volume, levels, boundary/TLS-TLR lines and pivots on data change.
  createEffect(() => {
    const d = data();
    const candle = candleSeries;
    const volume = volumeSeries;
    if (!chart || !candle || !volume) return;

    candle.setData(d.candles as never);
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
        lineStyle: line.dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      series.setData(line.points as never);
      if (hiddenRef.has(line.name)) series.applyOptions({ visible: false });
      lineSeries.push(series);
    });

    try {
      markers?.setMarkers(visibleMarkers(d.markers, hiddenRef) as never);
    } catch {
      /* noop */
    }

    chart.timeScale().fitContent();
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
    const ts = chart.timeScale() as unknown as {
      timeToCoordinate?: (t: unknown) => number | null;
    };
    if (typeof ts.timeToCoordinate !== "function") return;
    ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    data().lines.forEach((line, i) => {
      if (!line.labelEligible || hiddenRef.has(line.name)) return;
      const series = lineSeries[i] as unknown as
        | { priceToCoordinate?: (p: number) => number | null }
        | undefined;
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
      // Spread overlapping labels HORIZONTALLY first (same row, shifted left,
      // then right) so a stack of patterns reads along one line; only fall
      // back to a vertical step when the row is full.
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
    try {
      markers?.setMarkers(visibleMarkers(d.markers, next) as never);
    } catch {
      /* noop */
    }
    drawEndLabels();
  });

  return (
    <div
      data-testid="patterns-tv-chart"
      className="relative flex min-h-0 w-full flex-col"
      style={{ height: typeof props.height === "number" ? `${props.height}px` : (props.height ?? "100%") }}
    >
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
