// @vitest-environment happy-dom
import { describe, expect, test, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useBacktestLayout, RAIL_MIN_WIDTH } from "./useBacktestLayout";

describe("useBacktestLayout", () => {
  beforeEach(() => localStorage.clear());

  test("config panel open by default, results/trades closed", () => {
    const { result } = renderHook(() => useBacktestLayout());
    expect(result.current.panels.config).toBe(true);
    expect(result.current.panels.results).toBe(false);
    expect(result.current.panels.trades).toBe(false);
  });

  test("toggle/flatten panel open state", () => {
    const { result } = renderHook(() => useBacktestLayout());
    act(() => result.current.togglePanel("trades"));
    expect(result.current.panels.trades).toBe(true);
    act(() => result.current.togglePanel("trades"));
    expect(result.current.panels.trades).toBe(false);
    act(() => result.current.openPanel("results"));
    expect(result.current.panels.results).toBe(true);
  });

  test("rail width clamps and persists", () => {
    const { result } = renderHook(() => useBacktestLayout());
    act(() => result.current.setRailWidth(10));
    expect(result.current.railWidth).toBe(RAIL_MIN_WIDTH);
    act(() => result.current.setRailWidth(520));
    expect(result.current.railWidth).toBe(520);
    const saved = JSON.parse(localStorage.getItem("alphashri.backtest.layout.v1") || "{}");
    expect(saved.railWidth).toBe(520);
    expect(saved.panels.results).toBe(false);
  });

  test("reset restores defaults", () => {
    const { result } = renderHook(() => useBacktestLayout());
    act(() => result.current.setPanelOpen("trades", true));
    act(() => result.current.setRailWidth(700));
    act(() => result.current.reset());
    expect(result.current.panels.trades).toBe(false);
    expect(result.current.railWidth).not.toBe(700);
  });
});
