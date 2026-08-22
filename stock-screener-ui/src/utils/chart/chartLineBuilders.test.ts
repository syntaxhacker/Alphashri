import { describe, expect, it } from "vitest";
import { buildPivotSeries, buildWeek52Series, buildEmaSeries } from "../chartLineBuilders";
import {
  PIVOT_R1,
  PIVOT_PP,
  PIVOT_S1,
  CHART_AVG_ENTRY,
  INDICATOR_BLUE_A,
  INDICATOR_BLUE_B,
} from "../../config/colors";

describe("buildPivotSeries", () => {
  const mockCandles = [
    { date: "2025-01-15" },
    { date: "2025-01-16" },
    { date: "2025-01-17" },
    { date: "2025-01-18" },
    { date: "2025-01-19" },
  ];

  const mockPivotLevels = [
    { date: "2025-01-15", date_raw: "2025-01-15", pp: 100, r1: 105, s1: 95 },
    { date: "2025-01-16", date_raw: "2025-01-16", pp: 101, r1: 106, s1: 96 },
    { date: "2025-01-17", date_raw: "2025-01-17", pp: 102, r1: 107, s1: 97 },
    { date: "2025-01-18", date_raw: "2025-01-18", pp: 103, r1: 108, s1: 98 },
    { date: "2025-01-19", date_raw: "2025-01-19", pp: 104, r1: 109, s1: 99 },
  ];

  describe("when pivot_levels is empty or null", () => {
    it("returns empty array for null", () => {
      const result = buildPivotSeries(mockCandles, null as any);
      expect(result).toEqual([]);
    });

    it("returns empty array for empty array", () => {
      const result = buildPivotSeries(mockCandles, []);
      expect(result).toEqual([]);
    });
  });

  describe("when pivot_levels has data", () => {
    it("creates three series (R1, PP, S1)", () => {
      const result = buildPivotSeries(mockCandles, mockPivotLevels);
      expect(result).toHaveLength(3);
    });

    it("sets correct ids", () => {
      const result = buildPivotSeries(mockCandles, mockPivotLevels);
      expect(result[0].id).toBe("pivot-r1");
      expect(result[1].id).toBe("pivot-pp");
      expect(result[2].id).toBe("pivot-s1");
    });

    it("sets correct names", () => {
      const result = buildPivotSeries(mockCandles, mockPivotLevels);
      expect(result[0].name).toBe("R1");
      expect(result[1].name).toBe("PP");
      expect(result[2].name).toBe("S1");
    });

    it("sets type to line", () => {
      const result = buildPivotSeries(mockCandles, mockPivotLevels);
      result.forEach((series) => expect(series.type).toBe("line"));
    });

    it("maps values correctly with date_raw fallback", () => {
      const result = buildPivotSeries(mockCandles, mockPivotLevels);
      expect(result[0].data).toEqual([105, 106, 107, 108, 109]); // R1
      expect(result[1].data).toEqual([100, 101, 102, 103, 104]); // PP
      expect(result[2].data).toEqual([95, 96, 97, 98, 99]); // S1
    });

    it("fills null for missing dates", () => {
      const levelsWithGap = [
        { date: "2025-01-15", date_raw: "2025-01-15", pp: 100, r1: 105, s1: 95 },
        { date: "2025-01-17", date_raw: "2025-01-17", pp: 102, r1: 107, s1: 97 }, // skips 16
      ];
      const result = buildPivotSeries(mockCandles, levelsWithGap);
      expect(result[0].data[1]).toBeNull(); // R1 on 16th is null
      expect(result[1].data[1]).toBeNull(); // PP on 16th is null
      expect(result[2].data[1]).toBeNull(); // S1 on 16th is null
    });

    it("uses PIVOT_R1 color for R1", () => {
      const result = buildPivotSeries(mockCandles, mockPivotLevels);
      expect(result[0].lineStyle.color).toBe(PIVOT_R1);
    });

    it("uses PIVOT_PP color for PP", () => {
      const result = buildPivotSeries(mockCandles, mockPivotLevels);
      expect(result[1].lineStyle.color).toBe(PIVOT_PP);
    });

    it("uses PIVOT_S1 color for S1", () => {
      const result = buildPivotSeries(mockCandles, mockPivotLevels);
      expect(result[2].lineStyle.color).toBe(PIVOT_S1);
    });

    it("sets line width to 1", () => {
      const result = buildPivotSeries(mockCandles, mockPivotLevels);
      result.forEach((series) => expect(series.lineStyle.width).toBe(1));
    });

    it("sets correct line styles: R1 dashed, PP dotted, S1 dashed", () => {
      const result = buildPivotSeries(mockCandles, mockPivotLevels);
      expect(result[0].lineStyle.type).toBe("dashed"); // R1
      expect(result[1].lineStyle.type).toBe("dotted"); // PP
      expect(result[2].lineStyle.type).toBe("dashed"); // S1
    });

    it("shows tooltip with formatted value", () => {
      const result = buildPivotSeries(mockCandles, mockPivotLevels);
      expect(result[0].tooltip.show).toBe(true);
      const formatter = result[0].tooltip.formatter as (params: any) => string;
      expect(formatter({ value: 105 })).toBe(`<span style="color:${PIVOT_R1}">R1: ₹105.00</span>`);
    });

    it("handles null values in tooltip", () => {
      const result = buildPivotSeries(mockCandles, mockPivotLevels);
      const formatter = result[0].tooltip.formatter as (params: any) => string;
      expect(formatter({ value: null })).toBe("");
    });

    it("sets z-index to 4", () => {
      const result = buildPivotSeries(mockCandles, mockPivotLevels);
      result.forEach((series) => expect(series.z).toBe(4));
    });

    it("does not show symbols", () => {
      const result = buildPivotSeries(mockCandles, mockPivotLevels);
      result.forEach((series) => expect(series.showSymbol).toBe(false));
    });

    it("does not connect nulls", () => {
      const result = buildPivotSeries(mockCandles, mockPivotLevels);
      result.forEach((series) => expect(series.connectNulls).toBe(false));
    });

    it("sets silent to true", () => {
      const result = buildPivotSeries(mockCandles, mockPivotLevels);
      result.forEach((series) => expect(series.silent).toBe(true));
    });

    it("does not show symbols", () => {
      const result = buildPivotSeries(mockCandles, mockPivotLevels);
      result.forEach((series) => expect(series.showSymbol).toBe(false));
    });

    it("does not connect nulls", () => {
      const result = buildPivotSeries(mockCandles, mockPivotLevels);
      result.forEach((series) => expect(series.connectNulls).toBe(false));
    });

    it("uses date_raw as key but looks up by date", () => {
      // The function builds map with date_raw/date as key, but looks up by c.date
      // If date_raw differs from date, lookup with c.date will fail (return null)
      const levels = [
        { date: "2025-01-15", date_raw: "2025-01-15-processed", pp: 100, r1: 105, s1: 95 },
      ];
      const result = buildPivotSeries(mockCandles, levels);
      // Lookup uses c.date which is "2025-01-15", but map key is "2025-01-15-processed"
      // So the lookup fails and returns null
      expect(result[0].data[0]).toBeNull();
    });
  });
});

