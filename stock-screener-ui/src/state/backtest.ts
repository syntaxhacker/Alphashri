/**
 * Backtest State Management
 */

import type {
  AppView,
  Strategy,
  BacktestResult,
  BacktestTotals,
  SymbolChartData,
  BacktestProgress,
  ChartOptions,
  Trade,
  CostBreakdown,
} from "../types/backtest";
import { chartTradesToTrades } from "../api/chartBuilder";
import { createSubscriber } from "./createSubscriber";

// State interface
export interface BacktestState {
  // View
  currentView: AppView;

  // Available strategies
  strategies: Strategy[];
  strategiesLoading: boolean;

  // Available variations
  variations: StrategyVariation[];
  selectedVariation: string | null;

  // Current config
  selectedStrategy: string;
  selectedSymbols: string[];
  params: Record<string, number | string | boolean>;
  days: number;
  includeCosts: boolean;

  // Results
  results: BacktestResult[] | null;
  totals: BacktestTotals | null;
  isRunning: boolean;
  progress: BacktestProgress;

  // Chart state
  showCharts: boolean;
  selectedChartSymbol: string | null;
  chartData: Map<string, SymbolChartData>;
  chartLoading: boolean;
  chartOptions: ChartOptions;

  // Trade history (table view)
  tradeHistory: Trade[] | null;
  tradeHistorySymbol: string | null;

  // Costs
  costBreakdown: CostBreakdown | null;

  // Error
  error: string | null;
}

// Initial state
export const initialBacktestState: BacktestState = {
  currentView: "screener",

  strategies: [],
  strategiesLoading: false,

  variations: [],
  selectedVariation: null,

  selectedStrategy: "orb",
  selectedSymbols: ["NETWEB", "SBILIFE"],
  params: {
    or_minutes: 45,
    timeframe: "5",
    stop_loss_pct: 0.4,
    take_profit_pct: 1.2,
    trade_size: 100,
    cooldown_bars: 3,
    enable_shorts: false,
  },
  days: 180,
  includeCosts: true,

  results: null,
  totals: null,
  isRunning: false,
  progress: {
    current: 0,
    total: 0,
    message: "",
    running: false,
  },

  showCharts: true,
  selectedChartSymbol: null,
  chartData: new Map(),
  chartLoading: false,
  chartOptions: {
    show_orb_zones: true,
    show_entry_markers: true,
    show_exit_markers: true,
    show_sl_tp_lines: true,
    date_range: "all",
  },

  tradeHistory: null,
  tradeHistorySymbol: null,

  costBreakdown: null,

  error: null,
};

// Current state (mutable)
let state: BacktestState = { ...initialBacktestState };

const { subscribe: _subscribe, notify } = createSubscriber();
export const subscribe = _subscribe;

// Get current state
export function getState(): BacktestState {
  return state;
}

// View management
export function setCurrentView(view: AppView) {
  state = { ...state, currentView: view };
  notify();
}

// Strategy management
export function setStrategies(strategies: Strategy[]) {
  state = { ...state, strategies, strategiesLoading: false };
  notify();
}

export function setStrategiesLoading(loading: boolean) {
  state = { ...state, strategiesLoading: loading };
  notify();
}

// Variation management
export function setVariations(variations: StrategyVariation[]) {
  state = { ...state, variations };
  notify();
}

/**
 * Set the selected variation ID directly (used for history loading)
 */
export function setSelectedVariationId(variationId: string | null) {
  state = { ...state, selectedVariation: variationId };
  notify();
}

