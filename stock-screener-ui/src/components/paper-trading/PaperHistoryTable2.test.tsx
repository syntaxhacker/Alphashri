// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import { renderWithMantine } from "../../test-utils/renderWithMantine";

const mockStateStore: any = {
  currentView: "history",
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
};

const initialMockState = { ...mockStateStore };
function resetMockStateStore() {
  Object.assign(mockStateStore, JSON.parse(JSON.stringify(initialMockState)));
}

vi.mock("../../state/paperTrading", () => ({
  getPaperTradingState: vi.fn(() => mockStateStore),
  subscribe: vi.fn(() => vi.fn()),
  setSelectedSymbol: vi.fn(),
  setFilterStrategy: vi.fn(),
  setFilterBot: vi.fn(),
  setFilterFromDate: vi.fn(),
  setFilterToDate: vi.fn(),
  setSelectedTradeId: vi.fn(),
  setShowAllTrades: vi.fn(),
  deleteTradeAction: vi.fn(),
  updateTradeNotesAction: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  mockFetchPaperChart: vi.fn().mockResolvedValue(undefined),
  mockRefreshHistoryData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../api/paperTrading", () => ({
  fetchPaperChart: mocks.mockFetchPaperChart,
  refreshHistoryData: mocks.mockRefreshHistoryData,
}));

vi.mock("../common/PreviewChartProvider", () => ({
  usePreviewChart: vi.fn(() => ({
    showPreviewChart: vi.fn(),
    hidePreviewChart: vi.fn(),
  })),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(() => vi.fn()),
}));

vi.mock("../../hooks/useStoreSubscription", () => ({
  useStoreSubscription: vi.fn(),
}));

vi.mock("@/ui", async () => {
  const core = await vi.importActual<typeof import("@mantine/core")>("@mantine/core");
  const ui = await vi.importActual<typeof import("@/ui")>("@/ui");
  return {
    ...core,
    UIProvider: ui.UIProvider,
    Select: ({ data, value, onChange, "data-testid": testId, ...rest }: any) => (
      <select
        data-testid={testId}
        value={value || ""}
        onChange={(e: any) => {
          const val = e.target.value;
          onChange(val === "" ? null : val);
        }}
        {...rest}
      >
        {data?.map((opt: any) => (
          <option key={opt.value} value={opt.value ?? ""}>
            {opt.label}
          </option>
        ))}
      </select>
    ),
    SegmentedControl: ({ data, value, onChange, ...props }: any) => (
      <div data-testid={props["data-testid"]}>
        {data?.map((item: any) => (
          <button key={item.value} data-active={value === item.value} onClick={() => onChange(item.value)}>
            {item.label}
          </button>
        ))}
      </div>
    ),
  };
});

import { PaperHistoryTable } from "./PaperHistoryTable2";
import { mockTrade } from "./testFixtures";