describe("buildWeek52Series", () => {
  const mockCandles = [{ date: "2025-01-15" }, { date: "2025-01-16" }, { date: "2025-01-17" }];

  const mockWeek52Levels = [
    { date: "2025-01-15", "52w_high": 150 },
    { date: "2025-01-16", "52w_high": 151 },
    { date: "2025-01-17", "52w_high": 152 },
  ];

  describe("when week52_levels is empty or null", () => {
    it("returns empty array for null", () => {
      const result = buildWeek52Series(mockCandles, null as any, (d) => d);
      expect(result).toEqual([]);
    });

    it("returns empty array for empty array", () => {
      const result = buildWeek52Series(mockCandles, [], (d) => d);
      expect(result).toEqual([]);
    });
  });

  describe("when week52_levels has data", () => {
    it("creates one series", () => {
      const result = buildWeek52Series(mockCandles, mockWeek52Levels, (d) => d);
      expect(result).toHaveLength(1);
    });

    it("sets correct id", () => {
      const result = buildWeek52Series(mockCandles, mockWeek52Levels, (d) => d);
      expect(result[0].id).toBe("52w-high");
    });

    it("sets correct name", () => {
      const result = buildWeek52Series(mockCandles, mockWeek52Levels, (d) => d);
      expect(result[0].name).toBe("52W High");
    });

    it("maps values correctly", () => {
      const result = buildWeek52Series(mockCandles, mockWeek52Levels, (d) => d);
      expect(result[0].data).toEqual([150, 151, 152]);
    });

    it("fills null for missing dates", () => {
      const levelsWithGap = [
        { date: "2025-01-15", "52w_high": 150 },
        { date: "2025-01-17", "52w_high": 152 },
      ];
      const result = buildWeek52Series(mockCandles, levelsWithGap, (d) => d);
      expect(result[0].data[1]).toBeNull();
    });

    it("uses gold color for 52W high", () => {
      const result = buildWeek52Series(mockCandles, mockWeek52Levels, (d) => d);
      expect(result[0].lineStyle.color).toBe(CHART_AVG_ENTRY);
    });

    it("sets dashed line type with width 2", () => {
      const result = buildWeek52Series(mockCandles, mockWeek52Levels, (d) => d);
      expect(result[0].lineStyle.type).toBe("dashed");
      expect(result[0].lineStyle.width).toBe(2);
    });

    it("sets z-index to 5", () => {
      const result = buildWeek52Series(mockCandles, mockWeek52Levels, (d) => d);
      expect(result[0].z).toBe(5);
    });

    it("does not show symbols", () => {
      const result = buildWeek52Series(mockCandles, mockWeek52Levels, (d) => d);
      expect(result[0].showSymbol).toBe(false);
    });

    it("sets silent to true", () => {
      const result = buildWeek52Series(mockCandles, mockWeek52Levels, (d) => d);
      expect(result[0].silent).toBe(true);
    });

    it("applies extendSeriesData to data", () => {
      const extend = (data: any[]) => data.map((v) => (v !== null ? v * 2 : null));
      const result = buildWeek52Series(mockCandles, mockWeek52Levels, extend);
      expect(result[0].data).toEqual([300, 302, 304]);
    });
  });
});

