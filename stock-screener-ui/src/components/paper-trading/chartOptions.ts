import type {
  PaperChartData,
  CandleData,
  PaperTrade,
  PaperPosition,
} from "../../types/paperTrading";
import { theme } from "../../config/theme";

export const TIMEFRAME_OPTIONS = [
  { value: "1min", label: "1m" },
  { value: "5min", label: "5m" },
  { value: "15min", label: "15m" },
  { value: "1hour", label: "1H" },
  { value: "1day", label: "1D" },
];

function parseTimeToSeconds(str: string): number {
  const timePart = str.split("T")[1] || str;
  const parts = timePart.split(":");
  if (parts.length >= 2) {
    const secs = parts.length >= 3 ? parseInt(parts[2], 10) || 0 : 0;
    return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + secs;
  }
  return -1;
}

function getCandleIntervalSeconds(candles: CandleData[]): number {
  if (candles.length < 2) return 300;
  const t0 = parseTimeToSeconds(candles[0].time);
  const t1 = parseTimeToSeconds(candles[1].time);
  const diff = t1 - t0;
  return diff > 0 ? diff : 300;
}

function findCandleIndex(candles: CandleData[], timeStr: string): number {
  if (!timeStr || candles.length === 0) return -1;
  const targetSec = parseTimeToSeconds(timeStr);
  if (targetSec < 0) return -1;

  const interval = getCandleIntervalSeconds(candles);

  for (let i = 0; i < candles.length; i++) {
    const candleSec = parseTimeToSeconds(candles[i].time);
    if (candleSec === targetSec) return i;
  }

  let closestIdx = -1;
  let minDiff = Infinity;
  for (let i = 0; i < candles.length; i++) {
    const candleSec = parseTimeToSeconds(candles[i].time);
    const diff = Math.abs(candleSec - targetSec);
    if (diff < minDiff) {
      minDiff = diff;
      closestIdx = i;
    }
  }

  if (closestIdx >= 0 && minDiff <= interval) return closestIdx;

  return -1;
}

function formatVolume(vol: number): string {
  if (vol >= 1000000) return (vol / 1000000).toFixed(1) + "M";
  if (vol >= 1000) return (vol / 1000).toFixed(1) + "K";
  return vol.toString();
}

function pushTradeMarkers(
  trade: PaperTrade,
  candles: CandleData[],
  entryMarkers: any[],
  tpMarkers: any[],
  slMarkers: any[],
  eodMarkers: any[],
) {
  const entryIdx = findCandleIndex(candles, trade.entry_time);
  const exitIdx = findCandleIndex(candles, trade.exit_time);
  const isSameCandle = exitIdx === entryIdx && entryIdx >= 0;

  if (entryIdx >= 0) {
    entryMarkers.push({
      value: [entryIdx, trade.entry_price],
      itemStyle: { color: "#00FFFF", borderColor: "#FFFFFF", borderWidth: 2 },
      symbol: trade.side === "BUY" ? "triangle" : "triangleRotated",
      symbolSize: 18,
      symbolOffset: isSameCandle ? [0, -20] : [0, 0],
      trade,
    });
  }

  if (exitIdx >= 0) {
    const markerBase = {
      value: [exitIdx, trade.exit_price],
      symbol: "circle" as const,
      symbolSize: 16,
      symbolOffset: isSameCandle ? [0, 20] : [0, 0],
      trade,
    };

    if (trade.exit_reason === "TP") {
      tpMarkers.push({
        ...markerBase,
        itemStyle: { color: "#FFFF00", borderColor: "#FFFFFF", borderWidth: 2 },
      });
    } else if (trade.exit_reason === "SL") {
      slMarkers.push({
        ...markerBase,
        itemStyle: { color: "#FF00FF", borderColor: "#FFFFFF", borderWidth: 2 },
      });
    } else {
      eodMarkers.push({
        ...markerBase,
        symbol: "diamond" as const,
        itemStyle: { color: "#FFA500", borderColor: "#FFFFFF", borderWidth: 2 },
      });
    }
  }
}

