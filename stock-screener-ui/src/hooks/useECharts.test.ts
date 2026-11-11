// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useECharts } from "./useECharts";
import { attachMockDiv, applyOption, initChart, createMockECharts } from "./testFixtures";

const { mockEcharts, getChartInstance, install, uninstall } = createMockECharts();

beforeEach(() => {
  install();
});

afterEach(() => {
  cleanup();
  uninstall();
});

describe("useECharts", () => {
  it("returns chartRef, chartInstance, and setChartOption", async () => {
    const { result } = renderHook(() => useECharts({ isDark: false }));

    expect(result.current.chartRef).toBeDefined();
    expect(result.current.chartInstance).toBeDefined();
    expect(typeof result.current.setChartOption).toBe("function");
  });

  it("initializes chart on first setChartOption call", async () => {
    const { result } = renderHook(() => useECharts({ isDark: false }));

    const mockDiv = await initChart(result);

    expect(mockEcharts.init).toHaveBeenCalledWith(mockDiv, null);
  });

  it("initializes chart without theme (colors handled in options)", async () => {
    const { result } = renderHook(() => useECharts({ isDark: true }));

    const mockDiv = await initChart(result);

    expect(mockEcharts.init).toHaveBeenCalledWith(mockDiv, null);
  });

  it("registers click handler when onChartClick provided", async () => {
    const mockOnClick = vi.fn();
    const { result } = renderHook(() => useECharts({ isDark: false, onChartClick: mockOnClick }));

    await initChart(result);

    expect(getChartInstance().on).toHaveBeenCalledWith("click", mockOnClick);
  });

  it("does not register click handler without onChartClick", async () => {
    const { result } = renderHook(() => useECharts({ isDark: false }));

    await initChart(result);

    expect(getChartInstance().on).not.toHaveBeenCalled();
  });

  it("calls setOption with not merge and resizes", async () => {
    const { result } = renderHook(() => useECharts({ isDark: false }));

    await initChart(result, { title: { text: "Test" } });

    expect(getChartInstance().setOption).toHaveBeenCalledWith({ title: { text: "Test" } }, true);
    expect(getChartInstance().resize).toHaveBeenCalled();
  });

  it("does nothing when echarts library not available", async () => {
    delete (window as any).echarts;

    const { result } = renderHook(() => useECharts({ isDark: false }));

    attachMockDiv(result.current.chartRef);
    await applyOption(result, { series: [] });

    expect(mockEcharts.init).not.toHaveBeenCalled();
  });

  it("handles multiple setChartOption calls", async () => {
    const { result } = renderHook(() => useECharts({ isDark: false }));

    await initChart(result, { series: [{ type: "line" }] });
    await applyOption(result, { series: [{ type: "bar" }] });

    expect(getChartInstance().setOption).toHaveBeenCalledTimes(2);
  });

  it("retains click handler reference across options updates", async () => {
    const mockOnClick = vi.fn();
    const { result } = renderHook(() => useECharts({ isDark: false, onChartClick: mockOnClick }));

    await initChart(result, { series: [] });
    await applyOption(result, { xAxis: { type: "category" } });

    expect(getChartInstance().on).toHaveBeenCalledWith("click", mockOnClick);
    expect(getChartInstance().on).toHaveBeenCalledTimes(1);
  });

  it("does not init after unmount while the echarts import is in flight", async () => {
    const { result, unmount } = renderHook(() => useECharts({ isDark: false }));

    attachMockDiv(result.current.chartRef, { configurable: true });

    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.setChartOption({ series: [] });
    });
    unmount();
    await act(async () => {
      await pending;
    });

    expect(mockEcharts.init).not.toHaveBeenCalled();
  });
});
