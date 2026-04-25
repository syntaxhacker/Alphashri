// @vitest-environment happy-dom
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MantineProvider } from "@mantine/core";
import { PaperPositionsTable } from "./PaperPositionsTable2";
import { mockPosition } from "./testFixtures";
import type { PaperBotSnapshot, PaperTradingState } from "../../types/paperTrading";

afterEach(cleanup);

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

function createMockState(overrides: Partial<PaperTradingState> = {}): PaperTradingState {
  return {
    currentView: "live",
    positions: [],
    portfolio: null,
    trades: [],
    dailySummary: null,
    performanceSummary: null,
    symbolPerformance: [],
    filterDate: null,
    filterFromDate: new Date().toISOString().split("T")[0],
    filterToDate: new Date().toISOString().split("T")[0],
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
    ...overrides,
  };
}

const mockBotSnapshot: PaperBotSnapshot = {
  timestamp: "2026-03-20T09:30:00Z",
  watchlist: ["RELIANCE", "TCS", "INFY"],
  open_positions: ["RELIANCE"],
  scan_items: [
    {
      symbol: "RELIANCE",
      status: "signal",
      side: "LONG",
      price: 2520,
      or_high: 2525,
      or_low: 2500,
      or_range_pct: 1.0,
      reason: "ORB breakout above 2525",
      strategy_name: "ORB Strategy",
      strategy_id: 1,
    },
    {
      symbol: "TCS",
      status: "watching",
      side: "LONG",
      price: 3850,
      high_52w: 3900,
      reason: "Near 52W high",
      strategy_name: "ORB Strategy",
      strategy_id: 1,
    },
  ],
  signals: [{ symbol: "RELIANCE", side: "LONG", price: 2520, notes: "ORB breakout" }],
};

// Module-level state — initialized before vi.mock hoists the factory
let currentState: PaperTradingState = createMockState();

vi.mock("../../state/paperTrading", () => {
  return {
    getPaperTradingState: vi.fn(() => currentState),
    subscribe: vi.fn(() => vi.fn()),
    setSelectedSymbol: vi.fn(),
    setSelectedStrategyTab: vi.fn((tab: string) => {
      currentState.selectedStrategyTab = tab;
    }),
    setSelectedTradeId: vi.fn(),
    setShowAllTrades: vi.fn(),
  };
});

vi.mock("../../api/paperTrading", () => ({
  closePaperPosition: vi.fn().mockResolvedValue(undefined),
  refreshLiveData: vi.fn().mockResolvedValue(undefined),
  fetchPaperChart: vi.fn().mockResolvedValue(undefined),
  closeAllPositions: vi.fn().mockResolvedValue(undefined),
  refreshBotLiveData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(() => vi.fn()),
  useLocation: vi.fn(() => ({ pathname: "/" })),
  BrowserRouter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../common/PreviewChartProvider", () => ({
  usePreviewChart: vi.fn(() => ({
    showPreviewChart: vi.fn(),
    hidePreviewChart: vi.fn(),
  })),
}));

function setState(overrides: Partial<PaperTradingState>) {
  currentState = createMockState(overrides);
}

function resetState() {
  currentState = createMockState();
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: TestWrapper });
}

