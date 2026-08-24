// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach, beforeEach } from "vitest";
import { screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaperChart } from "./PaperChart2";
import { mockPosition } from "./testFixtures";
import { renderWithMantine } from "../../test-utils/renderWithMantine";
import type { PaperChartData, PaperTradingState } from "../../types/paperTrading";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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

const mockFetchPaperChart = vi.fn().mockResolvedValue(undefined);
const mockSetChartTimeframe = vi.fn();
const mockSetShowAllTrades = vi.fn();
const mockSetShowOrbLines = vi.fn();
const mockSetShowPivotLines = vi.fn();
const mockSetShow52wLines = vi.fn();
const mockSetShowEmaLines = vi.fn();

vi.mock("../../state/paperTrading", () => ({
  getPaperTradingState: vi.fn(() => currentState),
  subscribe: vi.fn(() => vi.fn()),
  setChartTimeframe: (...args: any[]) => mockSetChartTimeframe(...args),
  setShowAllTrades: (...args: any[]) => mockSetShowAllTrades(...args),
  setShowOrbLines: (...args: any[]) => mockSetShowOrbLines(...args),
  setShowPivotLines: (...args: any[]) => mockSetShowPivotLines(...args),
  setShow52wLines: (...args: any[]) => mockSetShow52wLines(...args),
  setShowEmaLines: (...args: any[]) => mockSetShowEmaLines(...args),
}));

vi.mock("../../api/paperTrading", () => ({
  fetchPaperChart: (...args: any[]) => mockFetchPaperChart(...args),
}));

vi.mock("../../hooks/useStoreSubscription", () => ({
  useStoreSubscription: vi.fn(),
}));

vi.mock("../chart/TradingChart", () => ({
  TradingChart: vi.fn(() => <div data-testid="mock-trading-chart">TradingChart</div>),
}));

// Mock MUI UI components for deterministic DOM interaction
// mui migrated

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

