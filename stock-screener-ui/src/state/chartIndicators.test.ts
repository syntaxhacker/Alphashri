// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_CHART_INDICATOR_PREFS } from "@/config/chartIndicators";
import {
  __resetChartIndicatorPrefsForTests,
  CHART_INDICATOR_PREFS_STORAGE_KEY,
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

  test("uses the versioned localStorage key", () => {
    expect(CHART_INDICATOR_PREFS_STORAGE_KEY).toBe("alphashri_chart_indicators_v1");
  });

  test("writes the whole snapshot on every change, including reset", () => {
    expect(window.localStorage.getItem(CHART_INDICATOR_PREFS_STORAGE_KEY)).toBeNull();

    setChartIndicator("vwap", true);
    expect(JSON.parse(window.localStorage.getItem(CHART_INDICATOR_PREFS_STORAGE_KEY)!)).toEqual({
      ...DEFAULT_CHART_INDICATOR_PREFS,
      vwap: true,
    });

    toggleChartIndicator("sma20");
    expect(JSON.parse(window.localStorage.getItem(CHART_INDICATOR_PREFS_STORAGE_KEY)!)).toEqual({
      ...DEFAULT_CHART_INDICATOR_PREFS,
      sma20: false,
      vwap: true,
    });

    resetChartIndicatorPrefs();
    expect(JSON.parse(window.localStorage.getItem(CHART_INDICATOR_PREFS_STORAGE_KEY)!)).toEqual(
      DEFAULT_CHART_INDICATOR_PREFS,
    );
  });

  test("the test-only reset clears the stored key", () => {
    setChartIndicator("crosses", true);
    expect(window.localStorage.getItem(CHART_INDICATOR_PREFS_STORAGE_KEY)).not.toBeNull();

    __resetChartIndicatorPrefsForTests();
    expect(window.localStorage.getItem(CHART_INDICATOR_PREFS_STORAGE_KEY)).toBeNull();
  });
});

describe("chart indicator hydration", () => {
  afterEach(() => __resetChartIndicatorPrefsForTests());

  async function hydrate(raw: string | null) {
    if (raw === null) window.localStorage.removeItem(CHART_INDICATOR_PREFS_STORAGE_KEY);
    else window.localStorage.setItem(CHART_INDICATOR_PREFS_STORAGE_KEY, raw);
    vi.resetModules();
    return import("./chartIndicators");
  }

  test("a fresh module reads stored choices and keeps defaults for missing ids", async () => {
    const fresh = await hydrate(JSON.stringify({ sma20: false, vwap: true, sma50: false }));
    expect(fresh.chartIndicatorPrefs()).toEqual({
      ...DEFAULT_CHART_INDICATOR_PREFS,
      sma20: false,
      vwap: true,
    });
    expect(fresh.chartIndicatorPrefs().sma200).toBe(false);
  });

  test("unknown ids, non-boolean values and array/null payloads are ignored", async () => {
    let fresh = await hydrate(
      JSON.stringify({ srZones: true, bb: "yes", sma200: 1, unknown: true }),
    );
    expect(fresh.chartIndicatorPrefs()).toEqual({
      ...DEFAULT_CHART_INDICATOR_PREFS,
      srZones: true,
    });

    fresh = await hydrate(JSON.stringify(["sma20", true]));
    expect(fresh.chartIndicatorPrefs()).toEqual(DEFAULT_CHART_INDICATOR_PREFS);

    fresh = await hydrate("null");
    expect(fresh.chartIndicatorPrefs()).toEqual(DEFAULT_CHART_INDICATOR_PREFS);
  });

  test("malformed JSON falls back to the canonical defaults", async () => {
    const fresh = await hydrate("{not json");
    expect(fresh.chartIndicatorPrefs()).toEqual(DEFAULT_CHART_INDICATOR_PREFS);
  });

  test("an absent key falls back to the canonical defaults without writing", async () => {
    const fresh = await hydrate(null);
    expect(fresh.chartIndicatorPrefs()).toEqual(DEFAULT_CHART_INDICATOR_PREFS);
    expect(window.localStorage.getItem(CHART_INDICATOR_PREFS_STORAGE_KEY)).toBeNull();
  });
});
