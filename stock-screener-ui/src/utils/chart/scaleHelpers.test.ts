import { describe, expect, it } from "vitest";
import {
  extractTradeLevels,
  buildHighlightEntryMarker,
  buildHighlightExitMarker,
  build52wHighSeries,
  buildOrLevelSeries,
  mapOverlayDateValues,
} from "./scaleHelpers";
import { MARKER_TP, MARKER_SL, MARKER_EOD, INDICATOR_BLUE_A, INDICATOR_BLUE_B } from "../../config/colors";

describe("extractTradeLevels", () => {
  it("picks or_high, falls back to r1, then 52w_high", () => {
    const trade = { or_high: 120, or_low: 90, r1: 115, "52w_high": 150 } as any;
    expect(extractTradeLevels(trade)).toEqual({ levelHigh: 120, levelLow: 90, level52wHigh: 150 });
  });

  it("falls back through r1 to 52w_high for levelHigh", () => {
    const trade = { or_low: 90, r1: 115, "52w_high": 150 } as any;
    expect(extractTradeLevels(trade).levelHigh).toBe(115);
    expect(extractTradeLevels(trade).level52wHigh).toBe(150);
  });

  it("resolves to undefined when no level is present", () => {
    expect(extractTradeLevels({} as any)).toEqual({ levelHigh: undefined, levelLow: undefined, level52wHigh: undefined });
  });
});

describe("buildHighlightEntryMarker", () => {
  it("builds the highlighted entry marker", () => {
    const result = buildHighlightEntryMarker({ price: 100 }, 5, 0, { md: 12 });
    expect(result).toMatchObject({
      value: [5, 100],
      symbol: "triangle",
      symbolSize: 32,
      itemStyle: {
        color: expect.any(String),
        borderColor: expect.any(String),
        borderWidth: 4,
        shadowBlur: 10,
      },
      label: {
        show: true,
        position: "top",
        distance: 8,
        formatter: "▼ Entry #1",
        fontSize: 12,
        fontWeight: "bold",
        borderRadius: 4,
      },
    });
  });

  it("increments the trade index in the formatter", () => {
    const result = buildHighlightEntryMarker({ price: 100 }, 0, 2, { md: 12 }) as any;
    expect(result.label.formatter).toBe("▼ Entry #3");
  });
});

describe("buildHighlightExitMarker", () => {
  it("colors TP exit with MARKER_TP", () => {
    const result = buildHighlightExitMarker(
      { price: 110, trade: { exit_reason: "TP" } },
      10,
      { md: 12 },
    ) as any;
    expect(result.itemStyle.color).toBe(MARKER_TP);
    expect(result.label.formatter).toBe("● TP");
  });

  it("colors SL exit with MARKER_SL", () => {
    const result = buildHighlightExitMarker(
      { price: 95, trade: { exit_reason: "SL" } },
      10,
      { md: 12 },
    ) as any;
    expect(result.itemStyle.color).toBe(MARKER_SL);
    expect(result.label.formatter).toBe("● SL");
  });

  it("colors EOD exit with MARKER_EOD", () => {
    const result = buildHighlightExitMarker(
      { price: 102, trade: { exit_reason: "EOD" } },
      10,
      { md: 12 },
    ) as any;
    expect(result.itemStyle.color).toBe(MARKER_EOD);
    expect(result.label.formatter).toBe("● EOD");
  });

  it("falls back to 'Exit' label when exit reason is missing", () => {
    const result = buildHighlightExitMarker(
      { price: 102, trade: { exit_reason: undefined } },
      10,
      { md: 12 },
    ) as any;
    expect(result.label.formatter).toBe("● Exit");
  });

  it("keeps a non-standard reason as-is in the label", () => {
    const result = buildHighlightExitMarker(
      { price: 102, trade: { exit_reason: "MANUAL" } },
      10,
      { md: 12 },
    ) as any;
    expect(result.label.formatter).toBe("● MANUAL");
  });

  it("returns null when exitMarker or exitIdx is missing", () => {
    expect(buildHighlightExitMarker(undefined, 10, { md: 12 })).toBeNull();
    expect(buildHighlightExitMarker({ price: 110, trade: { exit_reason: "TP" } }, undefined, { md: 12 })).toBeNull();
  });
});

describe("build52wHighSeries", () => {
  it("builds the 52W high target series with a markLine", () => {
    const result = build52wHighSeries([150, null, 150], 150, { sm: 10 });
    expect(result.id).toBe("selected-52w-high");
    expect(result.name).toBe("52W High Target");
    expect(result.type).toBe("line");
    expect(result.data).toEqual([150, null, 150]);
    expect(result.connectNulls).toBe(false);
    expect(result.z).toBe(6);
    expect(result.markLine.data).toEqual([{ yAxis: 150 }]);
    expect(result.markLine.lineStyle).toEqual({ color: expect.any(String), width: 2, type: "dashed" });
    expect(result.markLine.animation).toBe(false);
  });
});

describe("buildOrLevelSeries", () => {
  it("builds OR high and low line series", () => {
    const result = buildOrLevelSeries([120, null], [90, null]);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("selected-or-high");
    expect(result[0].name).toBe("Selected Level High");
    expect(result[0].data).toEqual([120, null]);
    expect(result[0].lineStyle.color).toBe(INDICATOR_BLUE_A);
    expect(result[1].id).toBe("selected-or-low");
    expect(result[1].name).toBe("Selected Level Low");
    expect(result[1].data).toEqual([90, null]);
    expect(result[1].lineStyle.color).toBe(INDICATOR_BLUE_B);
    result.forEach((s) => {
      expect(s.showSymbol).toBe(false);
      expect(s.connectNulls).toBe(false);
      expect(s.silent).toBe(true);
      expect(s.z).toBe(6);
      expect(s.tooltip.show).toBe(false);
    });
  });
});

describe("mapOverlayDateValues", () => {
  const candles = [{ date: "2025-01-15" }, { date: "2025-01-16" }, { date: "2025-01-17" }];

  it("maps the value to the matching date candle", () => {
    expect(mapOverlayDateValues(candles, "2025-01-16", 250)).toEqual([null, 250, null]);
  });

  it("returns all null when no date is provided", () => {
    expect(mapOverlayDateValues(candles, undefined, 100)).toEqual([null, null, null]);
  });

  it("returns all null for empty candles", () => {
    expect(mapOverlayDateValues([], "2025-01-15", 100)).toEqual([]);
  });
});
