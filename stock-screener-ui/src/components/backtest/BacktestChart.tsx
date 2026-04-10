import { useEffect, useRef } from "react";
import { Box, Text, useMantineColorScheme, Loader, Center } from "@mantine/core";
import type { SymbolChartData, ChartTrade } from "../../types/backtest";
import { theme } from "../../config/theme";
import { formatPercentage, normalizeTime } from "../../utils/ui-helpers";
import {
  CHART_DARK_BG, CHART_LIGHT_BG,
  CHART_DARK_TEXT, CHART_LIGHT_TEXT,
  CHART_DARK_MUTED, CHART_LIGHT_MUTED,
  CHART_DARK_BORDER, CHART_LIGHT_BORDER,
  CHART_DARK_SPLIT, CHART_LIGHT_SPLIT,
  CHART_DARK_OVERLAY, CHART_LIGHT_OVERLAY,
  CHART_CROSSHAIR,
  BULLISH, BEARISH,
  MARKER_BUY, MARKER_SELL, MARKER_STOP_LOSS, MARKER_CUSTOM, MARKER_MAX_HOLDING,
  MARKER_BORDER,
  PIVOT_R1, PIVOT_PP, PIVOT_S1, PIVOT_S2,
  POSITIVE, NEGATIVE,
  MARKER_ENTRY,
  MARKER_TP, MARKER_SL, MARKER_EOD,
  CHART_AVG_ENTRY, CHART_TRADE_EXIT, CHART_DARK_DROPDOWN,
  INDICATOR_BLUE_A, INDICATOR_BLUE_B,
} from "../../config/colors";

const chartInstances = new Map<string, any>();

interface BacktestChartProps {
  symbol: string;
  chartData: SymbolChartData | null | undefined;
  isLoading?: boolean;
  onTradeClick?: (tradeId: number) => void;
}