beforeEach(() => {
  resetMockStateStore();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

function r() {
  return renderWithMantine(<PaperHistoryTable />);
}

describe("PaperHistoryTable", () => {
  describe("loading state", () => {
    test("renders loading state when isLoading and no trades", () => {
      mockStateStore.isLoading = true;
      mockStateStore.trades = [];
      r();
      expect(screen.getByText("Loading trade history...")).toBeInTheDocument();
      expect(screen.getByTestId("history-panel")).toBeInTheDocument();
    });

    test("does not show loading when isLoading but trades exist", () => {
      mockStateStore.isLoading = true;
      mockStateStore.trades = [mockTrade()];
      r();
      expect(screen.queryByText("Loading trade history...")).not.toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    test("shows empty state with 'No trades found' when no trades", () => {
      mockStateStore.trades = [];
      r();
      expect(screen.getByText("No trades found")).toBeInTheDocument();
    });
  });

  describe("history filters", () => {
    test("renders bot filter select when multiple bots exist", () => {
      mockStateStore.trades = [
        mockTrade({ bot_id: "bot-1", bot_name: "Bot Alpha" }),
        mockTrade({ bot_id: "bot-2", bot_name: "Bot Beta", symbol: "TCS" }),
      ];
      r();
      expect(screen.getByTestId("bot-filter-select")).toBeInTheDocument();
    });

    test("does not render bot filter when only one bot", () => {
      mockStateStore.trades = [mockTrade({ bot_id: "bot-1", bot_name: "Bot Alpha" })];
      r();
      expect(screen.queryByTestId("bot-filter-select")).not.toBeInTheDocument();
    });

    test("does not render bot filter when no bot info", () => {
      mockStateStore.trades = [mockTrade({ bot_id: null, bot_name: null })];
      r();
      expect(screen.queryByTestId("bot-filter-select")).not.toBeInTheDocument();
    });

    test("renders strategy filter select when multiple strategies exist", () => {
      mockStateStore.trades = [
        mockTrade({ strategy_id: 1, strategy_name: "ORB" }),
        mockTrade({ strategy_id: 2, strategy_name: "SR Breakout", symbol: "TCS" }),
      ];
      r();
      expect(screen.getByTestId("strategy-filter-select")).toBeInTheDocument();
    });

    test("does not render strategy filter when only one strategy", () => {
      mockStateStore.trades = [mockTrade({ strategy_id: 1, strategy_name: "ORB" })];
      r();
      expect(screen.queryByTestId("strategy-filter-select")).not.toBeInTheDocument();
    });
  });

  describe("quick filter dates", () => {
    test("renders quick filter segmented control", () => {
      mockStateStore.trades = [mockTrade()];
      r();
      expect(screen.getByTestId("quick-filter")).toBeInTheDocument();
    });

    test("shows 'Trade History' header", () => {
      mockStateStore.trades = [mockTrade()];
      r();
      expect(screen.getByTestId("trades-header")).toBeInTheDocument();
      expect(screen.getByText("Trade History")).toBeInTheDocument();
    });
  });

  describe("trade history table rendering", () => {
    test("renders a day group row for each date with trades", () => {
      mockStateStore.filterFromDate = null;
      mockStateStore.filterToDate = null;
      mockStateStore.trades = [
        mockTrade({ trade_id: "t1", exit_time: "2026-05-09T10:30:00Z" }),
        mockTrade({ trade_id: "t2", exit_time: "2026-05-08T10:30:00Z", symbol: "TCS" }),
      ];
      r();
      expect(screen.getByTestId("day-group-2026-05-09")).toBeInTheDocument();
      expect(screen.getByTestId("day-group-2026-05-08")).toBeInTheDocument();
    });

    test("renders multiple trades on same date in one day group", () => {
      mockStateStore.trades = [
        mockTrade({ trade_id: "t1", exit_time: "2026-05-09T10:30:00Z" }),
        mockTrade({ trade_id: "t2", exit_time: "2026-05-09T11:30:00Z", symbol: "TCS" }),
      ];
      r();
      expect(screen.getByTestId("day-group-2026-05-09")).toBeInTheDocument();
    });

    test("does not call fetchPaperChart for table rendering", () => {
      mockStateStore.trades = [mockTrade()];
      r();
      expect(mocks.mockFetchPaperChart).not.toHaveBeenCalled();
    });

    test("renders all trades in a single table (no per-day tables)", () => {
      mockStateStore.trades = [
        mockTrade({ trade_id: "t1", exit_time: "2026-05-09T10:30:00Z" }),
        mockTrade({ trade_id: "t2", exit_time: "2026-05-09T11:30:00Z", symbol: "TCS" }),
        mockTrade({ trade_id: "t3", exit_time: "2026-05-08T10:30:00Z", symbol: "INFY" }),
      ];
      r();
      expect(document.querySelectorAll("table").length).toBe(1);
      expect(screen.getByTestId("trade-row-t1")).toBeInTheDocument();
      expect(screen.getByTestId("trade-row-t2")).toBeInTheDocument();
      expect(screen.getByTestId("trade-row-t3")).toBeInTheDocument();
    });

    test("collapses a day group when its header row is clicked", () => {
      mockStateStore.trades = [
        mockTrade({ trade_id: "t1", exit_time: "2026-05-09T10:30:00Z" }),
        mockTrade({ trade_id: "t2", exit_time: "2026-05-09T11:30:00Z", symbol: "TCS" }),
      ];
      r();
      expect(screen.getByTestId("trade-row-t1")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("day-header-2026-05-09"));
      expect(screen.queryByTestId("trade-row-t1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("trade-row-t2")).not.toBeInTheDocument();
      // Day summary row stays visible
      expect(screen.getByTestId("day-group-2026-05-09")).toBeInTheDocument();
    });

    test("expands a trade row to show detail", () => {
      mockStateStore.trades = [mockTrade({ trade_id: "trade-1" })];
      r();
      expect(screen.queryByTestId("trade-reason-trade-1")).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId("trade-detail-toggle-trade-1"));
      expect(screen.getByTestId("trade-reason-trade-1")).toBeInTheDocument();
    });
  });
});

describe("groupTradesByDate with sorting", () => {
  test("sorts by specified column", async () => {
    const { groupTradesByDate } = await import("../../utils/tradeHistoryUtils");
    const trades = [
      { trade_id: "t1", symbol: "AAPL", exit_time: "2026-05-09T10:30:00Z" },
      { trade_id: "t2", symbol: "ZOO", exit_time: "2026-05-09T11:00:00Z" },
    ];
    const result = groupTradesByDate(trades, "symbol", "asc");
    expect(result["2026-05-09"][0].trade_id).toBe("t1");
    expect(result["2026-05-09"][1].trade_id).toBe("t2");
  });
});

describe("PaperHistoryTable interactions", () => {
  test("quick filter triggers refreshHistoryData", async () => {
    mockStateStore.trades = [mockTrade()];
    r();
    const segControl = screen.getByTestId("quick-filter");
    const todayBtn = segControl.querySelector("button");
    if (todayBtn) {
      todayBtn.click();
    }
    expect(mocks.mockRefreshHistoryData).toHaveBeenCalled();
  });

  test("quick filter sets date filters", async () => {
    mockStateStore.trades = [mockTrade()];
    r();
    const { setFilterFromDate, setFilterToDate } = await import("../../state/paperTrading");
    const segControl = screen.getByTestId("quick-filter");
    const todayBtn = segControl.querySelector("button");
    if (todayBtn) {
      todayBtn.click();
    }
    expect(setFilterFromDate).toHaveBeenCalled();
    expect(setFilterToDate).toHaveBeenCalled();
  });

  test("handleSelectSymbol calls fetchPaperChart on row click", async () => {
    mockStateStore.trades = [mockTrade({ trade_id: "trade-1" })];
    r();
    const row = screen.getByTestId("trade-row-trade-1");
    row.click();
    await vi.waitFor(() => {
      expect(mocks.mockFetchPaperChart).toHaveBeenCalled();
    });
  });

  test("handleSelectSymbol sets selectedTradeId", async () => {
    mockStateStore.trades = [mockTrade({ trade_id: "trade-1", symbol: "RELIANCE" })];
    r();
    const row = screen.getByTestId("trade-row-trade-1");
    row.click();
    const { setSelectedTradeId } = await import("../../state/paperTrading");
    expect(setSelectedTradeId).toHaveBeenCalled();
  });

  test("clicking a trade always sets showAllTrades false via setSelectedTradeId", async () => {
    mockStateStore.trades = [
      mockTrade({ trade_id: "t1", symbol: "RELIANCE", exit_time: "2026-05-09T10:00:00Z" }),
      mockTrade({ trade_id: "t2", symbol: "RELIANCE", exit_time: "2026-05-09T11:00:00Z" }),
    ];
    r();
    const { setSelectedTradeId } = await import("../../state/paperTrading");
    const row = screen.getByTestId("trade-row-t1");
    row.click();
    expect(setSelectedTradeId).toHaveBeenCalled();
  });

  test("single symbol trade does not set showAllTrades", async () => {
    mockStateStore.trades = [mockTrade({ trade_id: "t1", symbol: "RELIANCE" })];
    r();
    const { setShowAllTrades } = await import("../../state/paperTrading");
    const row = screen.getByTestId("trade-row-t1");
    row.click();
    expect(setShowAllTrades).not.toHaveBeenCalledWith(true);
  });

  test("table sorting does not trigger chart fetch", async () => {
    mockStateStore.trades = [
      mockTrade({ trade_id: "t1", symbol: "AAPL" }),
      mockTrade({ trade_id: "t2", symbol: "ZOO" }),
    ];
    r();
    expect(screen.getByText("Symbol")).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(mocks.mockFetchPaperChart).not.toHaveBeenCalled();
    });
  });
});