function buildMarkers(
  candles: CandleData[],
  trades: PaperTrade[],
  current_position: PaperPosition | null,
  selectedTradeId: string | null,
  showAllTrades: boolean,
) {
  const entryMarkers: any[] = [];
  const tpMarkers: any[] = [];
  const slMarkers: any[] = [];
  const eodMarkers: any[] = [];

  const filteredTrades = showAllTrades
    ? trades
    : trades.filter((t: PaperTrade) => t.trade_id === selectedTradeId);

  for (const trade of filteredTrades) {
    pushTradeMarkers(trade, candles, entryMarkers, tpMarkers, slMarkers, eodMarkers);
  }

  if (current_position) {
    const idx = findCandleIndex(candles, current_position.entry_time);
    if (idx >= 0) {
      entryMarkers.push({
        value: [idx, current_position.entry_price],
        itemStyle: { color: "#00FFFF", borderColor: "#FFFFFF", borderWidth: 3 },
        symbol: current_position.side === "BUY" ? "triangle" : "triangleRotated",
        symbolSize: 22,
        trade: current_position,
        label: { show: true, formatter: "LIVE", position: "top" },
      });
    }
  }

  return { entryMarkers, tpMarkers, slMarkers, eodMarkers };
}

function buildMarkLines(
  current_position: PaperPosition | null,
  orb_levels: PaperChartData["orb_levels"],
  week52_levels: PaperChartData["week52_levels"],
  pivot_levels: PaperChartData["pivot_levels"],
  showOrb: boolean,
  showPivot: boolean,
  show52w: boolean,
): any[] {
  const lines: any[] = [];
  if (current_position) {
    lines.push({
      yAxis: current_position.stop_loss,
      lineStyle: { color: "#FF00FF", type: "dashed", width: 2 },
      label: { position: "insideEndTop", formatter: `SL ${current_position.stop_loss}` },
    });
    lines.push({
      yAxis: current_position.take_profit,
      lineStyle: { color: "#FFFF00", type: "dashed", width: 2 },
      label: { position: "insideEndTop", formatter: `TP ${current_position.take_profit}` },
    });
  }
  if (orb_levels && showOrb) {
    lines.push({
      yAxis: orb_levels.or_high,
      lineStyle: { color: "#2196F3", type: "dashed", width: 1 },
      label: { position: "insideEndTop", formatter: `OR-H ${orb_levels.or_high}` },
    });
    lines.push({
      yAxis: orb_levels.or_low,
      lineStyle: { color: "#2196F3", type: "dashed", width: 1 },
      label: { position: "insideEndTop", formatter: `OR-L ${orb_levels.or_low}` },
    });
  }
  if (pivot_levels && showPivot) {
    lines.push({
      yAxis: pivot_levels.r2,
      lineStyle: { color: "#EF5350", type: "dotted", width: 1 },
      label: { position: "insideEndTop", formatter: `R2 ${pivot_levels.r2}` },
    });
    lines.push({
      yAxis: pivot_levels.r1,
      lineStyle: { color: "#EF5350", type: "dashed", width: 1 },
      label: { position: "insideEndTop", formatter: `R1 ${pivot_levels.r1}` },
    });
    lines.push({
      yAxis: pivot_levels.pp,
      lineStyle: { color: "#AB47BC", type: "dotted", width: 1 },
      label: { position: "insideEndTop", formatter: `PP ${pivot_levels.pp}` },
    });
    lines.push({
      yAxis: pivot_levels.s1,
      lineStyle: { color: "#26A69A", type: "dashed", width: 1 },
      label: { position: "insideEndTop", formatter: `S1 ${pivot_levels.s1}` },
    });
    lines.push({
      yAxis: pivot_levels.s2,
      lineStyle: { color: "#26A69A", type: "dotted", width: 1 },
      label: { position: "insideEndTop", formatter: `S2 ${pivot_levels.s2}` },
    });
  }
  if (week52_levels && show52w) {
    lines.push({
      yAxis: week52_levels.high_52w,
      lineStyle: { color: "#E91E63", type: "dashed", width: 2 },
      label: { position: "insideEndTop", formatter: `52W-H ${week52_levels.high_52w}` },
    });
    if (week52_levels.low_52w > 0) {
      lines.push({
        yAxis: week52_levels.low_52w,
        lineStyle: { color: "#9C27B0", type: "dashed", width: 1 },
        label: { position: "insideEndTop", formatter: `52W-L ${week52_levels.low_52w}` },
      });
    }
  }
  return lines;
}