function buildChartOption(data: SymbolChartData, isDark: boolean): any {
  const { candles, pivot_levels, week52_levels, trades, visuals } = data;
  const fontSizes = theme.fontSizes;

  if (!candles || !trades) {
    return {};
  }

  const bgColor = isDark ? CHART_DARK_BG : CHART_LIGHT_BG;
  const textColor = isDark ? CHART_DARK_TEXT : CHART_LIGHT_TEXT;
  const mutedColor = isDark ? CHART_DARK_MUTED : CHART_LIGHT_MUTED;
  const borderColor = isDark ? CHART_DARK_BORDER : CHART_LIGHT_BORDER;
  const splitLineColor = isDark ? CHART_DARK_SPLIT : CHART_LIGHT_SPLIT;
  const tooltipBg = isDark ? CHART_DARK_OVERLAY : CHART_LIGHT_OVERLAY;

  const candleData = candles.map((c) => [c.open, c.close, c.low, c.high]);
  const timeData = candles.map((c) => c.time);

  const candleTimeMap = new Map(candles.map((c, i) => [normalizeTime(c.time), i]));
  const candleDateMap = new Map(candles.map((c, i) => [c.date, i]));

  const getCandleIdx = (trade: ChartTrade): number | undefined => {
    if (trade.candle_idx !== undefined) return trade.candle_idx;
    const normalized = normalizeTime(trade.time);
    let idx = candleTimeMap.get(normalized);
    if (idx === undefined && trade.date) {
      idx = candleDateMap.get(trade.date);
    }
    return idx;
  };

  type MarkerConfig = {
    filter: (t: ChartTrade) => boolean;
    color: string;
    symbol: string;
    symbolSize: number;
    symbolRotate?: number;
  };

  const buildMarkers = (trades: ChartTrade[], config: MarkerConfig) =>
    trades
      .filter(config.filter)
      .map((t) => ({ ...t, computedIdx: getCandleIdx(t) }))
      .filter((t) => t.computedIdx !== undefined)
      .map((t) => ({
        value: [t.computedIdx!, t.price],
        itemStyle: { color: config.color, borderColor: MARKER_BORDER, borderWidth: 2 },
        symbol: config.symbol,
        ...(config.symbolRotate !== undefined ? { symbolRotate: config.symbolRotate } : {}),
        symbolSize: config.symbolSize,
        trade: t.trade,
        trade_id: t.trade_id,
      }));

  const exitReason = (t: ChartTrade) => (t.trade as any).exit_reason;

  const markerConfigs: MarkerConfig[] = [
    {
      filter: (t) => t.type === "entry",
      color: MARKER_BUY,
      symbol: "triangle",
      symbolSize: 18,
      symbolRotate: 180,
    },
    {
      filter: (t) => t.type === "exit" && exitReason(t) === "TP",
      color: MARKER_SELL,
      symbol: "circle",
      symbolSize: 16,
    },
    {
      filter: (t) => t.type === "exit" && exitReason(t) === "SL",
      color: MARKER_STOP_LOSS,
      symbol: "circle",
      symbolSize: 16,
    },
    {
      filter: (t) => t.type === "exit" && exitReason(t) === "EOD",
      color: MARKER_CUSTOM,
      symbol: "diamond",
      symbolSize: 16,
    },
    {
      filter: (t) => t.type === "exit" && exitReason(t) === "TRAILING_STOP",
      color: "#9C27B0",
      symbol: "circle",
      symbolSize: 16,
    },
    {
      filter: (t) => t.type === "exit" && exitReason(t) === "MAX_HOLDING",
      color: MARKER_MAX_HOLDING,
      symbol: "diamond",
      symbolSize: 16,
    },
    {
      filter: (t) => t.type === "exit" && exitReason(t) === "NEW_52W_HIGH",
      color: PIVOT_S2,
      symbol: "circle",
      symbolSize: 16,
    },
  ];

  const [
    entryMarkers,
    tpMarkers,
    slMarkers,
    eodMarkers,
    trailingMarkers,
    maxHoldMarkers,
    new52wMarkers,
  ] = markerConfigs.map((cfg) => buildMarkers(trades, cfg));

  const series: any[] = [
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
    { name: "Entry", type: "scatter", data: entryMarkers, symbolSize: 16, z: 10 },
    { name: "TP", type: "scatter", data: tpMarkers, symbolSize: 14, z: 10 },
    { name: "SL", type: "scatter", data: slMarkers, symbolSize: 14, z: 10 },
    { name: "EOD", type: "scatter", data: eodMarkers, symbolSize: 14, z: 10 },
    { name: "Trailing", type: "scatter", data: trailingMarkers, symbolSize: 14, z: 10 },
    { name: "MaxHold", type: "scatter", data: maxHoldMarkers, symbolSize: 14, z: 10 },
    { name: "52W", type: "scatter", data: new52wMarkers, symbolSize: 14, z: 10 },
  ];

  const legendData = ["Price", "Entry", "TP", "SL", "EOD", "Trailing", "MaxHold", "52W"];

  // --- Dynamic Visuals (Standardized Overlays) ---
  if (visuals?.overlays) {
    visuals.overlays.forEach((overlay: any) => {
      if (overlay.type === "line") {
        const lineData = candles.map((c) =>
          overlay.date && c.date === overlay.date ? overlay.value : null,
        );

        series.push({
          id: overlay.id,
          name: overlay.label,
          type: "line",
          data: lineData,
          showSymbol: false,
          connectNulls: false,
          silent: true,
          z: 5,
          lineStyle: {
            color: overlay.color,
            width: 1,
            type: overlay.dash ? "dashed" : "solid",
          },
          tooltip: { show: true },
        });

        if (!legendData.includes(overlay.label)) {
          legendData.push(overlay.label);
        }
      } else if (overlay.type === "box") {
        const topData = candles.map((c) =>
          overlay.date && c.date === overlay.date ? overlay.levels.top : null,
        );

        series.push({
          id: `${overlay.id}_top`,
          name: overlay.label,
          type: "line",
          data: topData,
          showSymbol: false,
          connectNulls: false,
          silent: true,
          z: 4,
          lineStyle: { color: overlay.color, width: 0.5, opacity: 0.5, type: "dashed" },
        });

        if (!legendData.includes(overlay.label)) {
          legendData.push(overlay.label);
        }
      }
    });
  }

  // --- Legacy Visuals (Backward Compatibility) ---
  if (!visuals?.overlays) {
    // Add pivot levels for S/R Breakout strategy
    if (pivot_levels && pivot_levels.length > 0) {
      const r1Data = candles.map((c) => {
        const level = pivot_levels.find((p) => p.date_raw === c.date);
        return level ? level.r1 : null;
      });
      const s1Data = candles.map((c) => {
        const level = pivot_levels.find((p) => p.date_raw === c.date);
        return level ? level.s1 : null;
      });
      const ppData = candles.map((c) => {
        const level = pivot_levels.find((p) => p.date_raw === c.date);
        return level ? level.pp : null;
      });

      series.push(
        {
          id: "pivot-r1",
          name: "R1",
          type: "line",
          data: r1Data,
          showSymbol: false,
          silent: true,
          z: 5,
          lineStyle: { color: PIVOT_R1, width: 1, type: "dashed" },
        },
        {
          id: "pivot-pp",
          name: "PP",
          type: "line",
          data: ppData,
          showSymbol: false,
          silent: true,
          z: 5,
          lineStyle: { color: PIVOT_PP, width: 1, type: "dotted" },
        },
        {
          id: "pivot-s1",
          name: "S1",
          type: "line",
          data: s1Data,
          showSymbol: false,
          silent: true,
          z: 5,
          lineStyle: { color: PIVOT_S1, width: 1, type: "dashed" },
        },
      );
      legendData.push("R1", "PP", "S1");
    }

    // Add 52W high levels for 52W Chaser strategy
    if (week52_levels && week52_levels.length > 0) {
      const week52HighData = candles.map((c) => {
        const level = week52_levels.find((l) => l.date === c.date);
        return level ? level["52w_high"] : null;
      });
      series.push({
        id: "52w-high",
        name: "52W High",
        type: "line",
        data: week52HighData,
        showSymbol: false,
        silent: true,
        z: 5,
        lineStyle: { color: CHART_AVG_ENTRY, width: 2, type: "dashed" },
      });
      legendData.push("52W High");
    }
  }

  return {
    backgroundColor: bgColor,
    title: {
      text: `${data.symbol} - Backtest Results`,
      left: "center",
      textStyle: { fontSize: fontSizes.lg, color: textColor },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross", lineStyle: { color: CHART_CROSSHAIR } },
      backgroundColor: tooltipBg,
      borderColor: borderColor,
      borderWidth: 1,
      textStyle: { color: textColor, fontSize: fontSizes.sm },
      formatter: function (params: any) {
        // Find if this is a trade marker
        for (const p of params) {
          if (p.data && p.data.trade) {
            const t = p.data.trade;
            const pnlColor = t.net_pnl >= 0 ? POSITIVE : NEGATIVE;

            return `
              <div style="padding: 6px 8px; fontFamily: fontFamily; font-size: fontSizes.sm; line-height: 1.4;">
                <div style="color: ${MARKER_ENTRY}; font-weight: bold; margin-bottom: 4px;">
                  Trade #${p.data.trade_id} | ${t.exit_reason}
                </div>
                <div style="display: flex; gap: 12px; margin-bottom: 2px;">
                  <span>Entry: <b>₹${t.entry_price.toFixed(0)}</b></span>
                  <span>Exit: <b>₹${t.exit_price.toFixed(0)}</b></span>
                  <span>Qty: ${t.quantity}</span>
                </div>
                <div style="display: flex; gap: 12px;">
                  <span>Gross: ₹${t.gross_pnl.toFixed(0)}</span>
                  <span>Cost: ₹${t.trading_costs.toFixed(0)}</span>
                  <span style="color: ${pnlColor}; font-weight: bold;">
                    Net: ₹${t.net_pnl.toFixed(0)} (${formatPercentage(t.net_pnl_pct, 1, true)})
                  </span>
                </div>
              </div>
            `;
          }
        }

        // Candlestick tooltip
        const candle = params.find((p: any) => p.seriesType === "candlestick");
        if (candle) {
          const idx = candle.dataIndex;
          const c = candles[idx];
          const change = (((c.close - c.open) / c.open) * 100).toFixed(2);
          const changeColor = c.close >= c.open ? POSITIVE : NEGATIVE;

          return `
            <div style="padding: 6px 8px; fontFamily: fontFamily; font-size: fontSizes.sm; line-height: 1.4;">
              <div style="font-weight: bold; margin-bottom: 4px;">${c.date} ${c.time_str}</div>
              <div style="display: flex; gap: 12px;">
                <span>O: ₹${c.open.toFixed(0)}</span>
                <span>H: ₹${c.high.toFixed(0)}</span>
                <span>L: ₹${c.low.toFixed(0)}</span>
                <span>C: ₹${c.close.toFixed(0)}</span>
              </div>
              <div style="display: flex; gap: 12px; color: ${CHART_DARK_MUTED};">
                <span style="color: ${changeColor}; font-weight: bold;">${c.close >= c.open ? "+" : ""}${change}%</span>
                <span>Vol: ${(c.volume / 1000).toFixed(0)}K</span>
              </div>
            </div>
          `;
        }
        return "";
      },
    },
    legend: {
      data: legendData,
      bottom: 6,
      itemWidth: 14,
      itemHeight: 10,
      itemGap: 8,
      textStyle: { color: mutedColor, fontSize: fontSizes.sm },
      type: "scroll",
    },
    grid: {
      left: "8%",
      right: "8%",
      bottom: 82,
      top: 44,
    },
    xAxis: {
      type: "category",
      data: timeData,
      scale: true,
      splitLine: { show: false },
      axisLine: { lineStyle: { color: borderColor } },
      axisLabel: {
        color: mutedColor,
        rotate: 45,
      },
    },
    yAxis: {
      type: "value",
      scale: true,
      splitArea: { show: true },
      splitLine: { lineStyle: { color: splitLineColor } },
      axisLine: { lineStyle: { color: borderColor } },
      axisLabel: {
        color: mutedColor,
        formatter: function (value: number) {
          return "₹" + value.toFixed(0);
        },
      },
    },
    dataZoom: [
      { type: "inside", start: 0, end: 100 },
      { type: "slider", show: true, start: 0, end: 100, bottom: 30 },
    ],
    series,
  };
}