describe("buildEmaSeries", () => {
  const mockEmaSeries = [
    { label: "EMA 9", color: INDICATOR_BLUE_A, data: [100, 101, 102] },
    { label: "EMA 21", color: INDICATOR_BLUE_B, data: [99, 100, 101] },
  ];

  describe("when ema_series is empty or null", () => {
    it("returns empty array for null", () => {
      const result = buildEmaSeries(null as any, (d) => d, []);
      expect(result).toEqual([]);
    });

    it("returns empty array for undefined", () => {
      const result = buildEmaSeries(undefined as any, (d) => d, []);
      expect(result).toEqual([]);
    });

    it("returns empty array for empty array", () => {
      const result = buildEmaSeries([], (d) => d, []);
      expect(result).toEqual([]);
    });
  });

  describe("when ema_series has data", () => {
    it("creates series for each EMA", () => {
      const result = buildEmaSeries(mockEmaSeries, (d) => d, []);
      expect(result).toHaveLength(2);
    });

    it("preserves label and color", () => {
      const result = buildEmaSeries(mockEmaSeries, (d) => d, []);
      expect(result[0].name).toBe("EMA 9");
      expect(result[0].lineStyle.color).toBe(INDICATOR_BLUE_A);
      expect(result[1].name).toBe("EMA 21");
      expect(result[1].lineStyle.color).toBe(INDICATOR_BLUE_B);
    });

    it("sets type to line", () => {
      const result = buildEmaSeries(mockEmaSeries, (d) => d, []);
      result.forEach((series) => expect(series.type).toBe("line"));
    });

    it("applies extendSeriesData", () => {
      const extend = (data: any[]) => data.map((v) => v * 2);
      const result = buildEmaSeries(mockEmaSeries, extend, []);
      expect(result[0].data).toEqual([200, 202, 204]);
    });

    it("sets line width to 1.5", () => {
      const result = buildEmaSeries(mockEmaSeries, (d) => d, []);
      result.forEach((series) => expect(series.lineStyle.width).toBe(1.5));
    });

    it("shows tooltip", () => {
      const result = buildEmaSeries(mockEmaSeries, (d) => d, []);
      result.forEach((series) => expect(series.tooltip.show).toBe(true));
    });

    it("does not show symbols", () => {
      const result = buildEmaSeries(mockEmaSeries, (d) => d, []);
      result.forEach((series) => expect(series.showSymbol).toBe(false));
    });

    it("connects nulls", () => {
      const result = buildEmaSeries(mockEmaSeries, (d) => d, []);
      result.forEach((series) => expect(series.connectNulls).toBe(true));
    });

    it("sets z-index to 5", () => {
      const result = buildEmaSeries(mockEmaSeries, (d) => d, []);
      result.forEach((series) => expect(series.z).toBe(5));
    });

    it("is silent (no events)", () => {
      const result = buildEmaSeries(mockEmaSeries, (d) => d, []);
      result.forEach((series) => expect(series.silent).toBe(true));
    });

    it("adds labels to legendData when not present", () => {
      const legendData: string[] = [];
      buildEmaSeries(mockEmaSeries, (d) => d, legendData);
      expect(legendData).toEqual(["EMA 9", "EMA 21"]);
    });

    it("does not duplicate labels in legendData", () => {
      const legendData = ["EMA 9"];
      buildEmaSeries(mockEmaSeries, (d) => d, legendData);
      expect(legendData).toEqual(["EMA 9", "EMA 21"]);
    });
  });
});
