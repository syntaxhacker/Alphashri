import { describe, expect, it } from "vitest";
import {
  getChartThemeColors,
  getCandleChange,
  getCandleFromParams,
  formatVolume,
  buildHolidayMap,
  insertHolidayGaps,
  buildHighlightMarkers,
  buildHighlightLevelSeries,
} from "./chartUtils";
import {
  POSITIVE,
  NEGATIVE,
  BULLISH,
  BEARISH,
  CHART_DARK_BG,
  CHART_DARK_TEXT,
  CHART_DARK_SPLIT,
  CHART_DARK_BORDER,
  CHART_DARK_MUTED,
  CHART_AVG_ENTRY,
  CHART_TRADE_EXIT,
  MARKER_TP,
} from "../config/colors";

describe("getChartThemeColors", () => {
  const darkTheme = {
    colors: {
      dark: {
        7: CHART_DARK_BG,
        5: CHART_DARK_SPLIT,
        4: CHART_DARK_BORDER,
        1: CHART_DARK_MUTED,
      },
      gray: {
        8: CHART_DARK_TEXT,
        6: CHART_DARK_MUTED,
        3: CHART_DARK_BORDER,
        2: CHART_DARK_SPLIT,
      },
    },
    white: CHART_DARK_TEXT,
  };

  it("returns dark theme colors when isDark is true", () => {
    const result = getChartThemeColors(true, darkTheme);
    expect(result.bgColor).toBe(CHART_DARK_BG);
    expect(result.textColor).toBe(CHART_DARK_TEXT); // theme.white
    expect(result.gridLineColor).toBe(CHART_DARK_SPLIT);
    expect(result.borderColor).toBe(CHART_DARK_BORDER);
    expect(result.mutedColor).toBe(CHART_DARK_MUTED);
  });

  it("includes POSITIVE and NEGATIVE colors", () => {
    const result = getChartThemeColors(false, darkTheme);
    expect(result.positiveColor).toBe(POSITIVE);
    expect(result.negativeColor).toBe(NEGATIVE);
  });
});

describe("getCandleChange", () => {
  it("calculates bullish change correctly", () => {
    const result = getCandleChange(100, 105);
    expect(result.change).toBe("5.00");
    expect(result.changeColor).toBe(BULLISH);
  });

  it("calculates bearish change correctly", () => {
    const result = getCandleChange(100, 95);
    expect(result.change).toBe("-5.00");
    expect(result.changeColor).toBe(BEARISH);
  });

  it("handles zero open", () => {
    const result = getCandleChange(0, 100);
    expect(result.change).toBe("0");
  });
});

describe("getCandleFromParams", () => {
  const candles = [
    { open: 100, close: 105, high: 110, low: 95 },
    { open: 105, close: 103, high: 108, low: 102 },
  ];

  it("returns null when no candlestick series", () => {
    const result = getCandleFromParams([{ seriesType: "line", dataIndex: 0 }], candles);
    expect(result).toBeNull();
  });

  it("returns null when index out of range", () => {
    const result = getCandleFromParams([{ seriesType: "candlestick", dataIndex: 999 }], candles);
    expect(result).toBeNull();
  });

  it("returns candle and change for valid index", () => {
    const result = getCandleFromParams([{ seriesType: "candlestick", dataIndex: 0 }], candles);
    expect(result?.candle).toEqual(candles[0]);
    expect(result?.change).toEqual({ change: "5.00", changeColor: BULLISH });
  });
});

describe("formatVolume", () => {
  it("formats millions with M suffix", () => {
    expect(formatVolume(1500000)).toBe("1.5M");
    expect(formatVolume(2000000)).toBe("2.0M");
  });

  it("formats thousands with K suffix", () => {
    expect(formatVolume(1500)).toBe("1.5K");
    expect(formatVolume(1000)).toBe("1.0K");
  });

  it("returns plain number for < 1000", () => {
    expect(formatVolume(999)).toBe("999");
    expect(formatVolume(0)).toBe("0");
  });

  it("handles negative values", () => {
    expect(formatVolume(-1500)).toBe("-1500");
    expect(formatVolume(-1500000)).toBe("-1500000");
  });
});

describe("buildHolidayMap", () => {
  const holidays = [
    { date: "2025-01-16", type: "trading", description: "Republic Day" },
    { date: "2025-01-17", type: "clearing", description: "Clearing" },
  ];

  it("creates empty structures for undefined", () => {
    const result = buildHolidayMap();
    expect(result.trading.size).toBe(0);
    expect(result.clearing.size).toBe(0);
    expect(result.descriptions.size).toBe(0);
  });

  it("adds trading holidays to trading set with H abbreviation", () => {
    const result = buildHolidayMap(holidays);
    expect(result.trading.has("2025-01-16")).toBe(true);
    expect(result.descriptions.get("2025-01-16")?.type).toBe("H");
    expect(result.descriptions.get("2025-01-16")?.desc).toBe("Republic Day");
  });

  it("adds clearing holidays to clearing set with C abbreviation", () => {
    const result = buildHolidayMap(holidays);
    expect(result.clearing.has("2025-01-17")).toBe(true);
    expect(result.descriptions.get("2025-01-17")?.type).toBe("C");
  });
});