// Export zoom to trade function for external use
export function zoomToTrade(
  symbol: string,
  tradeIndex: number,
  chartData: SymbolChartData | undefined,
) {
  if (!chartData) return;

  const fontSizes = theme.fontSizes;

  const chart = chartInstances.get(symbol);
  if (!chart) {
    return;
  }

  // Get the entry and exit markers for this trade
  const entryMarker = chartData.trades.find(
    (t) => t.type === "entry" && t.trade_id === tradeIndex + 1,
  );
  const exitMarker = chartData.trades.find(
    (t) => t.type === "exit" && t.trade_id === tradeIndex + 1,
  );

  if (!entryMarker) {
    return;
  }

  // Build candle index maps for matching trades
  const candleTimeMap = new Map(chartData.candles.map((c, i) => [normalizeTime(c.time), i]));
  // Use both c.date and c.date_raw for matching (different strategies may use different fields)
  const candleDateMap = new Map<string, number>();
  chartData.candles.forEach((c, i) => {
    if (c.date) candleDateMap.set(c.date, i);
    if (c.date_raw) candleDateMap.set(c.date_raw!, i);
  });

  // Find candle index - either from pre-computed candle_idx or by matching time
  let entryIdx = entryMarker.candle_idx;
  let exitIdx = exitMarker?.candle_idx;

  if (entryIdx === undefined) {
    // First try exact time match
    const entryTime = normalizeTime(entryMarker.time);
    entryIdx = candleTimeMap.get(entryTime);


    // If not found, try matching by date only (for daily candles)
    if (entryIdx === undefined && entryMarker.date) {
      entryIdx = candleDateMap.get(entryMarker.date);

    }
  }

  if (exitIdx === undefined && exitMarker) {
    const exitTime = normalizeTime(exitMarker.time);
    exitIdx = candleTimeMap.get(exitTime);

    if (exitIdx === undefined && exitMarker.date) {
      exitIdx = candleDateMap.get(exitMarker.date);
    }
  }

  if (entryIdx === undefined) {
    return;
  }

  exitIdx = exitIdx ?? entryIdx;
  const selectedTrade = entryMarker.trade;

  // For multi-day trades (like 52W), use date range from entry to exit
  // For same-day trades (like ORB), use just the entry date
  const entryDate = entryMarker.date || normalizeTime(entryMarker.time).split("T")[0];
  const exitDate =
    exitMarker?.date || (exitMarker ? normalizeTime(exitMarker.time).split("T")[0] : entryDate);

  const totalCandles = chartData.candles.length;

  // Zoom to full day for the selected trade
  let startIdx = entryIdx;
  let endIdx = exitIdx;

  // Check if it's a same-day trade (ORB) or multi-day trade (52W)
  const isSameDay = entryDate === exitDate;

  if (isSameDay) {
    // Same-day trade: zoom to just that day
    const dayIndices = chartData.candles
      .map((c, idx) => ({ date: c.date, idx }))
      .filter((item) => item.date === entryDate)
      .map((item) => item.idx);

    if (dayIndices.length > 0) {
      startIdx = dayIndices[0];
      endIdx = dayIndices[dayIndices.length - 1];
    } else {
      const padding = 5;
      startIdx = Math.max(0, entryIdx - padding);
      endIdx = Math.min(totalCandles - 1, exitIdx + padding);
    }
  } else {
    // Multi-day trade: zoom to range from entry to exit
    const padding = 3;
    startIdx = Math.max(0, entryIdx - padding);
    endIdx = Math.min(totalCandles - 1, exitIdx + padding);
  }

  const startPercent = (startIdx / totalCandles) * 100;
  const endPercent = ((endIdx + 1) / totalCandles) * 100;


  // Apply zoom
  chart.dispatchAction({
    type: "dataZoom",
    dataZoomIndex: 0,
    start: startPercent,
    end: endPercent,
  });

  chart.dispatchAction({
    type: "dataZoom",
    dataZoomIndex: 1,
    start: startPercent,
    end: endPercent,
  });

  // Show highlighted markers for the selected trade
  if (selectedTrade && entryDate) {
    const levelHigh =
      (selectedTrade as any).or_high ??
      (selectedTrade as any).r1 ??
      (selectedTrade as any)["52w_high"];
    const levelLow = (selectedTrade as any).or_low ?? (selectedTrade as any).s1;

    // For multi-day trades, show 52W high line for entire trade range
    const level52wHigh = (selectedTrade as any)["52w_high"];
    const show52wLine = !isSameDay && level52wHigh;

    // Level high line: show on entry day
    const levelHighData = chartData.candles.map((c) => (c.date === entryDate ? levelHigh : null));

    // 52W high target line: show for entire trade range
    const level52wHighData = show52wLine
      ? chartData.candles.map((c, i) => {
          // Show from entry day to exit day
          return i >= entryIdx && i <= exitIdx ? level52wHigh : null;
        })
      : [];

    const levelLowData = chartData.candles.map((c) => (c.date === entryDate ? levelLow : null));

    const highlightEntryMarker = {
      value: [entryIdx, entryMarker.price],
      symbol: "triangle",
      symbolSize: 32,
      itemStyle: {
        color: CHART_AVG_ENTRY,
        borderColor: CHART_TRADE_EXIT,
        borderWidth: 4,
        shadowBlur: 10,
        shadowColor: CHART_AVG_ENTRY,
      },
      label: {
        show: true,
        position: "top",
        distance: 8,
        formatter: `▼ Entry #${tradeIndex + 1}`,
        color: CHART_AVG_ENTRY,
        fontSize: fontSizes.md,
        fontWeight: "bold",
        backgroundColor: CHART_DARK_DROPDOWN,
        padding: [4, 8],
        borderRadius: 4,
      },
    };

    const highlightExitMarker =
      exitMarker && exitIdx !== undefined
        ? {
            value: [exitIdx, exitMarker.price],
            symbol: "circle",
            symbolSize: 28,
            itemStyle: {
              color:
                (exitMarker.trade as any).exit_reason === "TP"
                  ? MARKER_TP
                  : (exitMarker.trade as any).exit_reason === "SL"
                    ? MARKER_SL
                    : MARKER_EOD,
              borderColor: MARKER_BORDER,
              borderWidth: 4,
              shadowBlur: 10,
              shadowColor:
                (exitMarker.trade as any).exit_reason === "TP"
                  ? MARKER_TP
                  : (exitMarker.trade as any).exit_reason === "SL"
                    ? MARKER_SL
                    : MARKER_EOD,
            },
            label: {
              show: true,
              position: "bottom",
              distance: 8,
              formatter: `● ${(exitMarker.trade as any).exit_reason || "Exit"}`,
              color: MARKER_BORDER,
              fontSize: fontSizes.md,
              fontWeight: "bold",
              backgroundColor: CHART_DARK_DROPDOWN,
              padding: [4, 8],
              borderRadius: 4,
            },
          }
        : null;

    chart.setOption({
      series: [
        ...(show52wLine && level52wHighData.length > 0
          ? [
              {
                id: "selected-52w-high",
                name: "52W High Target",
                type: "line",
                data: level52wHighData,
                showSymbol: false,
                connectNulls: false,
                silent: true,
                z: 6,
                markLine: {
                  symbol: "none",
                  label: {
                    show: true,
                    position: "end",
                    formatter: `52W High: ₹${level52wHigh}`,
                    color: CHART_AVG_ENTRY,
                    fontSize: fontSizes.sm,
                    fontWeight: "bold",
                    backgroundColor: CHART_DARK_DROPDOWN,
                    padding: [2, 6],
                    borderRadius: 3,
                  },
                  lineStyle: {
                    color: CHART_AVG_ENTRY,
                    width: 2,
                    type: "dashed",
                  },
                  data: [{ yAxis: level52wHigh }],
                  animation: false,
                },
              },
            ]
          : []),
        // Only show ORB/SR level lines for same-day trades (not 52W trades)
        ...(!show52wLine
          ? [
              {
                id: "selected-or-high",
                name: "Selected Level High",
                type: "line",
                data: levelHighData,
                showSymbol: false,
                connectNulls: false,
                silent: true,
                z: 6,
                lineStyle: { color: INDICATOR_BLUE_A, width: 2, type: "dashed" },
                tooltip: { show: false },
              },
              {
                id: "selected-or-low",
                name: "Selected Level Low",
                type: "line",
                data: levelLowData,
                showSymbol: false,
                connectNulls: false,
                silent: true,
                z: 6,
                lineStyle: { color: INDICATOR_BLUE_B, width: 2, type: "dashed" },
                tooltip: { show: false },
              },
            ]
          : []),
        {
          id: "highlight-entry",
          name: "Selected Entry",
          type: "scatter",
          data: [highlightEntryMarker],
          symbolSize: 32,
          z: 25,
          animation: true,
          animationDuration: 200,
        },
        ...(highlightExitMarker
          ? [
              {
                id: "highlight-exit",
                name: "Selected Exit",
                type: "scatter",
                data: [highlightExitMarker],
                symbolSize: 28,
                z: 25,
                animation: true,
                animationDuration: 200,
              },
            ]
          : []),
      ],
    });

    // Remove highlight after 5 seconds
    setTimeout(() => {
      chart.setOption({
        series: [
          { id: "highlight-entry", data: [] },
          { id: "highlight-exit", data: [] },
          { id: "trade-connect-line", data: [] },
        ],
      });
    }, 5000);
  }
}

