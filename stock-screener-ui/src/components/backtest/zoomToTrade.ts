import type { SymbolChartData } from "../../types/backtest";
import { normalizeTime } from "../../utils/ui-helpers";
import {
  extractTradeLevels,
  buildHighlightEntryMarker,
  buildHighlightExitMarker,
  build52wHighSeries,
  buildOrLevelSeries,
} from "../../utils/chart/scaleHelpers";

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
  return buildOrLevelSeries(levelHighData, levelLowData);
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

  // Fixed chart label sizes — no theme fontSizes scale to rely on.
  const fontSizes = { xs: 10, sm: 11, md: 12 };
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
    const { levelHigh, levelLow, level52wHigh } = extractTradeLevels(selectedTrade);
    const show52wLine = entryDate !== exitDate && level52wHigh;

    const levelHighData = chartData.candles.map((c) => (c.date === entryDate ? levelHigh : null));
    const level52wHighData = show52wLine
      ? chartData.candles.map((c, i) => (i >= entryIdx && i <= resolvedExitIdx ? level52wHigh : null))
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
