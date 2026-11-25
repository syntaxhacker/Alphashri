import { describe, expect, test } from "vitest";
import type { ChartIndicators, SRZone } from "@/types/chartPatterns";
import {
  CHART_INDICATOR_GROUPS,
  CHART_INDICATOR_SPECS,
  DEFAULT_CHART_INDICATOR_PREFS,
  activeChartIndicatorSpecs,
  chartIndicatorAvailability,
  hasIndicatorSeries,
  isVwapDisabledTimeframe,
} from "./chartIndicators";

function indicators(overrides: Partial<ChartIndicators> = {}): ChartIndicators {
  return {
    aligned: "candles",
    timeframe: "5m",
    session: "2026-11-25",
    partial_last: false,
    series: [
      { id: "sma20", values: [100, 101, 102] },
      { id: "sma50", values: [99, 100, 101] },
      { id: "sma200", values: [90, null, 92] },
      { id: "bbUpper", values: [110, 111, 112] },
      { id: "bbMiddle", values: [105, 106, 107] },
      { id: "bbLower", values: [100, 101, 102] },
      { id: "vwap", values: [101, 102, 103] },
    ],
    crosses: [{ t: "2026-11-25T09:30:00+05:30", kind: "golden" }],
    ...overrides,
  };
}

function zone(overrides: Partial<SRZone> = {}): SRZone {
  return {
    kind: "support",
    top: 101,
    bottom: 99,
    start_date: "2026-11-01",
    end_date: "2026-11-25",
    touches: 3,
    score: 0.8,
    ...overrides,
  };
}

describe("chart indicator specs", () => {
  test("registers the seven canonical indicators in menu order", () => {
    expect(CHART_INDICATOR_SPECS.map((spec) => spec.id)).toEqual([
      "sma20",
      "sma50",
      "sma200",
      "vwap",
      "bb",
      "crosses",
      "srZones",
    ]);
    expect(CHART_INDICATOR_GROUPS).toEqual(["MAs", "Studies", "Signals", "Zones"]);
    expect(CHART_INDICATOR_SPECS.every((spec) => spec.color.startsWith("#"))).toBe(true);
    expect(new Set(CHART_INDICATOR_SPECS.map((spec) => spec.tagPriority)).size).toBe(7);
  });

  test("defaults match the session contract", () => {
    expect(DEFAULT_CHART_INDICATOR_PREFS).toEqual({
      sma20: true,
      sma50: false,
      sma200: false,
      vwap: false,
      bb: false,
      crosses: false,
      srZones: false,
    });
  });

  test("VWAP is intraday-only on daily, weekly and monthly frames", () => {
    expect(isVwapDisabledTimeframe("1D")).toBe(true);
    expect(isVwapDisabledTimeframe("1W")).toBe(true);
    expect(isVwapDisabledTimeframe("1M")).toBe(true);
    expect(isVwapDisabledTimeframe(" 1M ")).toBe(true);
    // Case matters: `1m` is a minute frame, not a month.
    expect(isVwapDisabledTimeframe("1m")).toBe(false);
    expect(isVwapDisabledTimeframe("5m")).toBe(false);
    expect(isVwapDisabledTimeframe("1h")).toBe(false);
    expect(chartIndicatorAvailability("vwap", { timeframe: "1D" })).toEqual({
      enabled: false,
      reason: "Intraday only",
    });
    expect(
      chartIndicatorAvailability("vwap", {
        timeframe: "1m",
        indicators: indicators(),
      }),
    ).toEqual({ enabled: true, reason: null });
  });

  test("SMA200 needs 200 candles before it is selectable", () => {
    const ctx = { indicators: indicators(), candleCount: 199, timeframe: "1D" };
    expect(chartIndicatorAvailability("sma200", ctx)).toEqual({
      enabled: false,
      reason: "Needs 200 bars",
    });
    expect(chartIndicatorAvailability("sma200", { ...ctx, candleCount: 200 }).enabled).toBe(true);
  });

  test("rows without a payload series are disabled with a reason", () => {
    expect(
      chartIndicatorAvailability("sma50", {
        indicators: indicators({ series: [] }),
        candleCount: 300,
      }),
    ).toEqual({ enabled: false, reason: "No data" });
    expect(chartIndicatorAvailability("sma50", { candleCount: 300 })).toEqual({
      enabled: false,
      reason: "No data",
    });
    expect(
      chartIndicatorAvailability("crosses", { indicators: indicators({ crosses: [] }) }),
    ).toEqual({
      enabled: false,
      reason: "No data",
    });
  });

  test("S/R zones gate on the sr_zones payload count", () => {
    expect(chartIndicatorAvailability("srZones", { srZoneCount: 0 })).toEqual({
      enabled: false,
      reason: "No zones",
    });
    expect(chartIndicatorAvailability("srZones", { srZoneCount: 2 }).enabled).toBe(true);
    expect(chartIndicatorAvailability("srZones", { srZoneCount: 2 }).reason).toBeNull();
  });

  test("hasIndicatorSeries reads the aligned series bundle", () => {
    const bundle = indicators();
    expect(hasIndicatorSeries(bundle, "sma20")).toBe(true);
    expect(hasIndicatorSeries(bundle, "bb")).toBe(true);
    expect(hasIndicatorSeries(bundle, "vwap")).toBe(true);
    expect(hasIndicatorSeries(bundle, "crosses")).toBe(true);
    expect(hasIndicatorSeries({ ...bundle, crosses: [] }, "crosses")).toBe(false);
    expect(hasIndicatorSeries({ ...bundle, series: [] }, "sma20")).toBe(false);
    expect(hasIndicatorSeries(null, "sma20")).toBe(false);
  });

  test("active specs keep only enabled + drawable rows in tag priority order", () => {
    const active = activeChartIndicatorSpecs(DEFAULT_CHART_INDICATOR_PREFS, {
      timeframe: "5m",
      candleCount: 250,
      indicators: indicators(),
      srZoneCount: 1,
    });
    expect(active.map((spec) => spec.id)).toEqual(["sma20"]);
    expect(
      activeChartIndicatorSpecs(
        { ...DEFAULT_CHART_INDICATOR_PREFS, srZones: true, sma20: false },
        { srZoneCount: 1 },
      ).map((spec) => spec.id),
    ).toEqual(["srZones"]);
  });

  test("SR zone fixture stays typed against the transport contract", () => {
    expect(zone().touches).toBe(3);
  });
});
