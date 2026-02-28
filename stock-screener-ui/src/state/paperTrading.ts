/**
 * Paper Trading State Management
 */

import type {
  PaperTradingState,
  PaperTradingView,
  PaperPosition,
  PaperTrade,
  PortfolioStatus,
  DailySummary,
  PerformanceSummary,
  SymbolPerformance,
  PaperChartData,
  StrategyConfig,
} from "../types/paperTrading";

// Initial state
export const initialPaperTradingState: PaperTradingState = {
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

  selectedSymbol: null,
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

  // Strategy config
  strategyConfig: null,
  configLoading: false,
  configError: null,
  configDirty: false,
};

// Additional type for the view state
export type PaperViewState = "live" | "history";

// Current state (mutable)
let state: PaperTradingState = { ...initialPaperTradingState };

// Subscribers for state changes
const subscribers: Set<() => void> = new Set();

// Auto-refresh timer
let refreshTimer: ReturnType<typeof setInterval> | null = null;

// Notify all subscribers
function notify() {
  subscribers.forEach((callback) => callback());
}

// Subscribe to state changes
export function subscribe(callback: () => void) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

// Get current state
export function getPaperTradingState(): Readonly<PaperTradingState> {
  return state;
}

// View management
export function setPaperTradingView(view: PaperTradingView) {
  state = { ...state, currentView: view };
  notify();
}

// Positions management
export function setPositions(positions: PaperPosition[]) {
  state = { ...state, positions };
  notify();
}

export function setPortfolio(portfolio: PortfolioStatus | null) {
  state = { ...state, portfolio };
  notify();
}

// Trades management
export function setTrades(trades: PaperTrade[]) {
  state = { ...state, trades };
  notify();
}

export function setDailySummary(summary: DailySummary | null) {
  state = { ...state, dailySummary: summary };
  notify();
}

export function setPerformanceSummary(summary: PerformanceSummary | null) {
  state = { ...state, performanceSummary: summary };
  notify();
}

export function setSymbolPerformance(performance: SymbolPerformance[]) {
  state = { ...state, symbolPerformance: performance };
  notify();
}

// Filters
export function setFilterDate(date: string | null) {
  state = { ...state, filterDate: date };
  notify();
}

export function setFilterFromDate(date: string | null) {
  state = { ...state, filterFromDate: date };
  notify();
}

export function setFilterToDate(date: string | null) {
  state = { ...state, filterToDate: date };
  notify();
}

export function setFilterSymbol(symbol: string | null) {
  state = { ...state, filterSymbol: symbol };
  notify();
}

export function setFilterStrategy(strategy: string | null) {
  state = { ...state, filterStrategy: strategy };
  notify();
}

// Chart management
export function setSelectedSymbol(symbol: string | null) {
  state = { ...state, selectedSymbol: symbol };
  notify();
}

export function setChartData(data: PaperChartData | null) {
  state = { ...state, chartData: data, chartLoading: false };
  notify();
}

export function setChartLoading(loading: boolean) {
  state = { ...state, chartLoading: loading };
  notify();
}

export function setChartTimeframe(timeframe: string) {
  state = { ...state, chartTimeframe: timeframe };
  notify();
}

// Loading states
export function setLoading(isLoading: boolean) {
  state = { ...state, isLoading };
  notify();
}

export function setError(error: string | null) {
  state = { ...state, error, isLoading: false };
  notify();
}

// Auto-refresh management
export function setAutoRefresh(enabled: boolean) {
  state = { ...state, autoRefreshEnabled: enabled };
  if (!enabled && refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  notify();
}

export function setBotStatus(
  botRunning: boolean,
  botPid: number | null,
  botLogFile: string | null,
) {
  state = { ...state, botRunning, botPid, botLogFile };
  notify();
}

export function setBotSnapshot(snapshot: PaperTradingState["botSnapshot"]) {
  state = { ...state, botSnapshot: snapshot };
  notify();
}

export function setupAutoRefresh(fetchFn: () => void, intervalMs: number = 20000) {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  refreshTimer = setInterval(() => {
    if (state.autoRefreshEnabled && state.currentView === "live") {
      fetchFn();
    }
  }, intervalMs);
}

export function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// Reset state
export function resetPaperTradingState() {
  state = { ...initialPaperTradingState };
  stopAutoRefresh();
  notify();
}

// Force re-render
export function triggerPaperTradingRerender() {
  notify();
}

// Strategy config management
export function setStrategyConfig(config: StrategyConfig | null) {
  state = {
    ...state,
    strategyConfig: config,
    configLoading: false,
    configError: null,
    configDirty: false,
  };
  notify();
}

export function setConfigLoading(loading: boolean) {
  state = { ...state, configLoading: loading };
  notify();
}

export function setConfigError(error: string | null) {
  state = { ...state, configError: error, configLoading: false };
  notify();
}

export function setConfigDirty(dirty: boolean) {
  state = { ...state, configDirty: dirty };
  notify();
}

export function updateConfigValue(key: keyof StrategyConfig, value: any) {
  if (state.strategyConfig) {
    state = {
      ...state,
      strategyConfig: { ...state.strategyConfig, [key]: value },
      configDirty: true,
    };
    notify();
  }
}
