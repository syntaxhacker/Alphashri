// @vitest-environment happy-dom
import { describe, expect, test, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useBacktestWindows, WINDOW_MIN_SIZES } from "./useBacktestWindows";

describe("useBacktestWindows", () => {
  beforeEach(() => localStorage.clear());

  test("opens config by default, results/trades closed", () => {
    const { result } = renderHook(() => useBacktestWindows());
    expect(result.current.windows.config.open).toBe(true);
    expect(result.current.windows.results.open).toBe(false);
    expect(result.current.windows.trades.open).toBe(false);
  });

  test("toggle opens a window and focus raises its z-order", () => {
    const { result } = renderHook(() => useBacktestWindows());
    const zBefore = result.current.windows.trades.z;
    act(() => result.current.toggle("trades"));
    expect(result.current.windows.trades.open).toBe(true);
    expect(result.current.windows.trades.z).toBeGreaterThan(zBefore);
  });

  test("focus brings a window to the top", () => {
    const { result } = renderHook(() => useBacktestWindows());
    act(() => result.current.focus("config"));
    const zConfig = result.current.windows.config.z;
    expect(zConfig).toBeGreaterThan(result.current.windows.trades.z);
  });

  test("setGeometry updates and persists to localStorage", () => {
    const { result } = renderHook(() => useBacktestWindows());
    act(() => result.current.setGeometry("config", { x: 100, y: 120, width: 500, height: 300 }));
    expect(result.current.windows.config.geometry).toEqual({ x: 100, y: 120, width: 500, height: 300 });
    const saved = JSON.parse(localStorage.getItem("alphashri.backtest.windows.v3") || "{}");
    expect(saved.config.geometry).toEqual({ x: 100, y: 120, width: 500, height: 300 });
  });

  test("setGeometry clamps to the window's minimum size", () => {
    const { result } = renderHook(() => useBacktestWindows());
    act(() => result.current.setGeometry("trades", { x: 0, y: 0, width: 10, height: 10 }));
    expect(result.current.windows.trades.geometry.width).toBe(WINDOW_MIN_SIZES.trades.w);
    expect(result.current.windows.trades.geometry.height).toBe(WINDOW_MIN_SIZES.trades.h);
  });

  test("minimize keeps the window open (restorable)", () => {
    const { result } = renderHook(() => useBacktestWindows());
    act(() => result.current.minimize("config"));
    expect(result.current.windows.config.open).toBe(true);
    expect(result.current.windows.config.minimized).toBe(true);
    act(() => result.current.open("config"));
    expect(result.current.windows.config.minimized).toBe(false);
  });

  test("reset restores defaults", () => {
    const { result } = renderHook(() => useBacktestWindows());
    act(() => result.current.setGeometry("config", { x: 999, y: 999, width: 999, height: 999 }));
    act(() => result.current.toggle("results"));
    act(() => result.current.reset());
    expect(result.current.windows.config.geometry.x).not.toBe(999);
    expect(result.current.windows.results.open).toBe(false);
  });
});
