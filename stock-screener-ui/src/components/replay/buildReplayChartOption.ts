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

function parseTimeToHHMM(isoTime: string): string {
  if (isoTime.includes("T")) return isoTime.split("T")[1].substring(0, 5);
  if (isoTime.includes(" ")) return isoTime.split(" ")[1].substring(0, 5);
  return isoTime.substring(0, 5);
}

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
  rawCandles?: ReplayCandle[],
  activeTF?: number,
): Record<string, unknown> {
  if (!candles || candles.length === 0) return {};

  const { bgColor, textColor, mutedColor, gridLineColor } = getChartThemeColors(isDark, theme);
  const tooltipBg = isDark ? "rgba(20, 20, 20, 0.95)" : "rgba(255, 255, 255, 0.95)";

  const times = candles.map((c) => {
    const parts = c.time.includes(" ") ? c.time.split(" ")[1] : c.time;
    return parts.substring(0, 5);
  });

  const ohlcData = candles.map((c) => [c.open, c.close, c.low, c.high]);
  const volumeData = candles.map((c, i) => [i, c.volume, c.close >= c.open ? 1 : -1]);

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

  function map1mIndex(index1m: number): number {
    if (!rawCandles || !rawCandles.length || activeTF === undefined || activeTF <= 1)
      return index1m;
    const clamped = Math.max(0, Math.min(index1m, rawCandles.length - 1));
    const timeStr = rawCandles[clamped].time;
    const hhmm = timeStr.includes(" ")
      ? timeStr.split(" ")[1].substring(0, 5)
      : timeStr.substring(0, 5);
    let best = -1;
    for (let i = 0; i < times.length; i++) {
      if (times[i] <= hhmm) best = i;
      else break;
    }
    return best >= 0 ? best : 0;
  }

  const showMarkers = true;
  const showAll = chartOptions?.show_all_trades === true;

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
    const entryIdx = findCandleIdx(parseTimeToHHMM(trade.entry_time));
    const exitIdx = findCandleIdx(parseTimeToHHMM(trade.exit_time));

    if (entryIdx !== undefined && showMarkers) {
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

    if (exitIdx !== undefined && showMarkers) {
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

  if (chartOptions?.show_orb_zones === true) {
    for (const or of orLevels) {
      buildOverlayLine(
        `OR High (${or.strategy})`,
        "#2196F3",
        or.or_high,
        map1mIndex(or.from_index),
        map1mIndex(or.to_index),
      );
      buildOverlayLine(
        `OR Low (${or.strategy})`,
        "#2196F3",
        or.or_low,
        map1mIndex(or.from_index),
        map1mIndex(or.to_index),
      );
    }
  }

  if (chartOptions?.show_pivot_levels === true) {
    for (const piv of pivotLevels) {
      buildOverlayLine(
        `R2 (${piv.strategy})`,
        "#EF5350",
        piv.r2,
        map1mIndex(piv.from_index),
        map1mIndex(piv.to_index),
        true,
      );
      buildOverlayLine(
        `R1 (${piv.strategy})`,
        "#EF5350",
        piv.r1,
        map1mIndex(piv.from_index),
        map1mIndex(piv.to_index),
      );
      buildOverlayLine(
        `PP (${piv.strategy})`,
        "#AB47BC",
        piv.pp,
        map1mIndex(piv.from_index),
        map1mIndex(piv.to_index),
      );
      buildOverlayLine(
        `S1 (${piv.strategy})`,
        "#26A69A",
        piv.s1,
        map1mIndex(piv.from_index),
        map1mIndex(piv.to_index),
      );
      buildOverlayLine(
        `S2 (${piv.strategy})`,
        "#26A69A",
        piv.s2,
        map1mIndex(piv.from_index),
        map1mIndex(piv.to_index),
        true,
      );
    }
  }

  if (chartOptions?.show_52w_high === true) {
    for (const h52 of high52wLevels) {
      buildOverlayLine(
        `52W High (${h52.strategy})`,
        "#E91E63",
        h52.high_52w,
        map1mIndex(h52.from_index),
        map1mIndex(h52.to_index),
      );
      if (h52.low_52w > 0) {
        buildOverlayLine(
          `52W Low (${h52.strategy})`,
          "#9C27B0",
          h52.low_52w,
          map1mIndex(h52.from_index),
          map1mIndex(h52.to_index),
          true,
        );
      }
    }
  }

  const showEma = chartOptions?.show_ema === true;

  const orbMarkAreaData: any[] = [];
  if (chartOptions?.show_orb_zones === true) {
    for (const or of orLevels) {
      orbMarkAreaData.push([
        {
          xAxis: times[0],
          yAxis: or.or_low,
          itemStyle: { color: "rgba(33,150,243,0.15)" },
        },
        { xAxis: times[Math.min(8, times.length - 1)], yAxis: or.or_high },
      ]);
    }
  }

  const series: any[] = [
    {
      name: "Candlestick",
      type: "candlestick",
      data: ohlcData,
      itemStyle: CANDLESTICK_ITEM_STYLE,
      z: 2,
      ...(orbMarkAreaData.length > 0 ? { markArea: { data: orbMarkAreaData } } : {}),
    },
    {
      name: "Volume",
      type: "bar",
      data: volumeData,
      xAxisIndex: 1,
      yAxisIndex: 1,
      itemStyle: {
        color: (params: any) =>
          params.data[2] === 1 ? "rgba(0,230,118,0.5)" : "rgba(255,23,68,0.5)",
      },
      z: 1,
    },
  ];

  if (showEma && emaData && emaData.ema_fast.length > 0 && emaData.ema_slow.length > 0) {
    const emaFast =
      emaData.ema_fast.length > candles.length
        ? emaData.ema_fast.slice(-candles.length)
        : emaData.ema_fast;
    const emaSlow =
      emaData.ema_slow.length > candles.length
        ? emaData.ema_slow.slice(-candles.length)
        : emaData.ema_slow;
    overlaySeries.push(
      {
        name: `EMA ${emaData.ema_fast_period}`,
        type: "line",
        data: emaFast,
        showSymbol: false,
        smooth: true,
        silent: true,
        z: 5,
        lineStyle: { color: "#10ac84", width: 1.5 },
        tooltip: { show: true },
      },
      {
        name: `EMA ${emaData.ema_slow_period}`,
        type: "line",
        data: emaSlow,
        showSymbol: false,
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
      data: ["Candlestick", "Entry", "SL", "TP", "EOD"],
      bottom: 10,
      textStyle: { color: mutedColor, fontSize: theme.fontSizes.xs },
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
