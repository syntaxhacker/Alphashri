import { createEffect, createMemo, onCleanup, onMount } from "solid-js";
import type * as ECharts from "echarts";
import { NEGATIVE, POSITIVE } from "@/ui/palette";
import type { ChartCandle, PatternHitDTO, TrendLine, Trendline, TrendlinesView } from "@/types/chartPatterns";
import { MINI_CHART_HEIGHT } from "@/config/patterns";
import { buildPatternChartOption, BOUNDARY_COLORS } from "./patternChartOption";
import { loadEcharts } from "@/utils/loadEcharts";

export interface PatternMiniChartProps {
  hit: PatternHitDTO;
  /** View-only filter for standalone support/resistance lines. */
  trendlinesView?: TrendlinesView;
}

// Stable empties: the card renders one of these per row, so a fresh `[]`
// fallback would allocate on every hit without candles / trendlines.
const NO_CANDLES: ChartCandle[] = [];
const NO_TRENDLINES: Trendline[] = [];
const NO_STANDALONE: TrendLine[] = [];

// The fallback sketch's category axis only depends on the point count, and the
// same few lengths repeat across every card in a grid — build each once.
const categoryAxisCache = new Map<number, string[]>();
function categoryAxis(length: number): string[] {
  let axis = categoryAxisCache.get(length);
  if (!axis) {
    axis = Array.from({ length }, (_, i) => String(i));
    categoryAxisCache.set(length, axis);
  }
  return axis;
}

/**
 * Compact inline candlestick for a card. Reuses the shared option builder so
 * the pattern geometry matches the detail / fullscreen views exactly.
 */
export function PatternMiniChart(props: PatternMiniChartProps) {
  let chartEl: HTMLDivElement | undefined;
  let chart: ECharts.ECharts | undefined;
  let disposed = false;
  // `loadEcharts()` is async: without a token a slow first call could land
  // after a newer one and overwrite it with a stale option.
  let applyToken = 0;

  // Per-row work stays lazy and is keyed on the hit's data references, so a
  // re-render that carries an equal hit does no filtering or option building.
  const candles = createMemo(() => props.hit.candles ?? NO_CANDLES);
  const trendlines = createMemo(
    () => (props.hit.trendlines ?? NO_TRENDLINES).filter((line) => line.length > 0),
  );

  const option = createMemo<Record<string, unknown>>(() => {
    const hit = props.hit;
    const candleWindow = candles();
    const lines = trendlines();

    if (candleWindow.length > 0) {
      return buildPatternChartOption({
        candles: candleWindow,
        trendlines: lines,
        hit,
        standaloneTrendLines: hit.trend_lines ?? NO_STANDALONE,
        trendlinesView: props.trendlinesView ?? "both",
        compact: true,
      }) as Record<string, unknown>;
    }

    // No candle window: fall back to the boundary sketch (or start→end line).
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
      xAxis: { type: "category", show: false, data: categoryAxis(length) },
      yAxis: { type: "value", show: false, scale: true },
      series,
    };
  });

  async function applyOption(next: Record<string, unknown>) {
    const token = ++applyToken;
    const lib = await loadEcharts();
    if (disposed || !chartEl || !lib || token !== applyToken) return;
    if (!chart) chart = lib.init(chartEl, null) as ECharts.ECharts;
    chart.setOption(next, true);
    chart.resize();
  }

  createEffect(() => {
    void applyOption(option());
  });

  onMount(() => {
    const handleResize = () => chart?.resize();
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));
  });

  onCleanup(() => {
    disposed = true;
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