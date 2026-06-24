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
  BotInfo,
  AnalyticsData,
  ActivityEvent,
  AggregatedDashboardData,
} from "../types/paperTrading";

import { deleteTrade, updateTradeNotes, updatePositionNotes } from "../api/paperTrading";
import { createSubscriber } from "./createSubscriber";
import { isMarketClosedToday } from "./holidays";

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
  chartFromDate: null,
  chartDataLive: null,
  chartTimeframeLive: "5min",
  chartFromDateLive: null,
  chartDataHistory: null,
  chartTimeframeHistory: "1day",
  chartFromDateHistory: null,

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

  // Multi-strategy bots
  availableBots: [],

  // Analytics
  analyticsData: null,
  analyticsLoading: false,

  // Activity feed
  activityEvents: [],
  activityLoading: false,

  // Aggregated dashboard
  aggregatedData: null,
  aggregatedLoading: false,
};

// Additional type for the view state
export type PaperViewState = "live" | "history" | "analytics" | "activity" | "aggregated";

// Current state (mutable)
let state: PaperTradingState = { ...initialPaperTradingState };

const { subscribe: _subscribe, notify } = createSubscriber();
export const subscribe = _subscribe;

// Auto-refresh timer
let refreshTimer: ReturnType<typeof setInterval> | null = null;

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
  console.log("[setPositions] count:", positions.length, "sample order_id:", positions[0]?.order_id, "keys:", Object.keys(positions[0] || {}));
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

export function setFilterStrategy(strategyId: number | null) {
  state = { ...state, filterStrategy: strategyId };
  notify();
}

// Chart management
export function setSelectedSymbol(symbol: string | null) {
  state = { ...state, selectedSymbol: symbol, selectedTradeId: null };
  notify();
}

export function setSelectedTradeId(
  tradeId: string | null,
  strategyType?: string | null,
  strategyId?: number | null,
) {
  let showOrb = false;
  let showPivot = false;
  let show52w = false;
  if (strategyType) {
    if (strategyType === "ORB") showOrb = true;
    if (strategyType === "SR_BREAKOUT") showPivot = true;
    if (strategyType.startsWith("52W")) show52w = true;
  }
  state = {
    ...state,
    selectedTradeId: tradeId,
    selectedStrategyId: strategyId ?? null,
    showAllTrades: false,
    showOrbLines: showOrb,
    showPivotLines: showPivot,
    show52wLines: show52w,
  };
  notify();
}

export function setShowAllTrades(show: boolean) {
  state = { ...state, showAllTrades: show };
  notify();
}

export function setShowOrbLines(show: boolean) {
  state = { ...state, showOrbLines: show };
  notify();
}

export function setShowPivotLines(show: boolean) {
  state = { ...state, showPivotLines: show };
  notify();
}

export function setShow52wLines(show: boolean) {
  state = { ...state, show52wLines: show };
  notify();
}

export function setShowEmaLines(show: boolean) {
  state = { ...state, showEmaLines: show };
  notify();
}

export function setSelectedStrategyTab(strategy: string | null) {
  state = { ...state, selectedStrategyTab: strategy };
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

export function setChartFromDate(fromDate: string | null) {
  state = { ...state, chartFromDate: fromDate };
  notify();
}

export function setChartDataLive(data: PaperChartData | null) {
  state = { ...state, chartDataLive: data };
  notify();
}

export function setChartTimeframeLive(timeframe: string) {
  state = { ...state, chartTimeframeLive: timeframe };
  notify();
}

export function setChartFromDateLive(fromDate: string | null) {
  state = { ...state, chartFromDateLive: fromDate };
  notify();
}

export function setChartDataHistory(data: PaperChartData | null) {
  state = { ...state, chartDataHistory: data };
  notify();
}

export function setChartTimeframeHistory(timeframe: string) {
  state = { ...state, chartTimeframeHistory: timeframe };
  notify();
}

export function setChartFromDateHistory(fromDate: string | null) {
  state = { ...state, chartFromDateHistory: fromDate };
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
    if (isMarketClosedToday()) return;
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

// Analytics
export function setAnalyticsData(data: AnalyticsData | null) {
  state = { ...state, analyticsData: data, analyticsLoading: false };
  notify();
}

export function setAnalyticsLoading(loading: boolean) {
  state = { ...state, analyticsLoading: loading };
  notify();
}

// Activity feed
export function setActivityEvents(events: ActivityEvent[]) {
  state = { ...state, activityEvents: events, activityLoading: false };
  notify();
}

export function setActivityLoading(loading: boolean) {
  state = { ...state, activityLoading: loading };
  notify();
}

// Aggregated dashboard
export function setAggregatedData(data: AggregatedDashboardData | null) {
  state = { ...state, aggregatedData: data, aggregatedLoading: false };
  notify();
}

export function setAggregatedLoading(loading: boolean) {
  state = { ...state, aggregatedLoading: loading };
  notify();
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

// Multi-strategy bots management
export function setAvailableBots(bots: BotInfo[]) {
  state = { ...state, availableBots: bots };
  notify();
}

// Bot filter management
export function setFilterBot(botId: string | null) {
  state = { ...state, filterBot: botId };
  notify();
}

// Trade deletion action
export async function deleteTradeAction(tradeId: string): Promise<boolean> {
  try {
    await deleteTrade(tradeId);
    // Remove from local state
    state = {
      ...state,
      trades: state.trades.filter((t) => t.trade_id !== tradeId),
    };
    notify();
    return true;
  } catch (error) {
    setError(error instanceof Error ? error.message : "Failed to delete trade");
    return false;
  }
}

export async function updateTradeNotesAction(
  tradeId: string,
  notes: string,
  reason: string,
): Promise<boolean> {
  try {
    const updated = await updateTradeNotes(tradeId, notes, reason);
    state = {
      ...state,
      trades: state.trades.map((t) =>
        t.trade_id === tradeId
          ? { ...t, notes: updated.notes ?? notes, reason: updated.reason ?? reason }
          : t,
      ),
    };
    notify();
    return true;
  } catch (error) {
    setError(error instanceof Error ? error.message : "Failed to update trade");
    return false;
  }
}

export async function updatePositionNotesAction(
  positionId: string,
  notes: string | null,
  reason: string | null,
): Promise<boolean> {
  try {
    const updated = await updatePositionNotes(positionId, notes, reason);
    state = {
      ...state,
      positions: state.positions.map((p) =>
        p.order_id === positionId
          ? { ...p, notes: updated.notes ?? notes ?? p.notes, entry_reason: updated.entry_reason ?? reason ?? p.entry_reason }
          : p,
      ),
    };
    notify();
    return true;
  } catch (error) {
    setError(error instanceof Error ? error.message : "Failed to update position");
    return false;
  }
}