export function BacktestChart({ symbol, chartData, isLoading, onTradeClick }: BacktestChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<any>(null);
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";

  useEffect(() => {
    if (!chartRef.current) {
      return;
    }

    if (!chartData) {
      return;
    }

    const echartsLib = (window as any).echarts;
    if (!echartsLib) {
      console.error("BacktestChart: ECharts not loaded");
      return;
    }

    if (chartInstance.current) {
      chartInstance.current.dispose();
    }

    chartInstance.current = echartsLib.init(chartRef.current, isDark ? "dark" : null);
    chartInstances.set(symbol, chartInstance.current);

    const option = buildChartOption(chartData, isDark);
    chartInstance.current.setOption(option);
    chartInstance.current.resize();

    if (onTradeClick) {
      chartInstance.current.on("click", (params: any) => {
        if (params.componentType === "series" && params.seriesType === "scatter") {
          const data = params.data;
          if (data && data.trade_id !== undefined) {
            // Convert 1-based trade_id to 0-based index
            onTradeClick(data.trade_id - 1);
          }
        }
      });
    }

    const handleResize = () => {
      chartInstance.current?.resize();
    };
    window.addEventListener("resize", handleResize);

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            chartInstance.current?.resize();
          })
        : null;

    resizeObserver?.observe(chartRef.current);

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
      chartInstance.current?.dispose();
      chartInstances.delete(symbol);
      chartInstance.current = null;
    };
  }, [chartData, onTradeClick, symbol, isDark]);

  if (isLoading) {
    return (
      <Center
        className="backtest-chart-loading"
        data-testid="backtest-chart-loading"
        h="100%"
        bg="var(--mantine-color-body)"
        styles={{ root: { borderRadius: "var(--mantine-radius-md)" } }}
      >
        <Loader size="sm" />
      </Center>
    );
  }

  if (!chartData) {
    return (
      <Center
        className="backtest-chart-empty"
        data-testid="backtest-chart-empty"
        h="100%"
        bg="var(--mantine-color-body)"
        styles={{ root: { borderRadius: "var(--mantine-radius-md)" } }}
      >
        <Text c="dimmed">No chart data for {symbol}</Text>
      </Center>
    );
  }

  return (
    <Box
      ref={chartRef}
      id={`backtest-chart-${symbol}`}
      className="backtest-chart"
      data-testid="echarts-container"
      data-symbol={symbol}
      style={{ width: "100%", height: "100%", minHeight: 0 }}
    />
  );
}
