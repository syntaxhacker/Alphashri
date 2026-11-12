import { createEffect, onCleanup, onMount } from "solid-js";
import type * as ECharts from "echarts";
import { NEGATIVE, POSITIVE } from "@/ui/palette";
import type { PatternHitDTO, TrendlinesView } from "@/types/chartPatterns";
import { MINI_CHART_HEIGHT } from "@/config/patterns";
import { buildPatternChartOption, BOUNDARY_COLORS } from "./patternChartOption";
import { loadEcharts } from "@/utils/loadEcharts";

export interface PatternMiniChartProps {
  hit: PatternHitDTO;
  /** View-only filter for standalone support/resistance lines. */
  trendlinesView?: TrendlinesView;
}

/**
 * Compact inline candlestick for a card. Reuses the shared option builder so
 * the pattern geometry matches the detail / fullscreen views exactly.
 */
export function PatternMiniChart(props: PatternMiniChartProps) {
  let chartEl: HTMLDivElement | undefined;
  let chart: ECharts.ECharts | undefined;
  let disposed = false;

  async function applyOption(option: Record<string, unknown>) {
    const lib = await loadEcharts();
    if (disposed || !chartEl || !lib) return;
    if (!chart) chart = lib.init(chartEl, null) as ECharts.ECharts;
    chart.setOption(option, true);
    chart.resize();
  }

  createEffect(() => {
    const hit = props.hit;
    const trendlinesView = props.trendlinesView ?? "both";
    const candles = hit.candles ?? [];
    const trendlines = (hit.trendlines ?? []).filter((line) => line.length > 0);

    if (candles.length > 0) {
      void applyOption(
        buildPatternChartOption({
          candles,
          trendlines,
          hit,
          standaloneTrendLines: hit.trend_lines ?? [],
          trendlinesView,
          compact: true,
        }) as Record<string, unknown>,
      );
      return;
    }

    // No candle window: fall back to the boundary sketch (or start→end line).
    const series =
      trendlines.length > 0
        ? trendlines.map((line, i) => ({
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

    void applyOption({
      animation: false,
      grid: { left: 2, right: 2, top: 6, bottom: 2 },
      tooltip: { show: false },
      xAxis: { type: "category", show: false, data: Array.from({ length }, (_, i) => String(i)) },
      yAxis: { type: "value", show: false, scale: true },
      series,
    });
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
