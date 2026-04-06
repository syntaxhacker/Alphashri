/**
 * Chart Renderer
 *
 * Reusable ECharts option builder for candlestick charts.
 * Supports preview (mini), expanded, and full size charts.
 */

import type { PreviewCandle, PivotLevel } from "../../api/chartPreview";
import type { ORBZone } from "../../types/backtest";
import { theme } from "../../config/theme";
import { buildPivotSeries } from "../../utils/chartLineBuilders";
import { formatTimeLabel } from "../../utils/chartTimeUtils";
import {
  CHART_DARK_BG, CHART_LIGHT_BG,
  CHART_DARK_TEXT, CHART_LIGHT_TEXT,
  CHART_DARK_MUTED, CHART_LIGHT_MUTED,
  CHART_DARK_BORDER, CHART_LIGHT_BORDER,
  CHART_DARK_SPLIT, CHART_LIGHT_SPLIT,
  CHART_DARK_OVERLAY, CHART_LIGHT_OVERLAY,
  CHART_DARK_DATAZOOM_BG, CHART_LIGHT_DATAZOOM_BG,
  CHART_CROSSHAIR,
  BULLISH, BEARISH,
  INDICATOR_BLUE_A, INDICATOR_BLUE_B,
  POSITIVE, NEGATIVE,
  DATAZOOM_FILLER,
} from "../../config/colors";
export { buildPivotSeries, formatTimeLabel };

export type ChartSize = "preview" | "expanded" | "full";

export interface ChartRenderOptions {
  symbol: string;
  candles: PreviewCandle[];
  orb_zones?: ORBZone[];
  pivot_levels?: PivotLevel[];
  size: ChartSize;
  showPivots?: boolean;
  isDark?: boolean;
}

/**
 * Build ECharts option for candlestick chart.
 */
export function buildChartOption(options: ChartRenderOptions): any {
  const {
    symbol,
    candles,
    orb_zones = [],
    pivot_levels = [],
    size,
    showPivots = false,
    isDark = true,
  } = options;

  const fontSizes = theme.fontSizes;

  if (!candles || candles.length === 0) {
    return null;
  }

  const isSmall = size === "preview";
  const isFull = size === "full";

  const bgColor = isDark ? CHART_DARK_BG : CHART_LIGHT_BG;
  const textColor = isDark ? CHART_DARK_TEXT : CHART_LIGHT_TEXT;
  const mutedColor = isDark ? CHART_DARK_MUTED : CHART_LIGHT_MUTED;
  const borderColor = isDark ? CHART_DARK_BORDER : CHART_LIGHT_BORDER;
  const splitLineColor = isDark ? CHART_DARK_SPLIT : CHART_LIGHT_SPLIT;
  const tooltipBg = isDark ? CHART_DARK_OVERLAY : CHART_LIGHT_OVERLAY;
  const dataZoomBg = isDark ? CHART_DARK_DATAZOOM_BG : CHART_LIGHT_DATAZOOM_BG;

  // Build candlestick data
  const candleData = candles.map((c) => [c.open, c.close, c.low, c.high]);
  const timeData = candles.map((c) => c.time);

  // Build ORB zone lines (sparse arrays with values on matching dates)
  const orbHighData = buildORBLine(candles, orb_zones, "high");
  const orbLowData = buildORBLine(candles, orb_zones, "low");

  // Build pivot lines (only if showPivots)
  const pivotSeries = showPivots ? buildPivotSeries(candles, pivot_levels) : [];

  // Base configuration
  const chartOption: any = {
    backgroundColor: bgColor,
    animation: !isSmall,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross", lineStyle: { color: CHART_CROSSHAIR } },
      backgroundColor: tooltipBg,
      borderColor: borderColor,
      borderWidth: 1,
      textStyle: { color: textColor, fontSize: isSmall ? fontSizes.sm : fontSizes.md },
      formatter: (params: any) => formatTooltip(params, candles, isDark),
    },
    grid: {
      left: isSmall ? 40 : 50,
      right: isSmall ? 15 : 30,
      top: isSmall ? 10 : isFull ? 50 : 30,
      bottom: isSmall ? 20 : isFull ? 80 : 50,
    },
    xAxis: {
      type: "category",
      data: timeData,
      scale: true,
      splitLine: { show: false },
      axisLine: { lineStyle: { color: borderColor } },
      axisLabel: {
        show: !isSmall,
        color: mutedColor,
        rotate: 45,
        fontSize: fontSizes.sm,
        formatter: (value: string) => formatTimeLabel(value),
      },
    },
    yAxis: {
      type: "value",
      scale: true,
      splitLine: { lineStyle: { color: splitLineColor } },
      axisLine: { lineStyle: { color: borderColor } },
      axisLabel: {
        color: mutedColor,
        fontSize: isSmall ? fontSizes.sm : fontSizes.sm,
        formatter: (value: number) => "₹" + value.toFixed(0),
      },
    },
    series: [
      // Candlestick series
      {
        name: "Price",
        type: "candlestick",
        data: candleData,
        itemStyle: {
          color: BULLISH,
          color0: BEARISH,
          borderColor: BULLISH,
          borderColor0: BEARISH,
        },
      },
      // ORB High line
      {
        id: "orb-high",
        name: "OR High",
        type: "line",
        data: orbHighData,
        showSymbol: false,
        connectNulls: false,
        silent: true,
        z: 5,
        lineStyle: {
          color: INDICATOR_BLUE_A,
          width: isSmall ? 1 : 2,
          type: "dashed",
        },
        tooltip: {
          show: !isSmall,
          formatter: (params: any) => {
            if (params.value === null) return "";
            return `<span style="color:${INDICATOR_BLUE_A}">OR High: ₹${params.value.toFixed(2)}</span>`;
          },
        },
      },
      // ORB Low line
      {
        id: "orb-low",
        name: "OR Low",
        type: "line",
        data: orbLowData,
        showSymbol: false,
        connectNulls: false,
        silent: true,
        z: 5,
        lineStyle: {
          color: INDICATOR_BLUE_B,
          width: isSmall ? 1 : 2,
          type: "dashed",
        },
        tooltip: {
          show: !isSmall,
          formatter: (params: any) => {
            if (params.value === null) return "";
            return `<span style="color:${INDICATOR_BLUE_B}">OR Low: ₹${params.value.toFixed(2)}</span>`;
          },
        },
      },
      // Pivot level series
      ...pivotSeries,
    ],
  };

  if (!isSmall) {
    chartOption.title = {
      text: `${symbol}`,
      left: "center",
      textStyle: { fontSize: isFull ? fontSizes.xl : fontSizes.lg, color: textColor },
    };
  }

  if (!isSmall) {
    chartOption.legend = {
      data: ["Price", "OR High", "OR Low", ...(showPivots ? ["R1", "PP", "S1"] : [])],
      bottom: isFull ? 40 : 10,
      itemWidth: 14,
      itemHeight: 10,
      itemGap: 8,
      textStyle: { color: mutedColor, fontSize: fontSizes.sm },
    };
  }

  if (!isSmall) {
    chartOption.dataZoom = [
      {
        type: "inside",
        start: 0,
        end: 100,
      },
      ...(isFull
        ? [
            {
              type: "slider",
              show: true,
              start: 0,
              end: 100,
              bottom: 10,
              borderColor: borderColor,
              backgroundColor: dataZoomBg,
              fillerColor: DATAZOOM_FILLER,
              handleStyle: { color: BULLISH },
              textStyle: { color: mutedColor },
            },
          ]
        : []),
    ];
  }

  return chartOption;
}