export function setSelectedVariation(variationId: string | null) {
  const variation = state.variations.find((v) => v.id === variationId);
  if (variation) {
    // Define which params each strategy type supports
    const strategyParamKeys: Record<string, string[]> = {
      orb: [
        "or_minutes",
        "sl_pct",
        "tp_pct",
        "max_positions",
        "timeframe",
        "trade_size",
        "cooldown_bars",
        "enable_shorts",
      ],
      sr_breakout: [
        "breakout_buffer_pct",
        "pivot_type",
        "sl_pct",
        "tp_pct",
        "max_positions",
        "trade_size",
      ],
      "52w_chaser": [
        "entry_threshold_pct",
        "sl_pct",
        "tp_pct",
        "enable_trailing_stop",
        "trailing_stop_pct",
        "trailing_activation_pct",
        "max_holding_days",
        "cooldown_days",
        "trade_size",
        "enable_filters",
      ],
      "52w_target": [
        "entry_threshold_pct",
        "sl_pct",
        "trailing_stop_pct",
        "max_holding_days",
        "cooldown_days",
        "trade_size",
      ],
      ema_cross: [
        "ema_fast_period",
        "ema_slow_period",
        "sl_pct",
        "tp_pct",
        "timeframe",
        "trade_size",
        "enable_shorts",
        "cooldown_bars",
      ],
    };

    const strategyType = variation.strategy_type.toLowerCase();
    const keysToKeep = strategyParamKeys[strategyType] || [];

    const cleanParams: Record<string, any> = {};
    for (const key of keysToKeep) {
      if (variation[key] !== undefined) {
        // Special case mapping: sl_pct in DB is stop_loss_pct in backtest params
        if (key === "sl_pct") cleanParams["stop_loss_pct"] = variation[key];
        else if (key === "tp_pct") cleanParams["take_profit_pct"] = variation[key];
        else cleanParams[key] = variation[key];
      }
    }

    // Get default params for the strategy to ensure all required params have values
    const strategyDefaults = getStrategyDefaults(strategyType);

    state = {
      ...state,
      selectedVariation: variationId,
      selectedStrategy: strategyType,
      // Replace params completely: start with defaults, then override with variation params
      params: { ...strategyDefaults, ...cleanParams },
    };
  } else {
    state = { ...state, selectedVariation: variationId };
  }
  notify();
}

// Helper function to get default params for a strategy
export function getStrategyDefaults(strategyId: string): Record<string, any> {
  const defaults: Record<string, any> = {
    orb: {
      or_minutes: 45,
      timeframe: "5",
      stop_loss_pct: 0.5,
      take_profit_pct: 1.5,
      trade_size: 100,
      cooldown_bars: 3,
      enable_shorts: false,
      max_positions: 5,
    },
    sr_breakout: {
      pivot_type: "classic",
      breakout_buffer_pct: 0.1,
      stop_loss_pct: 0.5,
      take_profit_pct: 1.5,
      trade_size: 100,
      max_positions: 3,
    },
    "52w_chaser": {
      entry_threshold_pct: 3.0,
      stop_loss_pct: 3.0,
      take_profit_pct: 5.0,
      enable_trailing_stop: false,
      trailing_stop_pct: 3.0,
      trailing_activation_pct: 2.0,
      max_holding_days: 30,
      cooldown_days: 30,
      trade_size: 100,
      enable_filters: false,
    },
    "52w_target": {
      entry_threshold_pct: 2.0,
      stop_loss_pct: 2.0,
      trailing_stop_pct: 0.5,
      max_holding_days: 15,
      cooldown_days: 7,
      trade_size: 100,
    },
    ema_cross: {
      ema_fast_period: 9,
      ema_slow_period: 21,
      stop_loss_pct: 0.5,
      take_profit_pct: 1.5,
      timeframe: "5",
      trade_size: 100,
      enable_shorts: false,
      cooldown_bars: 3,
    },
  };
  return defaults[strategyId] || {};
}

export function setSelectedStrategy(strategyId: string) {
  // Reset params to strategy defaults when switching strategies
  const strategyDefaults = getStrategyDefaults(strategyId);
  state = {
    ...state,
    selectedStrategy: strategyId,
    selectedVariation: null,
    params: strategyDefaults,
  };
  notify();
}

