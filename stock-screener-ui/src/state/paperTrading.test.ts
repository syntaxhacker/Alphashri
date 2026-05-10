import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  initialPaperTradingState,
  getPaperTradingState,
  subscribe,
  setPositions,
  setPortfolio,
  setTrades,
  setDailySummary,
  setPerformanceSummary,
  setSymbolPerformance,
  setFilterDate,
  setFilterFromDate,
  setFilterToDate,
  setFilterSymbol,
  setFilterStrategy,
  setFilterBot,
  setSelectedSymbol,
  setSelectedTradeId,
  setShowAllTrades,
  setShowOrbLines,
  setShowPivotLines,
  setShow52wLines,
  setShowEmaLines,
  setSelectedStrategyTab,
  setChartData,
  setChartLoading,
  setChartTimeframe,
  setLoading,
  setError,
  setAutoRefresh,
  setBotStatus,
  setBotSnapshot,
  setStrategyConfig,
  setConfigLoading,
  setConfigError,
  setConfigDirty,
  updateConfigValue,
  setAvailableBots,
  resetPaperTradingState,
  triggerPaperTradingRerender,
  setPaperTradingView,
  deleteTradeAction,
  updateTradeNotesAction,
  setupAutoRefresh,
  stopAutoRefresh,
} from "./paperTrading";
import type {
  PaperPosition,
  PaperTrade,
  PortfolioStatus,
  DailySummary,
  PerformanceSummary,
  SymbolPerformance,
  StrategyConfig,
  BotInfo,
} from "../types/paperTrading";

vi.mock("../api/paperTrading", () => ({
  deleteTrade: vi.fn(),
  updateTradeNotes: vi.fn(),
}));

beforeEach(() => {
  resetPaperTradingState();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function createMockPosition(overrides: Partial<PaperPosition> = {}): PaperPosition {
  return {
    symbol: "RELIANCE",
    side: "BUY",
    quantity: 10,
    entry_price: 2500,
    current_price: 2600,
    entry_time: "2025-01-01T09:15:00",
    stop_loss: 2450,
    take_profit: 2650,
    pnl: 1000,
    pnl_pct: 4,
    margin_used: 25000,
    order_id: "ord-1",
    strategy_id: 1,
    strategy_name: "ORB",
    ...overrides,
  };
}

function createMockTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    trade_id: "t-1",
    symbol: "RELIANCE",
    side: "BUY",
    quantity: 10,
    entry_price: 2500,
    exit_price: 2600,
    entry_time: "2025-01-01T09:15:00",
    exit_time: "2025-01-01T10:30:00",
    pnl: 1000,
    pnl_pct: 4,
    exit_reason: "TP",
    costs: 20,
    net_pnl: 980,
    stop_loss: 2450,
    take_profit: 2650,
    peak_price: 2650,
    low_price: 2490,
    notes: "",
    strategy_id: 1,
    strategy_name: "ORB",
    bot_id: null,
    bot_name: null,
    ...overrides,
  };
}

describe("paperTrading state", () => {
  it("has correct initial state", () => {
    resetPaperTradingState();
    const state = getPaperTradingState();
    expect(state.currentView).toBe("live");
    expect(state.positions).toEqual([]);
    expect(state.portfolio).toBeNull();
    expect(state.trades).toEqual([]);
    expect(state.dailySummary).toBeNull();
    expect(state.performanceSummary).toBeNull();
    expect(state.symbolPerformance).toEqual([]);
    expect(state.filterDate).toBeNull();
    expect(state.filterFromDate).toBe(new Date().toISOString().split("T")[0]);
    expect(state.filterToDate).toBe(new Date().toISOString().split("T")[0]);
    expect(state.filterSymbol).toBeNull();
    expect(state.filterStrategy).toBeNull();
    expect(state.filterBot).toBeNull();
    expect(state.selectedSymbol).toBeNull();
    expect(state.selectedStrategyTab).toBeNull();
    expect(state.chartData).toBeNull();
    expect(state.chartLoading).toBe(false);
    expect(state.chartTimeframe).toBe("5min");
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.autoRefreshEnabled).toBe(true);
    expect(state.botRunning).toBe(false);
    expect(state.botPid).toBeNull();
    expect(state.botLogFile).toBeNull();
    expect(state.botSnapshot).toBeNull();
    expect(state.strategyConfig).toBeNull();
    expect(state.configLoading).toBe(false);
    expect(state.configError).toBeNull();
    expect(state.configDirty).toBe(false);
    expect(state.availableBots).toEqual([]);
  });

  it("initialPaperTradingState is a frozen snapshot", () => {
    expect(initialPaperTradingState.currentView).toBe("live");
    expect(initialPaperTradingState.positions).toEqual([]);
  });
});

