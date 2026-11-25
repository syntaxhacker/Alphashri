// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { DEFAULT_CHART_INDICATOR_PREFS } from "@/config/chartIndicators";
import {
  __resetChartIndicatorPrefsForTests,
  chartIndicatorPrefs,
  isChartIndicatorEnabled,
  resetChartIndicatorPrefs,
  setChartIndicator,
  toggleChartIndicator,
} from "./chartIndicators";

describe("chart indicator session store", () => {
  afterEach(() => __resetChartIndicatorPrefsForTests());

  test("starts from the canonical defaults", () => {
    expect(chartIndicatorPrefs()).toEqual(DEFAULT_CHART_INDICATOR_PREFS);
    expect(isChartIndicatorEnabled("sma20")).toBe(true);
    expect(isChartIndicatorEnabled("vwap")).toBe(false);
  });

  test("set updates one row without touching the others", () => {
    setChartIndicator("vwap", true);
    expect(chartIndicatorPrefs()).toEqual({
      ...DEFAULT_CHART_INDICATOR_PREFS,
      vwap: true,
    });
    expect(chartIndicatorPrefs().sma20).toBe(true);
  });

  test("toggle flips the current value", () => {
    toggleChartIndicator("sma20");
    toggleChartIndicator("crosses");
    expect(chartIndicatorPrefs().sma20).toBe(false);
    expect(chartIndicatorPrefs().crosses).toBe(true);
    toggleChartIndicator("sma20");
    expect(chartIndicatorPrefs().sma20).toBe(true);
  });

  test("set is a no-op when the value already matches", () => {
    const before = chartIndicatorPrefs();
    setChartIndicator("sma20", true);
    expect(chartIndicatorPrefs()).toBe(before);
  });

  test("reset and the test-only reset both restore every default", () => {
    setChartIndicator("bb", true);
    setChartIndicator("srZones", true);
    resetChartIndicatorPrefs();
    expect(chartIndicatorPrefs()).toEqual(DEFAULT_CHART_INDICATOR_PREFS);

    setChartIndicator("sma200", true);
    __resetChartIndicatorPrefsForTests();
    expect(chartIndicatorPrefs()).toEqual(DEFAULT_CHART_INDICATOR_PREFS);
  });

  test("the store is session-scoped (module singleton), never localStorage-backed", () => {
    setChartIndicator("sma50", true);
    const first = chartIndicatorPrefs();
    // A second read (as a remounted component would do) sees the same value.
    expect(chartIndicatorPrefs()).toBe(first);
    expect(chartIndicatorPrefs().sma50).toBe(true);
    expect(window.localStorage.getItem("chartIndicators")).toBeNull();
    expect(window.localStorage.getItem("chart-indicator-prefs")).toBeNull();
  });
});
