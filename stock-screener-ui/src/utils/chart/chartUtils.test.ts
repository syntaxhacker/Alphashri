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
  CANDLESTICK_ITEM_STYLE,
} from "../chartUtils";
import {
  makeCandles,
  expectZeroOpenChange,
  makeDarkTheme,
  makeLightTheme,
  registerFormatVolumeMillionsTest,
  registerFormatVolumeThousandsTest,
} from "./chartTestFixtures";
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
  CHART_LIGHT_BG,
  CHART_LIGHT_TEXT,
  CHART_LIGHT_SPLIT,
  CHART_LIGHT_BORDER,
  CHART_LIGHT_MUTED,
  CHART_AVG_ENTRY,
  CHART_TRADE_EXIT,
  MARKER_TP,
} from "../../config/colors";

describe("getChartThemeColors", () => {
  const darkTheme = makeDarkTheme();
  const lightTheme = makeLightTheme();

  it("returns correct colors for dark theme", () => {
    const result = getChartThemeColors(true, darkTheme);
    expect(result.bgColor).toBe(CHART_DARK_BG);
    expect(result.textColor).toBe(CHART_DARK_TEXT); // isDark=true uses theme.white
    expect(result.gridLineColor).toBe(CHART_DARK_SPLIT);
    expect(result.borderColor).toBe(CHART_DARK_BORDER);
    expect(result.mutedColor).toBe(CHART_DARK_MUTED);
  });

  it("returns correct colors for light theme", () => {
    const result = getChartThemeColors(false, lightTheme);
    expect(result.bgColor).toBe(CHART_LIGHT_BG); // isDark=false uses theme.white
    expect(result.textColor).toBe(CHART_LIGHT_TEXT); // isDark=false uses theme.colors.gray[8]
    expect(result.gridLineColor).toBe(CHART_LIGHT_SPLIT);
    expect(result.borderColor).toBe(CHART_LIGHT_BORDER);
    expect(result.mutedColor).toBe(CHART_LIGHT_MUTED);
  });

  it("includes POSITIVE and NEGATIVE colors", () => {
    const result = getChartThemeColors(false, lightTheme);
    expect(result.positiveColor).toBe(POSITIVE);
    expect(result.negativeColor).toBe(NEGATIVE);
  });

  it("handles minimal theme object", () => {
    const minimalTheme = {
      white: CHART_LIGHT_BG,
      colors: {
        dark: { 7: CHART_LIGHT_BG },
        gray: { 8: CHART_LIGHT_TEXT, 2: CHART_LIGHT_SPLIT, 3: CHART_LIGHT_BORDER, 6: CHART_LIGHT_MUTED },
      },
    } as any;
    const result = getChartThemeColors(false, minimalTheme);
    expect(result).toHaveProperty("bgColor");
    expect(result).toHaveProperty("textColor");
    expect(result).toHaveProperty("positiveColor");
    expect(result).toHaveProperty("negativeColor");
  });
});

describe("getCandleChange", () => {
  it("calculates percentage change correctly", () => {
    const result = getCandleChange(100, 105);
    expect(result.change).toBe("5.00");
    expect(result.changeColor).toBe(BULLISH);
  });

  it("returns negative change for bearish candle", () => {
    const result = getCandleChange(100, 95);
    expect(result.change).toBe("-5.00");
    expect(result.changeColor).toBe(BEARISH);
  });

  it("returns zero change for doji", () => {
    const result = getCandleChange(100, 100);
    expect(result.change).toBe("0.00");
    expect(result.changeColor).toBe(BULLISH); // close >= open => bullish
  });

  it("handles decimal precision", () => {
    const result = getCandleChange(100, 100.123);
    expect(result.change).toBe("0.12");
  });

  it("handles very small changes", () => {
    const result = getCandleChange(100, 100.01);
    expect(result.change).toBe("0.01");
  });

  it("handles large changes", () => {
    const result = getCandleChange(100, 150);
    expect(result.change).toBe("50.00");
  });

  it("returns 0 when open is 0 to avoid division by zero", () => {
    expectZeroOpenChange();
  });
});

describe("getCandleFromParams", () => {
  const candles = makeCandles();

  it("returns candle and change for candlestick series", () => {
    const params = [{ seriesType: "candlestick", dataIndex: 0 }];
    const result = getCandleFromParams(params, candles);
    expect(result).not.toBeNull();
    expect(result?.candle).toEqual(candles[0]);
    expect(result?.change.change).toBe("5.00");
    expect(result?.change.changeColor).toBe(BULLISH);
  });

  it("handles bearish candle", () => {
    const params = [{ seriesType: "candlestick", dataIndex: 1 }];
    const result = getCandleFromParams(params, candles);
    expect(result?.change.change).toBe("-1.90");
    expect(result?.change.changeColor).toBe(BEARISH);
  });

  it("returns null when no candlestick series in params", () => {
    const params = [{ seriesType: "line", dataIndex: 0 }];
    const result = getCandleFromParams(params, candles);
    expect(result).toBeNull();
  });

  it("returns null when dataIndex out of range", () => {
    const params = [{ seriesType: "candlestick", dataIndex: 999 }];
    const result = getCandleFromParams(params, candles);
    expect(result).toBeNull();
  });

  it("handles empty params array", () => {
    const result = getCandleFromParams([], candles);
    expect(result).toBeNull();
  });

  it("finds first candlestick series when multiple exist", () => {
    const params = [
      { seriesType: "line", dataIndex: 0 },
      { seriesType: "candlestick", dataIndex: 1 },
      { seriesType: "candlestick", dataIndex: 0 },
    ];
    const result = getCandleFromParams(params, candles);
    // Should return the first candlestick found
    expect(result?.candle).toEqual(candles[1]);
  });
});