function buildTooltipFormatter(
  candles: CandleData[],
  textColor: string,
  mutedColor: string,
  fontSizes: any,
) {
  return function (params: any[]) {
    for (const p of params) {
      if (p.data && p.data.trade) {
        const t = p.data.trade;
        const isPosition = "order_id" in t;

        if (isPosition) {
          const pos = t as PaperPosition;
          const pnlColor = pos.pnl >= 0 ? "#00E676" : "#FF1744";
          return `<div style="padding:6px 8px;font-family:monospace;font-size:${fontSizes.sm};line-height:1.4"><div style="color:#00BFFF;font-weight:bold;margin-bottom:4px">LIVE POSITION | ${pos.side}</div><div style="display:flex;gap:12px;margin-bottom:2px"><span>Entry: <b>₹${pos.entry_price.toFixed(2)}</b></span><span>Current: <b>₹${pos.current_price.toFixed(2)}</b></span><span>Qty: ${pos.quantity}</span></div><div style="display:flex;gap:12px"><span style="color:#FF00FF;">SL: ₹${pos.stop_loss.toFixed(2)}</span><span style="color:#FFFF00;">TP: ₹${pos.take_profit.toFixed(2)}</span></div><div style="margin-top:4px"><span style="color:${pnlColor};font-weight:bold">P&L: ₹${pos.pnl.toFixed(0)} (${pos.pnl_pct >= 0 ? "+" : ""}${pos.pnl_pct.toFixed(2)}%)</span></div></div>`;
        } else {
          const trade = t as PaperTrade;
          const pnlColor = trade.net_pnl >= 0 ? "#00E676" : "#FF1744";
          const ft = (iso: string) => iso.split("T")[1]?.substring(0, 5) || iso;
          return `<div style="padding:6px 8px;font-family:monospace;font-size:${fontSizes.sm};line-height:1.4"><div style="color:#00BFFF;font-weight:bold;margin-bottom:4px">Trade | ${trade.side} | ${trade.exit_reason}</div><div style="color:#888;margin-bottom:4px;font-size:${fontSizes.sm}">${ft(trade.entry_time)} → ${ft(trade.exit_time)}</div><div style="display:flex;gap:12px;margin-bottom:2px"><span>Entry: <b>₹${trade.entry_price.toFixed(2)}</b></span><span>Exit: <b>₹${trade.exit_price.toFixed(2)}</b></span><span>Qty: ${trade.quantity}</span></div><div style="display:flex;gap:12px"><span style="color:${pnlColor};font-weight:bold">Net: ₹${trade.net_pnl.toFixed(0)} (${trade.pnl_pct >= 0 ? "+" : ""}${trade.pnl_pct.toFixed(2)}%)</span><span style="color:#888;">Cost: ₹${trade.costs.toFixed(0)}</span></div></div>`;
        }
      }
    }

    const candle = params.find((p: any) => p.seriesType === "candlestick");
    if (candle) {
      const idx = candle.dataIndex;
      const c = candles[idx];
      if (!c) return "";
      const change = (((c.close - c.open) / c.open) * 100).toFixed(2);
      const changeColor = c.close >= c.open ? "#00E676" : "#FF1744";
      const timeStr = c.time.split("T")[1]?.substring(0, 5) || c.time;
      return `<div style="padding:6px 8px;font-family:monospace;font-size:${fontSizes.sm};line-height:1.4"><div style="font-weight:bold;margin-bottom:4px">${timeStr}</div><div style="display:flex;gap:12px"><span>O: ₹${c.open.toFixed(2)}</span><span>H: ₹${c.high.toFixed(2)}</span><span>L: ₹${c.low.toFixed(2)}</span><span>C: ₹${c.close.toFixed(2)}</span></div><div style="display:flex;gap:12px;color:#888;"><span style="color:${changeColor};font-weight:bold">${c.close >= c.open ? "+" : ""}${change}%</span><span>Vol: ${formatVolume(c.volume)}</span></div></div>`;
    }
    return "";
  };
}

