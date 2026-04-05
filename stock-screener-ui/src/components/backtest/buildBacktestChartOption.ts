import type { SymbolChartData, ChartTrade } from "../../types/backtest";
import { theme } from "../../config/theme";
import { formatPercentage, normalizeTime } from "../../utils/ui-helpers";
import { getChartThemeColors, CANDLESTICK_ITEM_STYLE } from "../../utils/chartUtils";
import { buildPivotSeries } from "../../utils/chartLineBuilders";

interface MarkerConfig {
  filter: (t: ChartTrade) => boolean;
  color: string;
  symbol: string;
  symbolSize: number;
  symbolRotate?: number;
}

export function buildChartOption(data: SymbolChartData, isDark: boolean): any {
  const { candles, pivot_levels, week52_levels, trades, visuals } = data;
  const fontSizes = theme.fontSizes;

  if (!candles || !trades) {
    return {};
  }

  const { bgColor, textColor, mutedColor, borderColor, gridLineColor } = getChartThemeColors(
    isDark,
    theme,
  );
  const tooltipBg = isDark ? "rgba(20, 20, 20, 0.95)" : "rgba(255, 255, 255, 0.95)";

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

  const buildMarkers = (trades: ChartTrade[], config: MarkerConfig) =>
    trades
      .filter(config.filter)
      .map((t) => ({ ...t, computedIdx: getCandleIdx(t) }))
      .filter((t) => t.computedIdx !== undefined)
      .map((t) => ({
        value: [t.computedIdx!, t.price],
        itemStyle: { color: config.color, borderColor: "#FFFFFF", borderWidth: 2 },
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
      color: "#00FFFF",
      symbol: "triangle",
      symbolSize: 18,
      symbolRotate: 180,
    },
    {
      filter: (t) => t.type === "exit" && exitReason(t) === "TP",
      color: "#FFFF00",
      symbol: "circle",
      symbolSize: 16,
    },
    {
      filter: (t) => t.type === "exit" && exitReason(t) === "SL",
      color: "#FF00FF",
      symbol: "circle",
      symbolSize: 16,
    },
    {
      filter: (t) => t.type === "exit" && exitReason(t) === "EOD",
      color: "#FFA500",
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
      color: "#FF9800",
      symbol: "diamond",
      symbolSize: 16,
    },
    {
      filter: (t) => t.type === "exit" && exitReason(t) === "NEW_52W_HIGH",
      color: "#00BCD4",
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
      itemStyle: CANDLESTICK_ITEM_STYLE,
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

  if (!visuals?.overlays) {
    const pivotSeries = buildPivotSeries(candles, pivot_levels || []);
    if (pivotSeries.length > 0) {
      series.push(...pivotSeries);
      legendData.push("R1", "PP", "S1");
    }

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
        for (const p of params) {
          if (p.data && p.data.trade) {
            const t = p.data.trade;
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
                    Net: ₹${t.net_pnl.toFixed(0)} (${formatPercentage(t.net_pnl_pct, 1, true)})
                  </span>
                </div>
              </div>
            `;
          }
        }

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
      splitLine: { lineStyle: { color: gridLineColor } },
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
