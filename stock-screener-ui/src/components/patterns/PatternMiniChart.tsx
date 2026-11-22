import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type * as ECharts from "echarts";
import { NEGATIVE, POSITIVE } from "@/ui/palette";
import type { ChartCandle, PatternHitDTO, TrendLine, Trendline, TrendlinesView } from "@/types/chartPatterns";
import { MINI_CHART_HEIGHT } from "@/config/patterns";
import { buildPatternChartOption, BOUNDARY_COLORS } from "./patternChartOption";
import { loadEcharts } from "@/utils/loadEcharts";

export interface PatternMiniChartProps {
  hit: PatternHitDTO;
  trendlinesView?: TrendlinesView;
}

// Stable empties: the card renders one of these per row, so a fresh `[]`
// fallback would allocate on every hit without candles / trendlines.
const NO_CANDLES: ChartCandle[] = [];
const NO_TRENDLINES: Trendline[] = [];
const NO_STANDALONE: TrendLine[] = [];

// Start the chart just before its card scrolls into view so it is ready on paint.
const MINI_CHART_ROOT_MARGIN = "200px";

export function PatternMiniChart(props: PatternMiniChartProps) {
  let chartEl: HTMLDivElement | undefined;
  let chart: ECharts.ECharts | undefined;
  let observer: IntersectionObserver | undefined;
  let disposed = false;
  // `loadEcharts()` is async: without a token a slow first call could land
  // after a newer one and overwrite it with a stale option.
  let applyToken = 0;
  // The results grid mounts far more cards than are on screen at once; defer
  // ECharts work until a card is near the viewport.
  const [visible, setVisible] = createSignal(false);

  // Per-row work stays lazy and is keyed on the hit's data references, so a
  // re-render that carries an equal hit does no filtering or option building.
  const candles = createMemo(() => props.hit.candles ?? NO_CANDLES);
  const trendlines = createMemo(
    () => (props.hit.trendlines ?? NO_TRENDLINES).filter((line) => line.length > 0),
  );

  // Option construction is pure and memoised on the data that shapes it: the
  // hit (which carries the timeframe) and the trendline view. The visibility
  // guard is first so an off-screen card never builds an option at all, and
  // the memo means unrelated parent activity never rebuilds the arrays.
  const chartOption = createMemo<Record<string, unknown> | undefined>(() => {
    if (!visible()) return undefined;
    const hit = props.hit;
    const view = props.trendlinesView;
    const candleWindow = candles();
    const lines = trendlines();

    if (candleWindow.length > 0) {
      return buildPatternChartOption({
        candles: candleWindow,
        trendlines: lines,
        hit,
        standaloneTrendLines: hit.trend_lines ?? NO_STANDALONE,
        trendlinesView: view ?? "both",
        compact: true,
      }) as Record<string, unknown>;
    }

    const series =
      lines.length > 0
        ? lines.map((line, i) => ({
            type: "line" as const,
            showSymbol: false,
            smooth: true,
            silent: true,
            data: line.map((p) => p.price),
            lineStyle: { width: 2, color: BOUNDARY_COLORS[i % BOUNDARY_COLORS.length] },
          }))
        : [
            {
              type: "line" as const,
              showSymbol: false,
              smooth: true,
              silent: true,
              data: [hit.start_price, hit.end_price],
              lineStyle: { width: 2, color: hit.direction === "bearish" ? NEGATIVE : POSITIVE },
            },
          ];

    const length = Math.max(...series.map((s) => s.data.length), 2);

    return {
      animation: false,
      grid: { left: 2, right: 2, top: 6, bottom: 2 },
      tooltip: { show: false },
      xAxis: {
        type: "category",
        show: false,
        data: Array.from({ length }, (_, i) => String(i)),
      },
      yAxis: { type: "value", show: false, scale: true },
      series,
    };
  });

  async function applyOption(next: Record<string, unknown>) {
    const token = ++applyToken;
    const lib = await loadEcharts();
    if (disposed || !chartEl || !lib || !visible() || token !== applyToken) return;
    if (!chart) chart = lib.init(chartEl, null) as ECharts.ECharts;
    chart.setOption(next, true);
    chart.resize();
  }

  createEffect(() => {
    const option = chartOption();
    if (option) void applyOption(option);
  });

  onMount(() => {
    const el = chartEl;
    if (el && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          if (disposed || visible()) return;
          if (entries.some((entry) => entry.isIntersecting)) {
            setVisible(true);
            observer?.unobserve(el);
          }
        },
        { rootMargin: MINI_CHART_ROOT_MARGIN },
      );
      observer.observe(el);
    } else {
      // Environments without IntersectionObserver (e.g. JSDOM) render immediately.
      setVisible(true);
    }

    const handleResize = () => chart?.resize();
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));
  });

  onCleanup(() => {
    disposed = true;
    observer?.disconnect();
    observer = undefined;
    chart?.dispose();
    chart = undefined;
  });

  return (
    <div
      ref={(el) => (chartEl = el)}
      data-testid={`patterns-mini-chart-${props.hit.symbol}-${props.hit.pattern_id}`}
      className="w-full"
      style={{ height: `${MINI_CHART_HEIGHT}px` }}
    />
  );
}