describe("insertHolidayGaps", () => {
  const fullWeekCandles = [
    { time: "2025-01-13T09:30", date: "2025-01-13" }, // Mon
    { time: "2025-01-14T09:30", date: "2025-01-14" }, // Tue
    { time: "2025-01-15T09:30", date: "2025-01-15" }, // Wed (would be holiday but present in data)
    { time: "2025-01-16T09:30", date: "2025-01-16" }, // Thu
    { time: "2025-01-17T09:30", date: "2025-01-17" }, // Fri
  ];

  // Using week: Mon 13, Tue 14, Thu 16, Fri 17 - missing Wed 15 (which is a holiday)
  const candlesWithMissingDay = [
    { time: "2025-01-13T09:30", date: "2025-01-13" }, // Mon
    { time: "2025-01-14T09:30", date: "2025-01-14" }, // Tue
    // Skip Wed 15 (holiday)
    { time: "2025-01-16T09:30", date: "2025-01-16" }, // Thu
    { time: "2025-01-17T09:30", date: "2025-01-17" }, // Fri
  ];

  const holidayMap = buildHolidayMap([
    { date: "2025-01-15", type: "trading", description: "Republic Day" },
  ]);

  it("inserts gap marker for missing holiday date", () => {
    const result = insertHolidayGaps(candlesWithMissingDay, holidayMap);
    expect(result.extendedTimeData.some((t) => t.includes("2025-01-15 [H]"))).toBe(true);
    expect(result.hasGaps).toBe(true);
  });

  it("preserves all original candles", () => {
    const result = insertHolidayGaps(candlesWithMissingDay, holidayMap);
    candlesWithMissingDay.forEach((c) => {
      expect(result.extendedTimeData).toContain(c.time);
    });
  });

  it("returns original data when no gaps", () => {
    const result = insertHolidayGaps(fullWeekCandles, {
      trading: new Set(),
      clearing: new Set(),
      descriptions: new Map(),
    });
    expect(result.extendedTimeData).toEqual(fullWeekCandles.map((c) => c.time));
    expect(result.hasGaps).toBe(false);
  });

  it("preserves all original candles", () => {
    const result = insertHolidayGaps(candlesWithMissingDay, holidayMap);
    candlesWithMissingDay.forEach((c) => {
      expect(result.extendedTimeData).toContain(c.time);
    });
  });

  it("returns original data when no gaps", () => {
    const result = insertHolidayGaps(fullWeekCandles, {
      trading: new Set(),
      clearing: new Set(),
      descriptions: new Map(),
    });
    expect(result.extendedTimeData).toEqual(fullWeekCandles.map((c) => c.time));
    expect(result.hasGaps).toBe(false);
  });

  it("handles empty candles", () => {
    const result = insertHolidayGaps([], holidayMap);
    expect(result.extendedTimeData).toEqual([]);
    expect(result.hasGaps).toBe(false);
  });
});

describe("buildHighlightMarkers", () => {
  const entryMarker = { price: 100, symbol: "triangle" };
  const exitMarker = { price: 110, trade: { exit_reason: "TP" } };

  it("creates highlighted entry marker", () => {
    const result = buildHighlightMarkers(entryMarker, exitMarker, 5, 10, 0, { md: 12 });
    expect(result.highlightEntryMarker).toMatchObject({
      value: [5, 100],
      symbol: "triangle",
      symbolSize: 32,
      itemStyle: { color: CHART_AVG_ENTRY, borderColor: CHART_TRADE_EXIT, borderWidth: 4 },
      label: { show: true, position: "top", formatter: "▼ Entry #1" },
    });
  });

  it("colors exit marker based on reason", () => {
    const result = buildHighlightMarkers(entryMarker, exitMarker, 0, 0, 0, { md: 12 });
    expect(result.highlightExitMarker?.itemStyle.color).toBe(MARKER_TP); // TP = green
  });

  it("returns null exit marker when exitMarker is undefined", () => {
    const result = buildHighlightMarkers(entryMarker, undefined, 0, 0, 0, { md: 12 });
    expect(result.highlightExitMarker).toBeNull();
  });
});

describe("buildHighlightLevelSeries", () => {
  const candles = [{ date: "2025-01-15" }, { date: "2025-01-16" }, { date: "2025-01-17" }];

  const selectedTrade = { or_high: 120, or_low: 90, r1: 115, "52w_high": 150 };

  it("creates selected OR lines when same day", () => {
    const result = buildHighlightLevelSeries(candles, "2025-01-15", 0, 1, selectedTrade, true, {
      sm: 10,
    });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("selected-or-high");
    expect(result[1].id).toBe("selected-or-low");
  });

  it("creates 52W high line when different day and available", () => {
    const result = buildHighlightLevelSeries(candles, "2025-01-15", 0, 2, selectedTrade, false, {
      sm: 10,
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("selected-52w-high");
    expect(result[0].markLine.lineStyle.color).toBe(CHART_AVG_ENTRY);
  });

  it("does not include 52W line if r1/52w_high is missing", () => {
    const trade = { or_high: 120 };
    const result = buildHighlightLevelSeries(candles, "2025-01-15", 0, 1, trade, false, { sm: 10 });
    expect(result[0].id).toBe("selected-or-high");
    expect(result).toHaveLength(2);
  });
});
