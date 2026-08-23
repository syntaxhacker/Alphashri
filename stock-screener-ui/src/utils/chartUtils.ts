import type { MantineTheme } from "@/ui";
import {
  POSITIVE,
  NEGATIVE,
  BULLISH,
  BEARISH,
  MARKER_ENTRY,
  MARKER_TP,
  MARKER_SL,
  MARKER_EOD,
  MARKER_STOP_LOSS,
  MARKER_MAX_HOLDING,
  PIVOT_S2,
  MARKER_BORDER,
  CHART_AVG_ENTRY,
  CHART_TRADE_EXIT,
  CHART_DARK_DROPDOWN,
  INDICATOR_BLUE_A,
  INDICATOR_BLUE_B,
} from "../config/colors";

export function getChartThemeColors(isDark: boolean, theme: MantineTheme | Record<string, any>) {
  const t: any = theme as any;
  const colors = t?.colors;
  const palette = t?.palette;
  // Support both Mantine (colors) and MUI (palette) themes; FormControl muiName crash guard
  if (colors?.dark && colors?.gray) {
    return {
      bgColor: isDark ? colors.dark[7] : t.white ?? "#ffffff",
      textColor: isDark ? (t.white ?? "#ffffff") : colors.gray[8],
      gridLineColor: isDark ? colors.dark[5] : colors.gray[2],
      borderColor: isDark ? colors.dark[4] : colors.gray[3],
      mutedColor: isDark ? colors.dark[1] : colors.gray[6],
      positiveColor: POSITIVE,
      negativeColor: NEGATIVE,
    };
  }
  // MUI palette fallback
  const bgDefault = palette?.background?.default;
  const bgPaper = palette?.background?.paper;
  const textPrimary = palette?.text?.primary;
  const textSecondary = palette?.text?.secondary;
  const divider = palette?.divider;
  const grey = palette?.grey;
  return {
    bgColor: isDark ? (bgPaper ?? bgDefault ?? "#121212") : (bgPaper ?? "#ffffff"),
    textColor: isDark ? (textPrimary ?? "#ffffff") : (textPrimary ?? "#1a1a1a"),
    gridLineColor: divider ?? (grey?.[700] ?? "#333"),
    borderColor: divider ?? (grey?.[400] ?? "#e0e0e0"),
    mutedColor: textSecondary ?? (grey?.[500] ?? "#888"),
    positiveColor: POSITIVE,
    negativeColor: NEGATIVE,
  };
}

export const CANDLESTICK_ITEM_STYLE = {
  color: BULLISH,
  color0: BEARISH,
  borderColor: BULLISH,
  borderColor0: BEARISH,
};

export function getCandleChange(open: number, close: number) {
  const change = open > 0 ? (((close - open) / open) * 100).toFixed(2) : "0";
  const changeColor = close >= open ? CANDLESTICK_ITEM_STYLE.color : CANDLESTICK_ITEM_STYLE.color0;
  return { change, changeColor };
}

export function getCandleFromParams(
  params: any[],
  candles: { open: number; close: number; [key: string]: any }[],
) {
  const candle = params.find((p: any) => p.seriesType === "candlestick");
  if (!candle) return null;
  const c = candles[candle.dataIndex];
  if (!c) return null;
  return { candle: c, change: getCandleChange(c.open, c.close) };
}

export function formatVolume(vol: number): string {
  if (vol >= 1000000) return (vol / 1000000).toFixed(1) + "M";
  if (vol >= 1000) return (vol / 1000).toFixed(1) + "K";
  return vol.toString();
}

// === Holiday Helpers ===

export interface HolidayMap {
  trading: Set<string>;
  clearing: Set<string>;
  descriptions: Map<string, { type: string; desc: string }>;
}

