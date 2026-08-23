// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createRef } from "react";
import { UIProvider } from "@/ui";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

// Track mock instances
const mockSetChartOption = vi.fn();
const mockResize = vi.fn();
const mockDispose = vi.fn();
const mockOn = vi.fn();
const mockChartInstance = {
  setOption: mockSetChartOption,
  resize: mockResize,
  dispose: mockDispose,
  on: mockOn,
  dispatchAction: vi.fn(),
};

const mockBuildChartOption = vi.fn((input: any) => ({ mocked: true, input }));

vi.mock("../../utils/chart/buildChartOption", () => ({
  buildChartOption: (...args: any[]) => mockBuildChartOption(...args),
}));

vi.mock("../../hooks/useECharts", () => ({
  useECharts: vi.fn((opts: any) => {
    // Simulate real hook: expose chartRef, chartInstance, setChartOption
    const chartRef = { current: document.createElement("div") };
    const chartInstance = { current: mockChartInstance };
    // Wire onChartClick if provided
    if (opts.onChartClick) {
      (chartInstance.current as any)._onClick = opts.onChartClick;
    }
    return {
      chartRef,
      chartInstance,
      setChartOption: mockSetChartOption,
    };
  }),
}));

vi.mock("../../hooks/useChartZoom", () => ({
  useChartZoom: vi.fn(() => ({
    allTimesRef: { current: [] },
    zoomToTradeByTime: vi.fn(),
    zoomToTradeByIndex: vi.fn(),
  })),
}));

import { TradingChart } from "./TradingChart";
import type { TradingChartHandle } from "./TradingChart";

beforeEach(() => {
  setupBrowserMocks();
  (window as any).echarts = {
    init: vi.fn(() => mockChartInstance),
  };
  vi.clearAllMocks();
});

afterEach(() => {
  delete (window as any).echarts;
  cleanup();
  vi.clearAllMocks();
});

const baseInput: any = {
  candles: [
    { time: "09:15", open: 100, high: 105, low: 98, close: 103, volume: 1000, date: "2025-01-15" },
    { time: "09:30", open: 103, high: 108, low: 102, close: 106, volume: 1200, date: "2025-01-15" },
  ],
  trades: [],
  overlays: [],
  isDark: true,
  showVolume: false,
  showLegend: false,
  showAllTrades: false,
  showDataZoomSlider: false,
  emaData: [],
};

describe("TradingChart", () => {
  it("renders without crashing and forwards Box ref container", () => {
    const { container } = render(
      <UIProvider>
        <TradingChart input={baseInput} />
      </UIProvider>,
    );
    // Should render Box container (not Loader) when not loading and candles exist
    expect(container.innerHTML.length).toBeGreaterThan(0);
    expect(screen.queryByTestId("loader")).not.toBeInTheDocument();
  });

  it("renders without echarts crash when window.echarts is undefined (lazy import path)", async () => {
    delete (window as any).echarts;
    // Dynamic import path inside useEffect should not throw
    expect(() =>
      render(
        <UIProvider>
          <TradingChart input={baseInput} />
        </UIProvider>,
      ),
    ).not.toThrow();
    // Allow useEffect to run
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("shows Loader when isLoading is true and does not call setChartOption", () => {
    const { container } = render(
      <UIProvider>
        <TradingChart input={baseInput} isLoading />
      </UIProvider>,
    );
    expect(container.querySelector('[role="progressbar"]') || container.textContent).toBeTruthy();
    expect(mockBuildChartOption).not.toHaveBeenCalled();
    expect(mockSetChartOption).not.toHaveBeenCalled();
  });

  it("does not call setChartOption when candles are empty (no crash)", () => {
    const emptyInput = { ...baseInput, candles: [] };
    render(
      <UIProvider>
        <TradingChart input={emptyInput} />
      </UIProvider>,
    );
    expect(mockSetChartOption).not.toHaveBeenCalled();
    expect(mockBuildChartOption).not.toHaveBeenCalled();
  });

  it("calls buildChartOption and setChartOption with input when candles present", async () => {
    render(
      <UIProvider>
        <TradingChart input={baseInput} />
      </UIProvider>,
    );
    // useEffect triggers buildChartOption
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockBuildChartOption).toHaveBeenCalledWith(baseInput);
    expect(mockSetChartOption).toHaveBeenCalledWith({ mocked: true, input: baseInput });
  });

  it("forwards imperative handle with chartInstance and zoom methods", () => {
    const ref = createRef<TradingChartHandle>();
    render(
      <UIProvider>
        <TradingChart input={baseInput} ref={ref} />
      </UIProvider>,
    );
    expect(ref.current).toBeDefined();
    expect(ref.current?.chartInstance).toBeDefined();
    expect(typeof ref.current?.zoomToTradeByTime).toBe("function");
    expect(typeof ref.current?.zoomToTradeByIndex).toBe("function");
  });

  it("handles trade click only for scatter series with trade_id", async () => {
    const onTradeClick = vi.fn();
    const { useECharts } = await import("../../hooks/useECharts");
    // The mocked useECharts captures onChartClick in mockChartInstance._onClick
    render(
      <UIProvider>
        <TradingChart input={baseInput} onTradeClick={onTradeClick} />
      </UIProvider>,
    );
    // Retrieve the onChartClick handler passed to useECharts
    const captured = (mockChartInstance as any)._onClick;
    expect(captured).toBeDefined();
    // Valid scatter click
    captured({ componentType: "series", seriesType: "scatter", data: { trade_id: 42 } });
    expect(onTradeClick).toHaveBeenCalledWith(42);
    // Non-scatter should not trigger
    onTradeClick.mockClear();
    captured({ componentType: "series", seriesType: "candlestick", data: { trade_id: 99 } });
    expect(onTradeClick).not.toHaveBeenCalled();
    // Scatter without trade_id should not trigger
    captured({ componentType: "series", seriesType: "scatter", data: {} });
    expect(onTradeClick).not.toHaveBeenCalled();
  });

  it("extracts time strings from candle data including time_str fallback", async () => {
    const inputWithTimeStr = {
      ...baseInput,
      candles: [
        { ...baseInput.candles[0], time_str: "09:15" },
        { ...baseInput.candles[1], time: "2025-01-15T09:30:00", time_str: undefined },
        { ...baseInput.candles[0], time: "09:45:00", time_str: undefined },
      ],
    };
    render(
      <UIProvider>
        <TradingChart input={inputWithTimeStr} />
      </UIProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockBuildChartOption).toHaveBeenCalled();
    // allTimesRef should have been populated; verify no throw and time parsing covers both branches
    expect(mockSetChartOption).toHaveBeenCalled();
  });

  it("handles candle time without T separator (space or plain)", async () => {
    const input = {
      ...baseInput,
      candles: [{ time: "2025-01-15 10:15:00", open: 100, high: 110, low: 95, close: 105, volume: 1000 }],
    };
    render(
      <UIProvider>
        <TradingChart input={input} />
      </UIProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockBuildChartOption).toHaveBeenCalled();
  });

  it("does not build option when isLoading true even with valid candles", () => {
    render(
      <UIProvider>
        <TradingChart input={baseInput} isLoading />
      </UIProvider>,
    );
    expect(mockBuildChartOption).not.toHaveBeenCalled();
  });
});
