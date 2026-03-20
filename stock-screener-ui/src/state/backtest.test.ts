import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  initialBacktestState,
  getState,
  getBacktestState,
  subscribe,
  setCurrentView,
  setStrategies,
  setVariations,
  setSelectedVariationId,
  setSelectedVariation,
  setSelectedStrategy,
  setSelectedSymbols,
  addSymbol,
  removeSymbol,
  setParam,
  setParams,
  setDays,
  setIncludeCosts,
  setResults,
  setRunning,
  setProgress,
  setError,
  setShowCharts,
  setSelectedChartSymbol,
  setChartDataBatch,
  setChartLoading,
  setChartOptions,
  setTradeHistory,
  setCostBreakdown,
  resetBacktestState,
  triggerRerender,
  getStrategyDefaults,
} from "./backtest";
import type { BacktestResult, BacktestTotals, CostBreakdown, SymbolChartData } from "../types/backtest";

vi.mock("../api/chartBuilder", () => ({
  chartTradesToTrades: vi.fn().mockReturnValue([]),
}));

describe("backtest state", () => {
  beforeEach(() => {
    resetBacktestState();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct initial state", () => {
    resetBacktestState();
    const state = getState();
    expect(state.currentView).toBe("screener");
    expect(state.strategies).toEqual([]);
    expect(state.strategiesLoading).toBe(false);
    expect(state.variations).toEqual([]);
    expect(state.selectedVariation).toBeNull();
    expect(state.selectedStrategy).toBe("orb");
    expect(state.selectedSymbols).toEqual(["NETWEB", "SBILIFE"]);
    expect(state.days).toBe(180);
    expect(state.includeCosts).toBe(true);
    expect(state.results).toBeNull();
    expect(state.totals).toBeNull();
    expect(state.isRunning).toBe(false);
    expect(state.progress).toEqual({ current: 0, total: 0, message: "", running: false });
    expect(state.showCharts).toBe(true);
    expect(state.selectedChartSymbol).toBeNull();
    expect(state.chartData).toEqual(new Map());
    expect(state.chartLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.costBreakdown).toBeNull();
  });

  it("initial params contain orb defaults", () => {
    resetBacktestState();
    const state = getState();
    expect(state.params.or_minutes).toBe(45);
    expect(state.params.timeframe).toBe("5");
    expect(state.params.stop_loss_pct).toBe(0.4);
    expect(state.params.take_profit_pct).toBe(1.2);
    expect(state.params.trade_size).toBe(100);
    expect(state.params.cooldown_bars).toBe(3);
    expect(state.params.enable_shorts).toBe(false);
  });

  it("chart options have correct defaults", () => {
    resetBacktestState();
    const state = getState();
    expect(state.chartOptions.show_orb_zones).toBe(true);
    expect(state.chartOptions.show_entry_markers).toBe(true);
    expect(state.chartOptions.show_exit_markers).toBe(true);
    expect(state.chartOptions.show_sl_tp_lines).toBe(true);
    expect(state.chartOptions.date_range).toBe("all");
  });
});

describe("subscribe", () => {
  beforeEach(() => { resetBacktestState(); });

  it("returns unsubscribe function", () => {
    const unsub = subscribe(vi.fn());
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("triggerRerender notifies subscribers", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);
    triggerRerender();
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
  });
});

describe("setCurrentView", () => {
  beforeEach(() => { resetBacktestState(); });

  it("updates currentView", () => {
    setCurrentView("backtest");
    expect(getState().currentView).toBe("backtest");
  });
});

describe("setStrategies", () => {
  beforeEach(() => { resetBacktestState(); });

  it("updates strategies and sets loading false", () => {
    setStrategies([{ id: "orb", name: "ORB", description: "", params: [] }]);
    const state = getState();
    expect(state.strategies).toHaveLength(1);
    expect(state.strategiesLoading).toBe(false);
  });
});

describe("setVariations", () => {
  beforeEach(() => { resetBacktestState(); });

  it("updates variations", () => {
    const variations = [
      { id: "v1", internal_id: 1, name: "Var 1", strategy_type: "orb", description: "", is_template: false, is_default: true },
    ];
    setVariations(variations);
    expect(getState().variations).toEqual(variations);
  });
});