export function buildHolidayMap(
  holidays?: { date: string; type: string; description: string }[],
): HolidayMap {
  const map: HolidayMap = { trading: new Set(), clearing: new Set(), descriptions: new Map() };
  if (!holidays) return map;
  for (const h of holidays) {
    if (h.type === "trading") map.trading.add(h.date);
    else map.clearing.add(h.date);
    map.descriptions.set(h.date, { type: h.type === "trading" ? "H" : "C", desc: h.description });
  }
  return map;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function insertHolidayGaps(
  candles: { time: string; date: string }[],
  holidayMap: HolidayMap,
): { extendedTimeData: string[]; hasGaps: boolean } {
  if (candles.length === 0) return { extendedTimeData: [], hasGaps: false };

  const tradingDates = new Set(candles.map((c) => c.date));
  const sortedDates = [...tradingDates].sort();
  const startDate = new Date(sortedDates[0] + "T00:00:00");
  const endDate = new Date(sortedDates[sortedDates.length - 1] + "T00:00:00");

  const gaps: string[] = [];
  let current = new Date(startDate);
  while (current <= endDate) {
    const ds = toDateStr(current);
    const dow = current.getDay();
    if (dow < 5 && !tradingDates.has(ds)) {
      const info = holidayMap.descriptions.get(ds);
      const label = info ? `${ds} [${info.type}]` : `${ds} [H]`;
      gaps.push(label);
    }
    current = addDays(current, 1);
  }

  if (gaps.length === 0) return { extendedTimeData: candles.map((c) => c.time), hasGaps: false };

  const extendedTimeData: string[] = [];
  let gapIdx = 0;
  for (const candle of candles) {
    while (gapIdx < gaps.length) {
      const gapLabel = gaps[gapIdx];
      const gapDate = gapLabel.split(" ")[0];
      if (candle.date > gapDate) {
        extendedTimeData.push(gapLabel);
        gapIdx++;
      } else {
        break;
      }
    }
    extendedTimeData.push(candle.time);
  }
  while (gapIdx < gaps.length) {
    extendedTimeData.push(gaps[gapIdx]);
    gapIdx++;
  }

  return { extendedTimeData, hasGaps: true };
}

// === Marker Configs ===

export interface MarkerConfig {
  filter: (t: any) => boolean;
  color: string;
  symbol: string;
  symbolSize: number;
  symbolRotate?: number;
}

export function getMarkerConfigs(): MarkerConfig[] {
  return [
    {
      filter: (t) => t.type === "entry",
      color: MARKER_ENTRY,
      symbol: "triangle",
      symbolSize: 18,
      symbolRotate: 180,
    },
    {
      filter: (t) => t.type === "exit" && (t.trade as any).exit_reason === "TP",
      color: MARKER_TP,
      symbol: "circle",
      symbolSize: 16,
    },
    {
      filter: (t) => t.type === "exit" && (t.trade as any).exit_reason === "SL",
      color: MARKER_SL,
      symbol: "circle",
      symbolSize: 16,
    },
    {
      filter: (t) => t.type === "exit" && (t.trade as any).exit_reason === "EOD",
      color: MARKER_EOD,
      symbol: "diamond",
      symbolSize: 16,
    },
    {
      filter: (t) => t.type === "exit" && (t.trade as any).exit_reason === "TRAILING_STOP",
      color: MARKER_STOP_LOSS,
      symbol: "circle",
      symbolSize: 16,
    },
    {
      filter: (t) => t.type === "exit" && (t.trade as any).exit_reason === "MAX_HOLDING",
      color: MARKER_MAX_HOLDING,
      symbol: "diamond",
      symbolSize: 16,
    },
    {
      filter: (t) => t.type === "exit" && (t.trade as any).exit_reason === "NEW_52W_HIGH",
      color: PIVOT_S2,
      symbol: "circle",
      symbolSize: 16,
    },
  ];
}

// === Zoom-to-Trade Highlight Helpers ===

export function buildHighlightMarkers(
  entryMarker: any,
  exitMarker: any | undefined,
  entryIdx: number,
  exitIdx: number,
  tradeIndex: number,
  fontSizes: Record<string, number>,
) {
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

  const exitReason = exitMarker ? (exitMarker.trade as any).exit_reason : null;
  const exitColor = exitReason === "TP" ? MARKER_TP : exitReason === "SL" ? MARKER_SL : MARKER_EOD;

  const highlightExitMarker =
    exitMarker && exitIdx !== undefined
      ? {
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
        }
      : null;

  return { highlightEntryMarker, highlightExitMarker };
}

export function buildHighlightLevelSeries(
  candles: any[],
  entryDate: string,
  entryIdx: number,
  exitIdx: number,
  selectedTrade: any,
  isSameDay: boolean,
  fontSizes: Record<string, number>,
): any[] {
  const levelHigh =
    (selectedTrade as any).or_high ??
    (selectedTrade as any).r1 ??
    (selectedTrade as any)["52w_high"];
  const levelLow = (selectedTrade as any).or_low ?? (selectedTrade as any).s1;
  const level52wHigh = (selectedTrade as any)["52w_high"];
  const show52wLine = !isSameDay && level52wHigh;

  const levelHighData = candles.map((c) => (c.date === entryDate ? levelHigh : null));
  const level52wHighData = show52wLine
    ? candles.map((c, i) => (i >= entryIdx && i <= exitIdx ? level52wHigh : null))
    : [];
  const levelLowData = candles.map((c) => (c.date === entryDate ? levelLow : null));

  const series: any[] = [];

  if (show52wLine && level52wHighData.length > 0) {
    series.push({
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
    });
  }

  if (!show52wLine) {
    series.push(
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
    );
  }

  return series;
}
