// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

vi.mock("lightweight-charts", () => {
  const makeSeries = () => ({
    setData: vi.fn(),
    applyOptions: vi.fn(),
    removePriceLine: vi.fn(),
    createPriceLine: vi.fn(),
    priceScale: () => ({ applyOptions: vi.fn() }),
    priceToCoordinate: vi.fn(() => null),
  });
  return {
    createChart: vi.fn(() => ({
      addSeries: vi.fn(() => makeSeries()),
      removeSeries: vi.fn(),
      remove: vi.fn(),
      applyOptions: vi.fn(),
      panes: vi.fn(() => []),
      timeScale: vi.fn(() => ({
        subscribeVisibleLogicalRangeChange: vi.fn(),
        unsubscribeVisibleLogicalRangeChange: vi.fn(),
        fitContent: vi.fn(),
        setVisibleLogicalRange: vi.fn(),
        setVisibleRange: vi.fn(),
        timeToCoordinate: vi.fn(() => null),
      })),
    })),
    createSeriesMarkers: vi.fn(() => ({ setMarkers: vi.fn() })),
    ColorType: { Solid: "solid" },
    CandlestickSeries: "candlestick",
    HistogramSeries: "histogram",
    LineSeries: "line",
    LineStyle: { Dashed: 1, Dotted: 2, LargeDashed: 3, SparseDotted: 4, Solid: 0 },
    TickMarkType: { Year: 0, Month: 1, DayOfMonth: 2, TimeWithSeconds: 3, Time: 4 },
  };
});

import { TradingViewChart } from "./TradingViewChart";

afterEach(() => {
  cleanup();
});

const CANDLES = [
  { time: "2026-10-12 09:15:00", open: 25700, high: 25720, low: 25690, close: 25710, volume: 1000 },
  { time: "2026-10-12 09:16:00", open: 25710, high: 25730, low: 25700, close: 25725, volume: 1200 },
];

describe("TradingViewChart redraw loop", () => {
  test("resize redraws are coalesced and a pending frame is cancelled on unmount", () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame");
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");
    try {
      const { unmount } = render(<TradingViewChart candles={CANDLES} />);
      expect(rafSpy).not.toHaveBeenCalled();

      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(rafSpy).toHaveBeenCalledTimes(1);
      expect(cancelSpy).not.toHaveBeenCalled();

      // A second resize before the frame fires coalesces: the first frame
      // is cancelled instead of queueing a second one behind it.
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(rafSpy).toHaveBeenCalledTimes(2);
      expect(cancelSpy).toHaveBeenCalledTimes(1);

      // Unmounting with a frame still pending cancels it — the stale
      // drawEntryLabels closure (and its candle arrays) is never retained
      // past cleanup, and nothing draws on a detached canvas.
      unmount();
      expect(cancelSpy).toHaveBeenCalledTimes(2);
    } finally {
      rafSpy.mockRestore();
      cancelSpy.mockRestore();
    }
  });
});