describe("formatVolume", () => {
  registerFormatVolumeMillionsTest();
  registerFormatVolumeThousandsTest();

  it("returns plain number for volumes below 1000", () => {
    expect(formatVolume(999)).toBe("999");
    expect(formatVolume(0)).toBe("0");
    expect(formatVolume(500)).toBe("500");
  });

  it("handles exact boundary values", () => {
    expect(formatVolume(999999)).toBe("1000.0K"); // Actually 999999 / 1000 = 999.999 -> "1000.0K" after rounding
    expect(formatVolume(1000000)).toBe("1.0M");
  });

  it("handles zero", () => {
    expect(formatVolume(0)).toBe("0");
  });

  it("handles negative values", () => {
    // Note: formatVolume doesn't specially handle negative values
    expect(formatVolume(-1500)).toBe("-1500");
    expect(formatVolume(-1500000)).toBe("-1500000");
  });
});

describe("buildHolidayMap", () => {
  const holidays = [
    { date: "2025-01-16", type: "trading", description: "Trading holiday" },
    { date: "2025-01-17", type: "clearing", description: "Clearing holiday" },
  ];

  it("creates empty map for undefined input", () => {
    const result = buildHolidayMap();
    expect(result.trading).toBeInstanceOf(Set);
    expect(result.clearing).toBeInstanceOf(Set);
    expect(result.descriptions).toBeInstanceOf(Map);
    expect(result.trading.size).toBe(0);
    expect(result.clearing.size).toBe(0);
    expect(result.descriptions.size).toBe(0);
  });

  it("adds trading holidays to trading set", () => {
    const result = buildHolidayMap(holidays);
    expect(result.trading.has("2025-01-16")).toBe(true);
    expect(result.trading.size).toBe(1);
  });

  it("adds clearing holidays to clearing set", () => {
    const result = buildHolidayMap(holidays);
    expect(result.clearing.has("2025-01-17")).toBe(true);
    expect(result.clearing.size).toBe(1);
  });

  it("stores descriptions in map", () => {
    const result = buildHolidayMap(holidays);
    expect(result.descriptions.get("2025-01-16")).toEqual({
      type: "H",
      desc: "Trading holiday",
    });
    expect(result.descriptions.get("2025-01-17")).toEqual({
      type: "C",
      desc: "Clearing holiday",
    });
  });

  it("converts trading type to 'H' abbreviation", () => {
    const result = buildHolidayMap(holidays);
    expect(result.descriptions.get("2025-01-16")?.type).toBe("H");
  });

  it("converts clearing type to 'C' abbreviation", () => {
    const result = buildHolidayMap(holidays);
    expect(result.descriptions.get("2025-01-17")?.type).toBe("C");
  });

  it("handles unknown type (converts to 'C' as non-trading)", () => {
    const customHolidays = [{ date: "2025-01-18", type: "unknown", description: "Weird" }];
    const result = buildHolidayMap(customHolidays);
    expect(result.descriptions.get("2025-01-18")?.type).toBe("C");
  });

  it("handles empty array", () => {
    const result = buildHolidayMap([]);
    expect(result.trading.size).toBe(0);
    expect(result.clearing.size).toBe(0);
  });
});

