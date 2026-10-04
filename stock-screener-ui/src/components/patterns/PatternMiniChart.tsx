import { useEffect } from "react";
import { Box } from "@/ui";
import { useECharts } from "@/hooks/useECharts";
import { NEGATIVE, POSITIVE } from "@/ui/palette";
import type { PatternHitDTO, TrendlinesView } from "@/types/chartPatterns";
import { MINI_CHART_HEIGHT } from "@/config/patterns";
import { buildPatternChartOption, BOUNDARY_COLORS } from "./patternChartOption";

export interface PatternMiniChartProps {
  hit: PatternHitDTO;
  /** View-only filter for standalone support/resistance lines. */
  trendlinesView?: TrendlinesView;
}

/**
 * Compact inline candlestick for a card. Reuses the shared option builder so
 * the pattern geometry matches the detail / fullscreen views exactly.
 */
export function PatternMiniChart({ hit, trendlinesView = "both" }: PatternMiniChartProps) {
  const { chartRef, setChartOption } = useECharts({ isDark: true });

  useEffect(() => {
    const candles = hit.candles ?? [];
    const trendlines = (hit.trendlines ?? []).filter((line) => line.length > 0);

    if (candles.length > 0) {
      setChartOption(
        buildPatternChartOption({
          candles,
          trendlines,
          hit,
          standaloneTrendLines: hit.trend_lines ?? [],
          trendlinesView,
          compact: true,
        }) as never,
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

    setChartOption({
      animation: false,
      grid: { left: 2, right: 2, top: 6, bottom: 2 },
      tooltip: { show: false },
      xAxis: { type: "category", show: false, data: Array.from({ length }, (_, i) => String(i)) },
      yAxis: { type: "value", show: false, scale: true },
      series,
    });
  }, [hit, setChartOption, trendlinesView]);

  return (
    <Box
      ref={chartRef}
      data-testid={`patterns-mini-chart-${hit.symbol}-${hit.pattern_id}`}
      sx={{ width: "100%", height: MINI_CHART_HEIGHT }}
    />
  );
}