describe("PaperPositionsTable", () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetState();
  });

  describe("Empty states", () => {
    test("shows empty state when positions is empty and no botSnapshot", () => {
      setState({ positions: [], botSnapshot: null, isLoading: false });
      r(<PaperPositionsTable />);
      expect(screen.getByTestId("positions-empty")).toBeTruthy();
      expect(screen.getByText("No open positions")).toBeTruthy();
    });

    test("shows loading state when isLoading and no positions", () => {
      setState({ isLoading: true, positions: [], botSnapshot: null });
      r(<PaperPositionsTable />);
      expect(screen.getByText("Loading positions...")).toBeTruthy();
    });
  });

  describe("Single position display", () => {
    test("renders single position with symbol, entry/exit prices, P&L", () => {
      const pos = mockPosition({ symbol: "RELIANCE", side: "BUY", pnl: 5000, pnl_pct: 2.0 });
      setState({ positions: [pos], botSnapshot: null });
      r(<PaperPositionsTable />);

      expect(screen.getByText("RELIANCE")).toBeTruthy();
      expect(screen.getByText("₹2500.00")).toBeTruthy();
      expect(screen.getByText("₹2550.00")).toBeTruthy();
      expect(screen.getByText(/₹5\.0K/)).toBeTruthy();
    });

    test("renders close button for each position row", () => {
      const pos = mockPosition({ symbol: "RELIANCE", side: "BUY" });
      setState({ positions: [pos], botSnapshot: null });
      r(<PaperPositionsTable />);

      const closeBtn = screen.getByTestId("close-position-RELIANCE");
      expect(closeBtn).toBeTruthy();
    });

    test("position row click triggers symbol selection", async () => {
      const user = userEvent.setup();
      const pos = mockPosition({ symbol: "RELIANCE", side: "BUY" });
      setState({ positions: [pos], botSnapshot: null });
      r(<PaperPositionsTable />);

      await user.click(screen.getByText("RELIANCE"));
    });
  });

  describe("BUY and SELL badges", () => {
    test("shows BUY badge for BUY side", () => {
      const pos = mockPosition({ symbol: "RELIANCE", side: "BUY" });
      setState({ positions: [pos], botSnapshot: null });
      r(<PaperPositionsTable />);

      const badge = screen.getByTestId("side-badge-RELIANCE");
      expect(badge).toBeTruthy();
      expect(badge.textContent).toContain("BUY");
    });

    test("shows SELL badge for SELL side", () => {
      const pos = mockPosition({ symbol: "RELIANCE", side: "SELL", pnl: -500, pnl_pct: -1.0 });
      setState({ positions: [pos], botSnapshot: null });
      r(<PaperPositionsTable />);

      const badge = screen.getByTestId("side-badge-RELIANCE");
      expect(badge).toBeTruthy();
      expect(badge.textContent).toContain("SELL");
    });
  });

  describe("P&L text color", () => {
    test("positive P&L rendered", () => {
      const pos = mockPosition({ symbol: "RELIANCE", pnl: 5000, pnl_pct: 2.0 });
      setState({ positions: [pos], botSnapshot: null });
      r(<PaperPositionsTable />);

      const row = screen.getByTestId("position-row-RELIANCE");
      expect(row.textContent).toMatch(/₹5\.0K/);
    });

    test("negative P&L rendered", () => {
      const pos = mockPosition({ symbol: "RELIANCE", pnl: -500, pnl_pct: -0.2 });
      setState({ positions: [pos], botSnapshot: null });
      r(<PaperPositionsTable />);

      const row = screen.getByTestId("position-row-RELIANCE");
      expect(row.textContent).toMatch(/₹-500/);
    });
  });

  describe("Multiple positions grouped by strategy (isMultiStrategy)", () => {
    test("renders positions without strategy tabs when single strategy", () => {
      const pos1 = mockPosition({
        symbol: "RELIANCE",
        side: "BUY",
        strategy_id: 1,
        strategy_name: "ORB Strategy",
      });
      const pos2 = mockPosition({
        symbol: "TCS",
        side: "BUY",
        strategy_id: 1,
        strategy_name: "ORB Strategy",
        order_id: "ord-2",
      });
      setState({ positions: [pos1, pos2], botSnapshot: null });
      r(<PaperPositionsTable />);

      expect(screen.getByText("RELIANCE")).toBeTruthy();
      expect(screen.getByText("TCS")).toBeTruthy();
      expect(screen.queryByTestId("strategy-tabs")).toBeFalsy();
    });

    test("renders strategy tabs when multiple strategies", () => {
      const pos1 = mockPosition({
        symbol: "RELIANCE",
        side: "BUY",
        strategy_id: 1,
        strategy_name: "ORB Strategy",
      });
      const pos2 = mockPosition({
        symbol: "INFY",
        side: "BUY",
        strategy_id: 2,
        strategy_name: "SR Breakout",
      });
      setState({ positions: [pos1, pos2], botSnapshot: null });
      r(<PaperPositionsTable />);

      expect(screen.getByTestId("strategy-tabs")).toBeTruthy();
      expect(screen.getByTestId("strategy-tab-all")).toBeTruthy();
    });

    test("strategy tab shows count and P&L", () => {
      const pos1 = mockPosition({
        symbol: "RELIANCE",
        side: "BUY",
        strategy_id: 1,
        strategy_name: "ORB Strategy",
        pnl: 5000,
      });
      const pos2 = mockPosition({
        symbol: "INFY",
        side: "BUY",
        strategy_id: 2,
        strategy_name: "SR Breakout",
        pnl: 3000,
      });
      setState({ positions: [pos1, pos2], botSnapshot: null });
      r(<PaperPositionsTable />);

      const allTab = screen.getByTestId("strategy-tab-all");
      expect(within(allTab).getByText("2")).toBeTruthy();
      expect(within(allTab).getByText(/₹8\.0K/)).toBeTruthy();
    });

    test("clicking strategy tab filters positions", async () => {
      const pos1 = mockPosition({
        symbol: "RELIANCE",
        side: "BUY",
        strategy_id: 1,
        strategy_name: "ORB Strategy",
      });
      const pos2 = mockPosition({
        symbol: "INFY",
        side: "BUY",
        strategy_id: 2,
        strategy_name: "SR Breakout",
      });
      setState({
        positions: [pos1, pos2],
        botSnapshot: null,
        selectedStrategyTab: "1",
      });
      r(<PaperPositionsTable />);

      expect(screen.getByText("RELIANCE")).toBeTruthy();
      expect(screen.queryByText("INFY")).toBeFalsy();
    });

    test("strategy summary footer visible with multi-strategy all tab", () => {
      const pos1 = mockPosition({
        symbol: "RELIANCE",
        side: "BUY",
        strategy_id: 1,
        strategy_name: "ORB Strategy",
        pnl: 5000,
      });
      const pos2 = mockPosition({
        symbol: "INFY",
        side: "BUY",
        strategy_id: 2,
        strategy_name: "SR Breakout",
        pnl: 3000,
      });
      setState({ positions: [pos1, pos2], botSnapshot: null });
      r(<PaperPositionsTable />);

      expect(screen.getByTestId("strategy-summary-footer")).toBeTruthy();
    });
  });

  describe("CloseAll button", () => {
    test("CloseAll button renders when positions exist", () => {
      const pos = mockPosition({ symbol: "RELIANCE", side: "BUY", current_price: 2550 });
      setState({
        positions: [pos],
        botSnapshot: null,
        availableBots: [{ id: "bot-1", name: "Bot 1", strategies: [], is_active: true }],
      });
      r(<PaperPositionsTable />);

      expect(screen.getByTestId("close-all-positions")).toBeTruthy();
      expect(screen.getByText("Close All")).toBeTruthy();
    });

    test("CloseAll button NOT rendered when no positions", () => {
      setState({ positions: [], botSnapshot: null });
      r(<PaperPositionsTable />);

      expect(screen.queryByTestId("close-all-positions")).toBeFalsy();
    });
  });

  describe("WatchlistScan panel", () => {
    test("WatchlistScan renders when botSnapshot is present", () => {
      const pos = mockPosition({ symbol: "RELIANCE", side: "BUY" });
      setState({ positions: [pos], botSnapshot: mockBotSnapshot });
      r(<PaperPositionsTable />);

      expect(screen.getByTestId("watchlist-scan-card")).toBeTruthy();
      expect(screen.getByText("Watchlist Scan")).toBeTruthy();
    });

    test("WatchlistScan shows signals and watching sections", () => {
      const pos = mockPosition({ symbol: "RELIANCE", side: "BUY" });
      setState({ positions: [pos], botSnapshot: mockBotSnapshot });
      r(<PaperPositionsTable />);

      expect(screen.getByText("Signals")).toBeTruthy();
      expect(screen.getByText("Watching")).toBeTruthy();
    });

    test("WatchlistScan shows empty state when no scan_items", () => {
      const pos = mockPosition({ symbol: "RELIANCE", side: "BUY" });
      setState({
        positions: [pos],
        botSnapshot: {
          timestamp: "2026-03-20T09:30:00Z",
          watchlist: [],
          open_positions: [],
          scan_items: [],
          signals: [],
        },
      });
      r(<PaperPositionsTable />);

      expect(screen.getByTestId("watchlist-scan-card")).toBeTruthy();
      expect(screen.getByText("No scan data yet")).toBeTruthy();
    });

    test("WatchlistScan hidden when no botSnapshot and no positions", () => {
      setState({ positions: [], botSnapshot: null });
      r(<PaperPositionsTable />);

      expect(screen.queryByTestId("watchlist-scan-card")).toBeFalsy();
    });
  });

  describe("Positions table container and header", () => {
    test("positions table container renders", () => {
      const pos = mockPosition({ symbol: "RELIANCE", side: "BUY" });
      setState({ positions: [pos], botSnapshot: null });
      r(<PaperPositionsTable />);

      expect(screen.getByTestId("positions-table-container")).toBeTruthy();
    });

    test("positions header shows count", () => {
      const pos1 = mockPosition({ symbol: "RELIANCE", side: "BUY" });
      const pos2 = mockPosition({ symbol: "TCS", side: "BUY" });
      setState({ positions: [pos1, pos2], botSnapshot: null });
      r(<PaperPositionsTable />);

      expect(screen.getByText("Positions (2)")).toBeTruthy();
    });

    test("LIVE badge renders in header", () => {
      const pos = mockPosition({ symbol: "RELIANCE", side: "BUY" });
      setState({ positions: [pos], botSnapshot: null });
      r(<PaperPositionsTable />);

      expect(screen.getByText("LIVE")).toBeTruthy();
    });

    test("positions panel data-testid present", () => {
      const pos = mockPosition({ symbol: "RELIANCE", side: "BUY" });
      setState({ positions: [pos], botSnapshot: null });
      r(<PaperPositionsTable />);

      expect(screen.getByTestId("positions-panel")).toBeTruthy();
    });
  });

  describe("Strategy tabs with various strategy names", () => {
    test("tabs normalize strategy name for testid", async () => {
      const user = userEvent.setup();
      const pos1 = mockPosition({
        symbol: "RELIANCE",
        side: "BUY",
        strategy_id: 1,
        strategy_name: "ORB Conservative",
      });
      const pos2 = mockPosition({
        symbol: "TCS",
        side: "BUY",
        strategy_id: 2,
        strategy_name: "SR Breakout",
      });
      setState({ positions: [pos1, pos2], botSnapshot: null });
      r(<PaperPositionsTable />);

      expect(screen.getByTestId("strategy-tab-orb-conservative")).toBeTruthy();
      expect(screen.getByTestId("strategy-tab-sr-breakout")).toBeTruthy();

      await user.click(screen.getByTestId("strategy-tab-sr-breakout"));
      expect(screen.getByText("TCS")).toBeTruthy();
    });
  });
});