describe("subscribe", () => {
  it("returns unsubscribe function", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("unsubscribes callback from future notifications", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);
    unsub();
    setPositions([]);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("setter functions", () => {
  it("setPaperTradingView updates currentView", () => {
    setPaperTradingView("history");
    expect(getPaperTradingState().currentView).toBe("history");
  });

  it("setPositions updates positions", () => {
    const positions = [createMockPosition()];
    setPositions(positions);
    expect(getPaperTradingState().positions).toEqual(positions);
  });

  it("setPositions accepts empty array", () => {
    setPositions([]);
    expect(getPaperTradingState().positions).toEqual([]);
  });

  it("setPortfolio updates portfolio", () => {
    const portfolio: PortfolioStatus = {
      initial_capital: 100000,
      cash: 50000,
      margin_used: 25000,
      position_value: 75000,
      unrealized_pnl: 2000,
      realized_pnl: 5000,
      total_value: 125000,
      total_pnl: 7000,
      total_pnl_pct: 7,
      positions: 1,
      trades: 5,
      daily_pnl: 500,
      daily_pnl_pct: 0.5,
      daily_trades: 2,
      open_positions: 1,
    };
    setPortfolio(portfolio);
    expect(getPaperTradingState().portfolio).toEqual(portfolio);
  });

  it("setPortfolio accepts null", () => {
    setPortfolio(null);
    expect(getPaperTradingState().portfolio).toBeNull();
  });

  it("setTrades updates trades", () => {
    const trades = [createMockTrade()];
    setTrades(trades);
    expect(getPaperTradingState().trades).toEqual(trades);
  });

  it("setDailySummary updates dailySummary", () => {
    const summary: DailySummary = {
      date: "2025-01-01",
      trades: 5,
      winners: 3,
      losers: 2,
      total_pnl: 5000,
      net_pnl: 4500,
      total_costs: 500,
      symbols: ["RELIANCE", "TCS"],
    };
    setDailySummary(summary);
    expect(getPaperTradingState().dailySummary).toEqual(summary);
  });

  it("setDailySummary accepts null", () => {
    setDailySummary(null);
    expect(getPaperTradingState().dailySummary).toBeNull();
  });

  it("setPerformanceSummary updates performanceSummary", () => {
    const summary: PerformanceSummary = {
      total_trades: 100,
      winners: 60,
      losers: 40,
      win_rate: 60,
      total_pnl: 50000,
      net_pnl: 45000,
      total_costs: 5000,
      avg_win: 1500,
      avg_loss: 800,
      profit_factor: 1.8,
    };
    setPerformanceSummary(summary);
    expect(getPaperTradingState().performanceSummary).toEqual(summary);
  });

  it("setPerformanceSummary accepts null", () => {
    setPerformanceSummary(null);
    expect(getPaperTradingState().performanceSummary).toBeNull();
  });

  it("setSymbolPerformance updates symbolPerformance", () => {
    const perf: SymbolPerformance[] = [
      {
        symbol: "RELIANCE",
        trades: 10,
        winners: 6,
        losers: 4,
        win_rate: 60,
        net_pnl: 5000,
        total_costs: 500,
      },
    ];
    setSymbolPerformance(perf);
    expect(getPaperTradingState().symbolPerformance).toEqual(perf);
  });
});

describe("filter setters", () => {
  it("setFilterDate updates filterDate", () => {
    setFilterDate("2025-01-01");
    expect(getPaperTradingState().filterDate).toBe("2025-01-01");
    setFilterDate(null);
    expect(getPaperTradingState().filterDate).toBeNull();
  });

  it("setFilterFromDate updates filterFromDate", () => {
    setFilterFromDate("2025-01-01");
    expect(getPaperTradingState().filterFromDate).toBe("2025-01-01");
  });

  it("setFilterToDate updates filterToDate", () => {
    setFilterToDate("2025-12-31");
    expect(getPaperTradingState().filterToDate).toBe("2025-12-31");
  });

  it("setFilterSymbol updates filterSymbol", () => {
    setFilterSymbol("RELIANCE");
    expect(getPaperTradingState().filterSymbol).toBe("RELIANCE");
    setFilterSymbol(null);
    expect(getPaperTradingState().filterSymbol).toBeNull();
  });

  it("setFilterStrategy updates filterStrategy", () => {
    setFilterStrategy(5);
    expect(getPaperTradingState().filterStrategy).toBe(5);
  });

  it("setFilterBot updates filterBot", () => {
    setFilterBot("bot-uuid-1");
    expect(getPaperTradingState().filterBot).toBe("bot-uuid-1");
    setFilterBot(null);
    expect(getPaperTradingState().filterBot).toBeNull();
  });
});

describe("chart management", () => {
  it("setSelectedSymbol updates selectedSymbol", () => {
    setSelectedSymbol("RELIANCE");
    expect(getPaperTradingState().selectedSymbol).toBe("RELIANCE");
    setSelectedSymbol(null);
    expect(getPaperTradingState().selectedSymbol).toBeNull();
  });

  it("setSelectedSymbol clears selectedTradeId", () => {
    setSelectedTradeId("trade-1", "ORB", 1);
    expect(getPaperTradingState().selectedTradeId).toBe("trade-1");
    setSelectedSymbol("RELIANCE");
    expect(getPaperTradingState().selectedSymbol).toBe("RELIANCE");
    expect(getPaperTradingState().selectedTradeId).toBeNull();
  });

  it("setSelectedTradeId sets ORB line visibility for ORB strategy", () => {
    setSelectedTradeId("trade-1", "ORB", 1);
    const state = getPaperTradingState();
    expect(state.selectedTradeId).toBe("trade-1");
    expect(state.selectedStrategyId).toBe(1);
    expect(state.showAllTrades).toBe(false);
    expect(state.showOrbLines).toBe(true);
    expect(state.showPivotLines).toBe(false);
    expect(state.show52wLines).toBe(false);
  });

  it("setSelectedTradeId sets SR_BREAKOUT line visibility", () => {
    setSelectedTradeId("trade-2", "SR_BREAKOUT", 2);
    const state = getPaperTradingState();
    expect(state.selectedTradeId).toBe("trade-2");
    expect(state.selectedStrategyId).toBe(2);
    expect(state.showOrbLines).toBe(false);
    expect(state.showPivotLines).toBe(true);
    expect(state.show52wLines).toBe(false);
  });

  it("setSelectedTradeId sets 52W line visibility", () => {
    setSelectedTradeId("trade-3", "52W_TARGET", 3);
    const state = getPaperTradingState();
    expect(state.selectedTradeId).toBe("trade-3");
    expect(state.showOrbLines).toBe(false);
    expect(state.showPivotLines).toBe(false);
    expect(state.show52wLines).toBe(true);
  });

  it("setSelectedTradeId handles 52W prefix strategies", () => {
    setSelectedTradeId("trade-4", "52W_CHASER", 4);
    const state = getPaperTradingState();
    expect(state.show52wLines).toBe(true);
  });

  it("setSelectedTradeId clears all overlays when no strategy type", () => {
    setSelectedTradeId("trade-5", null, null);
    const state = getPaperTradingState();
    expect(state.showOrbLines).toBe(false);
    expect(state.showPivotLines).toBe(false);
    expect(state.show52wLines).toBe(false);
    expect(state.selectedStrategyId).toBeNull();
  });

  it("setShowAllTrades toggles all trades view", () => {
    setShowAllTrades(true);
    expect(getPaperTradingState().showAllTrades).toBe(true);
    setShowAllTrades(false);
    expect(getPaperTradingState().showAllTrades).toBe(false);
  });

  it("setShowOrbLines toggles ORB overlay", () => {
    setShowOrbLines(true);
    expect(getPaperTradingState().showOrbLines).toBe(true);
    setShowOrbLines(false);
    expect(getPaperTradingState().showOrbLines).toBe(false);
  });

  it("setShowPivotLines toggles pivot overlay", () => {
    setShowPivotLines(true);
    expect(getPaperTradingState().showPivotLines).toBe(true);
    setShowPivotLines(false);
    expect(getPaperTradingState().showPivotLines).toBe(false);
  });

  it("setShow52wLines toggles 52W overlay", () => {
    setShow52wLines(true);
    expect(getPaperTradingState().show52wLines).toBe(true);
    setShow52wLines(false);
    expect(getPaperTradingState().show52wLines).toBe(false);
  });

  it("setShowEmaLines toggles EMA overlay", () => {
    setShowEmaLines(true);
    expect(getPaperTradingState().showEmaLines).toBe(true);
    setShowEmaLines(false);
    expect(getPaperTradingState().showEmaLines).toBe(false);
  });

  it("setSelectedStrategyTab updates selectedStrategyTab", () => {
    setSelectedStrategyTab("ORB");
    expect(getPaperTradingState().selectedStrategyTab).toBe("ORB");
  });

  it("setChartData updates chartData and sets chartLoading to false", () => {
    const chartData = {
      symbol: "RELIANCE",
      date: "2025-01-01",
      candles: [],
      trades: [],
      orb_levels: null,
      week52_levels: null,
      current_position: null,
    };
    setChartData(chartData);
    expect(getPaperTradingState().chartData).toEqual(chartData);
    expect(getPaperTradingState().chartLoading).toBe(false);
  });

  it("setChartData accepts null", () => {
    setChartData(null);
    expect(getPaperTradingState().chartData).toBeNull();
    expect(getPaperTradingState().chartLoading).toBe(false);
  });

  it("setChartLoading updates chartLoading", () => {
    setChartLoading(true);
    expect(getPaperTradingState().chartLoading).toBe(true);
  });

  it("setChartTimeframe updates chartTimeframe", () => {
    setChartTimeframe("15min");
    expect(getPaperTradingState().chartTimeframe).toBe("15min");
  });
});

describe("loading and error", () => {
  it("setLoading updates isLoading", () => {
    setLoading(true);
    expect(getPaperTradingState().isLoading).toBe(true);
    setLoading(false);
    expect(getPaperTradingState().isLoading).toBe(false);
  });

  it("setError updates error and sets isLoading to false", () => {
    setLoading(true);
    setError("something failed");
    expect(getPaperTradingState().error).toBe("something failed");
    expect(getPaperTradingState().isLoading).toBe(false);
  });

  it("setError accepts null", () => {
    setError("err");
    setError(null);
    expect(getPaperTradingState().error).toBeNull();
  });
});

describe("auto-refresh", () => {
  it("setAutoRefresh disables and clears timer", () => {
    setAutoRefresh(false);
    expect(getPaperTradingState().autoRefreshEnabled).toBe(false);
  });

  it("setAutoRefresh enables refresh", () => {
    setAutoRefresh(false);
    setAutoRefresh(true);
    expect(getPaperTradingState().autoRefreshEnabled).toBe(true);
  });

  it("setupAutoRefresh starts interval that calls fetchFn", () => {
    const fetchFn = vi.fn();
    setupAutoRefresh(fetchFn, 10000);
    expect(fetchFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10000);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10000);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    stopAutoRefresh();
  });

  it("setupAutoRefresh only calls fetchFn when autoRefreshEnabled and view=live", () => {
    const fetchFn = vi.fn();
    setAutoRefresh(false);
    setupAutoRefresh(fetchFn, 10000);

    vi.advanceTimersByTime(10000);
    expect(fetchFn).not.toHaveBeenCalled();

    setAutoRefresh(true);
    vi.advanceTimersByTime(10000);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    stopAutoRefresh();
  });

  it("setupAutoRefresh does not call fetchFn when view is not live", () => {
    const fetchFn = vi.fn();
    setPaperTradingView("history");
    setupAutoRefresh(fetchFn, 10000);

    vi.advanceTimersByTime(10000);
    expect(fetchFn).not.toHaveBeenCalled();

    setPaperTradingView("live");
    vi.advanceTimersByTime(10000);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    stopAutoRefresh();
  });

  it("stopAutoRefresh clears the interval timer", () => {
    const fetchFn = vi.fn();
    setupAutoRefresh(fetchFn, 10000);
    stopAutoRefresh();

    vi.advanceTimersByTime(10000);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("setupAutoRefresh replaces existing timer", () => {
    const fetchFn1 = vi.fn();
    const fetchFn2 = vi.fn();
    setupAutoRefresh(fetchFn1, 10000);
    setupAutoRefresh(fetchFn2, 10000);

    vi.advanceTimersByTime(10000);
    expect(fetchFn1).not.toHaveBeenCalled();
    expect(fetchFn2).toHaveBeenCalledTimes(1);

    stopAutoRefresh();
  });
});

describe("bot status", () => {
  it("setBotStatus updates bot fields", () => {
    setBotStatus(true, 12345, "/logs/bot.log");
    const state = getPaperTradingState();
    expect(state.botRunning).toBe(true);
    expect(state.botPid).toBe(12345);
    expect(state.botLogFile).toBe("/logs/bot.log");
  });

  it("setBotStatus accepts null values", () => {
    setBotStatus(false, null, null);
    const state = getPaperTradingState();
    expect(state.botRunning).toBe(false);
    expect(state.botPid).toBeNull();
    expect(state.botLogFile).toBeNull();
  });

  it("setBotSnapshot updates botSnapshot", () => {
    const snapshot = {
      timestamp: "2025-01-01T10:00:00",
      watchlist: ["RELIANCE"],
      open_positions: ["TCS"],
      scan_items: [],
      signals: [],
    };
    setBotSnapshot(snapshot);
    expect(getPaperTradingState().botSnapshot).toEqual(snapshot);
  });
});

describe("strategy config", () => {
  function createMockStrategyConfig(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
    return {
      id: "test-uuid",
      name: "Test",
      strategy_type: "orb",
      parent_id: null,
      is_template: false,
      is_active: true,
      is_default: false,
      description: null,
      or_minutes: 45,
      sl_pct: 0.5,
      tp_pct: 1.5,
      min_or_range_pct: 0.2,
      max_or_range_pct: 5,
      max_positions: 5,
      max_capital_per_trade_pct: 20,
      max_daily_loss_pct: 3,
      max_total_exposure_pct: 80,
      risk_per_trade_pct: 2,
      min_trade_value: 5000,
      max_trade_value: 50000,
      cooldown_minutes: 30,
      max_distance_from_or_pct: 2,
      entry_threshold_pct: 0,
      enable_trailing_stop: false,
      trailing_stop_pct: 0,
      trailing_activation_pct: 0,
      max_holding_days: 0,
      cooldown_days: 0,
      enable_filters: false,
      ema_fast_period: 0,
      ema_slow_period: 0,
      pivot_type: "",
      breakout_buffer_pct: 0,
      brokerage_pct: 0.03,
      min_brokerage: 20,
      stt_pct: 0.1,
      exchange_pct: 0.00345,
      sebi_pct: 0.0001,
      stamp_pct: 0.003,
      gst_pct: 18,
      created_at: null,
      updated_at: null,
      ...overrides,
    };
  }

  it("setStrategyConfig updates config and resets error/dirty", () => {
    const config = createMockStrategyConfig();
    setConfigError("old error");
    setConfigDirty(true);
    setStrategyConfig(config);
    const state = getPaperTradingState();
    expect(state.strategyConfig).toEqual(config);
    expect(state.configLoading).toBe(false);
    expect(state.configError).toBeNull();
    expect(state.configDirty).toBe(false);
  });

  it("setStrategyConfig accepts null", () => {
    setStrategyConfig(null);
    expect(getPaperTradingState().strategyConfig).toBeNull();
  });

  it("setConfigLoading updates configLoading", () => {
    setConfigLoading(true);
    expect(getPaperTradingState().configLoading).toBe(true);
  });

  it("setConfigError updates configError and sets configLoading to false", () => {
    setConfigLoading(true);
    setConfigError("config error");
    const state = getPaperTradingState();
    expect(state.configError).toBe("config error");
    expect(state.configLoading).toBe(false);
  });

  it("setConfigDirty updates configDirty", () => {
    setConfigDirty(true);
    expect(getPaperTradingState().configDirty).toBe(true);
  });

  it("updateConfigValue updates a specific config key and sets dirty", () => {
    const config = createMockStrategyConfig();
    setStrategyConfig(config);
    setConfigDirty(false);
    updateConfigValue("or_minutes", 60);
    const state = getPaperTradingState();
    expect(state.strategyConfig!.or_minutes).toBe(60);
    expect(state.configDirty).toBe(true);
  });

  it("updateConfigValue does nothing when no config is set", () => {
    setStrategyConfig(null);
    updateConfigValue("or_minutes", 60);
    expect(getPaperTradingState().strategyConfig).toBeNull();
  });
});

describe("available bots", () => {
  it("setAvailableBots updates availableBots", () => {
    const bots: BotInfo[] = [{ id: "bot-1", name: "Bot 1", strategies: [], is_active: true }];
    setAvailableBots(bots);
    expect(getPaperTradingState().availableBots).toEqual(bots);
  });

  it("setAvailableBots accepts empty array", () => {
    setAvailableBots([]);
    expect(getPaperTradingState().availableBots).toEqual([]);
  });
});

describe("resetPaperTradingState", () => {
  it("resets all state to initial values", () => {
    setPositions([createMockPosition()]);
    setTrades([createMockTrade()]);
    setFilterSymbol("RELIANCE");
    setLoading(true);
    setError("err");
    setConfigDirty(true);

    resetPaperTradingState();
    const state = getPaperTradingState();
    expect(state.positions).toEqual([]);
    expect(state.trades).toEqual([]);
    expect(state.filterSymbol).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.configDirty).toBe(false);
  });
});

describe("triggerPaperTradingRerender", () => {
  it("notifies subscribers without changing state", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);
    triggerPaperTradingRerender();
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
  });
});

describe("deleteTradeAction", () => {
  it("removes trade from state on success", async () => {
    const { deleteTrade } = await import("../api/paperTrading");
    vi.mocked(deleteTrade).mockResolvedValue(undefined as any);

    const trade1 = createMockTrade({ trade_id: "t-1" });
    const trade2 = createMockTrade({ trade_id: "t-2" });
    setTrades([trade1, trade2]);

    const result = await deleteTradeAction("t-1");
    expect(result).toBe(true);
    expect(getPaperTradingState().trades).toEqual([trade2]);
  });

  it("sets error on failure", async () => {
    const { deleteTrade } = await import("../api/paperTrading");
    vi.mocked(deleteTrade).mockRejectedValue(new Error("API error"));

    setTrades([createMockTrade()]);
    const result = await deleteTradeAction("t-1");
    expect(result).toBe(false);
    expect(getPaperTradingState().error).toBe("API error");
    expect(getPaperTradingState().isLoading).toBe(false);
  });

  it("handles non-Error rejection", async () => {
    const { deleteTrade } = await import("../api/paperTrading");
    vi.mocked(deleteTrade).mockRejectedValue("unknown error");

    setTrades([createMockTrade()]);
    const result = await deleteTradeAction("t-1");
    expect(result).toBe(false);
    expect(getPaperTradingState().error).toBe("Failed to delete trade");
  });
});

describe("updateTradeNotesAction", () => {
  it("updates trade in state with new notes and reason", async () => {
    const { updateTradeNotes } = await import("../api/paperTrading");
    vi.mocked(updateTradeNotes).mockResolvedValue({
      ...createMockTrade({ trade_id: "t-1", notes: "new notes", reason: "new reason" }),
    });

    setTrades([createMockTrade({ trade_id: "t-1", notes: "", reason: "" })]);
    const result = await updateTradeNotesAction("t-1", "new notes", "new reason");
    expect(result).toBe(true);
    const trade = getPaperTradingState().trades.find((t) => t.trade_id === "t-1");
    expect(trade?.notes).toBe("new notes");
    expect(trade?.reason).toBe("new reason");
  });

  it("handles error gracefully", async () => {
    const { updateTradeNotes } = await import("../api/paperTrading");
    vi.mocked(updateTradeNotes).mockRejectedValue(new Error("Update failed"));

    setTrades([createMockTrade({ trade_id: "t-1", notes: "old", reason: "old" })]);
    const result = await updateTradeNotesAction("t-1", "new", "new");
    expect(result).toBe(false);
    expect(getPaperTradingState().error).toBe("Update failed");
    expect(getPaperTradingState().isLoading).toBe(false);
    expect(getPaperTradingState().trades[0].notes).toBe("old");
  });

  it("handles trade not found in local state", async () => {
    const { updateTradeNotes } = await import("../api/paperTrading");
    vi.mocked(updateTradeNotes).mockResolvedValue({
      ...createMockTrade({ trade_id: "t-missing" }),
    });

    setTrades([createMockTrade({ trade_id: "t-1" })]);
    const result = await updateTradeNotesAction("t-missing", "notes", "reason");
    expect(result).toBe(true);
    expect(getPaperTradingState().trades).toHaveLength(1);
    expect(getPaperTradingState().trades[0].trade_id).toBe("t-1");
  });

  it("merges backend response fields", async () => {
    const { updateTradeNotes } = await import("../api/paperTrading");
    vi.mocked(updateTradeNotes).mockResolvedValue({
      ...createMockTrade({ trade_id: "t-1", notes: "from server", reason: "server reason" }),
    });

    setTrades([
      createMockTrade({ trade_id: "t-1", notes: "client notes", reason: "client reason" }),
    ]);
    await updateTradeNotesAction("t-1", "client notes", "client reason");
    const trade = getPaperTradingState().trades.find((t) => t.trade_id === "t-1");
    expect(trade?.notes).toBe("from server");
    expect(trade?.reason).toBe("server reason");
  });
});