describe("setSelectedVariationId", () => {
  beforeEach(() => { resetBacktestState(); });

  it("sets variation id directly without param mapping", () => {
    setSelectedVariationId("v1");
    expect(getState().selectedVariation).toBe("v1");
  });

  it("accepts null", () => {
    setSelectedVariationId(null);
    expect(getState().selectedVariation).toBeNull();
  });
});

describe("setSelectedVariation", () => {
  beforeEach(() => { resetBacktestState(); });

  it("maps orb variation params correctly", () => {
    const variations = [
      {
        id: "v1", internal_id: 1, name: "ORB 30min", strategy_type: "ORB",
        description: "", is_template: false, is_default: true,
        or_minutes: 30, sl_pct: 0.5, tp_pct: 2.0, max_positions: 3,
        timeframe: "5", trade_size: 200, cooldown_bars: 2, enable_shorts: true,
      },
    ];
    setVariations(variations);
    setSelectedVariation("v1");

    const state = getState();
    expect(state.selectedVariation).toBe("v1");
    expect(state.selectedStrategy).toBe("orb");
    expect(state.params.or_minutes).toBe(30);
    expect(state.params.stop_loss_pct).toBe(0.5);
    expect(state.params.take_profit_pct).toBe(2.0);
    expect(state.params.max_positions).toBe(3);
    expect(state.params.timeframe).toBe("5");
    expect(state.params.trade_size).toBe(200);
    expect(state.params.cooldown_bars).toBe(2);
    expect(state.params.enable_shorts).toBe(true);
  });

  it("maps sr_breakout variation params", () => {
    const variations = [
      {
        id: "v2", internal_id: 2, name: "SR Breakout", strategy_type: "sr_breakout",
        description: "", is_template: false, is_default: true,
        breakout_buffer_pct: 0.2, pivot_type: "fibonacci", sl_pct: 0.8,
        tp_pct: 2.5, max_positions: 2, trade_size: 150,
      },
    ];
    setVariations(variations);
    setSelectedVariation("v2");

    const state = getState();
    expect(state.selectedStrategy).toBe("sr_breakout");
    expect(state.params.breakout_buffer_pct).toBe(0.2);
    expect(state.params.pivot_type).toBe("fibonacci");
    expect(state.params.stop_loss_pct).toBe(0.8);
    expect(state.params.take_profit_pct).toBe(2.5);
    expect(state.params.max_positions).toBe(2);
    expect(state.params.trade_size).toBe(150);
  });

  it("maps 52w_chaser variation params", () => {
    const variations = [
      {
        id: "v3", internal_id: 3, name: "52W Chaser", strategy_type: "52w_chaser",
        description: "", is_template: false, is_default: true,
        entry_threshold_pct: 2.5, sl_pct: 4.0, tp_pct: 6.0,
        enable_trailing_stop: true, trailing_stop_pct: 2.5, trailing_activation_pct: 1.5,
        max_holding_days: 20, cooldown_days: 15, trade_size: 300, enable_filters: true,
      },
    ];
    setVariations(variations);
    setSelectedVariation("v3");

    const state = getState();
    expect(state.selectedStrategy).toBe("52w_chaser");
    expect(state.params.entry_threshold_pct).toBe(2.5);
    expect(state.params.stop_loss_pct).toBe(4.0);
    expect(state.params.take_profit_pct).toBe(6.0);
    expect(state.params.enable_trailing_stop).toBe(true);
    expect(state.params.trailing_stop_pct).toBe(2.5);
    expect(state.params.trailing_activation_pct).toBe(1.5);
    expect(state.params.max_holding_days).toBe(20);
    expect(state.params.cooldown_days).toBe(15);
    expect(state.params.trade_size).toBe(300);
    expect(state.params.enable_filters).toBe(true);
  });

  it("maps 52w_target variation params", () => {
    const variations = [
      {
        id: "v4", internal_id: 4, name: "52W Target", strategy_type: "52w_target",
        description: "", is_template: false, is_default: true,
        entry_threshold_pct: 1.5, sl_pct: 3.0, trailing_stop_pct: 1.0,
        max_holding_days: 10, cooldown_days: 5, trade_size: 250,
      },
    ];
    setVariations(variations);
    setSelectedVariation("v4");

    const state = getState();
    expect(state.selectedStrategy).toBe("52w_target");
    expect(state.params.entry_threshold_pct).toBe(1.5);
    expect(state.params.stop_loss_pct).toBe(3.0);
    expect(state.params.trailing_stop_pct).toBe(1.0);
    expect(state.params.max_holding_days).toBe(10);
    expect(state.params.cooldown_days).toBe(5);
    expect(state.params.trade_size).toBe(250);
  });

  it("falls back to defaults for missing variation params", () => {
    const variations = [
      {
        id: "v5", internal_id: 5, name: "ORB Minimal", strategy_type: "ORB",
        description: "", is_template: false, is_default: true,
        or_minutes: 30,
      },
    ];
    setVariations(variations);
    setSelectedVariation("v5");

    const state = getState();
    expect(state.params.or_minutes).toBe(30);
    expect(state.params.stop_loss_pct).toBe(0.5);
    expect(state.params.take_profit_pct).toBe(1.5);
    expect(state.params.trade_size).toBe(100);
  });

  it("sets only variation id when variation not found", () => {
    setVariations([]);
    setSelectedVariation("nonexistent");
    const state = getState();
    expect(state.selectedVariation).toBe("nonexistent");
  });
});

