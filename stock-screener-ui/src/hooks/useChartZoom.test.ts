// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useChartZoom, computeZoomRange, dispatchZoom } from "./useChartZoom";

// Mock parseTimeToHHMM
vi.mock("../utils/ui-helpers", () => ({
  parseTimeToHHMM: vi.fn((time: string) => {
    // Convert "HH:MM:SS" to "HH:MM"
    if (time.includes(":")) {
      const parts = time.split(":");
      return `${parts[0]}:${parts[1]}`;
    }
    return time;
  }),
}));

describe("useChartZoom", () => {
  let mockChartInstance: any;

  beforeEach(() => {
    mockChartInstance = {
      dispatchAction: vi.fn(),
    };
  });

  afterEach(() => {
  cleanup();
    vi.clearAllMocks();
  });

  describe("computeZoomRange", () => {
    it("computes correct range with sufficient span", () => {
      const result = computeZoomRange(10, 20, 100);
      expect(result.start).toBeLessThanOrEqual(10);
      expect(result.end).toBeGreaterThanOrEqual(20);
      // Inclusive span: end - start + 1 should be >= minWindow (60)
      expect(result.end - result.start + 1).toBeGreaterThanOrEqual(60);
    });

    it("adds padding around the range", () => {
      const result = computeZoomRange(40, 50, 100);
      const span = result.end - result.start + 1;
      expect(span).toBeGreaterThanOrEqual(60); // minWindow
    });

    it("does not go below 0", () => {
      const result = computeZoomRange(2, 5, 100);
      expect(result.start).toBeGreaterThanOrEqual(0);
    });

    it("does not exceed total-1", () => {
      const result = computeZoomRange(90, 95, 100);
      expect(result.end).toBeLessThanOrEqual(99);
    });

    it("handles start at 0 correctly", () => {
      const result = computeZoomRange(0, 10, 100);
      expect(result.start).toBe(0);
      expect(result.end).toBeGreaterThan(0);
    });

    it("handles end at total-1 correctly", () => {
      const result = computeZoomRange(90, 99, 100);
      expect(result.end).toBe(99);
      expect(result.start).toBeLessThan(90);
    });

    it("adjusts when range is smaller than minWindow", () => {
      const result = computeZoomRange(5, 10, 100); // span = 6
      expect(result.end - result.start + 1).toBeGreaterThanOrEqual(60);
    });
  });

  describe("dispatchZoom", () => {
    it("dispatches two dataZoom actions with correct percentages", () => {
      const chart = {
        dispatchAction: vi.fn(),
      };

      dispatchZoom(chart, 20, 30, 100);

      // computeZoomRange(20, 30, 100) adds padding to reach minWindow=60
      // Returns {start: 0, end: 59} after padding adjustment
      // startPct = (0 / 100) * 100 = 0
      // endPct = ((59 + 1) / 100) * 100 = 60

      expect(chart.dispatchAction).toHaveBeenCalledTimes(2);
      expect(chart.dispatchAction).toHaveBeenNthCalledWith(1, {
        type: "dataZoom",
        dataZoomIndex: 0,
        start: 0,
        end: 60,
      });
      expect(chart.dispatchAction).toHaveBeenNthCalledWith(2, {
        type: "dataZoom",
        dataZoomIndex: 1,
        start: 0,
        end: 60,
      });
    });

    it("calculates correct edge case percentages", () => {
      const chart = { dispatchAction: vi.fn() };

      dispatchZoom(chart, 0, 0, 100);

      // computeZoomRange(0, 0, 100) adds padding to reach minWindow=60
      // Returns {start: 0, end: 59}
      // startPct = 0, endPct = 60

      expect(chart.dispatchAction).toHaveBeenNthCalledWith(1, {
        type: "dataZoom",
        dataZoomIndex: 0,
        start: 0,
        end: 60,
      });
    });

    it("handles full range", () => {
      const chart = { dispatchAction: vi.fn() };

      dispatchZoom(chart, 0, 99, 100);

      expect(chart.dispatchAction).toHaveBeenNthCalledWith(1, {
        type: "dataZoom",
        dataZoomIndex: 0,
        start: 0,
        end: 100,
      });
    });
  });

  describe("useChartZoom hook", () => {
    it("returns allTimesRef and zoom functions", () => {
      const { result } = renderHook(() =>
        useChartZoom({ chartInstance: { current: mockChartInstance } as any }),
      );

      expect(result.current.allTimesRef).toBeDefined();
      expect(typeof result.current.zoomToTradeByTime).toBe("function");
      expect(typeof result.current.zoomToTradeByIndex).toBe("function");
    });

    it("zoomToTradeByIndex calls dispatchZoom after timeout", () => {
      vi.useFakeTimers();
      const { result } = renderHook(() =>
        useChartZoom({ chartInstance: { current: mockChartInstance } as any }),
      );

      act(() => {
        result.current.zoomToTradeByIndex(10, 20, 100);
      });

      expect(mockChartInstance.dispatchAction).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(150);
      });

      expect(mockChartInstance.dispatchAction).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it("zoomToTradeByIndex does nothing if no chart instance", () => {
      const { result } = renderHook(() =>
        useChartZoom({ chartInstance: { current: null } as any }),
      );

      act(() => {
        result.current.zoomToTradeByIndex(10, 20, 100);
      });

      // No error thrown, no calls
      expect(mockChartInstance.dispatchAction).not.toHaveBeenCalled();
    });

    it("zoomToTradeByTime finds exact time match", () => {
      vi.useFakeTimers();
      const { result } = renderHook(() =>
        useChartZoom({ chartInstance: { current: mockChartInstance } as any }),
      );

      const times = ["09:15", "09:16", "09:17", "09:18"];
      result.current.allTimesRef.current = times;

      act(() => {
        result.current.zoomToTradeByTime("09:16:45", "09:17:30");
      });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      // Should find index 1 for 09:16 and 2 for 09:17
      // computeZoomRange adds padding, so with total=4, minWindow=4
      // This results in start=0, end=3, so startPct=0, endPct=100
      expect(mockChartInstance.dispatchAction).toHaveBeenCalledWith({
        type: "dataZoom",
        dataZoomIndex: 0,
        start: 0,
        end: 100,
      });
      vi.useRealTimers();
    });

    it("zoomToTradeByTime finds best match when exact not found", () => {
      vi.useFakeTimers();
      const { result } = renderHook(() =>
        useChartZoom({ chartInstance: { current: mockChartInstance } as any }),
      );

      const times = ["09:15", "09:20", "09:25"];
      result.current.allTimesRef.current = times;

      act(() => {
        result.current.zoomToTradeByTime("09:17", "09:22");
      });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      // 09:17 -> best match before it is 09:15 (index 0)
      // 09:22 -> best match before it is 09:20 (index 1)
      expect(mockChartInstance.dispatchAction).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("zoomToTradeByTime handles empty times array", () => {
      vi.useFakeTimers();
      const { result } = renderHook(() =>
        useChartZoom({ chartInstance: { current: mockChartInstance } as any }),
      );

      result.current.allTimesRef.current = [];

      act(() => {
        result.current.zoomToTradeByTime("09:15", "09:20");
      });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(mockChartInstance.dispatchAction).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("zoomToTradeByTime handles entry time before first time", () => {
      vi.useFakeTimers();
      const { result } = renderHook(() =>
        useChartZoom({ chartInstance: { current: mockChartInstance } as any }),
      );

      const times = ["09:16", "09:17", "09:18"];
      result.current.allTimesRef.current = times;

      act(() => {
        result.current.zoomToTradeByTime("09:10", "09:17");
      });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      // 09:10 is before first time, should fall back to index 0
      expect(mockChartInstance.dispatchAction).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("zoomToTradeByTime handles exit time after last time", () => {
      vi.useFakeTimers();
      const { result } = renderHook(() =>
        useChartZoom({ chartInstance: { current: mockChartInstance } as any }),
      );

      const times = ["09:15", "09:16", "09:17"];
      result.current.allTimesRef.current = times;

      act(() => {
        result.current.zoomToTradeByTime("09:16", "09:20");
      });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      // 09:20 is after last time, should fall back to index 2 (last)
      expect(mockChartInstance.dispatchAction).toHaveBeenCalled();
      vi.useRealTimers();
    });
  });
});
