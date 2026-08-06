// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { ReplayChart } from "./ReplayChart";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";
import { aggregateCandles } from "./ReplayChart";
import { createRef } from "react";
import type { ReplayChartHandle } from "./ReplayChart";

vi.mock("../chart/TradingChart", () => ({
  TradingChart: (props: any) => <div data-testid="trading-chart">TradingChart</div>,
}));

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

const baseProps = {
  candlesBySymbol: {},
  trades: [],
  orLevels: [],
  pivotLevels: [],
  high52wLevels: [],
  emaData: {},
  selectedSymbol: "",
  setSelectedSymbol: vi.fn(),
  chartOptions: {
    show_orb_zones: false,
    show_pivot_levels: false,
    show_52w_high: false,
    show_ema: false,
    show_markers: false,
    show_all_trades: false,
  },
  setChartOptions: vi.fn(),
  highlightedTradeId: null,
  onTradeClick: vi.fn(),
};

describe("aggregateCandles", () => {
  it("returns raw candles unchanged for 1m interval", () => {
    const candles = [
      { time: "09:15", open: 100, high: 105, low: 98, close: 103, volume: 1000 },
      { time: "09:16", open: 103, high: 106, low: 102, close: 104, volume: 500 },
    ];
    const result = aggregateCandles(candles, 1);
    expect(result).toEqual(candles);
  });

  it("groups candles into interval buckets", () => {
    const candles = [
      { time: "09:15", open: 100, high: 105, low: 98, close: 103, volume: 1000 },
      { time: "09:18", open: 103, high: 107, low: 102, close: 106, volume: 500 },
      { time: "09:22", open: 106, high: 108, low: 104, close: 107, volume: 300 },
    ];
    const result = aggregateCandles(candles, 5);
    expect(result).toHaveLength(2);
  });

  it("sorts aggregated groups by time", () => {
    const candles = [
      { time: "2025-05-09 09:25", open: 110, high: 112, low: 109, close: 111, volume: 400 },
      { time: "2025-05-09 09:10", open: 100, high: 105, low: 98, close: 103, volume: 1000 },
      { time: "2025-05-09 09:15", open: 103, high: 107, low: 102, close: 106, volume: 500 },
    ];
    const result = aggregateCandles(candles, 5);
    expect(result[0].time).toBe("2025-05-09 09:10");
    expect(result[1].time).toBe("2025-05-09 09:15");
    expect(result[2].time).toBe("2025-05-09 09:25");
  });

  it("aggregates OHLCV correctly", () => {
    const candles = [
      { time: "09:15", open: 100, high: 105, low: 98, close: 103, volume: 1000 },
      { time: "09:18", open: 103, high: 107, low: 102, close: 106, volume: 500 },
    ];
    const result = aggregateCandles(candles, 5);
    expect(result).toHaveLength(1);
    expect(result[0].open).toBe(100);
    expect(result[0].high).toBe(107);
    expect(result[0].low).toBe(98);
    expect(result[0].close).toBe(106);
    expect(result[0].volume).toBe(1500);
  });

  it("returns empty array for empty input", () => {
    const result = aggregateCandles([], 5);
    expect(result).toEqual([]);
  });
});