describe("setSelectedStrategy", () => {
  beforeEach(() => { resetBacktestState(); });

  it("resets params to strategy defaults", () => {
    setSelectedStrategy("sr_breakout");
    const state = getState();
    expect(state.selectedStrategy).toBe("sr_breakout");
    expect(state.selectedVariation).toBeNull();
    expect(state.params.pivot_type).toBe("classic");
    expect(state.params.breakout_buffer_pct).toBe(0.1);
  });

  it("resets params when switching from orb to 52w_chaser", () => {
    setSelectedStrategy("orb");
    expect(getState().params.or_minutes).toBeDefined();
    setSelectedStrategy("52w_chaser");
    const state = getState();
    expect(state.params.or_minutes).toBeUndefined();
    expect(state.params.entry_threshold_pct).toBe(3.0);
  });
});

describe("addSymbol / removeSymbol", () => {
  beforeEach(() => { resetBacktestState(); });

  it("addSymbol adds to selectedSymbols", () => {
    addSymbol("TCS");
    expect(getState().selectedSymbols).toContain("TCS");
  });

  it("addSymbol does not add duplicates", () => {
    addSymbol("TCS");
    addSymbol("TCS");
    expect(getState().selectedSymbols.filter((s) => s === "TCS")).toHaveLength(1);
  });

  it("removeSymbol removes from selectedSymbols", () => {
    addSymbol("TCS");
    removeSymbol("TCS");
    expect(getState().selectedSymbols).not.toContain("TCS");
  });

  it("removeSymbol does nothing for non-existent symbol", () => {
    removeSymbol("NONEXISTENT");
    expect(getState().selectedSymbols).toEqual(["NETWEB", "SBILIFE"]);
  });
});

describe("setSelectedSymbols", () => {
  beforeEach(() => { resetBacktestState(); });

  it("replaces selected symbols", () => {
    setSelectedSymbols(["RELIANCE", "TCS"]);
    expect(getState().selectedSymbols).toEqual(["RELIANCE", "TCS"]);
  });
});

describe("setParam / setParams", () => {
  beforeEach(() => { resetBacktestState(); });

  it("setParam updates a single param", () => {
    setParam("or_minutes", 60);
    expect(getState().params.or_minutes).toBe(60);
  });

  it("setParams replaces all params", () => {
    setParams({ or_minutes: 30, stop_loss_pct: 1.0 });
    const state = getState();
    expect(state.params.or_minutes).toBe(30);
    expect(state.params.stop_loss_pct).toBe(1.0);
  });
});

