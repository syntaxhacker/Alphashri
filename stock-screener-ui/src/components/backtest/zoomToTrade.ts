import type { SymbolChartData } from "../../types/backtest";
import { theme } from "../../config/theme";
import { normalizeTime } from "../../utils/ui-helpers";

export const chartInstances = new Map<string, any>();

function resolveMarkerIndices(
  entryMarker: any,
  exitMarker: any,
  candleTimeMap: Map<string, number>,
  candleDateMap: Map<string, number>,
) {
  let entryIdx = entryMarker.candle_idx;
  let exitIdx = exitMarker?.candle_idx;

  if (entryIdx === undefined) {
    const entryTime = normalizeTime(entryMarker.time);
    entryIdx = candleTimeMap.get(entryTime);
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

  return { entryIdx, exitIdx };
}

function computeAndApplyZoom(
  chart: any,
  entryIdx: number,
  exitIdx: number,
  entryDate: string,
  exitDate: string,
  candles: any[],
) {
  const totalCandles = candles.length;
  const isSameDay = entryDate === exitDate;
  let startIdx = entryIdx;
  let endIdx = exitIdx;

  if (isSameDay) {
    const dayIndices = candles
      .map((c, idx) => ({ date: c.date, idx }))
      .filter((item) => item.date === entryDate)
      .map((item) => item.idx);

    if (dayIndices.length > 0) {
      startIdx = dayIndices[0];
      endIdx = dayIndices[dayIndices.length - 1];
    } else {
      startIdx = Math.max(0, entryIdx - 5);
      endIdx = Math.min(totalCandles - 1, exitIdx + 5);
    }
  } else {
    startIdx = Math.max(0, entryIdx - 3);
    endIdx = Math.min(totalCandles - 1, exitIdx + 3);
  }

  const startPercent = (startIdx / totalCandles) * 100;
  const endPercent = ((endIdx + 1) / totalCandles) * 100;

  for (const i of [0, 1]) {
    chart.dispatchAction({
      type: "dataZoom",
      dataZoomIndex: i,
      start: startPercent,
      end: endPercent,
    });
  }
}

function buildHighlightEntryMarker(
  entryMarker: any,
  entryIdx: number,
  tradeIndex: number,
  fontSizes: any,
) {
  return {
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
}

function buildHighlightExitMarker(exitMarker: any, exitIdx: number, fontSizes: any) {
  if (!exitMarker || exitIdx === undefined) return null;

  const exitReason = (exitMarker.trade as any).exit_reason;
  const color = exitReason === "TP" ? "#00E676" : exitReason === "SL" ? "#FF1744" : "#FFEA00";

  return {
    value: [exitIdx, exitMarker.price],
    symbol: "circle",
    symbolSize: 28,
    itemStyle: {
      color,
      borderColor: "#FFFFFF",
      borderWidth: 4,
      shadowBlur: 10,
      shadowColor: color,
    },
    label: {
      show: true,
      position: "bottom",
      distance: 8,
      formatter: `● ${exitReason || "Exit"}`,
      color: "#FFFFFF",
      fontSize: fontSizes.md,
      fontWeight: "bold",
      backgroundColor: "rgba(0,0,0,0.7)",
      padding: [4, 8],
      borderRadius: 4,
    },
  };
}

function build52wHighSeries(level52wHighData: any[], level52wHigh: any, fontSizes: any) {
  return {
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
      lineStyle: { color: "#FFD700", width: 2, type: "dashed" },
      data: [{ yAxis: level52wHigh }],
      animation: false,
    },
  };
}

function buildLevelSeries(
  show52wLine: boolean,
  level52wHighData: any[],
  level52wHigh: any,
  levelHighData: any[],
  levelLowData: any[],
  fontSizes: any,
) {
  if (show52wLine && level52wHighData.length > 0) {
    return [build52wHighSeries(level52wHighData, level52wHigh, fontSizes)];
  }

  return [
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
  ];
}

function applyHighlightSeries(
  chart: any,
  levelLines: any[],
  highlightEntry: any,
  highlightExit: any,
) {
  chart.setOption({
    series: [
      ...levelLines,
      {
        id: "highlight-entry",
        name: "Selected Entry",
        type: "scatter",
        data: [highlightEntry],
        symbolSize: 32,
        z: 25,
        animation: true,
        animationDuration: 200,
      },
      ...(highlightExit
        ? [
            {
              id: "highlight-exit",
              name: "Selected Exit",
              type: "scatter",
              data: [highlightExit],
              symbolSize: 28,
              z: 25,
              animation: true,
              animationDuration: 200,
            },
          ]
        : []),
    ],
  });

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

export function zoomToTrade(
  symbol: string,
  tradeIndex: number,
  chartData: SymbolChartData | undefined,
) {
  if (!chartData) return;

  const fontSizes = theme.fontSizes;
  const chart = chartInstances.get(symbol);
  if (!chart) return;

  const entryMarker = chartData.trades.find(
    (t) => t.type === "entry" && t.trade_id === tradeIndex + 1,
  );
  const exitMarker = chartData.trades.find(
    (t) => t.type === "exit" && t.trade_id === tradeIndex + 1,
  );
  if (!entryMarker) return;

  const candleTimeMap = new Map(chartData.candles.map((c, i) => [normalizeTime(c.time), i]));
  const candleDateMap = new Map<string, number>();
  chartData.candles.forEach((c, i) => {
    if (c.date) candleDateMap.set(c.date, i);
    if (c.date_raw) candleDateMap.set(c.date_raw!, i);
  });

  const { entryIdx, exitIdx } = resolveMarkerIndices(
    entryMarker,
    exitMarker,
    candleTimeMap,
    candleDateMap,
  );
  if (entryIdx === undefined) return;

  const resolvedExitIdx = exitIdx ?? entryIdx;
  const selectedTrade = entryMarker.trade;
  const entryDate = entryMarker.date || normalizeTime(entryMarker.time).split("T")[0];
  const exitDate =
    exitMarker?.date || (exitMarker ? normalizeTime(exitMarker.time).split("T")[0] : entryDate);

  computeAndApplyZoom(chart, entryIdx, resolvedExitIdx, entryDate, exitDate, chartData.candles);

  if (selectedTrade && entryDate) {
    const levelHigh =
      (selectedTrade as any).or_high ??
      (selectedTrade as any).r1 ??
      (selectedTrade as any)["52w_high"];
    const levelLow = (selectedTrade as any).or_low ?? (selectedTrade as any).s1;
    const level52wHigh = (selectedTrade as any)["52w_high"];
    const show52wLine = entryDate !== exitDate && level52wHigh;

    const levelHighData = chartData.candles.map((c) => (c.date === entryDate ? levelHigh : null));
    const level52wHighData = show52wLine
      ? chartData.candles.map((c, i) =>
          i >= entryIdx && i <= resolvedExitIdx ? level52wHigh : null,
        )
      : [];
    const levelLowData = chartData.candles.map((c) => (c.date === entryDate ? levelLow : null));

    const highlightEntry = buildHighlightEntryMarker(entryMarker, entryIdx, tradeIndex, fontSizes);
    const highlightExit = buildHighlightExitMarker(exitMarker, resolvedExitIdx, fontSizes);
    const levelLines = buildLevelSeries(
      show52wLine,
      level52wHighData,
      level52wHigh,
      levelHighData,
      levelLowData,
      fontSizes,
    );

    applyHighlightSeries(chart, levelLines, highlightEntry, highlightExit);
  }
}