// Config management
export function setSelectedSymbols(symbols: string[]) {
  state = { ...state, selectedSymbols: symbols };
  notify();
}

export function addSymbol(symbol: string) {
  if (!state.selectedSymbols.includes(symbol)) {
    state = { ...state, selectedSymbols: [...state.selectedSymbols, symbol] };
    notify();
  }
}

export function removeSymbol(symbol: string) {
  state = {
    ...state,
    selectedSymbols: state.selectedSymbols.filter((s) => s !== symbol),
  };
  notify();
}

export function setParam(key: string, value: number | string | boolean) {
  state = {
    ...state,
    params: { ...state.params, [key]: value },
  };
  notify();
}

export function setParams(params: Record<string, number | string | boolean>) {
  state = {
    ...state,
    params: { ...params },
  };
  notify();
}

export function setDays(days: number) {
  state = { ...state, days };
  notify();
}

export function setIncludeCosts(include: boolean) {
  state = { ...state, includeCosts: include };
  notify();
}

// Results management
export function setResults(results: BacktestResult[], totals: BacktestTotals) {
  state = {
    ...state,
    results,
    totals,
    isRunning: false,
    progress: { current: 0, total: 0, message: "", running: false },
    chartData: new Map(),
    selectedChartSymbol: null,
    tradeHistory: null,
    tradeHistorySymbol: null,
  };
  notify();
}

export function setRunning(isRunning: boolean) {
  state = {
    ...state,
    isRunning,
    progress: { ...state.progress, running: isRunning },
  };
  notify();
}

export function setProgress(progress: Partial<BacktestProgress>) {
  state = { ...state, progress: { ...state.progress, ...progress } };
  notify();
}

export function setError(error: string | null) {
  state = { ...state, error, isRunning: false };
  notify();
}

// Chart management
export function setShowCharts(show: boolean) {
  state = { ...state, showCharts: show };
  notify();
}

export function setSelectedChartSymbol(symbol: string | null) {
  state = { ...state, selectedChartSymbol: symbol };
  notify();
}

export function setChartDataBatch(dataMap: Record<string, SymbolChartData>) {
  const newChartData = new Map(state.chartData);
  for (const [symbol, data] of Object.entries(dataMap)) {
    newChartData.set(symbol, data);
  }

  state = {
    ...state,
    chartData: newChartData,
    chartLoading: false,
  };
  notify();
}

export function setChartData(symbol: string, data: SymbolChartData) {
  const newChartData = new Map(state.chartData);
  newChartData.set(symbol, data);

  // Also set trade history if trades exist
  let tradeHistory = state.tradeHistory;
  let tradeHistorySymbol = state.tradeHistorySymbol;
  if (data.trades && data.trades.length > 0) {
    tradeHistory = chartTradesToTrades(data.trades);
    tradeHistorySymbol = symbol;
  }

  state = {
    ...state,
    chartData: newChartData,
    chartLoading: false,
    tradeHistory,
    tradeHistorySymbol,
  };
  notify();
}

export function setChartLoading(loading: boolean) {
  state = { ...state, chartLoading: loading };
  notify();
}

export function setChartOptions(options: Partial<ChartOptions>) {
  state = { ...state, chartOptions: { ...state.chartOptions, ...options } };
  notify();
}

// Trade history
export function setTradeHistory(trades: Trade[] | null, symbol: string | null) {
  state = { ...state, tradeHistory: trades, tradeHistorySymbol: symbol };
  notify();
}

// Costs
export function setCostBreakdown(costs: CostBreakdown) {
  state = { ...state, costBreakdown: costs };
  notify();
}

// Reset
export function resetBacktestState() {
  state = { ...initialBacktestState, currentView: state.currentView };
  notify();
}

// Export a readonly state getter for components
export function getBacktestState(): Readonly<BacktestState> {
  return state;
}

// Force a re-render (used for sorting without changing state)
export function triggerRerender() {
  notify();
}
