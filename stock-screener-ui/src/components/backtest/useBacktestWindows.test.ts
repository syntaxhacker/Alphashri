// @vitest-environment happy-dom
import { describe, expect, test, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useBacktestWindows, WINDOW_MIN_SIZES, DOCK_MIN_WIDTH } from "./useBacktestWindows";

describe("useBacktestWindows", () => {
  beforeEach(() => localStorage.clear());

  test("config open by default, results closed, dock closed", () => {
    const { result } = renderHook(() => useBacktestWindows());
    expect(result.current.windows.config.open).toBe(true);
    expect(result.current.windows.results.open).toBe(false);
    expect(result.current.dock.open).toBe(false);
  });

  test("toggle opens a window and focus raises its z-order", () => {
    const { result } = renderHook(() => useBacktestWindows());
    const zBefore = result.current.windows.results.z;
    act(() => result.current.toggle("results"));
    expect(result.current.windows.results.open).toBe(true);
    expect(result.current.windows.results.z).toBeGreaterThan(zBefore);
  });

  test("focus brings a window to the top", () => {
    const { result } = renderHook(() => useBacktestWindows());
    act(() => result.current.focus("config"));
    expect(result.current.windows.config.z).toBeGreaterThan(result.current.windows.results.z);
  });

  test("setGeometry clamps to the window minimum size", () => {
    const { result } = renderHook(() => useBacktestWindows());
    act(() => result.current.setGeometry("results", { x: 100, y: 120, width: 10, height: 10 }));
    expect(result.current.windows.results.geometry.width).toBe(WINDOW_MIN_SIZES.results.w);
    expect(result.current.windows.results.geometry.height).toBe(WINDOW_MIN_SIZES.results.h);
  });

  test("minimize keeps the window open (restorable)", () => {
    const { result } = renderHook(() => useBacktestWindows());
    act(() => result.current.minimize("config"));
    expect(result.current.windows.config.open).toBe(true);
    expect(result.current.windows.config.minimized).toBe(true);
    act(() => result.current.open("config"));
    expect(result.current.windows.config.minimized).toBe(false);
  });

  test("dock toggles and clamps width, persisted to localStorage", () => {
    const { result } = renderHook(() => useBacktestWindows());
    act(() => result.current.toggleDock());
    expect(result.current.dock.open).toBe(true);
    act(() => result.current.setDockWidth(10));
    expect(result.current.dock.width).toBe(DOCK_MIN_WIDTH);
    const saved = JSON.parse(localStorage.getItem("alphashri.backtest.windows.v4") || "{}");
    expect(saved.dock?.open).toBe(true);
    act(() => result.current.setDockWidth(500));
    expect(result.current.dock.width).toBe(500);
  });

  test("reset restores defaults", () => {
    const { result } = renderHook(() => useBacktestWindows());
    act(() => result.current.setGeometry("config", { x: 999, y: 999, width: 999, height: 999 }));
    act(() => result.current.toggle("results"));
    act(() => result.current.openDock());
    act(() => result.current.reset());
    expect(result.current.windows.config.geometry.x).not.toBe(999);
    expect(result.current.windows.results.open).toBe(false);
    expect(result.current.dock.open).toBe(false);
  });
});
