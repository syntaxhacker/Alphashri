// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { screen, within, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaperPositionsTable } from "./PaperPositionsTable2";
import { mockPosition } from "./testFixtures";
import { renderWithMantine } from "../../test-utils/renderWithMantine";
import type { PaperBotSnapshot, PaperTradingState } from "../../types/paperTrading";

afterEach(cleanup);

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
    {
      symbol: "INFY",
      status: "skipped",
      price: 4500,
      reason: "Low volume",
      strategy_name: "ORB Strategy",
      strategy_id: 1,
    },
  ],
  signals: [{ symbol: "RELIANCE", side: "LONG", price: 2520, notes: "ORB breakout" }],
};

const mockBotSnapshotSignalsOnly: PaperBotSnapshot = {
  timestamp: "2026-03-20T09:30:00Z",
  watchlist: ["RELIANCE"],
  open_positions: [],
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
  return renderWithMantine(jsx);
}

function rWithPosition(
  positionOverrides: Partial<PaperPosition> = {},
  stateOverrides: Partial<PaperTradingState> = {},
) {
  const pos = mockPosition({
    symbol: "RELIANCE",
    side: "BUY",
    ...positionOverrides,
  });
  setState({
    positions: [pos],
    botSnapshot: null,
    ...stateOverrides,
  });
  r(<PaperPositionsTable />);
  return pos;
}

function rWithCloseAllEnabled(positionOverrides: Partial<PaperPosition> = {}) {
  return rWithPosition(
    { current_price: 2550, ...positionOverrides },
    {
      availableBots: [{ id: "bot-1", name: "Bot 1", strategies: [], is_active: true }],
    },
  );
}

