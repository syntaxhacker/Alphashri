import type {
  AppView,
  Strategy,
  StrategyVariation,
  BacktestResult,
  BacktestTotals,
  SymbolChartData,
  BacktestProgress,
  ChartOptions,
  Trade,
  CostBreakdown,
} from "../types/backtest";
import { createSubscriber } from "./createSubscriber";
import { getStrategyDefaults, strategyParamKeys } from "../config/backtestDefaults";
import { createChartActions } from "./backtest/chartActions";

export { getStrategyDefaults, strategyParamKeys };

export interface BacktestState {
  currentView: AppView;

  strategies: Strategy[];
  strategiesLoading: boolean;

  variations: StrategyVariation[];
  selectedVariation: string | null;

  selectedStrategy: string;
  selectedSymbols: string[];
  params: Record<string, number | string | boolean>;
  days: number;
  includeCosts: boolean;

  results: BacktestResult[] | null;
  totals: BacktestTotals | null;
  isRunning: boolean;
  progress: BacktestProgress;

  showCharts: boolean;
  selectedChartSymbol: string | null;
  chartData: Map<string, SymbolChartData>;
  chartLoading: boolean;
  chartOptions: ChartOptions;

  tradeHistory: Trade[] | null;
  tradeHistorySymbol: string | null;

  costBreakdown: CostBreakdown | null;

  error: string | null;
}

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

let state: BacktestState = { ...initialBacktestState };

const { subscribe: _subscribe, notify } = createSubscriber();
export const subscribe = _subscribe;

export function getState(): BacktestState {
  return state;
}

function patchState(partial: Record<string, any>) {
  state = { ...state, ...partial };
  notify();
}

const chart = createChartActions(() => state, patchState);

export const {
  setShowCharts,
  setSelectedChartSymbol,
  setChartDataBatch,
  setChartData,
  setChartLoading,
  setChartOptions,
} = chart;

export function setCurrentView(view: AppView) {
  state = { ...state, currentView: view };
  notify();
}

export function setStrategies(strategies: Strategy[]) {
  state = { ...state, strategies, strategiesLoading: false };
  notify();
}

export function setStrategiesLoading(loading: boolean) {
  state = { ...state, strategiesLoading: loading };
  notify();
}

export function setVariations(variations: StrategyVariation[]) {
  state = { ...state, variations };
  notify();
}

export function setSelectedVariationId(variationId: string | null) {
  state = { ...state, selectedVariation: variationId };
  notify();
}

export function setSelectedVariation(variationId: string | null) {
  const variation = state.variations.find((v) => v.id === variationId);
  if (variation) {
    const strategyType = variation.strategy_type.toLowerCase();
    const keysToKeep = strategyParamKeys[strategyType] || [];

    const cleanParams: Record<string, any> = {};
    for (const key of keysToKeep) {
      if (variation[key] !== undefined) {
        if (key === "sl_pct") cleanParams["stop_loss_pct"] = variation[key];
        else if (key === "tp_pct") cleanParams["take_profit_pct"] = variation[key];
        else cleanParams[key] = variation[key];
      }
    }

    const strategyDefaults = getStrategyDefaults(strategyType);

    state = {
      ...state,
      selectedVariation: variationId,
      selectedStrategy: strategyType,
      params: { ...strategyDefaults, ...cleanParams },
    };
  } else {
    state = { ...state, selectedVariation: variationId };
  }
  notify();
}

export function setSelectedStrategy(strategyId: string) {
  const strategyDefaults = getStrategyDefaults(strategyId);
  state = {
    ...state,
    selectedStrategy: strategyId,
    selectedVariation: null,
    params: strategyDefaults,
  };
  notify();
}

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
    selectedVariation: null,
  };
  notify();
}

export function setParams(params: Record<string, number | string | boolean>) {
  state = {
    ...state,
    params: { ...params },
    selectedVariation: null,
  };
  notify();
}

export function setParamsKeepVariation(params: Record<string, number | string | boolean>) {
  state = {
    ...state,
    params: { ...state.params, ...params },
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

export function setTradeHistory(trades: Trade[] | null, symbol: string | null) {
  state = { ...state, tradeHistory: trades, tradeHistorySymbol: symbol };
  notify();
}

export function setCostBreakdown(costs: CostBreakdown) {
  state = { ...state, costBreakdown: costs };
  notify();
}

export function resetBacktestState() {
  state = { ...initialBacktestState, currentView: state.currentView };
  notify();
}

export function getBacktestState(): Readonly<BacktestState> {
  return state;
}

export function triggerRerender() {
  notify();
}
