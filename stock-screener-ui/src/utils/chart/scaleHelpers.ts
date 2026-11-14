import {
  CHART_AVG_ENTRY,
  CHART_TRADE_EXIT,
  MARKER_TP,
  MARKER_SL,
  MARKER_EOD,
  MARKER_BORDER,
  CHART_DARK_DROPDOWN,
  INDICATOR_BLUE_A,
  INDICATOR_BLUE_B,
} from "../../config/colors";

export interface TradeLevels {
  levelHigh: any;
  levelLow: any;
  level52wHigh: any;
}

/** Extract the reference levels carried on a trade (OR high/low + 52W high). */
export function extractTradeLevels(selectedTrade: any): TradeLevels {
  return {
    levelHigh: selectedTrade.or_high ?? selectedTrade.r1 ?? selectedTrade["52w_high"],
    levelLow: selectedTrade.or_low ?? selectedTrade.s1,
    level52wHigh: selectedTrade["52w_high"],
  };
}

export function buildHighlightEntryMarker(
  entryMarker: any,
  entryIdx: number,
  tradeIndex: number,
  fontSizes: Record<string, number>,
) {
  return {
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
}

export function buildHighlightExitMarker(
  exitMarker: any,
  exitIdx: number | undefined,
  fontSizes: Record<string, number>,
) {
  if (!exitMarker || exitIdx === undefined) return null;

  const exitReason = (exitMarker.trade as any).exit_reason;
  const exitColor = exitReason === "TP" ? MARKER_TP : exitReason === "SL" ? MARKER_SL : MARKER_EOD;

  return {
    value: [exitIdx, exitMarker.price],
    symbol: "circle",
    symbolSize: 28,
    itemStyle: {
      color: exitColor,
      borderColor: MARKER_BORDER,
      borderWidth: 4,
      shadowBlur: 10,
      shadowColor: exitColor,
    },
    label: {
      show: true,
      position: "bottom",
      distance: 8,
      formatter: `● ${exitReason || "Exit"}`,
      color: MARKER_BORDER,
      fontSize: fontSizes.md,
      fontWeight: "bold",
      backgroundColor: CHART_DARK_DROPDOWN,
      padding: [4, 8],
      borderRadius: 4,
    },
  };
}

export function build52wHighSeries(
  level52wHighData: any[],
  level52wHigh: any,
  fontSizes: Record<string, number>,
) {
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
        color: CHART_AVG_ENTRY,
        fontSize: fontSizes.sm,
        fontWeight: "bold",
        backgroundColor: CHART_DARK_DROPDOWN,
        padding: [2, 6],
        borderRadius: 3,
      },
      lineStyle: { color: CHART_AVG_ENTRY, width: 2, type: "dashed" },
      data: [{ yAxis: level52wHigh }],
      animation: false,
    },
  };
}

export function buildOrLevelSeries(
  levelHighData: any[],
  levelLowData: any[],
): any[] {
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
  ];
}

/** Map a single date-scoped level value onto each candle (null where no match). */
export function mapOverlayDateValues<T>(
  candles: { date?: string }[],
  date: string | undefined,
  value: T,
): (T | null)[] {
  if (!date) return candles.map(() => null);
  return candles.map((c) => (c.date === date ? value : null));
}