describe("setDays / setIncludeCosts", () => {
  beforeEach(() => { resetBacktestState(); });

  it("setDays updates days", () => {
    setDays(90);
    expect(getState().days).toBe(90);
  });

  it("setIncludeCosts updates includeCosts", () => {
    setIncludeCosts(false);
    expect(getState().includeCosts).toBe(false);
  });
});

describe("results management", () => {
  beforeEach(() => { resetBacktestState(); });

  it("setResults updates results and resets chart/trade state", () => {
    const results: BacktestResult[] = [
      { symbol: "RELIANCE", trades: 10, wins: 6, losses: 4, win_rate: 60, gross_pnl: 5000, total_costs: 500, net_pnl: 4500, pf: 1.8, tp_exits: 5, sl_exits: 3, eod_exits: 2 },
    ];
    const totals: BacktestTotals = { gross_pnl: 5000, total_costs: 500, net_pnl: 4500, trades: 10, win_rate: 60 };

    setResults(results, totals);
    const state = getState();
    expect(state.results).toEqual(results);
    expect(state.totals).toEqual(totals);
    expect(state.isRunning).toBe(false);
    expect(state.chartData).toEqual(new Map());
    expect(state.selectedChartSymbol).toBeNull();
    expect(state.tradeHistory).toBeNull();
  });
});

describe("setRunning / setProgress / setError", () => {
  beforeEach(() => { resetBacktestState(); });

  it("setRunning updates isRunning and progress.running", () => {
    setRunning(true);
    const state = getState();
    expect(state.isRunning).toBe(true);
    expect(state.progress.running).toBe(true);
  });

  it("setProgress merges progress", () => {
    setProgress({ current: 5, total: 10, message: "running..." });
    const state = getState();
    expect(state.progress.current).toBe(5);
    expect(state.progress.total).toBe(10);
    expect(state.progress.message).toBe("running...");
    expect(state.progress.running).toBe(false);
  });

  it("setError sets error and stops running", () => {
    setRunning(true);
    setError("test error");
    const state = getState();
    expect(state.error).toBe("test error");
    expect(state.isRunning).toBe(false);
  });
});

describe("chart management", () => {
  beforeEach(() => { resetBacktestState(); });

  it("setShowCharts updates showCharts", () => {
    setShowCharts(false);
    expect(getState().showCharts).toBe(false);
  });

  it("setSelectedChartSymbol updates selectedChartSymbol", () => {
    setSelectedChartSymbol("RELIANCE");
    expect(getState().selectedChartSymbol).toBe("RELIANCE");
  });

  it("setChartDataBatch adds chart data", () => {
    const data: SymbolChartData = {
      symbol: "RELIANCE",
      candles: [],
      orb_zones: [],
      pivot_levels: [],
      week52_levels: [],
      trades: [],
      date_range: { start: "2025-01-01", end: "2025-06-01" },
      total_candles: 100,
      total_trades: 5,
    };
    setChartDataBatch({ RELIANCE: data });
    expect(getState().chartData.get("RELIANCE")).toEqual(data);
    expect(getState().chartLoading).toBe(false);
  });

  it("setChartLoading updates chartLoading", () => {
    setChartLoading(true);
    expect(getState().chartLoading).toBe(true);
  });

  it("setChartOptions merges options", () => {
    setChartOptions({ show_orb_zones: false });
    const state = getState();
    expect(state.chartOptions.show_orb_zones).toBe(false);
    expect(state.chartOptions.show_entry_markers).toBe(true);
  });
});

describe("setTradeHistory / setCostBreakdown", () => {
  beforeEach(() => { resetBacktestState(); });

  it("setTradeHistory updates trade history", () => {
    setTradeHistory([], "RELIANCE");
    const state = getState();
    expect(state.tradeHistory).toEqual([]);
    expect(state.tradeHistorySymbol).toBe("RELIANCE");
  });

  it("setCostBreakdown updates cost breakdown", () => {
    const costs: CostBreakdown = {
      brokerage: { rate: "0.03%", description: "Brokerage", applies_to: "buy+sell" },
      stt: { rate: "0.1%", description: "STT", applies_to: "sell" },
      exchange_charges: { rate: "0.00345%", description: "Exchange", applies_to: "buy+sell" },
      sebi_fee: { rate: "0.0001%", description: "SEBI", applies_to: "buy+sell" },
      stamp_duty: { rate: "0.003%", description: "Stamp", applies_to: "buy" },
      gst: { rate: "18%", description: "GST", applies_to: "total" },
      dp_charges: { rate: "15.93", description: "DP", applies_to: "sell" },
    };
    setCostBreakdown(costs);
    expect(getState().costBreakdown).toEqual(costs);
  });
});

