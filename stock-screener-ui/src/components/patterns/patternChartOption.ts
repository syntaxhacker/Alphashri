import type { ChartCandle, PatternHitDTO, Trendline } from "@/types/chartPatterns";
import {
  CHART_MUTED,
  CHART_SPLIT,
  MARKER_SL,
  MARKER_TP,
  NEGATIVE,
  POSITIVE,
  PRIMARY,
  WARNING,
} from "@/ui/palette";
import { mapTrendlines, pointsToSeriesData } from "./trendlineMapping";
import { formatChartTick, formatChartTimestamp } from "./datetime";
import { formatCurrency } from "@/utils/ui-helpers";

export const BOUNDARY_COLORS = [PRIMARY, WARNING];

interface TooltipParam {
  axisValue?: unknown;
  marker?: string;
  seriesName?: string;
  seriesType?: string;
  value?: unknown;
}

/**
 * Readable tooltip: replaces the raw ISO category header with the IST trading
 * date/time and keeps each series' value visible.
 */
function formatPatternTooltip(params: unknown): string {
  const list = Array.isArray(params) ? (params as TooltipParam[]) : [params as TooltipParam];
  const first = list[0];
  if (!first) return "";
  const header = formatChartTimestamp(String(first.axisValue ?? ""));
  const rows = list
    .map((p) => {
      const marker = p.marker ?? "";
      const name = p.seriesName ?? "";
      if (p.value == null) return "";
      let value: string;
      if (p.seriesType === "candlestick" && Array.isArray(p.value)) {
        const [o, c, l, h] = p.value as number[];
        value = `O ${o}  H ${h}  L ${l}  C ${c}`;
      } else if (p.seriesType === "scatter" && Array.isArray(p.value)) {
        // Pivot markers plot as [categoryIndex, price]; show the price at the
        // marker's readable date (the tooltip header) instead of raw indices.
        value = formatCurrency(Number((p.value as number[])[1]), 2);
      } else if (Array.isArray(p.value)) {
        value = (p.value as unknown[]).join(" / ");
      } else {
        value = String(p.value);
      }
      return `${marker}${name}: ${value}`;
    })
    .filter((row) => row !== "");
  return [header, ...rows].join("<br/>");
}

export interface PatternChartOptionInput {
  candles: ChartCandle[];
  trendlines?: Trendline[];
  hit?: PatternHitDTO | null;
  /** Compact = card sparkline (no axes/tooltip/legend/zoom). */
  compact?: boolean;
  /** Full = drill-down / fullscreen (axes, tooltip, legend, level guides). */
  showZoom?: boolean;
  /** Larger fonts/margins for the fullscreen view. */
  large?: boolean;
}

/**
 * Single source of truth for drawing a detected pattern: real OHLCV candles,
 * the detector's boundary trendlines, and breakout/target/stop guides. Used by
 * the card sparkline, the detail chart, and the fullscreen view so the geometry
 * is identical everywhere.
 */
