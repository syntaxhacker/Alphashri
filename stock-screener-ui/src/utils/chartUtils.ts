import type { MantineTheme } from "@mantine/core";

export function getChartThemeColors(isDark: boolean, theme: MantineTheme | Record<string, any>) {
  return {
    bgColor: isDark ? theme.colors.dark[7] : theme.white,
    textColor: isDark ? theme.white : theme.colors.gray[8],
    gridLineColor: isDark ? theme.colors.dark[5] : theme.colors.gray[2],
    borderColor: isDark ? theme.colors.dark[4] : theme.colors.gray[3],
    mutedColor: isDark ? theme.colors.dark[1] : theme.colors.gray[6],
    positiveColor: "#00E676",
    negativeColor: "#FF1744",
  };
}

export const CANDLESTICK_ITEM_STYLE = {
  color: "#00E676",
  color0: "#FF1744",
  borderColor: "#00E676",
  borderColor0: "#FF1744",
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
      color: "#00FFFF",
      symbol: "triangle",
      symbolSize: 18,
      symbolRotate: 180,
    },
    {
      filter: (t) => t.type === "exit" && (t.trade as any).exit_reason === "TP",
      color: "#FFFF00",
      symbol: "circle",
      symbolSize: 16,
    },
    {
      filter: (t) => t.type === "exit" && (t.trade as any).exit_reason === "SL",
      color: "#FF00FF",
      symbol: "circle",
      symbolSize: 16,
    },
    {
      filter: (t) => t.type === "exit" && (t.trade as any).exit_reason === "EOD",
      color: "#FFA500",
      symbol: "diamond",
      symbolSize: 16,
    },
    {
      filter: (t) => t.type === "exit" && (t.trade as any).exit_reason === "TRAILING_STOP",
      color: "#9C27B0",
      symbol: "circle",
      symbolSize: 16,
    },
    {
      filter: (t) => t.type === "exit" && (t.trade as any).exit_reason === "MAX_HOLDING",
      color: "#FF9800",
      symbol: "diamond",
      symbolSize: 16,
    },
    {
      filter: (t) => t.type === "exit" && (t.trade as any).exit_reason === "NEW_52W_HIGH",
      color: "#00BCD4",
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

  const exitReason = exitMarker ? (exitMarker.trade as any).exit_reason : null;
  const exitColor = exitReason === "TP" ? "#00E676" : exitReason === "SL" ? "#FF1744" : "#FFEA00";

  const highlightExitMarker =
    exitMarker && exitIdx !== undefined
      ? {
          value: [exitIdx, exitMarker.price],
          symbol: "circle",
          symbolSize: 28,
          itemStyle: {
            color: exitColor,
            borderColor: "#FFFFFF",
            borderWidth: 4,
            shadowBlur: 10,
            shadowColor: exitColor,
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
    );
  }

  return series;
}