describe("resetBacktestState", () => {
  beforeEach(() => { resetBacktestState(); });

  it("resets all state except currentView", () => {
    setCurrentView("backtest");
    addSymbol("TCS");
    setRunning(true);
    setError("err");

    resetBacktestState();
    const state = getState();
    expect(state.currentView).toBe("backtest");
    expect(state.selectedSymbols).toEqual(["NETWEB", "SBILIFE"]);
    expect(state.isRunning).toBe(false);
    expect(state.error).toBeNull();
  });
});

describe("getStrategyDefaults", () => {
  it("returns orb defaults", () => {
    const defaults = getStrategyDefaults("orb");
    expect(defaults.or_minutes).toBe(45);
    expect(defaults.timeframe).toBe("5");
    expect(defaults.stop_loss_pct).toBe(0.5);
    expect(defaults.take_profit_pct).toBe(1.5);
    expect(defaults.trade_size).toBe(100);
    expect(defaults.cooldown_bars).toBe(3);
    expect(defaults.enable_shorts).toBe(false);
    expect(defaults.max_positions).toBe(5);
  });

  it("returns sr_breakout defaults", () => {
    const defaults = getStrategyDefaults("sr_breakout");
    expect(defaults.pivot_type).toBe("classic");
    expect(defaults.breakout_buffer_pct).toBe(0.1);
    expect(defaults.stop_loss_pct).toBe(0.5);
    expect(defaults.take_profit_pct).toBe(1.5);
    expect(defaults.trade_size).toBe(100);
    expect(defaults.max_positions).toBe(3);
  });

  it("returns 52w_chaser defaults", () => {
    const defaults = getStrategyDefaults("52w_chaser");
    expect(defaults.entry_threshold_pct).toBe(3.0);
    expect(defaults.stop_loss_pct).toBe(3.0);
    expect(defaults.take_profit_pct).toBe(5.0);
    expect(defaults.enable_trailing_stop).toBe(false);
    expect(defaults.trailing_stop_pct).toBe(3.0);
    expect(defaults.trailing_activation_pct).toBe(2.0);
    expect(defaults.max_holding_days).toBe(30);
    expect(defaults.cooldown_days).toBe(30);
    expect(defaults.trade_size).toBe(100);
    expect(defaults.enable_filters).toBe(false);
  });

  it("returns 52w_target defaults", () => {
    const defaults = getStrategyDefaults("52w_target");
    expect(defaults.entry_threshold_pct).toBe(2.0);
    expect(defaults.stop_loss_pct).toBe(2.0);
    expect(defaults.trailing_stop_pct).toBe(0.5);
    expect(defaults.max_holding_days).toBe(15);
    expect(defaults.cooldown_days).toBe(7);
    expect(defaults.trade_size).toBe(100);
  });

  it("returns empty object for unknown strategy", () => {
    expect(getStrategyDefaults("unknown_strategy")).toEqual({});
  });

  it("orb defaults do not contain sr_breakout keys", () => {
    const defaults = getStrategyDefaults("orb");
    expect(defaults).not.toHaveProperty("pivot_type");
    expect(defaults).not.toHaveProperty("breakout_buffer_pct");
  });

  it("sr_breakout defaults do not contain orb keys", () => {
    const defaults = getStrategyDefaults("sr_breakout");
    expect(defaults).not.toHaveProperty("or_minutes");
    expect(defaults).not.toHaveProperty("timeframe");
    expect(defaults).not.toHaveProperty("cooldown_bars");
  });
});

describe("getBacktestState", () => {
  beforeEach(() => { resetBacktestState(); });

  it("returns same state as getState", () => {
    expect(getBacktestState()).toEqual(getState());
  });
});