export function buildPatternChartOption({
  candles,
  trendlines,
  hit,
  compact = false,
  showZoom = false,
  large = false,
}: PatternChartOptionInput): Record<string, unknown> {
  const times = candles.map((c) => c.t);
  const mapped = mapTrendlines(trendlines, times);

  const markData: Array<Record<string, unknown>> = [];
  if (!compact && hit) {
    if (hit.breakout_level) {
      markData.push({
        yAxis: hit.breakout_level,
        label: { formatter: "Breakout", position: "insideEndTop", color: PRIMARY, fontSize: large ? 12 : 10 },
        lineStyle: { color: PRIMARY, type: "dashed", width: 1 },
      });
    }
    if (hit.target) {
      markData.push({
        yAxis: hit.target,
        label: { formatter: "Target", position: "insideEndTop", color: MARKER_TP, fontSize: large ? 12 : 10 },
        lineStyle: { color: MARKER_TP, type: "dashed", width: 1 },
      });
    }
    if (hit.stop) {
      markData.push({
        yAxis: hit.stop,
        label: { formatter: "Stop", position: "insideEndBottom", color: MARKER_SL, fontSize: large ? 12 : 10 },
        lineStyle: { color: MARKER_SL, type: "dashed", width: 1 },
      });
    }
  }

  const series: Array<Record<string, unknown>> = [
    {
      type: "candlestick",
      name: hit?.symbol ?? "Price",
      data: candles.map((c) => [c.o, c.c, c.l, c.h]),
      itemStyle: { color: POSITIVE, color0: NEGATIVE, borderColor: POSITIVE, borderColor0: NEGATIVE },
      barMaxWidth: compact ? 5 : 12,
      silent: compact,
      z: 1,
      markLine:
        markData.length > 0
          ? { symbol: "none", silent: true, data: markData as never }
          : undefined,
    },
  ];

  const legendData = mapped.map((_, i) => (i === 0 ? "Upper boundary" : "Lower boundary"));

  mapped.forEach((points, i) => {
    series.push({
      type: "line",
      name: i === 0 ? "Upper boundary" : "Lower boundary",
      showSymbol: false,
      connectNulls: true,
      silent: true,
      data: pointsToSeriesData(points, times.length),
      lineStyle: { width: compact ? 2 : large ? 3 : 2, color: BOUNDARY_COLORS[i % BOUNDARY_COLORS.length] },
      z: 3,
    });
  });

  // Swing pivots that define the pattern: up/down triangles at their real
  // timestamp mapped onto the category axis (full charts only — card sparklines
  // stay clean). Highs are red pointing down; lows green pointing up.
  const pivotMarkers: Array<{ index: number; price: number; kind: "high" | "low" }> = [];
  if (!compact && hit?.pivots?.length && times.length > 0) {
    hit.pivots.forEach((pivot) => {
      if (!pivot || !pivot.t) return;
      const [point] = mapTrendlines([[{ t: pivot.t, price: pivot.price }]], times);
      const mappedPoint = point?.[0];
      if (!mappedPoint || mappedPoint.index < 0) return;
      pivotMarkers.push({
        index: mappedPoint.index,
        price: mappedPoint.price,
        kind: pivot.kind === "low" ? "low" : "high",
      });
    });
  }

  if (pivotMarkers.length > 0) {
    const markerSize = large ? 12 : 9;
    const highs = pivotMarkers.filter((p) => p.kind === "high");
    const lows = pivotMarkers.filter((p) => p.kind === "low");
    if (highs.length > 0) {
      legendData.push("Pivot High");
      series.push({
        type: "scatter",
        name: "Pivot High",
        symbol: "triangle",
        symbolRotate: 180,
        symbolSize: markerSize,
        itemStyle: { color: NEGATIVE },
        z: 4,
        data: highs.map((p) => [p.index, p.price]),
      });
    }
    if (lows.length > 0) {
      legendData.push("Pivot Low");
      series.push({
        type: "scatter",
        name: "Pivot Low",
        symbol: "triangle",
        symbolRotate: 0,
        symbolSize: markerSize,
        itemStyle: { color: POSITIVE },
        z: 4,
        data: lows.map((p) => [p.index, p.price]),
      });
    }
  }

  const fontSize = large ? 12 : 10;

  return {
    animation: false,
    grid: compact
      ? { left: 2, right: 2, top: 6, bottom: 2 }
      : { left: large ? 64 : 54, right: large ? 28 : 16, top: large ? 36 : 12, bottom: showZoom ? (large ? 64 : 52) : 42 },
    tooltip: compact
      ? { show: false }
      : {
          trigger: "axis",
          axisPointer: {
            type: "cross",
            label: { formatter: (p: { value?: unknown }) => formatChartTimestamp(String(p.value ?? "")) },
          },
          formatter: formatPatternTooltip,
        },
    legend: compact
      ? undefined
      : {
          show: legendData.length > 0,
          top: 0,
          left: "center",
          itemWidth: 14,
          itemHeight: 8,
          textStyle: { color: CHART_MUTED, fontSize },
          data: legendData,
        },
    dataZoom: showZoom
      ? [
          { type: "inside", throttle: 50 },
          { type: "slider", height: large ? 22 : 18, bottom: large ? 12 : 6, borderColor: CHART_SPLIT, textStyle: { color: CHART_MUTED, fontSize } },
        ]
      : undefined,
    xAxis: {
      type: "category",
      data: times,
      show: !compact,
      boundaryGap: true,
      axisLabel: { fontSize, color: CHART_MUTED, formatter: (value: string) => formatChartTick(value) },
      axisLine: { lineStyle: { color: CHART_SPLIT } },
    },
    yAxis: {
      type: "value",
      scale: true,
      show: !compact,
      axisLabel: { fontSize, color: CHART_MUTED },
      splitLine: { lineStyle: { color: CHART_SPLIT } },
    },
    series: series as never,
  };
}
