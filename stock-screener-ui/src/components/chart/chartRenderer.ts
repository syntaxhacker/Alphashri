/**
 * Chart Renderer
 *
 * Reusable ECharts option builder for candlestick charts.
 * Supports preview (mini), expanded, and full size charts.
 */

import type { PreviewCandle, ORBZone, PivotLevel } from "../../api/chartPreview";

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

  if (!candles || candles.length === 0) {
    return null;
  }

  const isSmall = size === "preview";
  const isFull = size === "full";

  const bgColor = isDark ? "#0a0a0a" : "#ffffff";
  const textColor = isDark ? "#e0e0e0" : "#333333";
  const mutedColor = isDark ? "#888" : "#666666";
  const borderColor = isDark ? "#333" : "#e0e0e0";
  const splitLineColor = isDark ? "#222" : "#eeeeee";
  const tooltipBg = isDark ? "rgba(20, 20, 20, 0.95)" : "rgba(255, 255, 255, 0.95)";
  const dataZoomBg = isDark ? "#111" : "#f5f5f5";

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
      axisPointer: { type: "cross", lineStyle: { color: "#666" } },
      backgroundColor: tooltipBg,
      borderColor: borderColor,
      borderWidth: 1,
      textStyle: { color: textColor, fontSize: isSmall ? 10 : 12 },
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
        fontSize: 10,
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
        fontSize: isSmall ? 10 : 11,
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
          color: "#00E676", // Bullish - bright green
          color0: "#FF1744", // Bearish - bright red
          borderColor: "#00E676",
          borderColor0: "#FF1744",
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
          color: "#42A5F5", // Blue
          width: isSmall ? 1 : 2,
          type: "dashed",
        },
        tooltip: {
          show: !isSmall,
          formatter: (params: any) => {
            if (params.value === null) return "";
            return `<span style="color:#42A5F5">OR High: ₹${params.value.toFixed(2)}</span>`;
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
          color: "#1E88E5", // Darker blue
          width: isSmall ? 1 : 2,
          type: "dashed",
        },
        tooltip: {
          show: !isSmall,
          formatter: (params: any) => {
            if (params.value === null) return "";
            return `<span style="color:#1E88E5">OR Low: ₹${params.value.toFixed(2)}</span>`;
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
      textStyle: { fontSize: isFull ? 16 : 13, color: textColor },
    };
  }

  if (!isSmall) {
    chartOption.legend = {
      data: ["Price", "OR High", "OR Low", ...(showPivots ? ["R1", "PP", "S1"] : [])],
      bottom: isFull ? 40 : 10,
      itemWidth: 14,
      itemHeight: 10,
      itemGap: 8,
      textStyle: { color: mutedColor, fontSize: 10 },
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
              fillerColor: "rgba(0, 230, 118, 0.1)",
              handleStyle: { color: "#00E676" },
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
function buildORBLine(
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
 * Build pivot level series for chart.
 */
function buildPivotSeries(candles: PreviewCandle[], pivot_levels: PivotLevel[]): any[] {
  if (!pivot_levels || pivot_levels.length === 0) {
    return [];
  }

  // Create date -> level maps
  const r1Map = new Map<string, number>();
  const s1Map = new Map<string, number>();
  const ppMap = new Map<string, number>();

  for (const level of pivot_levels) {
    const key = level.date_raw || level.date;
    r1Map.set(key, level.r1);
    s1Map.set(key, level.s1);
    ppMap.set(key, level.pp);
  }

  // Build sparse arrays
  const r1Data = candles.map((c) => r1Map.get(c.date) ?? null);
  const s1Data = candles.map((c) => s1Map.get(c.date) ?? null);
  const ppData = candles.map((c) => ppMap.get(c.date) ?? null);

  return [
    {
      id: "pivot-r1",
      name: "R1",
      type: "line",
      data: r1Data,
      showSymbol: false,
      connectNulls: false,
      silent: true,
      z: 4,
      lineStyle: { color: "#EF5350", width: 1, type: "dashed" },
      tooltip: {
        show: true,
        formatter: (params: any) =>
          params.value !== null
            ? `<span style="color:#EF5350">R1: ₹${params.value.toFixed(2)}</span>`
            : "",
      },
    },
    {
      id: "pivot-pp",
      name: "PP",
      type: "line",
      data: ppData,
      showSymbol: false,
      connectNulls: false,
      silent: true,
      z: 4,
      lineStyle: { color: "#AB47BC", width: 1, type: "dotted" },
      tooltip: {
        show: true,
        formatter: (params: any) =>
          params.value !== null
            ? `<span style="color:#AB47BC">PP: ₹${params.value.toFixed(2)}</span>`
            : "",
      },
    },
    {
      id: "pivot-s1",
      name: "S1",
      type: "line",
      data: s1Data,
      showSymbol: false,
      connectNulls: false,
      silent: true,
      z: 4,
      lineStyle: { color: "#26A69A", width: 1, type: "dashed" },
      tooltip: {
        show: true,
        formatter: (params: any) =>
          params.value !== null
            ? `<span style="color:#26A69A">S1: ₹${params.value.toFixed(2)}</span>`
            : "",
      },
    },
  ];
}

/**
 * Format time label for x-axis.
 */
function formatTimeLabel(value: string): string {
  if (!value || !value.includes("T")) return value;
  const parts = value.split("T");
  const timePart = parts[1] || "";
  // Just show time for preview
  return timePart.substring(0, 5);
}

/**
 * Format tooltip content.
 */
function formatTooltip(params: any, candles: PreviewCandle[], isDark: boolean): string {
  const candle = params.find((p: any) => p.seriesType === "candlestick");
  if (!candle) return "";

  const idx = candle.dataIndex;
  const c = candles[idx];
  if (!c) return "";

  const change = c.open > 0 ? (((c.close - c.open) / c.open) * 100).toFixed(2) : "0";
  const changeColor = c.close >= c.open ? "#00E676" : "#FF1744";
  const textColor = isDark ? "#e0e0e0" : "#333333";

  return `
    <div style="padding: 4px 6px; font-family: 'SF Mono', Monaco, monospace; font-size: 11px; line-height: 1.3; color: ${textColor};">
      <div style="font-weight: bold; margin-bottom: 2px;">${c.date} ${c.time_str}</div>
      <div>O: ₹${c.open.toFixed(0)} H: ₹${c.high.toFixed(0)} L: ₹${c.low.toFixed(0)} C: ₹${c.close.toFixed(0)}</div>
      <div style="color: ${changeColor};">${c.close >= c.open ? "+" : ""}${change}%</div>
    </div>
  `;
}
