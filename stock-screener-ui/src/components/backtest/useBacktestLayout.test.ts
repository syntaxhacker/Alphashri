// @vitest-environment happy-dom
import { describe, expect, test, beforeEach } from "vitest";
import { cleanup, renderHook } from "@solidjs/testing-library";
import { useBacktestLayout, RAIL_MIN_WIDTH } from "./useBacktestLayout";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

describe("useBacktestLayout", () => {
  beforeEach(() => localStorage.clear());

  test("config panel open by default, results/trades closed", () => {
    const { result } = renderHook(() => useBacktestLayout());
    expect(result.panels().config).toBe(true);
    expect(result.panels().results).toBe(false);
    expect(result.panels().trades).toBe(false);
    expect(result.panels().edge).toBe(false);
  });

  test("toggle/flatten panel open state", () => {
    const { result } = renderHook(() => useBacktestLayout());
    result.togglePanel("trades");
    expect(result.panels().trades).toBe(true);
    result.togglePanel("trades");
    expect(result.panels().trades).toBe(false);
    result.openPanel("results");
    expect(result.panels().results).toBe(true);
  });

  test("rail width clamps and persists", () => {
    const { result } = renderHook(() => useBacktestLayout());
    result.setRailWidth(10);
    expect(result.railWidth()).toBe(RAIL_MIN_WIDTH);
    result.setRailWidth(520);
    expect(result.railWidth()).toBe(520);
    const saved = JSON.parse(localStorage.getItem("alphashri.backtest.layout.v1") || "{}");
    expect(saved.railWidth).toBe(520);
    expect(saved.panels.results).toBe(false);
  });

  test("chart mode defaults to all and persists a change", () => {
    const { result } = renderHook(() => useBacktestLayout());
    expect(result.chartMode()).toBe("all");
    result.setChartMode("trades");
    expect(result.chartMode()).toBe("trades");
    const saved = JSON.parse(localStorage.getItem("alphashri.backtest.layout.v1") || "{}");
    expect(saved.chartMode).toBe("trades");
  });

  test("reset restores defaults", () => {
    const { result } = renderHook(() => useBacktestLayout());
    result.setPanelOpen("trades", true);
    result.setRailWidth(700);
    result.reset();
    expect(result.panels().trades).toBe(false);
    expect(result.railWidth()).not.toBe(700);
  });
});