describe("PaperChart2 component rendering - empty states via DOM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchPaperChart.mockClear();
    mockSetChartTimeframe.mockClear();
  });

  test("renders empty state when selectedSymbol is null", () => {
    setState({ selectedSymbol: null, chartData: null, chartLoading: false });
    r(<PaperChart />);
    expect(screen.getByTestId("paper-chart-empty")).toBeInTheDocument();
    expect(screen.getByText("Select a position or trade to view chart")).toBeInTheDocument();
  });

  test("renders loading state when chartLoading is true (DOM)", () => {
    setState({ selectedSymbol: "RELIANCE", chartData: null, chartLoading: true });
    r(<PaperChart />);
    expect(screen.getByText(/Loading RELIANCE chart/)).toBeInTheDocument();
    // should have paper-chart-loading class container
    expect(screen.getByTestId("paper-chart-empty")).toHaveClass("paper-chart-loading");
  });

  test("renders error state when chartData is null but symbol selected (DOM)", () => {
    setState({ selectedSymbol: "RELIANCE", chartData: null, chartLoading: false });
    r(<PaperChart />);
    expect(screen.getByText(/No data available for RELIANCE/)).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
    expect(screen.getByTestId("paper-chart-empty")).toHaveClass("paper-chart-error");
  });

  test("renders no-data state when candles array is empty (DOM)", () => {
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

  test("renders timeframe select with chart-timeframe-select testId", () => {
    setState({
      selectedSymbol: "RELIANCE",
      chartData: mockChartData(),
      chartLoading: false,
    });
    r(<PaperChart />);
    expect(screen.getByTestId("chart-timeframe-select")).toBeInTheDocument();
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

  test("timeframe Select onChange calls setChartTimeframe and fetchPaperChart", async () => {
    const user = userEvent.setup();
    setState({
      selectedSymbol: "RELIANCE",
      chartData: mockChartData(),
      chartLoading: false,
      chartTimeframe: "5min",
      selectedStrategyId: 1,
    });
    r(<PaperChart />);
    const select = screen.getByTestId("chart-timeframe-select") as HTMLSelectElement;
    await user.selectOptions(select, "1hour");
    expect(mockSetChartTimeframe).toHaveBeenCalledWith("1hour");
    await waitFor(() => expect(mockFetchPaperChart).toHaveBeenCalled());
    // fetchPaperChart called with symbol, date, new timeframe, strategy, fromDate, true
    expect(mockFetchPaperChart).toHaveBeenCalledWith(
      "RELIANCE",
      "2026-04-24",
      "1hour",
      1,
      undefined,
      true
    );
  });

  test("DatePicker range change triggers fetchPaperChart", async () => {
    const user = userEvent.setup();
    setState({
      selectedSymbol: "RELIANCE",
      chartData: mockChartData(),
      chartLoading: false,
    });
    r(<PaperChart />);
    await user.click(screen.getByTestId("chart-date-set-range"));
    await waitFor(() => expect(mockFetchPaperChart).toHaveBeenCalled());
  });

  test("DatePicker invalid range (from > to) does not call fetchPaperChart", async () => {
    const user = userEvent.setup();
    setState({
      selectedSymbol: "RELIANCE",
      chartData: mockChartData(),
      chartLoading: false,
    });
    r(<PaperChart />);
    mockFetchPaperChart.mockClear();
    await user.click(screen.getByTestId("chart-date-invalid-range"));
    // should return early, not call fetch
    expect(mockFetchPaperChart).not.toHaveBeenCalled();
  });

  test("overlay Chip toggles call corresponding setters", async () => {
    const user = userEvent.setup();
    setState({
      selectedSymbol: "RELIANCE",
      chartData: mockChartData(),
      chartLoading: false,
      showOrbLines: false,
      showAllTrades: false,
    });
    r(<PaperChart />);
    // Chips rendered inside PopoverDropdown
    const orbChip = screen.getByTestId("chip-orb");
    await user.click(orbChip);
    expect(mockSetShowOrbLines).toHaveBeenCalledWith(true);

    const allChip = screen.getByTestId("chip-all");
    await user.click(allChip);
    expect(mockSetShowAllTrades).toHaveBeenCalledWith(true);
  });

  test("Retry button calls fetchPaperChart with forceRefresh true", async () => {
    const user = userEvent.setup();
    setState({ selectedSymbol: "RELIANCE", chartData: null, chartLoading: false, chartTimeframe: "5min", selectedStrategyId: 2 });
    r(<PaperChart />);
    const retry = screen.getByText("Retry");
    await user.click(retry);
    expect(mockFetchPaperChart).toHaveBeenCalledWith(
      "RELIANCE",
      expect.any(String),
      "5min",
      2,
      undefined,
      true
    );
  });

  test("getEmptyState branches all return correct class via DOM", () => {
    // null symbol
    setState({ selectedSymbol: null, chartData: null, chartLoading: false });
    const { unmount } = r(<PaperChart />);
    expect(screen.getByTestId("paper-chart-empty")).toHaveClass("paper-chart-empty");
    unmount(); cleanup();

    // loading
    setState({ selectedSymbol: "TCS", chartData: null, chartLoading: true });
    const { unmount: um2 } = r(<PaperChart />);
    expect(screen.getByTestId("paper-chart-empty")).toHaveClass("paper-chart-loading");
    um2(); cleanup();

    // error (symbol but no data)
    setState({ selectedSymbol: "TCS", chartData: null, chartLoading: false });
    const { unmount: um3 } = r(<PaperChart />);
    expect(screen.getByTestId("paper-chart-empty")).toHaveClass("paper-chart-error");
    um3(); cleanup();

    // no-data candles empty
    setState({ selectedSymbol: "TCS", chartData: mockChartData({ candles: [] }), chartLoading: false });
    r(<PaperChart />);
    expect(screen.getByTestId("paper-chart-empty")).toHaveClass("paper-chart-no-data");
  });
});
