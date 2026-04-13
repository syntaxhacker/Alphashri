import { CANDLESTICK_ITEM_STYLE, getChartThemeColors } from "../../utils/chartUtils";
import { theme } from "../../config/theme";
import type {
  ReplayCandle,
  ReplayTrade,
  ReplayORLevels,
  ReplayPivotLevels,
  Replay52WLevel,
  ReplayChartOptions,
} from "../../types/replay";

interface EMAData {
  ema_fast_period: number;
  ema_slow_period: number;
  ema_fast: number[];
  ema_slow: number[];
}

export function buildReplayChartOption(
  candles: ReplayCandle[],
  trades: ReplayTrade[],
  orLevels: ReplayORLevels[],
  pivotLevels: ReplayPivotLevels[],
  high52wLevels: Replay52WLevel[],
  emaData: EMAData | null,
  isDark: boolean,
  chartOptions?: ReplayChartOptions,
  highlightedTradeId?: number | null,
): Record<string, unknown> {
  if (!candles || candles.length === 0) return {};

  const { bgColor, textColor, mutedColor, gridLineColor } = getChartThemeColors(isDark, theme);
  const tooltipBg = isDark ? "rgba(20, 20, 20, 0.95)" : "rgba(255, 255, 255, 0.95)";

  const times = candles.map((c) => {
    const parts = c.time.includes(" ") ? c.time.split(" ")[1] : c.time;
    return parts.substring(0, 5);
  });

  const ohlcData = candles.map((c) => [c.open, c.close, c.low, c.high]);
  const volumeData = candles.map((c) => c.volume);

  const timeToIndex = new Map<string, number>();
  const sortedTimes: string[] = [];
  candles.forEach((c, i) => {
    const parts = c.time.includes(" ") ? c.time.split(" ")[1] : c.time;
    const key = parts.substring(0, 5);
    if (!timeToIndex.has(key)) {
      timeToIndex.set(key, i);
      sortedTimes.push(key);
    }
  });

  function findCandleIdx(timeHHMM: string): number | undefined {
    const exact = timeToIndex.get(timeHHMM);
    if (exact !== undefined) return exact;
    let best = -1;
    for (let i = 0; i < sortedTimes.length; i++) {
      if (sortedTimes[i] <= timeHHMM) {
        best = i;
      } else {
        break;
      }
    }
    if (best >= 0) return timeToIndex.get(sortedTimes[best]);
    return sortedTimes.length > 0 ? 0 : undefined;
  }

  const showEntry = chartOptions?.show_entry_markers !== false;
  const showExit = chartOptions?.show_exit_markers !== false;
  const showAll = chartOptions?.show_all_trades !== false;

  // Filter trades based on options
  const displayedTrades = showAll
    ? trades
    : trades.filter((t) => highlightedTradeId && t.id === highlightedTradeId);

  const entryMarkers: any[] = [];
  const slMarkers: any[] = [];
  const tpMarkers: any[] = [];
  const eodMarkers: any[] = [];
  const forceMarkers: any[] = [];

  for (const trade of displayedTrades) {
    const entryTime = trade.entry_time.includes(" ")
      ? trade.entry_time.split(" ")[1]
      : trade.entry_time;
    const exitTime = trade.exit_time.includes(" ")
      ? trade.exit_time.split(" ")[1]
      : trade.exit_time;
    const entryIdx = findCandleIdx(entryTime.substring(0, 5));
    const exitIdx = findCandleIdx(exitTime.substring(0, 5));

    if (entryIdx !== undefined && showEntry) {
      const isHighlighted = highlightedTradeId != null && trade.id === highlightedTradeId;
      entryMarkers.push({
        value: [entryIdx, trade.entry_price],
        itemStyle: {
          color: isHighlighted ? "#FFD700" : "#00FFFF",
          borderColor: "#FFFFFF",
          borderWidth: isHighlighted ? 3 : 2,
        },
        symbol: "triangle",
        symbolSize: isHighlighted ? 26 : 18,
        symbolRotate: 180,
        trade,
        tradeId: trade.id,
        ...(isHighlighted
          ? {
              label: {
                show: true,
                formatter: `#${trade.id}`,
                position: "top",
                color: "#FFD700",
                fontWeight: "bold",
                fontSize: 12,
              },
            }
          : {}),
      });
    }

    if (exitIdx !== undefined && showExit) {
      const isHighlighted = highlightedTradeId != null && trade.id === highlightedTradeId;
      const exitMarker: any = {
        value: [exitIdx, trade.exit_price],
        symbol: "circle",
        symbolSize: isHighlighted ? 22 : 16,
        trade,
        ...(isHighlighted
          ? {
              label: {
                show: true,
                formatter: trade.exit_reason,
                position: "bottom",
                color: "#FFD700",
                fontWeight: "bold",
                fontSize: 11,
              },
            }
          : {}),
      };

      switch (trade.exit_reason) {
        case "TP":
          exitMarker.itemStyle = {
            color: isHighlighted ? "#FFD700" : "#FFFF00",
            borderColor: "#FFFFFF",
            borderWidth: isHighlighted ? 3 : 2,
          };
          tpMarkers.push(exitMarker);
          break;
        case "SL":
          exitMarker.itemStyle = {
            color: isHighlighted ? "#FFD700" : "#FF00FF",
            borderColor: "#FFFFFF",
            borderWidth: isHighlighted ? 3 : 2,
          };
          slMarkers.push(exitMarker);
          break;
        case "EOD":
          exitMarker.symbol = "diamond";
          exitMarker.itemStyle = {
            color: isHighlighted ? "#FFD700" : "#FFA500",
            borderColor: "#FFFFFF",
            borderWidth: isHighlighted ? 3 : 2,
          };
          eodMarkers.push(exitMarker);
          break;
        default:
          exitMarker.itemStyle = {
            color: isHighlighted ? "#FFD700" : "#FF1744",
            borderColor: "#FFFFFF",
            borderWidth: isHighlighted ? 3 : 2,
          };
          forceMarkers.push(exitMarker);
          break;
      }
    }
  }

  const overlaySeries: any[] = [];

  function buildOverlayLine(
    label: string,
    color: string,
    value: number,
    entryIdx: number,
    exitIdx: number,
    dotted?: boolean,
  ) {
    const data = Array.from<null>({ length: candles.length }).fill(null);
    for (let i = entryIdx; i <= Math.min(exitIdx, candles.length - 1); i++) {
      data[i] = value;
    }
    overlaySeries.push({
      name: label,
      type: "line",
      data,
      showSymbol: false,
      connectNulls: false,
      silent: true,
      z: 4,
      lineStyle: { color, width: 1, type: dotted ? [2, 2] : [6, 3] },
      tooltip: { show: true },
      label: {
        show: true,
        position: "end",
        formatter: `${value}`,
        fontSize: 10,
        color,
        fontFamily: "monospace",
      },
      endLabel: {
        show: true,
        formatter: label,
        fontSize: 9,
        color,
        fontFamily: "monospace",
      },
    });
  }

  function getTradeTimeRange(strategy: string): [number, number] | null {
    const stratTrades = displayedTrades.filter((t) => t.strategy === strategy);
    if (stratTrades.length === 0) return null;
    let minEntry = Infinity;
    let maxExit = -Infinity;
    for (const t of stratTrades) {
      const et = t.entry_time.includes(" ") ? t.entry_time.split(" ")[1] : t.entry_time;
      const xt = t.exit_time.includes(" ") ? t.exit_time.split(" ")[1] : t.exit_time;
      const ei = findCandleIdx(et.substring(0, 5));
      const xi = findCandleIdx(xt.substring(0, 5));
      if (ei !== undefined && ei < minEntry) minEntry = ei;
      if (xi !== undefined && xi > maxExit) maxExit = xi;
    }
    if (minEntry === Infinity) return null;
    return [minEntry, maxExit === -Infinity ? minEntry : maxExit];
  }

  if (chartOptions?.show_orb_zones !== false) {
    for (const or of orLevels) {
      const range = getTradeTimeRange(or.strategy);
      if (!range) continue;
      buildOverlayLine(`OR High (${or.strategy})`, "#2196F3", or.or_high, 0, range[1]);
      buildOverlayLine(`OR Low (${or.strategy})`, "#2196F3", or.or_low, 0, range[1]);
    }
  }

  if (chartOptions?.show_pivot_levels !== false) {
    for (const piv of pivotLevels) {
      const range = getTradeTimeRange(piv.strategy);
      if (!range) continue;
      buildOverlayLine(`R2 (${piv.strategy})`, "#EF5350", piv.r2, 0, range[1], true);
      buildOverlayLine(`R1 (${piv.strategy})`, "#EF5350", piv.r1, 0, range[1]);
      buildOverlayLine(`PP (${piv.strategy})`, "#AB47BC", piv.pp, 0, range[1], true);
      buildOverlayLine(`S1 (${piv.strategy})`, "#26A69A", piv.s1, 0, range[1]);
      buildOverlayLine(`S2 (${piv.strategy})`, "#26A69A", piv.s2, 0, range[1], true);
    }
  }

  if (chartOptions?.show_52w_high !== false) {
    for (const h52 of high52wLevels) {
      const range = getTradeTimeRange(h52.strategy);
      if (!range) continue;
      buildOverlayLine(`52W High (${h52.strategy})`, "#E91E63", h52.high_52w, 0, range[1]);
    }
  }

  const showEma = chartOptions?.show_ema !== false;
  const tradeStrategiesSet = new Set(displayedTrades.map((t) => t.strategy));

  const series: any[] = [
    {
      name: "Candlestick",
      type: "candlestick",
      data: ohlcData,
      itemStyle: CANDLESTICK_ITEM_STYLE,
      z: 2,
    },
    {
      name: "Volume",
      type: "bar",
      data: volumeData,
      xAxisIndex: 1,
      yAxisIndex: 1,
      itemStyle: { color: "rgba(100,100,100,0.3)" },
      z: 1,
    },
  ];

  if (
    showEma &&
    emaData &&
    emaData.ema_fast.length > 0 &&
    emaData.ema_slow.length > 0 &&
    tradeStrategiesSet.has("EMA Cross")
  ) {
    const candleLen = candles.length;
    const makeData = (arr: number[]) =>
      arr.length >= candleLen
        ? arr.slice(0, candleLen)
        : [...arr, ...Array(candleLen - arr.length).fill(null)];
    overlaySeries.push(
      {
        name: `EMA ${emaData.ema_fast_period}`,
        type: "line",
        data: makeData(emaData.ema_fast),
        showSymbol: false,
        connectNulls: true,
        smooth: true,
        silent: true,
        z: 5,
        lineStyle: { color: "#10ac84", width: 1.5 },
        tooltip: { show: true },
      },
      {
        name: `EMA ${emaData.ema_slow_period}`,
        type: "line",
        data: makeData(emaData.ema_slow),
        showSymbol: false,
        connectNulls: true,
        smooth: true,
        silent: true,
        z: 5,
        lineStyle: { color: "#ee5253", width: 1.5 },
        tooltip: { show: true },
      },
    );
  }

  if (entryMarkers.length > 0)
    series.push({ name: "Entry", type: "scatter", data: entryMarkers, z: 10 });
  if (slMarkers.length > 0) series.push({ name: "SL", type: "scatter", data: slMarkers, z: 10 });
  if (tpMarkers.length > 0) series.push({ name: "TP", type: "scatter", data: tpMarkers, z: 10 });
  if (eodMarkers.length > 0) series.push({ name: "EOD", type: "scatter", data: eodMarkers, z: 10 });
  if (forceMarkers.length > 0)
    series.push({ name: "Force", type: "scatter", data: forceMarkers, z: 10 });
  for (const os of overlaySeries) series.push(os);

  return {
    backgroundColor: bgColor,
    animation: false,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      backgroundColor: tooltipBg,
      textStyle: { color: textColor, fontSize: theme.fontSizes.sm },
      formatter: (params: any) => {
        if (!params || !params.length) return "";
        for (const p of params) {
          if (p.data?.trade) {
            const t = p.data.trade;
            const pnlColor = t.net_pnl >= 0 ? "#00E676" : "#FF1744";
            return `<div style="padding:6px 8px;font-family:monospace;font-size:${theme.fontSizes.sm};line-height:1.4"><div style="color:#00BFFF;font-weight:bold;margin-bottom:4px">Trade #${t.id} | ${t.symbol} | ${t.exit_reason}</div><div style="display:flex;gap:12px;margin-bottom:2px"><span>Entry: <b>₹${t.entry_price.toFixed(2)}</b></span><span>Exit: <b>₹${t.exit_price.toFixed(2)}</b></span><span>Qty: ${t.quantity}</span></div><div style="display:flex;gap:12px"><span style="color:${pnlColor};font-weight:bold">Net: ₹${t.net_pnl.toFixed(0)} (${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}%)</span><span style="color:#888">Cost: ₹${t.costs.toFixed(0)}</span></div></div>`;
          }
        }
        const candle = params.find((p: any) => p.seriesType === "candlestick");
        if (candle) {
          const idx = candle.dataIndex;
          const c = candles[idx];
          if (!c) return "";
          const change = (((c.close - c.open) / c.open) * 100).toFixed(2);
          const changeColor = c.close >= c.open ? "#00E676" : "#FF1744";
          return `<div style="padding:6px 8px;font-family:monospace;font-size:${theme.fontSizes.sm};line-height:1.4"><div style="font-weight:bold;margin-bottom:4px">${times[idx]}</div><div style="display:flex;gap:12px"><span>O: ₹${c.open.toFixed(2)}</span><span>H: ₹${c.high.toFixed(2)}</span><span>L: ₹${c.low.toFixed(2)}</span><span>C: ₹${c.close.toFixed(2)}</span></div><div style="display:flex;gap:12px;color:#888"><span style="color:${changeColor};font-weight:bold">${c.close >= c.open ? "+" : ""}${change}%</span><span>Vol: ${c.volume?.toLocaleString() ?? "-"}</span></div></div>`;
        }
        return "";
      },
    },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    legend: {
      data: series.filter((s) => s.data?.length > 0).map((s) => s.name),
      top: 0,
      itemWidth: 14,
      itemHeight: 8,
      itemGap: 8,
      textStyle: { color: mutedColor, fontSize: theme.fontSizes.xs },
      type: "scroll",
    },
    grid: [
      { left: "8%", right: "3%", top: "5%", height: "60%" },
      { left: "8%", right: "3%", top: "72%", height: "18%" },
    ],
    xAxis: [
      {
        type: "category",
        data: times,
        boundaryGap: true,
        axisLabel: { fontSize: 10, color: mutedColor },
        splitLine: { show: false },
        min: "dataMin",
        max: "dataMax",
      },
      {
        type: "category",
        gridIndex: 1,
        data: times,
        boundaryGap: true,
        axisLabel: { show: false },
        splitLine: { show: false },
        min: "dataMin",
        max: "dataMax",
      },
    ],
    yAxis: [
      {
        scale: true,
        splitLine: { lineStyle: { color: gridLineColor } },
        axisLabel: { color: mutedColor, fontSize: 10 },
      },
      {
        scale: true,
        gridIndex: 1,
        splitNumber: 2,
        axisLabel: { show: false },
        splitLine: { show: false },
      },
    ],
    dataZoom: [{ type: "inside", xAxisIndex: [0, 1], start: 0, end: 100 }],
    series,
  };
}
