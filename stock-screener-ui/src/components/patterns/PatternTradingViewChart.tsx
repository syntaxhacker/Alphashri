import { createEffect, createMemo, onCleanup, onMount, Show } from "solid-js";
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
import * as palette from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import type {
  ChartCandle,
  PatternHitDTO,
  TrendLine,
  TrendlinesView,
} from "@/types/chartPatterns";
import { buildPatternTVData, type TVMarker, type TVSiblingOverlay } from "./patternTVData";
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

function visibleMarkers(markers: TVMarker[], hidden: ReadonlySet<string>): TVMarker[] {
  return markers.filter((marker) =>
    marker.group === "keypoints"
      ? !hidden.has(KEY_POINTS_LEGEND_NAME)
      : !hidden.has(PIVOT_LEGEND_NAME),
  );
}

export function PatternTradingViewChart(props: PatternTradingViewChartProps) {
  let containerEl: HTMLDivElement | undefined;
  let overlayEl: HTMLCanvasElement | undefined;
  let chart: IChartApi | null = null;
  let candleSeries: ISeriesApi<"Candlestick"> | null = null;
  let volumeSeries: ISeriesApi<"Histogram"> | null = null;
  let lineSeries: ISeriesApi<"Line">[] = [];
  let markers: ISeriesMarkersPluginApi<Time> | null = null;
  let priceLines: Array<{ name: string; line: IPriceLine }> = [];
  let hiddenRef: ReadonlySet<string> = props.hiddenNames ?? EMPTY_HIDDEN;

  const timeZoneOf = () => props.timeZone ?? MARKET_TIME_ZONE.india;
  // The chart is created once; the callbacks read this ref so a zone change
  // repaints the axis without rebuilding the series (and losing pan/zoom).
  let timeZoneRef = timeZoneOf();
  let localeRef = chartPriceLocale(props.market);
  const tickFormatter = (time: Time, kind: TickMarkType) =>
    tvTickMarkFormatter(time, kind, timeZoneRef);
  const crosshairFormatter = (time: Time) => tvTimeFormatter(time, timeZoneRef);

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
  const partialTime = createMemo(() => data().candles.find((c) => c.isPartial)?.time ?? null);

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
        tickMarkFormatter: tickFormatter,
      },
      localization: { locale: localeRef, timeFormatter: crosshairFormatter },
      rightPriceScale: { borderColor: palette.BORDER },
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

  // Paint candles, volume, levels, boundary/TLS-TLR lines and pivots on data change.
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
    const ts = chart.timeScale();
    if (typeof ts.timeToCoordinate !== "function") return;
    ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const placed: { x: number; y: number; w: number; h: number }[] = [];
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
      data-partial={partialTime() != null ? "true" : undefined}
      className="relative flex min-h-0 w-full flex-col"
      style={{ height: typeof props.height === "number" ? `${props.height}px` : (props.height ?? "100%") }}
    >
      <Show when={partialTime() != null}>
        <span
          data-testid="patterns-tv-partial-badge"
          className="pointer-events-none absolute right-2 top-1 z-[4] rounded-fin border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide"
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