/**
 * Build ORB line data (sparse array with values on matching dates).
 */
export function buildORBLine(
  candles: PreviewCandle[],
  orb_zones: ORBZone[],
  type: "high" | "low",
): (number | null)[] {
  if (!orb_zones || orb_zones.length === 0) {
    return candles.map(() => null);
  }

  // Create date -> level map
  const levelMap = new Map<string, number>();
  for (const zone of orb_zones) {
    const key = zone.date_raw || zone.date;
    levelMap.set(key, type === "high" ? zone.or_high : zone.or_low);
  }

  // Build sparse array
  return candles.map((c) => {
    const level = levelMap.get(c.date);
    return level !== undefined ? level : null;
  });
}

/**
 * Format tooltip content.
 */
export function formatTooltip(params: any, candles: PreviewCandle[], isDark: boolean): string {
  const candle = params.find((p: any) => p.seriesType === "candlestick");
  if (!candle) return "";

  const idx = candle.dataIndex;
  const c = candles[idx];
  if (!c) return "";

  const change = c.open > 0 ? (((c.close - c.open) / c.open) * 100).toFixed(2) : "0";
  const changeColor = c.close >= c.open ? POSITIVE : NEGATIVE;
  const textColor = isDark ? CHART_DARK_TEXT : CHART_LIGHT_TEXT;
  const fontFamily = theme.fontFamily;
  const fontSizes = theme.fontSizes;

  return `
    <div style="padding: 4px 6px; font-family: ${fontFamily}; font-size: ${fontSizes.sm}; line-height: 1.3; color: ${textColor};">
      <div style="font-weight: bold; margin-bottom: 2px;">${c.date} ${c.time_str}</div>
      <div>O: ₹${c.open.toFixed(0)} H: ₹${c.high.toFixed(0)} L: ₹${c.low.toFixed(0)} C: ₹${c.close.toFixed(0)}</div>
      <div style="color: ${changeColor};">${c.close >= c.open ? "+" : ""}${change}%</div>
    </div>
  `;
}
