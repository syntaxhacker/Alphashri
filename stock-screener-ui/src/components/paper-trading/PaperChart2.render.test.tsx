// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { PaperChart } from "./PaperChart2";
import { mockPosition } from "./testFixtures";
import { renderWithMantine } from "../../test-utils/renderWithMantine";
import type { PaperChartData, PaperTradingState } from "../../types/paperTrading";

afterEach(cleanup);

function createMockState(overrides: Partial<PaperTradingState> = {}): PaperTradingState {
  return {
    currentView: "live",
    positions: [],
    portfolio: null,
    trades: [],
    dailySummary: null,
    symbolPerformance: [],
    filterDate: null,
    filterFromDate: null,
    filterToDate: null,
    filterSymbol: null,
    filterStrategy: null,
    filterBot: null,
    selectedSymbol: null,
    selectedStrategyId: null,
    selectedStrategyTab: null,
    selectedTradeId: null,
    showAllTrades: false,
    showOrbLines: false,
    showPivotLines: false,
    show52wLines: false,
    showEmaLines: false,
    intradayOnly: false,
    chartData: null,
    chartLoading: false,
    chartTimeframe: "5min",
    chartFromDate: null,
    chartDataLive: null,
    chartTimeframeLive: "5min",
    chartFromDateLive: null,
    chartDataHistory: null,
    chartTimeframeHistory: "5min",
    chartFromDateHistory: null,
    isLoading: false,
    error: null,
    autoRefreshEnabled: true,
    botRunning: false,
    botPid: null,
    botLogFile: null,
    botSnapshot: null,
    strategyConfig: null,
    configLoading: false,
    configError: null,
    configDirty: false,
    availableBots: [],
    analyticsData: null,
    analyticsLoading: false,
    activityEvents: [],
    activityLoading: false,
    aggregatedData: null,
    aggregatedLoading: false,
    ...overrides,
  };
}

let currentState: PaperTradingState = createMockState();

vi.mock("../../state/paperTrading", () => ({
  getPaperTradingState: vi.fn(() => currentState),
  subscribe: vi.fn(() => vi.fn()),
  setChartTimeframe: vi.fn(),
  setShowAllTrades: vi.fn(),
  setShowOrbLines: vi.fn(),
  setShowPivotLines: vi.fn(),
  setShow52wLines: vi.fn(),
  setShowEmaLines: vi.fn(),
}));

vi.mock("../../api/paperTrading", () => ({
  fetchPaperChart: vi.fn(),
}));

vi.mock("../../hooks/useStoreSubscription", () => ({
  useStoreSubscription: vi.fn(),
}));

vi.mock("../chart/TradingChart", () => ({
  TradingChart: vi.fn(() => <div data-testid="mock-trading-chart">TradingChart</div>),
}));

function setState(overrides: Partial<PaperTradingState>) {
  currentState = createMockState(overrides);
}

function mockChartData(overrides: Partial<PaperChartData> = {}): PaperChartData {
  return {
    symbol: "RELIANCE",
    date: "2026-04-24",
    candles: [
      { time: "2026-04-24T09:15:00", open: 2500, high: 2510, low: 2490, close: 2505, volume: 100000 },
      { time: "2026-04-24T09:30:00", open: 2505, high: 2520, low: 2500, close: 2515, volume: 150000 },
    ],
    trades: [],
    orb_levels: null,
    week52_levels: null,
    pivot_levels: null,
    current_position: null,
    ...overrides,
  };
}

function r(jsx: React.ReactElement) {
  return renderWithMantine(jsx);
}

describe("PaperChart2 component rendering", () => {
  test("renders empty state when selectedSymbol is null", () => {
    setState({ selectedSymbol: null, chartData: null, chartLoading: false });
    r(<PaperChart />);
    expect(screen.getByTestId("paper-chart-empty")).toBeInTheDocument();
    expect(screen.getByText("Select a position or trade to view chart")).toBeInTheDocument();
  });

  test("renders loading state when chartLoading is true", () => {
    setState({ selectedSymbol: "RELIANCE", chartData: null, chartLoading: true });
    r(<PaperChart />);
    expect(screen.getByText(/Loading RELIANCE chart/)).toBeInTheDocument();
  });

  test("renders error state when chartData is null but symbol selected", () => {
    setState({ selectedSymbol: "RELIANCE", chartData: null, chartLoading: false });
    r(<PaperChart />);
    expect(screen.getByText(/No data available for RELIANCE/)).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  test("renders no-data state when candles array is empty", () => {
    setState({
      selectedSymbol: "RELIANCE",
      chartData: mockChartData({ candles: [] }),
      chartLoading: false,
    });
    r(<PaperChart />);
    expect(screen.getByText(/No candle data for RELIANCE/)).toBeInTheDocument();
  });

  test("renders chart container when data loaded", () => {
    setState({
      selectedSymbol: "RELIANCE",
      chartData: mockChartData(),
      chartLoading: false,
    });
    r(<PaperChart />);
    expect(screen.getByTestId("paper-chart-container")).toBeInTheDocument();
    expect(screen.getByTestId("paper-chart-header")).toBeInTheDocument();
  });

  test("renders timeframe select", () => {
    setState({
      selectedSymbol: "RELIANCE",
      chartData: mockChartData(),
      chartLoading: false,
    });
    r(<PaperChart />);
    expect(screen.getByTestId("paper-chart-timeframe")).toBeInTheDocument();
  });

  test("renders overlay toggle popover button", () => {
    setState({
      selectedSymbol: "RELIANCE",
      chartData: mockChartData(),
      chartLoading: false,
    });
    r(<PaperChart />);
    expect(screen.getByTestId("chart-more-button")).toBeInTheDocument();
  });

  test("renders position info when current_position set", () => {
    setState({
      selectedSymbol: "RELIANCE",
      chartData: mockChartData({
        current_position: mockPosition({
          symbol: "RELIANCE",
          side: "BUY",
          pnl: 5000,
          pnl_pct: 2.0,
          entry_price: 2500,
          quantity: 100,
        }),
      }),
      chartLoading: false,
    });
    r(<PaperChart />);
    expect(screen.getByTestId("position-info")).toBeInTheDocument();
    expect(screen.getByTestId("chart-legend")).toBeInTheDocument();
  });
});