export function buildChartOption(
  data: PaperChartData,
  isDark: boolean,
  selectedTradeId: string | null = null,
  showAllTrades: boolean = false,
  showOrbLines: boolean = false,
  showPivotLines: boolean = false,
  show52wLines: boolean = false,
  showEmaLines: boolean = false,
): any {
  const { candles, trades, orb_levels, week52_levels, pivot_levels, current_position, ema_series } =
    data;
  const fontSizes = theme.fontSizes;

  if (!candles || candles.length === 0) return {};

  const bgColor = isDark ? theme.colors.dark[7] : theme.white;
  const textColor = isDark ? theme.white : theme.colors.gray[8];
  const mutedColor = isDark ? theme.colors.dark[1] : theme.colors.gray[6];
  const borderColor = isDark ? theme.colors.dark[4] : theme.colors.gray[3];
  const splitLineColor = isDark ? theme.colors.dark[5] : theme.colors.gray[2];
  const axisLineColor = isDark ? theme.colors.dark[4] : theme.colors.gray[3];
  const tooltipBg = isDark ? "rgba(26,27,30,0.96)" : "rgba(255,255,255,0.96)";

  const ohlcData = candles.map((c: CandleData) => [c.open, c.close, c.low, c.high]);
  const volumeData = candles.map((c: CandleData, i: number) => [
    i,
    c.volume,
    c.close >= c.open ? 1 : -1,
  ]);
  const times = candles.map((c: CandleData) => c.time.split("T")[1]?.substring(0, 5) || c.time);

  const { entryMarkers, tpMarkers, slMarkers, eodMarkers } = buildMarkers(
    candles,
    trades,
    current_position,
    selectedTradeId,
    showAllTrades,
  );
  const markLines = buildMarkLines(
    current_position,
    orb_levels,
    week52_levels,
    pivot_levels,
    showOrbLines,
    showPivotLines,
    show52wLines,
  );

  return {
    backgroundColor: bgColor,
    animation: false,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      backgroundColor: tooltipBg,
      borderColor,
      borderWidth: 1,
      textStyle: { color: textColor, fontSize: fontSizes.sm },
      formatter: buildTooltipFormatter(candles, textColor, mutedColor, fontSizes),
    },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    grid: [
      { left: "8%", right: "3%", top: "5%", height: "60%" },
      { left: "8%", right: "3%", top: "72%", height: "18%" },
    ],
    xAxis: [
      {
        type: "category",
        data: times,
        boundaryGap: true,
        axisLine: { lineStyle: { color: axisLineColor } },
        axisLabel: { color: mutedColor, fontSize: fontSizes.sm },
        splitLine: { show: false },
        min: "dataMin",
        max: "dataMax",
      },
      {
        type: "category",
        gridIndex: 1,
        data: times,
        boundaryGap: true,
        axisLine: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
        min: "dataMin",
        max: "dataMax",
      },
    ],
    yAxis: [
      {
        scale: true,
        axisLine: { lineStyle: { color: axisLineColor } },
        axisLabel: { color: mutedColor, fontSize: fontSizes.sm },
        splitLine: { lineStyle: { color: splitLineColor } },
      },
      {
        scale: true,
        gridIndex: 1,
        axisLine: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
      },
    ],
    dataZoom: [{ type: "inside", xAxisIndex: [0, 1], start: 0, end: 100 }],
    series: [
      {
        name: "Price",
        type: "candlestick",
        data: ohlcData,
        itemStyle: {
          color: "#00E676",
          color0: "#FF1744",
          borderColor: "#00E676",
          borderColor0: "#FF1744",
        },
        markLine:
          markLines.length > 0
            ? {
                symbol: ["none", "none"],
                data: markLines,
                label: { color: "inherit", fontSize: 11, formatter: "{b}" },
              }
            : undefined,
        markArea:
          orb_levels && showOrbLines
            ? {
                data: [
                  [
                    {
                      xAxis: times[0],
                      yAxis: orb_levels.or_low,
                      itemStyle: { color: "rgba(33,150,243,0.15)" },
                    },
                    { xAxis: times[Math.min(8, times.length - 1)], yAxis: orb_levels.or_high },
                  ],
                ],
              }
            : undefined,
      },
      ...(showEmaLines && ema_series
        ? [
            {
              name: ema_series.ema_fast.label,
              type: "line",
              data: ema_series.ema_fast.data,
              showSymbol: false,
              z: 5,
              smooth: true,
              lineStyle: { color: ema_series.ema_fast.color, width: 1.5 },
            },
            {
              name: ema_series.ema_slow.label,
              type: "line",
              data: ema_series.ema_slow.data,
              showSymbol: false,
              z: 5,
              smooth: true,
              lineStyle: { color: ema_series.ema_slow.color, width: 1.5 },
            },
          ]
        : []),
      { name: "Entry", type: "scatter", data: entryMarkers, symbolSize: 18, z: 10 },
      { name: "TP Exit", type: "scatter", data: tpMarkers, symbolSize: 16, z: 10 },
      { name: "SL Exit", type: "scatter", data: slMarkers, symbolSize: 16, z: 10 },
      { name: "Other Exit", type: "scatter", data: eodMarkers, symbolSize: 16, z: 10 },
      {
        type: "bar",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumeData,
        itemStyle: {
          color: (params: any) =>
            params.data[2] === 1 ? "rgba(0,230,118,0.5)" : "rgba(255,23,68,0.5)",
        },
      },
    ],
  };
}