describe("ReplayChart", () => {
  it("shows empty state message when no symbols available", () => {
    render(
      <UIProvider>
        <ReplayChart {...baseProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("replay-chart-empty")).toBeInTheDocument();
    expect(screen.getByText("Run a replay to see chart")).toBeInTheDocument();
  });

  it("renders symbol badges for each symbol in candlesBySymbol", () => {
    const props = {
      ...baseProps,
      candlesBySymbol: {
        TCS: [{ time: "09:15", open: 100, high: 105, low: 98, close: 103, volume: 1000 }],
        INFY: [{ time: "09:15", open: 2000, high: 2050, low: 1990, close: 2020, volume: 500 }],
      },
    };
    render(
      <UIProvider>
        <ReplayChart {...props} />
      </UIProvider>,
    );
    expect(screen.getByTestId("symbol-badge-TCS")).toBeInTheDocument();
    expect(screen.getByTestId("symbol-badge-INFY")).toBeInTheDocument();
  });

  it("renders TF preset buttons: 1m, 5m, 15m, 1h, 1D", () => {
    const props = {
      ...baseProps,
      candlesBySymbol: {
        TCS: [{ time: "09:15", open: 100, high: 105, low: 98, close: 103, volume: 1000 }],
      },
    };
    render(
      <UIProvider>
        <ReplayChart {...props} />
      </UIProvider>,
    );
    expect(screen.getByTestId("tf-btn-1m")).toBeInTheDocument();
    expect(screen.getByTestId("tf-btn-5m")).toBeInTheDocument();
    expect(screen.getByTestId("tf-btn-15m")).toBeInTheDocument();
    expect(screen.getByTestId("tf-btn-1h")).toBeInTheDocument();
    expect(screen.getByTestId("tf-btn-1D")).toBeInTheDocument();
  });

  it("renders all switch toggles", () => {
    const props = {
      ...baseProps,
      candlesBySymbol: {
        TCS: [{ time: "09:15", open: 100, high: 105, low: 98, close: 103, volume: 1000 }],
      },
    };
    render(
      <UIProvider>
        <ReplayChart {...props} />
      </UIProvider>,
    );
    expect(screen.getByTestId("replay-show-all-trades")).toBeInTheDocument();
    expect(screen.getByTestId("replay-show-markers")).toBeInTheDocument();
    expect(screen.getByTestId("replay-show-orb")).toBeInTheDocument();
    expect(screen.getByTestId("replay-show-pivot")).toBeInTheDocument();
    expect(screen.getByTestId("replay-show-52w")).toBeInTheDocument();
    expect(screen.getByTestId("replay-show-ema")).toBeInTheDocument();
  });

  it("Show Markers switch is disabled", () => {
    const props = {
      ...baseProps,
      candlesBySymbol: {
        TCS: [{ time: "09:15", open: 100, high: 105, low: 98, close: 103, volume: 1000 }],
      },
    };
    render(
      <UIProvider>
        <ReplayChart {...props} />
      </UIProvider>,
    );
    const markersSwitch = screen.getByTestId("replay-show-markers");
    expect(markersSwitch).toBeDisabled();
  });

  it("active symbol badge renders with symbol text", () => {
    const props = {
      ...baseProps,
      candlesBySymbol: {
        TCS: [{ time: "09:15", open: 100, high: 105, low: 98, close: 103, volume: 1000 }],
        INFY: [{ time: "09:15", open: 2000, high: 2050, low: 1990, close: 2020, volume: 500 }],
      },
      selectedSymbol: "TCS",
    };
    render(
      <UIProvider>
        <ReplayChart {...props} />
      </UIProvider>,
    );
    expect(screen.getByTestId("symbol-badge-TCS")).toBeInTheDocument();
    expect(screen.getByTestId("symbol-badge-INFY")).toBeInTheDocument();
    expect(screen.getByText("TCS")).toBeInTheDocument();
    expect(screen.getByText("INFY")).toBeInTheDocument();
  });

  it("clicking TF preset renders chart", async () => {
    const user = userEvent.setup();
    const props = {
      ...baseProps,
      candlesBySymbol: {
        TCS: [
          { time: "09:15", open: 100, high: 105, low: 98, close: 103, volume: 1000 },
          { time: "09:20", open: 103, high: 107, low: 102, close: 106, volume: 500 },
        ],
      },
      selectedSymbol: "TCS",
    };
    render(
      <UIProvider>
        <ReplayChart {...props} />
      </UIProvider>,
    );
    const btn5m = screen.getByTestId("tf-btn-5m");
    await user.click(btn5m);
    expect(screen.getByTestId("trading-chart")).toBeInTheDocument();
  });

  it("setTimeframe imperative handle is callable", () => {
    const ref = createRef<ReplayChartHandle>();
    const props = {
      ...baseProps,
      candlesBySymbol: {
        TCS: [{ time: "09:15", open: 100, high: 105, low: 98, close: 103, volume: 1000 }],
      },
      selectedSymbol: "TCS",
    };
    render(
      <UIProvider>
        <ReplayChart {...props} ref={ref} />
      </UIProvider>,
    );
    expect(ref.current).toBeTruthy();
    ref.current!.setTimeframe(60);
    expect(screen.getByTestId("trading-chart")).toBeInTheDocument();
  });
});
