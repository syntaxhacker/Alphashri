import { useEffect, useRef, useCallback } from "react";
import { Box, Text, useMantineColorScheme } from "@mantine/core";
import type { SymbolChartData, ChartTrade } from "../../types/backtest";
import { theme } from "../../theme";

declare const echarts: any;

const chartInstances = new Map<string, any>();

function normalizeTime(time: string): string {
  if (!time) return "";

  // Handle date-only format (YYYY-MM-DD) - for daily candles
  if (/^\d{4}-\d{2}-\d{2}$/.test(time)) {
    return time;
  }

  // Strip timezone suffixes and return YYYY-MM-DDTHH:MM format
  return time
    .replace(/\+00:00$/, "")
    .replace(/\+05:30$/, "")
    .replace(/Z$/, "")
    .substring(0, 16);
}

interface BacktestChartProps {
  symbol: string;
  chartData: SymbolChartData | null | undefined;
  isLoading?: boolean;
  onTradeClick?: (tradeId: number) => void;
}

function buildChartOption(data: SymbolChartData, isDark: boolean): any {
  const { candles, orb_zones, pivot_levels, week52_levels, trades, visuals } = data;
  const fontSizes = theme.fontSizes;
  const fontFamily = theme.fontFamily;

  if (!candles || !trades) {
    console.warn("buildChartOption: Missing candles or trades data", data);
    return {};
  }

  const bgColor = isDark ? "#0a0a0a" : "#ffffff";
  const textColor = isDark ? "#e0e0e0" : "#333333";
  const mutedColor = isDark ? "#888" : "#666666";
  const borderColor = isDark ? "#333" : "#e0e0e0";
  const splitLineColor = isDark ? "#222" : "#eeeeee";
  const tooltipBg = isDark ? "rgba(20, 20, 20, 0.95)" : "rgba(255, 255, 255, 0.95)";
  const dataZoomBg = isDark ? "#111" : "#f5f5f5";

  console.log("buildChartOption for", data.symbol, {
    candleCount: candles.length,
    orbZoneCount: orb_zones?.length || 0,
    pivotLevelCount: pivot_levels?.length || 0,
    week52LevelCount: week52_levels?.length || 0,
    tradeCount: trades.length,
    overlayCount: visuals?.overlays?.length || 0,
  });

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

  const getExitReason = (t: ChartTrade) => (t.trade as any).exit_reason;

  // Entry markers - bright cyan
  const entryMarkers = trades
    .filter((t) => t.type === "entry")
    .map((t) => ({ ...t, computedIdx: getCandleIdx(t) }))
    .filter((t) => t.computedIdx !== undefined)
    .map((t) => ({
      value: [t.computedIdx!, t.price],
      itemStyle: { color: "#00FFFF", borderColor: "#FFFFFF", borderWidth: 2 },
      symbol: "triangle",
      symbolRotate: 180,
      symbolSize: 18,
      trade: t.trade,
      trade_id: t.trade_id,
    }));

  // TP markers - bright yellow
  const tpMarkers = trades
    .filter((t) => t.type === "exit" && getExitReason(t) === "TP")
    .map((t) => ({ ...t, computedIdx: getCandleIdx(t) }))
    .filter((t) => t.computedIdx !== undefined)
    .map((t) => ({
      value: [t.computedIdx!, t.price],
      itemStyle: { color: "#FFFF00", borderColor: "#FFFFFF", borderWidth: 2 },
      symbol: "circle",
      symbolSize: 16,
      trade: t.trade,
      trade_id: t.trade_id,
    }));

  // SL markers - magenta
  const slMarkers = trades
    .filter((t) => t.type === "exit" && getExitReason(t) === "SL")
    .map((t) => ({ ...t, computedIdx: getCandleIdx(t) }))
    .filter((t) => t.computedIdx !== undefined)
    .map((t) => ({
      value: [t.computedIdx!, t.price],
      itemStyle: { color: "#FF00FF", borderColor: "#FFFFFF", borderWidth: 2 },
      symbol: "circle",
      symbolSize: 16,
      trade: t.trade,
      trade_id: t.trade_id,
    }));

  // EOD markers - orange
  const eodMarkers = trades
    .filter((t) => t.type === "exit" && getExitReason(t) === "EOD")
    .map((t) => ({ ...t, computedIdx: getCandleIdx(t) }))
    .filter((t) => t.computedIdx !== undefined)
    .map((t) => ({
      value: [t.computedIdx!, t.price],
      itemStyle: { color: "#FFA500", borderColor: "#FFFFFF", borderWidth: 2 },
      symbol: "diamond",
      symbolSize: 16,
      trade: t.trade,
      trade_id: t.trade_id,
    }));

  // Trailing stop markers - purple
  const trailingMarkers = trades
    .filter((t) => t.type === "exit" && getExitReason(t) === "TRAILING_STOP")
    .map((t) => ({ ...t, computedIdx: getCandleIdx(t) }))
    .filter((t) => t.computedIdx !== undefined)
    .map((t) => ({
      value: [t.computedIdx!, t.price],
      itemStyle: { color: "#9C27B0", borderColor: "#FFFFFF", borderWidth: 2 },
      symbol: "circle",
      symbolSize: 16,
      trade: t.trade,
      trade_id: t.trade_id,
    }));

  // Max holding markers - orange
  const maxHoldMarkers = trades
    .filter((t) => t.type === "exit" && getExitReason(t) === "MAX_HOLDING")
    .map((t) => ({ ...t, computedIdx: getCandleIdx(t) }))
    .filter((t) => t.computedIdx !== undefined)
    .map((t) => ({
      value: [t.computedIdx!, t.price],
      itemStyle: { color: "#FF9800", borderColor: "#FFFFFF", borderWidth: 2 },
      symbol: "diamond",
      symbolSize: 16,
      trade: t.trade,
      trade_id: t.trade_id,
    }));

  // New 52W high markers - cyan
  const new52wMarkers = trades
    .filter((t) => t.type === "exit" && getExitReason(t) === "NEW_52W_HIGH")
    .map((t) => ({ ...t, computedIdx: getCandleIdx(t) }))
    .filter((t) => t.computedIdx !== undefined)
    .map((t) => ({
      value: [t.computedIdx!, t.price],
      itemStyle: { color: "#00BCD4", borderColor: "#FFFFFF", borderWidth: 2 },
      symbol: "circle",
      symbolSize: 16,
      trade: t.trade,
      trade_id: t.trade_id,
    }));

  const series: any[] = [
    {
      name: "Price",
      type: "candlestick",
      data: candleData,
      itemStyle: {
        color: "#00E676",
        color0: "#FF1744",
        borderColor: "#00E676",
        borderColor0: "#FF1744",
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
          lineStyle: { color: "#EF5350", width: 1, type: "dashed" },
        },
        {
          id: "pivot-pp",
          name: "PP",
          type: "line",
          data: ppData,
          showSymbol: false,
          silent: true,
          z: 5,
          lineStyle: { color: "#AB47BC", width: 1, type: "dotted" },
        },
        {
          id: "pivot-s1",
          name: "S1",
          type: "line",
          data: s1Data,
          showSymbol: false,
          silent: true,
          z: 5,
          lineStyle: { color: "#26A69A", width: 1, type: "dashed" },
        },
      );
      legendData.push("R1", "PP", "S1");
    }

    // Add ORB zones for ORB strategy
    if (orb_zones && orb_zones.length > 0) {
      const orHighData = candles.map((c) => {
        const zone = orb_zones.find((z) => z.date_raw === c.date);
        return zone ? zone.or_high : null;
      });
      const orLowData = candles.map((c) => {
        const zone = orb_zones.find((z) => z.date_raw === c.date);
        return zone ? zone.or_low : null;
      });

      series.push(
        {
          id: "or-high",
          name: "OR High",
          type: "line",
          data: orHighData,
          showSymbol: false,
          silent: true,
          z: 5,
          lineStyle: { color: "#42A5F5", width: 1, type: "dashed" },
        },
        {
          id: "or-low",
          name: "OR Low",
          type: "line",
          data: orLowData,
          showSymbol: false,
          silent: true,
          z: 5,
          lineStyle: { color: "#1E88E5", width: 1, type: "dashed" },
        },
      );
      legendData.push("OR High", "OR Low");
    }

    // Add 52W high levels for 52W Chaser strategy
    if (week52_levels && week52_levels.length > 0) {
      console.log("Adding 52W levels to chart:", week52_levels);
      const week52HighData = candles.map((c) => {
        const level = week52_levels.find((l) => l.date_raw === c.date);
        return level ? level["52w_high"] : null;
      });
      console.log(
        "52W high data for chart:",
        week52HighData.filter((v) => v !== null).length,
        "values",
      );

      series.push({
        id: "52w-high",
        name: "52W High",
        type: "line",
        data: week52HighData,
        showSymbol: false,
        silent: true,
        z: 5,
        lineStyle: { color: "#FFD700", width: 2, type: "dashed" },
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
      axisPointer: { type: "cross", lineStyle: { color: "#666" } },
      backgroundColor: tooltipBg,
      borderColor: borderColor,
      borderWidth: 1,
      textStyle: { color: textColor, fontSize: fontSizes.sm },
      formatter: function (params: any) {
        // Find if this is a trade marker
        for (const p of params) {
          if (p.data && p.data.trade) {
            const t = p.data.trade;
            const holdHours = Math.floor(t.hold_duration_minutes / 60);
            const holdMins = t.hold_duration_minutes % 60;
            const holdStr = holdHours > 0 ? `${holdHours}h ${holdMins}m` : `${holdMins}m`;
            const pnlColor = t.net_pnl >= 0 ? "#00E676" : "#FF1744";

            return `
              <div style="padding: 6px 8px; fontFamily: fontFamily; font-size: fontSizes.sm; line-height: 1.4;">
                <div style="color: #00BFFF; font-weight: bold; margin-bottom: 4px;">
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
                    Net: ₹${t.net_pnl.toFixed(0)} (${t.net_pnl_pct >= 0 ? "+" : ""}${t.net_pnl_pct.toFixed(1)}%)
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
          const changeColor = c.close >= c.open ? "#00E676" : "#FF1744";

          return `
            <div style="padding: 6px 8px; fontFamily: fontFamily; font-size: fontSizes.sm; line-height: 1.4;">
              <div style="font-weight: bold; margin-bottom: 4px;">${c.date} ${c.time_str}</div>
              <div style="display: flex; gap: 12px;">
                <span>O: ₹${c.open.toFixed(0)}</span>
                <span>H: ₹${c.high.toFixed(0)}</span>
                <span>L: ₹${c.low.toFixed(0)}</span>
                <span>C: ₹${c.close.toFixed(0)}</span>
              </div>
              <div style="display: flex; gap: 12px; color: #888;">
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

  const chart = chartInstances.get(symbol);
  if (!chart) {
    console.warn("Chart instance not found for", symbol);
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
    console.warn("Entry marker not found for trade", tradeIndex + 1);
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

  // Debug: Log sample candle times and dates
  console.log(
    "zoomToTrade: Sample candles:",
    chartData.candles.slice(0, 3).map((c) => ({
      time: c.time,
      normalized: normalizeTime(c.time),
      date: c.date,
      date_raw: c.date_raw,
    })),
  );
  console.log(
    "zoomToTrade: candleDateMap sample dates:",
    Array.from(candleDateMap.keys()).slice(0, 5),
  );
  console.log("zoomToTrade: entryMarker:", {
    time: entryMarker.time,
    normalized: normalizeTime(entryMarker.time),
    date: entryMarker.date,
    candle_idx: entryMarker.candle_idx,
  });

  // Find candle index - either from pre-computed candle_idx or by matching time
  let entryIdx = entryMarker.candle_idx;
  let exitIdx = exitMarker?.candle_idx;

  if (entryIdx === undefined) {
    // First try exact time match
    const entryTime = normalizeTime(entryMarker.time);
    entryIdx = candleTimeMap.get(entryTime);
    console.log("zoomToTrade: Looking for entryTime", entryTime, "found:", entryIdx);
    console.log(
      "zoomToTrade: candleTimeMap has",
      candleTimeMap.size,
      "entries, sample:",
      Array.from(candleTimeMap.entries()).slice(0, 3),
    );

    // If not found, try matching by date only (for daily candles)
    if (entryIdx === undefined && entryMarker.date) {
      entryIdx = candleDateMap.get(entryMarker.date);
      console.log("zoomToTrade: Looking for date", entryMarker.date, "found:", entryIdx);
      console.log(
        "zoomToTrade: candleDateMap has",
        candleDateMap.size,
        "entries, sample:",
        Array.from(candleDateMap.entries()).slice(0, 3),
      );
    }
  }

  if (exitIdx === undefined && exitMarker) {
    const exitTime = normalizeTime(exitMarker.time);
    exitIdx = candleTimeMap.get(exitTime);

    if (exitIdx === undefined && exitMarker.date) {
      exitIdx = candleDateMap.get(exitMarker.date);
    }
  }

  console.log(
    "zoomToTrade: tradeIndex",
    tradeIndex,
    "entryIdx",
    entryIdx,
    "exitIdx",
    exitIdx,
    "entryMarker.date",
    entryMarker.date,
  );

  if (entryIdx === undefined) {
    console.warn("Could not find candle index for trade", tradeIndex + 1);
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

  console.log(`Zooming to trade ${tradeIndex + 1}: candles ${startIdx} to ${endIdx}`);

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
        color: "#FFD700",
        borderColor: "#FF6B00",
        borderWidth: 4,
        shadowBlur: 10,
        shadowColor: "#FFD700",
      },
      label: {
        show: true,
        position: "top",
        distance: 8,
        formatter: `▼ Entry #${tradeIndex + 1}`,
        color: "#FFD700",
        fontSize: fontSizes.md,
        fontWeight: "bold",
        backgroundColor: "rgba(0,0,0,0.7)",
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
                  ? "#00E676"
                  : (exitMarker.trade as any).exit_reason === "SL"
                    ? "#FF1744"
                    : "#FFEA00",
              borderColor: "#FFFFFF",
              borderWidth: 4,
              shadowBlur: 10,
              shadowColor:
                (exitMarker.trade as any).exit_reason === "TP"
                  ? "#00E676"
                  : (exitMarker.trade as any).exit_reason === "SL"
                    ? "#FF1744"
                    : "#FFEA00",
            },
            label: {
              show: true,
              position: "bottom",
              distance: 8,
              formatter: `● ${(exitMarker.trade as any).exit_reason || "Exit"}`,
              color: "#FFFFFF",
              fontSize: fontSizes.md,
              fontWeight: "bold",
              backgroundColor: "rgba(0,0,0,0.7)",
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
                    color: "#FFD700",
                    fontSize: fontSizes.sm,
                    fontWeight: "bold",
                    backgroundColor: "rgba(0,0,0,0.7)",
                    padding: [2, 6],
                    borderRadius: 3,
                  },
                  lineStyle: {
                    color: "#FFD700",
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
                lineStyle: { color: "#42A5F5", width: 2, type: "dashed" },
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
                lineStyle: { color: "#1E88E5", width: 2, type: "dashed" },
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
      console.log("BacktestChart: No chartRef.current");
      return;
    }

    if (!chartData) {
      console.log("BacktestChart: No chartData");
      return;
    }

    const echartsLib = (window as any).echarts;
    if (!echartsLib) {
      console.error("BacktestChart: ECharts not loaded");
      return;
    }

    console.log("BacktestChart: Initializing chart for", symbol, {
      candles: chartData.candles?.length,
      trades: chartData.trades?.length,
      containerWidth: chartRef.current.offsetWidth,
      containerHeight: chartRef.current.offsetHeight,
    });

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
      <Box
        className="backtest-chart-loading"
        data-testid="backtest-chart-loading"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          backgroundColor: "var(--mantine-color-body)",
          borderRadius: "var(--mantine-radius-md)",
        }}
      >
        <Text c="dimmed">Loading {symbol}...</Text>
      </Box>
    );
  }

  if (!chartData) {
    return (
      <Box
        className="backtest-chart-empty"
        data-testid="backtest-chart-empty"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          backgroundColor: "var(--mantine-color-body)",
          borderRadius: "var(--mantine-radius-md)",
        }}
      >
        <Text c="dimmed">No chart data for {symbol}</Text>
      </Box>
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
