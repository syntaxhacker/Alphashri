// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderHook, act } from "@testing-library/react";
import { renderWithMantine } from "../../test-utils/renderWithMantine";
import React from "react";

// --- Mock external modules ---
const mockStateStore: any = {
  currentView: "live",
  positions: [],
  portfolio: null,
  trades: [],
  dailySummary: null,
  performanceSummary: null,
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

var mockActions = {
  handleViewChange: vi.fn(),
  handleToggleBot: vi.fn(),
  handleRefresh: vi.fn(),
  handleBotSelect: vi.fn(),
};

var mockFilters = {
  handleFilterFromDate: vi.fn(),
  handleFilterToDate: vi.fn(),
  handleFilterSymbol: vi.fn(),
};

// Capture initial state for reset between tests
const initialMockState = { ...mockStateStore };
function resetMockStateStore() {
  Object.assign(mockStateStore, initialMockState);
}

// Global beforeEach/afterEach for test isolation
beforeEach(() => {
  resetMockStateStore();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

vi.mock("../../state/paperTrading", () => ({
  getPaperTradingState: vi.fn(() => mockStateStore),
  subscribe: vi.fn(() => vi.fn()),
  setPaperTradingView: vi.fn(),
  setFilterFromDate: vi.fn(),
  setFilterToDate: vi.fn(),
  setFilterSymbol: vi.fn(),
  setSelectedSymbol: vi.fn(),
  setFilterBot: vi.fn(),
  setFilterStrategy: vi.fn(),
}));

vi.mock("../../state/holidays", () => ({
  subscribeToHolidays: vi.fn(),
  isMarketClosedToday: vi.fn().mockReturnValue(false),
}));

vi.mock("../../api/paperTrading", () => ({
  refreshLiveData: vi.fn().mockResolvedValue(undefined),
  refreshHistoryData: vi.fn().mockResolvedValue(undefined),
  stopLiveAutoRefresh: vi.fn(),
  refreshBotLiveData: vi.fn().mockResolvedValue(undefined),
  startBot: vi.fn().mockResolvedValue({}),
  stopBot: vi.fn().mockResolvedValue({}),
  startPaperBot: vi.fn().mockResolvedValue({}),
  stopPaperBot: vi.fn().mockResolvedValue({}),
  fetchStrategyConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../api/botControlApi", () => ({
  fetchBotSummaries: vi.fn().mockResolvedValue({ summaries: [] }),
}));

// ============================================================
// Mock child components to simplify component tests
// ============================================================
vi.mock("../../components/paper-trading/BotCardStrip", () => ({
  BotCardStrip: ({ bots }: any) => (
    <div data-testid="bot-card-strip">
      {bots.map((b: any) => (
        <div key={b.id} data-testid={`bot-card-${b.id}`}>
          {b.name}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("../common/BadgeComponents", () => ({
  StatusBadge: ({ running, pid }: any) => (
    <div data-testid="bot-status">{running ? `Running (PID ${pid})` : "Stopped"}</div>
  ),
}));

// Mock TradingDatePicker as a simple date input for test interactions
vi.mock("../common/TradingDatePicker", () => ({
  TradingDatePicker: ({ value, onChange, "data-testid": testId, placeholder, ...rest }: any) => (
    <input
      type="date"
      data-testid={testId}
      value={value || ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    />
  ),
}));

// Mock Mantine Select as a native <select> for easier testing
vi.mock("@mantine/core", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    Select: ({ data, value, onChange, "data-testid": testId, ...rest }: any) => (
      <select
        data-testid={testId}
        value={value || ""}
        onChange={(e) => {
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
  };
});

// Import real hooks and components after mocks
import {
  usePaperViewActions,
  useHistoryFilters,
  LiveFilters,
  HistoryFilters,
  FiltersBar,
  PaperTradingTabs,
} from "./PaperTradingHelpers";
import type { BotSummary, PaperTrade } from "../../types/paperTrading";

// --- Helper ---
function r<T>(jsx: T) {
  return renderWithMantine(jsx);
}

// --- Mock data factories ---
function mockBot(overrides: Partial<BotSummary> = {}): BotSummary {
  return {
    id: "bot-1",
    name: "Test Bot",
    is_active: true,
    running: false,
    pid: null,
    status: "stopped",
    position_count: 0,
    strategies: [],
    ...overrides,
  };
}

function mockTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    trade_id: "trade-1",
    symbol: "RELIANCE",
    side: "BUY",
    quantity: 1,
    entry_price: 100,
    exit_price: 110,
    entry_time: "2026-04-27T09:30:00Z",
    exit_time: "2026-04-27T15:30:00Z",
    pnl: 10,
    pnl_pct: 10,
    exit_reason: "TP",
    costs: 1,
    net_pnl: 9,
    stop_loss: 95,
    take_profit: 115,
    peak_price: 115,
    low_price: 95,
    hold_duration_minutes: 360,
    notes: "",
    reason: "ORB Breakout",
    strategy_id: 1,
    strategy_name: "ORB",
    bot_id: null,
    bot_name: null,
    ...overrides,
  };
}

// ============================================================
// usePaperViewActions tests
// ============================================================
describe("usePaperViewActions", () => {
  beforeEach(() => {
    mockStateStore.currentView = "live";
    mockStateStore.botRunning = false;
    mockStateStore.botPid = null;
    mockStateStore.filterFromDate = null;
    mockStateStore.filterToDate = null;
    mockStateStore.filterBot = null;
    vi.clearAllMocks();
  });

  it("handleViewChange('live') with activeBotId calls refreshBotLiveData", async () => {
    mockStateStore.currentView = "history";
    const { result } = renderHook(() => usePaperViewActions("bot-1"));

    await act(async () => {
      await result.current.handleViewChange("live");
    });

    const { refreshBotLiveData } = await import("../../api/paperTrading");
    expect(refreshBotLiveData).toHaveBeenCalledWith("bot-1");
  });

  it("handleViewChange('live') without activeBotId calls refreshLiveData", async () => {
    mockStateStore.currentView = "history";
    const { result } = renderHook(() => usePaperViewActions(null));

    await act(async () => {
      await result.current.handleViewChange("live");
    });

    const { refreshLiveData } = await import("../../api/paperTrading");
    expect(refreshLiveData).toHaveBeenCalled();
  });

  it("handleViewChange('history') stops auto-refresh and sets default dates when missing", async () => {
    mockStateStore.filterFromDate = null;
    mockStateStore.filterToDate = null;
    mockStateStore.currentView = "live";
    const { result } = renderHook(() => usePaperViewActions(null));

    await act(async () => {
      await result.current.handleViewChange("history");
    });

    const { stopLiveAutoRefresh, refreshHistoryData } = await import("../../api/paperTrading");
    const { setFilterFromDate, setFilterToDate } = await import("../../state/paperTrading");

    expect(stopLiveAutoRefresh).toHaveBeenCalled();
    expect(setFilterFromDate).toHaveBeenCalled();
    expect(setFilterToDate).toHaveBeenCalled();
    expect(refreshHistoryData).toHaveBeenCalledWith(null, expect.any(String), expect.any(String));
  });

  it("handleViewChange('history') uses existing dates when present", async () => {
    mockStateStore.filterFromDate = "2026-04-01";
    mockStateStore.filterToDate = "2026-04-27";
    mockStateStore.filterBot = "bot-2";
    mockStateStore.currentView = "live";
    const { result } = renderHook(() => usePaperViewActions("bot-1"));

    await act(async () => {
      await result.current.handleViewChange("history");
    });

    const { refreshHistoryData } = await import("../../api/paperTrading");
    expect(refreshHistoryData).toHaveBeenCalledWith("bot-2", "2026-04-01", "2026-04-27");
  });

  it("handleViewChange('settings') stops auto-refresh and fetches strategy config", async () => {
    const { result } = renderHook(() => usePaperViewActions(null));

    await act(async () => {
      await result.current.handleViewChange("settings");
    });

    const { stopLiveAutoRefresh, fetchStrategyConfig } = await import("../../api/paperTrading");
    expect(stopLiveAutoRefresh).toHaveBeenCalled();
    expect(fetchStrategyConfig).toHaveBeenCalled();
  });

  it("handleToggleBot with activeBotId and botRunning calls stopBot then refresh", async () => {
    vi.useFakeTimers();
    mockStateStore.botRunning = true;
    const { result } = renderHook(() => usePaperViewActions("bot-1"));

    await act(async () => {
      await result.current.handleToggleBot();
    });

    const { stopBot, refreshBotLiveData } = await import("../../api/paperTrading");
    expect(stopBot).toHaveBeenCalledWith("bot-1");

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(refreshBotLiveData).toHaveBeenCalledWith("bot-1");

    vi.useRealTimers();
  });

  it("handleToggleBot with activeBotId and not running calls startBot then refresh", async () => {
    vi.useFakeTimers();
    mockStateStore.botRunning = false;
    const { result } = renderHook(() => usePaperViewActions("bot-1"));

    await act(async () => {
      await result.current.handleToggleBot();
    });

    const { startBot, refreshBotLiveData } = await import("../../api/paperTrading");
    expect(startBot).toHaveBeenCalledWith("bot-1");

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(refreshBotLiveData).toHaveBeenCalledWith("bot-1");

    vi.useRealTimers();
  });

  it("handleToggleBot without activeBotId and botRunning calls stopPaperBot then refresh live", async () => {
    vi.useFakeTimers();
    mockStateStore.botRunning = true;
    const { result } = renderHook(() => usePaperViewActions(null));

    await act(async () => {
      await result.current.handleToggleBot();
    });

    const { stopPaperBot, refreshLiveData } = await import("../../api/paperTrading");
    expect(stopPaperBot).toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(refreshLiveData).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("handleToggleBot without activeBotId and not running calls startPaperBot then refresh live", async () => {
    vi.useFakeTimers();
    mockStateStore.botRunning = false;
    const { result } = renderHook(() => usePaperViewActions(null));

    await act(async () => {
      await result.current.handleToggleBot();
    });

    const { startPaperBot, refreshLiveData } = await import("../../api/paperTrading");
    expect(startPaperBot).toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(refreshLiveData).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("handleRefresh with activeBotId calls refreshBotLiveData", async () => {
    const { result } = renderHook(() => usePaperViewActions("bot-1"));

    await act(async () => {
      await result.current.handleRefresh();
    });

    const { refreshBotLiveData } = await import("../../api/paperTrading");
    expect(refreshBotLiveData).toHaveBeenCalledWith("bot-1");
  });

  it("handleRefresh without activeBotId calls refreshLiveData", async () => {
    const { result } = renderHook(() => usePaperViewActions(null));

    await act(async () => {
      await result.current.handleRefresh();
    });

    const { refreshLiveData } = await import("../../api/paperTrading");
    expect(refreshLiveData).toHaveBeenCalled();
  });

  it("handleBotSelect with null calls refreshLiveData", async () => {
    const { result } = renderHook(() => usePaperViewActions("bot-1"));

    await act(async () => {
      await result.current.handleBotSelect("");
    });

    const { refreshLiveData } = await import("../../api/paperTrading");
    expect(refreshLiveData).toHaveBeenCalled();
  });

  it("handleBotSelect with botId calls refreshBotLiveData", async () => {
    const { result } = renderHook(() => usePaperViewActions("bot-1"));

    await act(async () => {
      await result.current.handleBotSelect("bot-2");
    });

    const { refreshBotLiveData } = await import("../../api/paperTrading");
    expect(refreshBotLiveData).toHaveBeenCalledWith("bot-2");
  });
});

// ============================================================
// useHistoryFilters tests
// ============================================================
describe("useHistoryFilters", () => {
  beforeEach(() => {
    mockStateStore.filterFromDate = null;
    mockStateStore.filterToDate = null;
    mockStateStore.filterBot = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("handleFilterFromDate sets state and calls refreshHistoryData", async () => {
    mockStateStore.filterBot = "bot-1";
    mockStateStore.filterToDate = "2026-04-27";
    const { result } = renderHook(() => useHistoryFilters());

    await act(async () => {
      await result.current.handleFilterFromDate("2026-04-01");
    });

    const { setFilterFromDate } = await import("../../state/paperTrading");
    const { refreshHistoryData } = await import("../../api/paperTrading");

    expect(setFilterFromDate).toHaveBeenCalledWith("2026-04-01");
    expect(refreshHistoryData).toHaveBeenCalledWith("bot-1", "2026-04-01", "2026-04-27");
  });

  it("handleFilterFromDate passes null when empty string", async () => {
    mockStateStore.filterBot = null;
    mockStateStore.filterToDate = "2026-04-27";
    const { result } = renderHook(() => useHistoryFilters());

    await act(async () => {
      await result.current.handleFilterFromDate("");
    });

    const { refreshHistoryData } = await import("../../api/paperTrading");
    expect(refreshHistoryData).toHaveBeenCalledWith(null, null, "2026-04-27");
  });

  it("handleFilterToDate sets state and calls refreshHistoryData", async () => {
    mockStateStore.filterBot = "bot-1";
    mockStateStore.filterFromDate = "2026-04-01";
    const { result } = renderHook(() => useHistoryFilters());

    await act(async () => {
      await result.current.handleFilterToDate("2026-04-27");
    });

    const { setFilterToDate } = await import("../../state/paperTrading");
    const { refreshHistoryData } = await import("../../api/paperTrading");

    expect(setFilterToDate).toHaveBeenCalledWith("2026-04-27");
    expect(refreshHistoryData).toHaveBeenCalledWith("bot-1", "2026-04-01", "2026-04-27");
  });

  it("handleFilterSymbol sets filter symbol", async () => {
    const { result } = renderHook(() => useHistoryFilters());

    result.current.handleFilterSymbol("RELIANCE");

    const { setFilterSymbol } = await import("../../state/paperTrading");
    expect(setFilterSymbol).toHaveBeenCalledWith("RELIANCE");
  });

  it("handleFilterSymbol passes null when cleared", async () => {
    const { result } = renderHook(() => useHistoryFilters());

    result.current.handleFilterSymbol(null);

    const { setFilterSymbol } = await import("../../state/paperTrading");
    expect(setFilterSymbol).toHaveBeenCalledWith(null);
  });
});

// ============================================================
// LiveFilters component tests
// ============================================================
describe("LiveFilters", () => {
  beforeEach(() => {
    mockStateStore.currentView = "live";
    mockStateStore.botRunning = false;
    mockStateStore.botPid = null;
    vi.clearAllMocks();
  });

  it("renders BotCardStrip with bots and selectedBotId", () => {
    const bots = [mockBot({ id: "bot-1", name: "Bot A" }), mockBot({ id: "bot-2", name: "Bot B" })];

    r(<LiveFilters activeBotId="bot-1" bots={bots} state={mockStateStore} actions={mockActions} />);

    expect(screen.getByTestId("bot-card-strip")).toBeInTheDocument();
    expect(screen.getByTestId("bot-card-bot-1")).toBeInTheDocument();
    expect(screen.getByTestId("bot-card-bot-2")).toBeInTheDocument();
  });

  it("renders StatusBadge with running state and pid", () => {
    mockStateStore.botRunning = true;
    mockStateStore.botPid = 12345;

    r(
      <LiveFilters
        activeBotId="bot-1"
        bots={[mockBot()]}
        state={mockStateStore}
        actions={mockActions}
      />,
    );

    expect(screen.getByTestId("bot-status")).toBeInTheDocument();
    expect(screen.getByText("Running (PID 12345)")).toBeInTheDocument();
  });

  it("renders StatusBadge as Stopped when not running", () => {
    mockStateStore.botRunning = false;

    r(
      <LiveFilters
        activeBotId="bot-1"
        bots={[mockBot()]}
        state={mockStateStore}
        actions={mockActions}
      />,
    );

    expect(screen.getByText("Stopped")).toBeInTheDocument();
  });

  it("renders Refresh button that calls actions.handleRefresh", async () => {
    const user = userEvent.setup();
    mockStateStore.botRunning = false;

    r(
      <LiveFilters
        activeBotId={null}
        bots={[mockBot()]}
        state={mockStateStore}
        actions={mockActions}
      />,
    );

    const refreshBtn = screen.getByTestId("refresh-btn");
    expect(refreshBtn).toBeInTheDocument();
    expect(refreshBtn).toHaveTextContent("Refresh");

    await user.click(refreshBtn);

    expect(mockActions.handleRefresh).toHaveBeenCalled();
  });

  it("renders Start button when bot not running", () => {
    mockStateStore.botRunning = false;

    r(
      <LiveFilters
        activeBotId="bot-1"
        bots={[mockBot({ name: "My Bot" })]}
        state={mockStateStore}
        actions={mockActions}
      />,
    );

    const startBtn = screen.getByTestId("start-bot-btn");
    expect(startBtn).toBeInTheDocument();
    expect(startBtn).toHaveTextContent("Start My Bot");
  });

  it("renders Stop button when bot is running", () => {
    mockStateStore.botRunning = true;

    r(
      <LiveFilters
        activeBotId="bot-1"
        bots={[mockBot({ name: "My Bot" })]}
        state={mockStateStore}
        actions={mockActions}
      />,
    );

    const stopBtn = screen.getByTestId("stop-bot-btn");
    expect(stopBtn).toBeInTheDocument();
    expect(stopBtn).toHaveTextContent("Stop My Bot");
  });

  it("Start button calls handleToggleBot when clicked", async () => {
    const user = userEvent.setup();
    mockStateStore.botRunning = false;

    r(
      <LiveFilters
        activeBotId="bot-1"
        bots={[mockBot()]}
        state={mockStateStore}
        actions={mockActions}
      />,
    );

    await user.click(screen.getByTestId("start-bot-btn"));
    expect(mockActions.handleToggleBot).toHaveBeenCalled();
  });

  it("Stop button calls handleToggleBot when clicked", async () => {
    const user = userEvent.setup();
    mockStateStore.botRunning = true;

    r(
      <LiveFilters
        activeBotId="bot-1"
        bots={[mockBot()]}
        state={mockStateStore}
        actions={mockActions}
      />,
    );

    await user.click(screen.getByTestId("stop-bot-btn"));
    expect(mockActions.handleToggleBot).toHaveBeenCalled();
  });

  it("shows 'Bot' as default name when selected bot not found", () => {
    const bots = [mockBot({ id: "bot-2", name: "Other Bot" })];

    r(
      <LiveFilters
        activeBotId="bot-999"
        bots={bots}
        state={mockStateStore}
        actions={mockActions}
      />,
    );

    expect(screen.getByTestId("start-bot-btn")).toHaveTextContent("Start Bot");
  });

  it("renders empty BotCardStrip when bots array is empty", () => {
    const { container } = r(
      <LiveFilters activeBotId={null} bots={[]} state={mockStateStore} actions={mockActions} />,
    );

    expect(container.querySelector('[data-testid="bot-status"]')).toBeTruthy();
  });
});

// ============================================================
// HistoryFilters component tests
// ============================================================
describe("HistoryFilters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStateStore.trades = [];
    mockStateStore.filterFromDate = null;
    mockStateStore.filterToDate = null;
  });

  it("renders date pickers with correct testids", () => {
    mockStateStore.filterFromDate = "2026-04-01";
    mockStateStore.filterToDate = "2026-04-27";

    r(<HistoryFilters state={mockStateStore} filters={mockFilters} />);

    expect(screen.getByTestId("filter-from-date")).toBeInTheDocument();
    expect(screen.getByTestId("filter-to-date")).toBeInTheDocument();
  });

  it("renders symbol select with clearable and 'All' option", () => {
    mockStateStore.trades = [mockTrade({ symbol: "RELIANCE" })];

    r(<HistoryFilters state={mockStateStore} filters={mockFilters} />);

    const symbolSelect = screen.getByTestId("filter-symbol");
    expect(symbolSelect).toBeInTheDocument();
    expect(screen.getByText("All")).toBeInTheDocument();
  });

  it("symbol select shows all unique symbols from trades", () => {
    mockStateStore.trades = [
      mockTrade({ symbol: "RELIANCE" }),
      mockTrade({ symbol: "TCS" }),
      mockTrade({ symbol: "RELIANCE" }),
    ];

    r(<HistoryFilters state={mockStateStore} filters={mockFilters} />);

    expect(screen.getByText("RELIANCE")).toBeInTheDocument();
    expect(screen.getByText("TCS")).toBeInTheDocument();
  });

  it("changing from date calls handleFilterFromDate", async () => {
    mockStateStore.filterFromDate = "2026-04-01";

    r(<HistoryFilters state={mockStateStore} filters={mockFilters} />);

    const fromPicker = screen.getByTestId("filter-from-date");
    fireEvent.change(fromPicker, { target: { value: "2026-04-02" } });

    expect(mockFilters.handleFilterFromDate).toHaveBeenCalledWith("2026-04-02");
  });

  it("changing to date calls handleFilterToDate", async () => {
    const user = userEvent.setup();
    mockStateStore.filterToDate = "2026-04-27";

    r(<HistoryFilters state={mockStateStore} filters={mockFilters} />);

    const toPicker = screen.getByTestId("filter-to-date");
    await user.click(toPicker);

    expect(screen.getByTestId("filter-to-date")).toBeInTheDocument();
  });

  it("changing symbol select calls handleFilterSymbol", async () => {
    const user = userEvent.setup();
    mockStateStore.trades = [mockTrade({ symbol: "RELIANCE" })];

    r(<HistoryFilters state={mockStateStore} filters={mockFilters} />);

    const symbolSelect = screen.getByTestId("filter-symbol");
    await user.selectOptions(symbolSelect, "RELIANCE");

    expect(mockFilters.handleFilterSymbol).toHaveBeenCalledWith("RELIANCE");
  });

  it("selecting 'All' clears the filter", async () => {
    const user = userEvent.setup();
    mockStateStore.trades = [mockTrade({ symbol: "RELIANCE" })];

    r(<HistoryFilters state={mockStateStore} filters={mockFilters} />);

    const symbolSelect = screen.getByTestId("filter-symbol");
    await user.selectOptions(symbolSelect, "");

    expect(mockFilters.handleFilterSymbol).toHaveBeenCalledWith(null);
  });

  it("renders empty symbol options when no trades", () => {
    mockStateStore.trades = [];

    r(<HistoryFilters state={mockStateStore} filters={mockFilters} />);

    expect(screen.getByTestId("filter-symbol")).toBeInTheDocument();
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(1);
  });
});

// ============================================================
// FiltersBar component tests
// ============================================================
describe("FiltersBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns LiveFilters when currentView === 'live'", () => {
    mockStateStore.currentView = "live";

    r(
      <FiltersBar
        activeBotId={null}
        bots={[]}
        state={mockStateStore}
        actions={mockActions}
        filters={mockFilters}
      />,
    );

    expect(screen.getByTestId("bot-status")).toBeInTheDocument();
    expect(screen.getByTestId("refresh-btn")).toBeInTheDocument();
  });

  it("returns HistoryFilters when currentView === 'history'", () => {
    mockStateStore.currentView = "history";

    r(
      <FiltersBar
        activeBotId={null}
        bots={[]}
        state={mockStateStore}
        actions={mockActions}
        filters={mockFilters}
      />,
    );

    expect(screen.getByTestId("filter-from-date")).toBeInTheDocument();
    expect(screen.getByTestId("filter-to-date")).toBeInTheDocument();
  });

  it("returns null for other views", () => {
    mockStateStore.currentView = "settings";

    const { container } = r(
      <FiltersBar
        activeBotId={null}
        bots={[]}
        state={mockStateStore}
        actions={mockActions}
        filters={mockFilters}
      />,
    );

    // No component testids should be rendered (MantineProvider may inject styles)
    expect(container.querySelector("[data-testid]")).toBeNull();
  });
});

// ============================================================
// PaperTradingTabs component tests
// ============================================================
describe("PaperTradingTabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStateStore.positions = [];
    mockStateStore.trades = [];
    mockStateStore.currentView = "live";
  });

  it("renders Tabs with Live, History, and Settings tabs", () => {
    const onViewChange = vi.fn();

    r(<PaperTradingTabs state={mockStateStore} onViewChange={onViewChange} />);

    expect(screen.getByTestId("tab-live")).toBeInTheDocument();
    expect(screen.getByTestId("trade-history-tab")).toBeInTheDocument();
    expect(screen.getByTestId("tab-settings")).toBeInTheDocument();
  });

  it("shows position count badge in Live tab when positions exist", () => {
    const onViewChange = vi.fn();
    mockStateStore.positions = [mockTrade() as any];

    r(<PaperTradingTabs state={mockStateStore} onViewChange={onViewChange} />);

    expect(screen.getByText("(1)")).toBeInTheDocument();
  });

  it("does not show position badge when positions empty", () => {
    const onViewChange = vi.fn();
    mockStateStore.positions = [];

    r(<PaperTradingTabs state={mockStateStore} onViewChange={onViewChange} />);

    expect(screen.queryByText("(0)")).not.toBeInTheDocument();
  });

  it("shows trade count badge in History tab when trades exist", () => {
    const onViewChange = vi.fn();
    mockStateStore.trades = [mockTrade()];

    r(<PaperTradingTabs state={mockStateStore} onViewChange={onViewChange} />);

    expect(screen.getByText("(1)")).toBeInTheDocument();
  });

  it("onChange calls onViewChange with selected tab value", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();

    r(<PaperTradingTabs state={mockStateStore} onViewChange={onViewChange} />);

    await user.click(screen.getByTestId("tab-settings"));

    expect(onViewChange).toHaveBeenCalledWith("settings");
  });

  it("renders correct tab labels", () => {
    const onViewChange = vi.fn();

    r(<PaperTradingTabs state={mockStateStore} onViewChange={onViewChange} />);

    expect(screen.getByText("Positions")).toBeInTheDocument();
    expect(screen.getByText("Trade History")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });
});

// ============================================================
// Integration tests
// ============================================================
describe("PaperTradingHelpers integration", () => {
  beforeEach(() => {
    mockStateStore.currentView = "live";
    mockStateStore.botRunning = false;
    mockStateStore.trades = [];
    vi.clearAllMocks();
  });

  it("full filter flow: changing date picker triggers handleFilterFromDate", () => {
    mockStateStore.filterFromDate = null;
    mockStateStore.filterToDate = null;
    mockStateStore.trades = [mockTrade({ symbol: "RELIANCE" })];

    r(<HistoryFilters state={mockStateStore} filters={mockFilters} />);

    const fromPicker = screen.getByTestId("filter-from-date");
    fireEvent.change(fromPicker, { target: { value: "2026-04-01" } });

    expect(mockFilters.handleFilterFromDate).toHaveBeenCalledWith("2026-04-01");
  });

  it("changing symbol select triggers handleFilterSymbol", async () => {
    const user = userEvent.setup();
    mockStateStore.trades = [mockTrade({ symbol: "RELIANCE" })];

    r(<HistoryFilters state={mockStateStore} filters={mockFilters} />);

    const symbolSelect = screen.getByTestId("filter-symbol");
    await user.selectOptions(symbolSelect, "RELIANCE");

    expect(mockFilters.handleFilterSymbol).toHaveBeenCalledWith("RELIANCE");
  });

  it("clicking refresh button in LiveFilters triggers handleRefresh", async () => {
    const user = userEvent.setup();
    mockStateStore.botRunning = false;
    const bots = [mockBot()];

    r(<LiveFilters activeBotId={null} bots={bots} state={mockStateStore} actions={mockActions} />);

    await user.click(screen.getByTestId("refresh-btn"));

    expect(mockActions.handleRefresh).toHaveBeenCalled();
  });

  it("FiltersBar correctly renders LiveFilters with all subcomponents", () => {
    const bots = [mockBot({ id: "bot-1", name: "Bot 1" }), mockBot({ id: "bot-2", name: "Bot 2" })];
    mockStateStore.currentView = "live";
    mockStateStore.botRunning = true;
    mockStateStore.botPid = 1234;

    r(
      <FiltersBar
        activeBotId="bot-1"
        bots={bots}
        state={mockStateStore}
        actions={mockActions}
        filters={mockFilters}
      />,
    );

    expect(screen.getByTestId("bot-card-bot-1")).toBeInTheDocument();
    expect(screen.getByTestId("bot-card-bot-2")).toBeInTheDocument();
    expect(screen.getByTestId("bot-status")).toBeInTheDocument();
    expect(screen.getByTestId("refresh-btn")).toBeInTheDocument();
    expect(screen.getByTestId("stop-bot-btn")).toBeInTheDocument();
  });

  it("FiltersBar correctly renders HistoryFilters with all subcomponents", () => {
    mockStateStore.currentView = "history";
    mockStateStore.trades = [mockTrade({ symbol: "RELIANCE" }), mockTrade({ symbol: "TCS" })];

    r(
      <FiltersBar
        activeBotId={null}
        bots={[]}
        state={mockStateStore}
        actions={mockActions}
        filters={mockFilters}
      />,
    );

    expect(screen.getByTestId("filter-from-date")).toBeInTheDocument();
    expect(screen.getByTestId("filter-to-date")).toBeInTheDocument();
    expect(screen.getByTestId("filter-symbol")).toBeInTheDocument();
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("RELIANCE")).toBeInTheDocument();
    expect(screen.getByText("TCS")).toBeInTheDocument();
  });
});

// ============================================================
// Edge case tests
// ============================================================
describe("Edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("activeBotId null vs non-null", () => {
    it("usePaperViewActions uses refreshLiveData when activeBotId is null", async () => {
      const { result } = renderHook(() => usePaperViewActions(null));

      await act(async () => {
        await result.current.handleRefresh();
      });

      const { refreshLiveData } = await import("../../api/paperTrading");
      expect(refreshLiveData).toHaveBeenCalled();
    });

    it("usePaperViewActions uses refreshBotLiveData when activeBotId is set", async () => {
      const { result } = renderHook(() => usePaperViewActions("bot-1"));

      await act(async () => {
        await result.current.handleRefresh();
      });

      const { refreshBotLiveData } = await import("../../api/paperTrading");
      expect(refreshBotLiveData).toHaveBeenCalledWith("bot-1");
    });
  });

  describe("bots array empty vs single vs multiple", () => {
    it("LiveFilters renders bot-status when bots empty", () => {
      mockStateStore.botRunning = false;

      const { container } = r(
        <LiveFilters activeBotId={null} bots={[]} state={mockStateStore} actions={mockActions} />,
      );

      expect(container.querySelector('[data-testid="bot-status"]')).toBeTruthy();
    });

    it("LiveFilters handles single bot correctly", () => {
      const bots = [mockBot({ id: "bot-1", name: "Single Bot" })];
      mockStateStore.botRunning = false;

      r(
        <LiveFilters
          activeBotId="bot-1"
          bots={bots}
          state={mockStateStore}
          actions={mockActions}
        />,
      );

      expect(screen.getByTestId("bot-card-bot-1")).toBeInTheDocument();
      expect(screen.getByText("Single Bot")).toBeInTheDocument();
    });

    it("LiveFilters handles multiple bots with selection", () => {
      const bots = [
        mockBot({ id: "bot-1", name: "Bot A" }),
        mockBot({ id: "bot-2", name: "Bot B" }),
        mockBot({ id: "bot-3", name: "Bot C" }),
      ];
      mockStateStore.botRunning = false;

      r(
        <LiveFilters
          activeBotId="bot-2"
          bots={bots}
          state={mockStateStore}
          actions={mockActions}
        />,
      );

      expect(screen.getByTestId("bot-card-bot-1")).toBeInTheDocument();
      expect(screen.getByTestId("bot-card-bot-2")).toBeInTheDocument();
      expect(screen.getByTestId("bot-card-bot-3")).toBeInTheDocument();
    });
  });

  describe("strategies empty vs multiple", () => {
    it("HistoryFilters renders with empty trades", () => {
      mockStateStore.trades = [];

      r(<HistoryFilters state={mockStateStore} filters={mockFilters} />);

      expect(screen.getByTestId("filter-symbol")).toBeInTheDocument();
    });
  });

  describe("trades empty for symbol options", () => {
    it("HistoryFilters shows only 'All' option when no trades", () => {
      mockStateStore.trades = [];

      r(<HistoryFilters state={mockStateStore} filters={mockFilters} />);

      expect(screen.getByText("All")).toBeInTheDocument();
      expect(screen.queryAllByRole("option")).toHaveLength(1);
    });
  });

  describe("fromDate/toDate null in state", () => {
    it("handleViewChange('history') sets default dates when both null", async () => {
      mockStateStore.filterFromDate = null;
      mockStateStore.filterToDate = null;
      mockStateStore.currentView = "live";

      const { result } = renderHook(() => usePaperViewActions(null));

      await act(async () => {
        await result.current.handleViewChange("history");
      });

      const { setFilterFromDate, setFilterToDate } = await import("../../state/paperTrading");
      expect(setFilterFromDate).toHaveBeenCalled();
      expect(setFilterToDate).toHaveBeenCalled();
    });

    it("handleViewChange('history') preserves existing from date when toDate is null", async () => {
      mockStateStore.filterFromDate = "2026-04-01";
      mockStateStore.filterToDate = null;
      mockStateStore.currentView = "live";

      const { result } = renderHook(() => usePaperViewActions(null));

      await act(async () => {
        await result.current.handleViewChange("history");
      });

      const { refreshHistoryData } = await import("../../api/paperTrading");
      expect(refreshHistoryData).toHaveBeenCalledWith(null, "2026-04-01", null);
    });

    it("handleViewChange('history') preserves existing to date when fromDate is null", async () => {
      mockStateStore.filterFromDate = null;
      mockStateStore.filterToDate = "2026-04-27";
      mockStateStore.currentView = "live";

      const { result } = renderHook(() => usePaperViewActions(null));

      await act(async () => {
        await result.current.handleViewChange("history");
      });

      const { refreshHistoryData } = await import("../../api/paperTrading");
      expect(refreshHistoryData).toHaveBeenCalledWith(null, null, "2026-04-27");
    });
  });
});