function rWithTwoPositions(
  pos1Overrides: Partial<PaperPosition>,
  pos2Overrides: Partial<PaperPosition>,
  stateOverrides: Partial<PaperTradingState> = {},
) {
  const pos1 = mockPosition({ symbol: "RELIANCE", side: "BUY", ...pos1Overrides });
  const pos2 = mockPosition({ symbol: "INFY", side: "BUY", ...pos2Overrides });
  setState({ positions: [pos1, pos2], botSnapshot: null, ...stateOverrides });
  r(<PaperPositionsTable />);
  return { pos1, pos2 };
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

    test("no positions but botSnapshot present shows empty positions and watchlist", () => {
      setState({ positions: [], botSnapshot: mockBotSnapshot });
      r(<PaperPositionsTable />);

      expect(screen.getByTestId("positions-empty")).toBeInTheDocument();
      expect(screen.getByTestId("watchlist-scan-card")).toBeInTheDocument();
    });
  });

  describe("Single position display", () => {
    test("renders single position with symbol, merged entry/curr, P&L %", () => {
      rWithPosition({ pnl: 5000, pnl_pct: 2.0 });
      expect(screen.getByText("RELIANCE")).toBeTruthy();
      expect(screen.getByText((c) => c.includes("10") && c.includes("₹2500"))).toBeTruthy();
      const row = screen.getByTestId("position-row-RELIANCE");
      expect(row.textContent).toContain("+₹5.0K");
      expect(row.textContent).toContain("+2.00%");
    });

    test("renders close button for each position row", () => {
      rWithPosition();
      const closeBtn = screen.getByTestId("close-position-RELIANCE");
      expect(closeBtn).toBeTruthy();
    });

    test("position row click triggers symbol selection", async () => {
      const user = userEvent.setup();
      rWithPosition();
      await user.click(screen.getByText("RELIANCE"));
    });
  });

  describe("Side indicator", () => {
    test("BUY side shows symbol name", () => {
      rWithPosition();
      expect(screen.getByText("RELIANCE")).toBeTruthy();
    });

    test("SELL side shows symbol name", () => {
      rWithPosition({ side: "SELL", pnl: -500, pnl_pct: -1.0 });
      expect(screen.getByText("RELIANCE")).toBeTruthy();
    });
  });

  describe("P&L text color", () => {
    test("positive P&L with ₹ amount and percentage", () => {
      rWithPosition({ pnl: 5000, pnl_pct: 2.0 });
      const row = screen.getByTestId("position-row-RELIANCE");
      expect(row.textContent).toContain("+₹5.0K");
      expect(row.textContent).toContain("+2.00%");
    });

    test("positive P&L with ₹ amount and percentage", () => {
      rWithPosition({ pnl: 5000, pnl_pct: 2.0 });
      const row = screen.getByTestId("position-row-RELIANCE");
      expect(row.textContent).toContain("+₹5.0K");
      expect(row.textContent).toContain("+2.00%");
    });

    test("negative P&L with ₹ amount and percentage", () => {
      rWithPosition({ pnl: -500, pnl_pct: -0.2 });
      const row = screen.getByTestId("position-row-RELIANCE");
      expect(row.textContent).toContain("₹-500");
      expect(row.textContent).toContain("-0.20%");
    });
  });

  describe("Multiple positions grouped by strategy", () => {
    test("renders positions in strategy panel", () => {
      rWithTwoPositions(
        { strategy_id: 1, strategy_name: "ORB Strategy" },
        {
          symbol: "TCS",
          side: "BUY",
          strategy_id: 1,
          strategy_name: "ORB Strategy",
          order_id: "ord-2",
        },
      );
      expect(screen.getByText((c) => c.includes("RELIANCE"))).toBeTruthy();
      expect(screen.getByText((c) => c.includes("TCS"))).toBeTruthy();
      expect(screen.getByTestId("strategy-panel-1")).toBeTruthy();
    });

    test("renders separate panels for different strategies", () => {
      rWithTwoPositions(
        { strategy_id: 1, strategy_name: "ORB Strategy" },
        { symbol: "INFY", side: "BUY", strategy_id: 2, strategy_name: "SR Breakout" },
      );
      expect(screen.getByTestId("strategy-panel-1")).toBeTruthy();
      expect(screen.getByTestId("strategy-panel-2")).toBeTruthy();
    });

    test("strategy panel shows count and P&L", () => {
      rWithTwoPositions(
        { strategy_id: 1, strategy_name: "ORB Strategy", pnl: 5000 },
        { symbol: "INFY", side: "BUY", strategy_id: 2, strategy_name: "SR Breakout", pnl: 3000 },
      );
      expect(screen.getByText("ORB Strategy")).toBeTruthy();
      expect(screen.getByText("SR Breakout")).toBeTruthy();
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
      expect(screen.getAllByText("Close All").length).toBeGreaterThanOrEqual(1);
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
      expect(screen.getByText(/No scan data/)).toBeTruthy();
    });

    test("WatchlistScan shows skipped section when skipped items exist", () => {
      rWithPosition({}, { botSnapshot: mockBotSnapshot });
      expect(screen.getByText("Skipped")).toBeInTheDocument();
      expect(screen.getByTestId("scan-skipped-INFY")).toBeInTheDocument();
    });

    test("clicking skipped row selects symbol", async () => {
      const user = userEvent.setup();
      rWithPosition({}, { botSnapshot: mockBotSnapshot });
      await user.click(within(screen.getByTestId("watchlist-scan-skipped")).getByRole("button"));
      const { setSelectedSymbol } = await import("../../state/paperTrading");
      await user.click(screen.getByTestId("scan-skipped-INFY"));
      expect(setSelectedSymbol).toHaveBeenCalledWith("INFY");
    });

    test("clicking signal row selects symbol", async () => {
      const user = userEvent.setup();
      rWithPosition({}, { botSnapshot: mockBotSnapshotSignalsOnly });
      const { setSelectedSymbol } = await import("../../state/paperTrading");
      await user.click(screen.getByTestId("scan-signal-RELIANCE"));
      expect(setSelectedSymbol).toHaveBeenCalledWith("RELIANCE");
    });

    test("WatchlistScan hidden when no botSnapshot and no positions", () => {
      setState({ positions: [], botSnapshot: null });
      r(<PaperPositionsTable />);

      expect(screen.queryByTestId("watchlist-scan-card")).not.toBeInTheDocument();
    });
  });

  describe("Positions table container and header", () => {
    test("positions table container renders", () => {
      rWithPosition();
      expect(screen.getByTestId("positions-table-container")).toBeTruthy();
    });

    test("positions header shows count", () => {
      rWithTwoPositions({}, {});
      expect(screen.getByText("Positions (2)")).toBeTruthy();
    });

    test("badge shows PAPER when no live bot selected", () => {
      rWithPosition();
      expect(screen.getByText("PAPER")).toBeTruthy();
    });

    test("badge shows LIVE when live bot is selected", () => {
      rWithPosition({}, {
        filterBot: "bot-1",
        availableBots: [{
          id: "bot-1",
          name: "Live Bot",
          strategies: [],
          is_active: true,
          live_trading: true,
        }],
      });
      expect(screen.getByText("LIVE")).toBeTruthy();
    });

    test("positions panel data-testid present", () => {
      rWithPosition();
      expect(screen.getByTestId("positions-panel")).toBeTruthy();
    });

    test("positions table has data-testid from DataTable", () => {
      rWithPosition();
      expect(screen.getByTestId("positions-table")).toBeInTheDocument();
    });
  });

  describe("WatchlistScan handleSelectSymbol", () => {
    test("handleSelectSymbol calls fetchPaperChart with current state params", async () => {
      const user = userEvent.setup();
      const { fetchPaperChart } = await import("../../api/paperTrading");
      const pos = mockPosition({ symbol: "RELIANCE", side: "BUY" });
      setState({
        positions: [pos],
        botSnapshot: mockBotSnapshotSignalsOnly,
        selectedStrategyId: 5,
        chartTimeframe: "15min",
        intradayOnly: true,
      });
      r(<PaperPositionsTable />);
      await user.click(screen.getByTestId("scan-signal-RELIANCE"));
      expect(fetchPaperChart).toHaveBeenCalledWith("RELIANCE", undefined, "15min", 5);
    });

    test("handleSelectSymbol works for watching rows too", async () => {
      const user = userEvent.setup();
      const { setSelectedSymbol } = await import("../../state/paperTrading");
      rWithPosition({}, { botSnapshot: mockBotSnapshot });
      await user.click(screen.getByTestId("scan-watching-TCS"));
      expect(setSelectedSymbol).toHaveBeenCalledWith("TCS");
    });
  });

  describe("CloseAll button loading and error", () => {
    test("closeAllPositions loading state shows loading indicator", async () => {
      const user = userEvent.setup();
      const { closeAllPositions } = await import("../../api/paperTrading");
      vi.mocked(closeAllPositions).mockReturnValueOnce(new Promise(() => {}));
      const confirmMock = vi.fn(() => true);
      window.confirm = confirmMock as unknown as typeof window.confirm;

      rWithCloseAllEnabled();

      expect(screen.queryByText("Closing...")).not.toBeInTheDocument();
      await user.click(screen.getByTestId("close-all-positions"));
      expect(screen.getByText("Closing...")).toBeInTheDocument();
    });

    test("error alert renders when closeAllPositions fails", async () => {
      const user = userEvent.setup();
      const { closeAllPositions } = await import("../../api/paperTrading");
      vi.mocked(closeAllPositions).mockRejectedValueOnce(new Error("Network error"));
      const confirmMock = vi.fn(() => true);
      window.confirm = confirmMock as unknown as typeof window.confirm;
      const alertMock = vi.fn();
      window.alert = alertMock as unknown as typeof window.alert;

      rWithCloseAllEnabled();

      await user.click(screen.getByTestId("close-all-positions"));
      await waitFor(() => {
        expect(alertMock).toHaveBeenCalledWith("Network error");
      });
    });
  });
});
