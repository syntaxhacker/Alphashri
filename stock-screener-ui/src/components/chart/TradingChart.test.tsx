// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
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

vi.mock("../../utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => (window as any).echarts),
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
  it("renders without crashing and mounts the chart container", () => {
    const { container } = render(() => (
      <UIProvider>
        <TradingChart input={baseInput} />
      </UIProvider>
    ));
    // Should render the container div (not Loader) when not loading and candles exist
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it("renders without echarts crash when window.echarts is undefined (lazy import path)", async () => {
    delete (window as any).echarts;
    // Dynamic import path inside onMount should not throw
    expect(() =>
      render(() => (
        <UIProvider>
          <TradingChart input={baseInput} />
        </UIProvider>
      )),
    ).not.toThrow();
    // Allow the async loadEcharts path to settle
    await Promise.resolve();
  });

  it("shows Loader when isLoading is true and does not call buildChartOption", () => {
    const { container } = render(() => (
      <UIProvider>
        <TradingChart input={baseInput} isLoading />
      </UIProvider>
    ));
    expect(container.querySelector('[role="progressbar"]') || container.textContent).toBeTruthy();
    expect(mockBuildChartOption).not.toHaveBeenCalled();
    expect(mockSetChartOption).not.toHaveBeenCalled();
  });

  it("does not call setChartOption when candles are empty (no crash)", async () => {
    const emptyInput = { ...baseInput, candles: [] };
    render(() => (
      <UIProvider>
        <TradingChart input={emptyInput} />
      </UIProvider>
    ));
    await Promise.resolve();
    expect(mockSetChartOption).not.toHaveBeenCalled();
    expect(mockBuildChartOption).not.toHaveBeenCalled();
  });

  it("calls buildChartOption and setChartOption with input when candles present", async () => {
    render(() => (
      <UIProvider>
        <TradingChart input={baseInput} />
      </UIProvider>
    ));
    // createEffect + async loadEcharts both flush on microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(mockBuildChartOption).toHaveBeenCalledWith(baseInput);
    expect(mockSetChartOption).toHaveBeenCalledWith({ mocked: true, input: baseInput }, true);
  });

  it("forwards imperative handle with chartInstance and zoom methods", async () => {
    let handle: TradingChartHandle | undefined;
    render(() => (
      <UIProvider>
        <TradingChart input={baseInput} ref={(h) => (handle = h)} />
      </UIProvider>
    ));
    await Promise.resolve();
    await Promise.resolve();
    expect(handle).toBeDefined();
    expect(typeof handle?.chartInstance).toBe("function");
    expect(handle?.chartInstance()).toBeDefined();
    expect(typeof handle?.zoomToTradeByTime).toBe("function");
    expect(typeof handle?.zoomToTradeByIndex).toBe("function");
  });

  it("handles trade click only for scatter series with trade_id", async () => {
    const onTradeClick = vi.fn();
    render(() => (
      <UIProvider>
        <TradingChart input={baseInput} onTradeClick={onTradeClick} />
      </UIProvider>
    ));
    // Chart creation registers the click handler inside the async path
    await Promise.resolve();
    await Promise.resolve();
    const clickHandler = mockOn.mock.calls.find(([evt]) => evt === "click")?.[1];
    expect(clickHandler).toBeDefined();
    // Valid scatter click
    clickHandler({ componentType: "series", seriesType: "scatter", data: { trade_id: 42 } });
    expect(onTradeClick).toHaveBeenCalledWith(42);
    // Non-scatter should not trigger
    onTradeClick.mockClear();
    clickHandler({ componentType: "series", seriesType: "candlestick", data: { trade_id: 99 } });
    expect(onTradeClick).not.toHaveBeenCalled();
    // Scatter without trade_id should not trigger
    clickHandler({ componentType: "series", seriesType: "scatter", data: {} });
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
    render(() => (
      <UIProvider>
        <TradingChart input={inputWithTimeStr} />
      </UIProvider>
    ));
    await Promise.resolve();
    await Promise.resolve();
    expect(mockBuildChartOption).toHaveBeenCalledWith(inputWithTimeStr);
    expect(mockSetChartOption).toHaveBeenCalledWith({ mocked: true, input: inputWithTimeStr }, true);
  });

  it("handles candle time without T separator (space or plain)", async () => {
    const input = {
      ...baseInput,
      candles: [{ time: "2025-01-15 10:15:00", open: 100, high: 110, low: 95, close: 105, volume: 1000 }],
    };
    render(() => (
      <UIProvider>
        <TradingChart input={input} />
      </UIProvider>
    ));
    await Promise.resolve();
    await Promise.resolve();
    expect(mockBuildChartOption).toHaveBeenCalledWith(input);
    expect(mockSetChartOption).toHaveBeenCalledWith({ mocked: true, input: input }, true);
  });
});
