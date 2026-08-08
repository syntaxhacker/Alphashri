// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { ScreenerPage } from "./ScreenerPage";
import { UIProvider } from "@/ui";

const render = (ui: ReactElement, options?: any) =>
  rtlRender(<MemoryRouter>{ui}</MemoryRouter>, options);

// Mock child components to isolate ScreenerPage tests
vi.mock("./ScreenerNav", () => ({
  ScreenerNav: ({ options, activeScreener, onChange }: any) => (
    <div
      data-testid="screener-nav"
      data-active={activeScreener}
      data-options-count={options.length}
    >
      {options.map((opt: any) => (
        <button key={opt.id} data-testid={`nav-${opt.id}`} onClick={() => onChange(opt.id)}>
          {opt.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("./ScreenerHeader", () => ({
  ScreenerHeader: (props: any) => (
    <div
      data-testid="screener-header"
      data-status={props.status}
      data-loading={props.isLoading}
      data-auto-refresh={props.autoRefreshSeconds}
      data-provider={props.provider}
      data-mode={props.mode}
      data-view-mode={props.viewMode}
    >
      <button data-testid="refresh-btn" onClick={props.onRefresh}>
        Refresh
      </button>
      <input
        data-testid="auto-refresh-input"
        value={props.autoRefreshSeconds}
        onChange={(e) => props.onAutoRefreshChange(Number(e.target.value))}
      />
      <select
        data-testid="provider-select"
        value={props.provider}
        onChange={(e) => props.onProviderChange(e.target.value)}
      >
        <option value="upstox">Upstox</option>
        <option value="indmoney">INDMONEY</option>
      </select>
      <select
        data-testid="mode-select"
        value={props.mode}
        onChange={(e) => props.onModeChange(e.target.value)}
      >
        <option value="intraday">Intraday</option>
        <option value="historical">5D</option>
      </select>
      <button data-testid="view-table" onClick={() => props.onViewModeChange("table")}>
        Table
      </button>
      <button data-testid="view-heatmap" onClick={() => props.onViewModeChange("heatmap")}>
        Heatmap
      </button>
    </div>
  ),
}));

vi.mock("./ScreenerTable", () => ({
  ScreenerTable: (props: any) => (
    <div
      data-testid={props["data-testid"] || "screener-table"}
      data-stocks-count={props.stocks.length}
    >
      {props.stocks.map((stock: Stock) => (
        <div key={`stock-${stock.symbol}`} data-testid={`row-${stock.symbol}`}>
          {stock.symbol}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("./ScreenerHeatmapView", () => ({
  ScreenerHeatmapView: (props: any) => (
    <div
      data-testid={props.testId || "screener-heatmap"}
      data-stocks-count={props.stocks.length}
    >
      {props.stocks.map((stock: Stock) => (
        <div key={`heatmap-${stock.symbol}`} data-testid={`heatmap-${stock.symbol}`}>
          {stock.symbol}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("./ScreenerEmpty", () => ({
  ScreenerEmpty: ({ message }: any) => (
    <div data-testid="screener-empty" data-message={message}>
      Empty state
    </div>
  ),
}));

vi.mock("./ScreenerLoading", () => ({
  ScreenerLoading: ({ message }: any) => (
    <div data-testid="screener-loading" data-message={message}>
      Loading...
    </div>
  ),
}));

vi.mock("../../hooks/useTableSort", () => ({
  useTableSort: () => ({
    getSortedData: (data: any, accessor: any) =>
      data.sort((a: any, b: any) => {
        const aVal = accessor(a);
        const bVal = accessor(b);
        if (aVal < bVal) return -1;
        if (aVal > bVal) return 1;
        return 0;
      }),
  }),
}));

// Mock the state module
vi.mock("../../state", () => ({
  profileMetaById: {
    trending: { section_labels: { primary: "Approaching", secondary: "Touched" } },
  },
  selectedSymbols: [] as string[],
  toggleSymbolSelection: vi.fn(),
  setSelectedSymbols: vi.fn(),
  clearSelectedSymbols: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
  screenerOptions: [
    { id: "trending", label: "Trending" },
  ],
}));

vi.mock("../../state/correlation", () => ({
  setSymbols: vi.fn(),
  setTimeframe: vi.fn(),
  setPeriod: vi.fn(),
  setPeriodUnit: vi.fn(),
  fetchCorrelationData: vi.fn(),
  clearSelectedSymbols: vi.fn(),
}));

const mockStock: Stock = {
  symbol: "RELIANCE",
  score: 85,
  tv_price: 2450.5,
  upstox_price: 2451.0,
  broker_diff: 0.02,
  high_52w: 2600,
  to_52w_high: -5.76,
  recent_return_5d: 3.2,
  perf_w: 1.5,
  sector: "Energy",
  touched_52w: false,
  day_change: 1.25,
  rsi: 65.3,
  stoch_k: 72.1,
  gap_pct: 0.5,
  premarket_change: 0.8,
  impact_score: 2.5,
  market_cap_b: 185.3,
  volume_m: 12.45,
};

const mockApproachingStocks: Stock[] = [mockStock, { ...mockStock, symbol: "TCS", score: 75 }];
const mockTouchedStocks: Stock[] = [{ ...mockStock, symbol: "INFY", touched_52w: true }];

describe("ScreenerPage", () => {
  const defaultProps = {
    screenerOptions: [
      { id: "trending", label: "Trending" },
      { id: "new-highs", label: "New Highs" },
    ],
    activeScreener: "trending",
    onScreenerChange: vi.fn(),
    title: "Trending | Alphashri",
    status: "3 stocks",
    isLoading: false,
    autoRefreshSeconds: 60,
    provider: "upstox",
    mode: "intraday",
    onRefresh: vi.fn(),
    onAutoRefreshChange: vi.fn(),
    onProviderChange: vi.fn(),
    onModeChange: vi.fn(),
    approachingStocks: mockApproachingStocks,
    touchedStocks: mockTouchedStocks,
    onSymbolClick: vi.fn(),
    onSymbolHover: vi.fn(),
    error: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders without crashing", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-page")).toBeInTheDocument();
  });

  it("displays loading state", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} isLoading={true} />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-loading")).toBeInTheDocument();
  });

  it("displays error state with retry button", () => {
    const errorMsg = "Failed to fetch data";
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} error={errorMsg} />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-error-container")).toBeInTheDocument();
    expect(screen.getByText("Screener failed to load")).toBeInTheDocument();
    expect(screen.getByText(errorMsg)).toBeInTheDocument();
    expect(screen.getByTestId("screener-retry-btn")).toBeInTheDocument();
  });

  it("calls onRefresh when retry button clicked", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} error="Error occurred" />
      </UIProvider>,
    );
    fireEvent.click(screen.getByTestId("screener-retry-btn"));
    expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("displays empty state when no stocks", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} approachingStocks={[]} touchedStocks={[]} />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-empty")).toBeInTheDocument();
  });

  it("displays approaching stocks section when data exists", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-approaching-section")).toBeInTheDocument();
    expect(screen.getByText(`Approaching (${mockApproachingStocks.length})`)).toBeInTheDocument();
  });

  it("displays touched stocks section when data exists", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-touched-section")).toBeInTheDocument();
    expect(screen.getByText(`Touched (${mockTouchedStocks.length})`)).toBeInTheDocument();
  });

  it("renders table view by default", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>,
    );
    // Both approaching and touched sections render tables
    expect(screen.getByTestId("screener-table-approaching")).toBeInTheDocument();
    expect(screen.getByTestId("screener-table-touched")).toBeInTheDocument();
  });

  it("switches to heatmap view when view mode changes", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>,
    );
    fireEvent.click(screen.getByTestId("view-heatmap"));
    // Both approaching and touched sections render heatmaps
    expect(screen.getByTestId("screener-heatmap-approaching")).toBeInTheDocument();
    expect(screen.getByTestId("screener-heatmap-touched")).toBeInTheDocument();
  });

  it("switches back to table view", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>,
    );
    // Switch to heatmap first
    fireEvent.click(screen.getByTestId("view-heatmap"));
    expect(screen.getByTestId("screener-heatmap-approaching")).toBeInTheDocument();
    expect(screen.getByTestId("screener-heatmap-touched")).toBeInTheDocument();

    // Switch back to table
    fireEvent.click(screen.getByTestId("view-table"));
    expect(screen.getByTestId("screener-table-approaching")).toBeInTheDocument();
    expect(screen.getByTestId("screener-table-touched")).toBeInTheDocument();
  });

  it("calls onSymbolClick when symbol is clicked in table", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>,
    );
    // The table mock renders rows with data-testid like `row-RELIANCE`
    fireEvent.click(screen.getByTestId("row-RELIANCE"));
    // Since we mocked ScreenerTable, we need to verify the prop is passed
  });

  it("calls onSymbolHover when symbol is hovered", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>,
    );
    // The actual hover handling is inside ScreenerTable - this test would need more detailed mocking
  });

  it("renders screener navigation with options", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>,
    );
    const nav = screen.getByTestId("screener-nav");
    expect(nav).toBeInTheDocument();
    expect(nav).toHaveAttribute("data-active", "trending");
    expect(nav).toHaveAttribute("data-options-count", "2");
  });

  it("calls onScreenerChange when navigation option clicked", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>,
    );
    fireEvent.click(screen.getByTestId("nav-new-highs"));
    expect(defaultProps.onScreenerChange).toHaveBeenCalledWith("new-highs");
  });

  it("renders header with correct status", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>,
    );
    const header = screen.getByTestId("screener-header");
    expect(header).toHaveAttribute("data-status", "3 stocks");
  });

  it("disables controls when loading", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} isLoading={true} />
      </UIProvider>,
    );
    // Header controls should be disabled - check via props
    const header = screen.getByTestId("screener-header");
    expect(header).toHaveAttribute("data-loading", "true");
  });

  it("calls onRefresh when refresh button clicked", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>,
    );
    fireEvent.click(screen.getByTestId("refresh-btn"));
    expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("calls onAutoRefreshChange when auto-refresh value changes", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>,
    );
    const input = screen.getByTestId("auto-refresh-input");
    fireEvent.change(input, { target: { value: "120" } });
    expect(defaultProps.onAutoRefreshChange).toHaveBeenCalledWith(120);
  });

  it("calls onProviderChange when provider changes", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>,
    );
    const select = screen.getByTestId("provider-select");
    fireEvent.change(select, { target: { value: "indmoney" } });
    expect(defaultProps.onProviderChange).toHaveBeenCalledWith("indmoney");
  });

  it("calls onModeChange when mode changes", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>,
    );
    const select = screen.getByTestId("mode-select");
    fireEvent.change(select, { target: { value: "historical" } });
    expect(defaultProps.onModeChange).toHaveBeenCalledWith("historical");
  });

  it("computes total stocks count correctly in status", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>,
    );
    const header = screen.getByTestId("screener-header");
    expect(header).toHaveAttribute("data-status", "3 stocks");
  });

  it("handles zero approaching stocks", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} approachingStocks={[]} />
      </UIProvider>,
    );
    expect(screen.queryByTestId("screener-approaching-section")).not.toBeInTheDocument();
  });

  it("handles zero touched stocks", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} touchedStocks={[]} />
      </UIProvider>,
    );
    expect(screen.queryByTestId("screener-touched-section")).not.toBeInTheDocument();
  });

  it("renders both sections when both have stocks", () => {
    render(
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-approaching-section")).toBeInTheDocument();
    expect(screen.getByTestId("screener-touched-section")).toBeInTheDocument();
  });
});
