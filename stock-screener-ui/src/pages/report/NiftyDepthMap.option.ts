import * as palette from "@/ui/palette";
import type { NiftyReport } from "@/types/niftyReport";
import { REPORT_FONT } from "./reportTokens";
import { fmtStrike, formatIstTimeMs } from "./NiftyDepthMap.format";
import {
  buildDepthRows,
  candleEpochMs,
  candleYRange,
  chartCandles,
  dayStats,
  depthKey,
  findOiPoc,
  levelLines,
} from "./NiftyDepthMap.geometry";
import {
  candleSeries,
  ceBarSeries,
  depthTooltip,
  dominanceSeries,
  peBarSeries,
} from "./NiftyDepthMap.bars";

/**
 * Full ECharts option: candlestick grid (left ~68%) + horizontal OI
 * depth-bar grid (right ~30%, visible gap between). The candle y-range is
 * candle-derived; the depth grid uses a strike category axis so every
 * strike row carries one CE bar (left) + one PE bar (right). Level tags
 * render as labeled lines on the candle grid. Plus CE/PE dominance markers.
 */
export function buildDepthOption(report: NiftyReport): Record<string, unknown> {
  const rows = buildDepthRows(report);
  const stats = dayStats(report);
  const poc = findOiPoc(report);
  const candles = chartCandles(report);
  const lines = levelLines(report, stats, poc);
  const { min: yMin, max: yMax } = candleYRange(candles);
  const [ceDom, peDom] = dominanceSeries(rows);

  const axisLabel = { color: palette.CHART_MUTED, "font-size": `${REPORT_FONT.micro}px` };
  const strikeFmt = (v: string | number) => fmtStrike(Number(v));
  const istFmt = (v: unknown) => formatIstTimeMs(Number(v));

  return {
    "background-color": "transparent",
    animation: false,
    legend: { show: false },
    // The two grids no longer share a value axis (depth y is categorical),
    // so only the candle grid participates in pointer linking.
    axisPointer: { link: { yAxisIndex: [0] } },
    tooltip: {
      trigger: "item",
      "background-color": palette.TOOLTIP_BG,
      "border-color": palette.TOOLTIP_BORDER,
      textStyle: { color: palette.TOOLTIP_TEXT, "font-size": `${REPORT_FONT.micro}px` },
      formatter: depthTooltip(rows, report),
    },
    grid: [
      { "left": "56px", right: "32%", "top": "16px", "bottom": "48px" },
      { left: "70%", "right": "64px", "top": "16px", "bottom": "48px" },
    ],
    xAxis: [
      {
        type: "category",
        gridIndex: 0,
        data: candles.map((c) => candleEpochMs(c.time)),
        axisLabel: { ...axisLabel, formatter: istFmt },
        axisLine: { lineStyle: { color: palette.AXIS_LINE } },
        axisTick: { show: false },
      },
      {
        // OI magnitude (value) axis: CE bars extend left (negative),
        // PE bars right (positive) from the zero center.
        type: "value",
        gridIndex: 1,
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
      },
    ],
    yAxis: [
      {
        type: "value",
        gridIndex: 0,
        min: yMin,
        max: yMax,
        position: "left",
        axisLabel: { ...axisLabel, formatter: strikeFmt },
        axisLine: { lineStyle: { color: palette.AXIS_LINE } },
        splitLine: { lineStyle: { color: palette.CHART_SPLIT } },
      },
      {
        // Strike category axis: one row per strike, ascending bottom to
        // top so rows sit at their price levels. Keys are strings — see
        // depthKey in the geometry module. This — not a second value axis —
        // is what makes the depth bars horizontal.
        type: "category",
        gridIndex: 1,
        data: rows.map((r) => depthKey(r.strike)),
        position: "right",
        axisLabel: { ...axisLabel, formatter: strikeFmt },
        axisLine: { lineStyle: { color: palette.AXIS_LINE } },
        axisTick: { show: false },
        splitLine: { show: false },
      },
    ],
    series: [
      candleSeries(candles, lines),
      ceBarSeries(rows),
      peBarSeries(rows),
      ceDom,
      peDom,
    ],
  };
}