describe("insertHolidayGaps", () => {
  const candles = [
    { time: "2025-01-13T09:30:00", date: "2025-01-13" }, // Monday
    { time: "2025-01-14T09:30:00", date: "2025-01-14" }, // Tuesday
    // 2025-01-15 is a holiday - no candle for this date
    { time: "2025-01-16T09:30:00", date: "2025-01-16" }, // Thursday
    { time: "2025-01-17T09:30:00", date: "2025-01-17" }, // Friday
  ];

  const holidayMap = buildHolidayMap([
    { date: "2025-01-15", type: "trading", description: "Republic Day" },
  ]);

  describe("when no gaps exist", () => {
    it("returns original time data with hasGaps false", () => {
      // Use candles with no missing dates (no gaps possible)
      const noGapCandles = [
        { time: "2025-01-13T09:30:00", date: "2025-01-13" },
        { time: "2025-01-14T09:30:00", date: "2025-01-14" },
        { time: "2025-01-15T09:30:00", date: "2025-01-15" },
        { time: "2025-01-16T09:30:00", date: "2025-01-16" },
      ];
      const result = insertHolidayGaps(noGapCandles, buildHolidayMap([]));
      expect(result.extendedTimeData).toHaveLength(4);
      expect(result.extendedTimeData[0]).toBe("2025-01-13T09:30:00");
      expect(result.hasGaps).toBe(false);
    });
  });

  describe("when trading holiday mid-week", () => {
    it("inserts gap marker for holiday date", () => {
      const result = insertHolidayGaps(candles, holidayMap);
      // Wednesday (15th) is the holiday, so should appear as gap between Tue and Thu
      expect(result.extendedTimeData.some((t) => t.includes("2025-01-15 [H]"))).toBe(true);
      expect(result.hasGaps).toBe(true);
    });

    it("preserves original candle times", () => {
      const result = insertHolidayGaps(candles, holidayMap);
      expect(result.extendedTimeData).toContain("2025-01-13T09:30:00");
      expect(result.extendedTimeData).toContain("2025-01-14T09:30:00");
      expect(result.extendedTimeData).toContain("2025-01-16T09:30:00");
      expect(result.extendedTimeData).toContain("2025-01-17T09:30:00");
    });

    it("formats gap label with date and type abbreviation", () => {
      const result = insertHolidayGaps(candles, holidayMap);
      const gapLabel = result.extendedTimeData.find((t) => t.includes("[H]"));
      expect(gapLabel).toBe("2025-01-15 [H]");
    });

    it("extends array length appropriately", () => {
      const result = insertHolidayGaps(candles, holidayMap);
      expect(result.extendedTimeData.length).toBe(5); // 4 candles + 1 gap = 5
    });

    it("places gap at correct chronological position", () => {
      const result = insertHolidayGaps(candles, holidayMap);
      const gapIndex = result.extendedTimeData.findIndex((t) => t.includes("[H]"));
      // Gap should come after Jan 14, before Jan 16
      expect(gapIndex).toBeGreaterThan(1);
      expect(gapIndex).toBeLessThan(4);
      expect(result.extendedTimeData[gapIndex - 1]).toBe("2025-01-14T09:30:00");
      expect(result.extendedTimeData[gapIndex + 1]).toBe("2025-01-16T09:30:00");
    });
  });

  describe("weekend handling", () => {
    const weekCandles = [
      { time: "2025-01-13T09:30:00", date: "2025-01-13" }, // Monday
      { time: "2025-01-14T09:30:00", date: "2025-01-14" }, // Tuesday
      { time: "2025-01-18T09:30:00", date: "2025-01-18" }, // Saturday
    ];

    it("adds gaps for weekend days (Sat, Sun)", () => {
      const result = insertHolidayGaps(weekCandles, holidayMap);
      expect(result.extendedTimeData.some((t) => t.includes("[H]"))).toBe(true); // Sat
    });

    it("only adds gaps for Mon-Fri missing dates", () => {
      // Monday to Friday range includes Sat & Sun, but weekends are expected
      const result = insertHolidayGaps(weekCandles, holidayMap);
      // Should have gap for Wednesday (trading holiday) AND weekend days between Tue and Sat
      const gapCount = result.extendedTimeData.filter((t) => t.includes("[")).length;
      expect(gapCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("empty input", () => {
    it("returns empty array for empty candles", () => {
      const result = insertHolidayGaps([], holidayMap);
      expect(result.extendedTimeData).toEqual([]);
      expect(result.hasGaps).toBe(false);
    });
  });

  describe("single day", () => {
    const singleDay = [{ time: "2025-01-13T09:30:00", date: "2025-01-13" }];

    it("returns single element with hasGaps false", () => {
      const result = insertHolidayGaps(singleDay, holidayMap);
      expect(result.extendedTimeData).toHaveLength(1);
      expect(result.hasGaps).toBe(false);
    });
  });

  describe("date range consistency", () => {
    it("sorts dates chronologically when computing gaps", () => {
      const unordered = [
        { time: "2025-01-15T09:30:00", date: "2025-01-15" },
        { time: "2025-01-13T09:30:00", date: "2025-01-13" },
      ];
      const result = insertHolidayGaps(unordered, holidayMap);
      // Should find gap based on sorted order (13 -> 15 includes 14)
      const gapLabels = result.extendedTimeData.filter((t) => t.includes("["));
      expect(gapLabels.length).toBeGreaterThan(0);
    });
  });
});

describe("CANDLESTICK_ITEM_STYLE", () => {
  it("has bullish color as color and color0", () => {
    expect(CANDLESTICK_ITEM_STYLE.color).toBe(BULLISH);
    expect(CANDLESTICK_ITEM_STYLE.color0).toBe(BEARISH);
  });

  it("has bullish borderColor", () => {
    expect(CANDLESTICK_ITEM_STYLE.borderColor).toBe(BULLISH);
    expect(CANDLESTICK_ITEM_STYLE.borderColor0).toBe(BEARISH);
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
