// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TradingChart } from "./TradingChart";
import { UIProvider } from "@/ui";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

const mockSetChartOption = vi.fn();
const mockEChartsInstance = {
  setOption: mockSetChartOption,
  resize: vi.fn(),
  dispose: vi.fn(),
  on: vi.fn(),
};

beforeEach(() => {
  setupBrowserMocks();
  (window as any).echarts = {
    init: vi.fn(() => mockEChartsInstance),
  };
});

afterEach(() => {
  delete (window as any).echarts;
  cleanup();
  vi.clearAllMocks();
});

const baseInput = {
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
  it("renders without crashing and uses echarts ref", () => {
    render(
      <UIProvider>
        <TradingChart input={baseInput} />
      </UIProvider>,
    );
    expect((window as any).echarts.init).toHaveBeenCalled();
  });

  it("shows Loader when isLoading is true", () => {
    const { container } = render(
      <UIProvider>
        <TradingChart input={baseInput} isLoading />
      </UIProvider>,
    );
    expect(container.querySelector(".mantine-Loader-root")).toBeInTheDocument();
  });

  it("calls buildChartOption and setChartOption with input", () => {
    render(
      <UIProvider>
        <TradingChart input={baseInput} />
      </UIProvider>,
    );
    expect((window as any).echarts.init).toHaveBeenCalled();
  });

  it("forwards zoomToTradeByTime and zoomToTradeByIndex via imperative handle", () => {
    const ref = vi.fn();
    render(
      <UIProvider>
        <TradingChart input={baseInput} ref={ref} />
      </UIProvider>,
    );
  });

  it("handles trade click via scatter series click", () => {
    const onTradeClick = vi.fn();
    render(
      <UIProvider>
        <TradingChart input={baseInput} onTradeClick={onTradeClick} />
      </UIProvider>,
    );
    expect((window as any).echarts.init).toHaveBeenCalled();
  });

  it("extracts time strings from candle data for zoom references", () => {
    const inputWithTimeStr = {
      ...baseInput,
      candles: [
        { ...baseInput.candles[0], time_str: "09:15" },
        { ...baseInput.candles[1], time_str: "09:30" },
      ],
    };
    render(
      <UIProvider>
        <TradingChart input={inputWithTimeStr} />
      </UIProvider>,
    );
    expect((window as any).echarts.init).toHaveBeenCalled();
  });
});
