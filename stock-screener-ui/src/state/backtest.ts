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
} from '../types/backtest'

// State interface
export interface BacktestState {
  // View
  currentView: AppView

  // Available strategies
  strategies: Strategy[]
  strategiesLoading: boolean

  // Current config
  selectedStrategy: string
  selectedSymbols: string[]
  params: Record<string, number | string | boolean>
  days: number
  includeCosts: boolean

  // Results
  results: BacktestResult[] | null
  totals: BacktestTotals | null
  isRunning: boolean
  progress: BacktestProgress

  // Chart state
  showCharts: boolean
  selectedChartSymbol: string | null
  chartData: Map<string, SymbolChartData>
  chartLoading: boolean
  chartOptions: ChartOptions

  // Trade history (table view)
  tradeHistory: Trade[] | null
  tradeHistorySymbol: string | null

  // Costs
  costBreakdown: CostBreakdown | null

  // Error
  error: string | null
}

// Initial state
export const initialBacktestState: BacktestState = {
  currentView: 'screener',

  strategies: [],
  strategiesLoading: false,

  selectedStrategy: 'orb',
  selectedSymbols: ['NETWEB', 'SBILIFE'],
  params: {
    or_minutes: 45,
    stop_loss_pct: 0.5,
    take_profit_pct: 1.0,
    trade_size: 100,
    timeframe: '5',
  },
  days: 180,
  includeCosts: true,

  results: null,
  totals: null,
  isRunning: false,
  progress: {
    current: 0,
    total: 0,
    message: '',
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
    date_range: 'all',
  },

  tradeHistory: null,
  tradeHistorySymbol: null,

  costBreakdown: null,

  error: null,
}

// Current state (mutable)
let state: BacktestState = { ...initialBacktestState }

// Subscribers for state changes
const subscribers: Set<() => void> = new Set()

// Notify all subscribers
function notify() {
  subscribers.forEach(callback => callback())
}

// Subscribe to state changes
export function subscribe(callback: () => void) {
  subscribers.add(callback)
  return () => subscribers.delete(callback)
}

// Get current state
export function getState(): BacktestState {
  return state
}

// View management
export function setCurrentView(view: AppView) {
  state = { ...state, currentView: view }
  notify()
}

// Strategy management
export function setStrategies(strategies: Strategy[]) {
  state = { ...state, strategies, strategiesLoading: false }
  notify()
}

export function setStrategiesLoading(loading: boolean) {
  state = { ...state, strategiesLoading: loading }
  notify()
}

export function setSelectedStrategy(strategyId: string) {
  state = { ...state, selectedStrategy: strategyId }
  notify()
}

// Config management
export function setSelectedSymbols(symbols: string[]) {
  state = { ...state, selectedSymbols: symbols }
  notify()
}

export function addSymbol(symbol: string) {
  if (!state.selectedSymbols.includes(symbol)) {
    state = { ...state, selectedSymbols: [...state.selectedSymbols, symbol] }
    notify()
  }
}

export function removeSymbol(symbol: string) {
  state = {
    ...state,
    selectedSymbols: state.selectedSymbols.filter(s => s !== symbol),
  }
  notify()
}

export function setParam(key: string, value: number | string | boolean) {
  state = {
    ...state,
    params: { ...state.params, [key]: value },
  }
  notify()
}

export function setDays(days: number) {
  state = { ...state, days }
  notify()
}

export function setIncludeCosts(include: boolean) {
  state = { ...state, includeCosts: include }
  notify()
}

// Results management
export function setResults(results: BacktestResult[], totals: BacktestTotals) {
  state = {
    ...state,
    results,
    totals,
    isRunning: false,
    progress: { current: 0, total: 0, message: '', running: false },
  }
  notify()
}

export function setRunning(isRunning: boolean) {
  state = {
    ...state,
    isRunning,
    progress: { ...state.progress, running: isRunning },
  }
  notify()
}

export function setProgress(progress: Partial<BacktestProgress>) {
  state = { ...state, progress: { ...state.progress, ...progress } }
  notify()
}

export function setError(error: string | null) {
  state = { ...state, error, isRunning: false }
  notify()
}

// Chart management
export function setShowCharts(show: boolean) {
  state = { ...state, showCharts: show }
  notify()
}

export function setSelectedChartSymbol(symbol: string | null) {
  state = { ...state, selectedChartSymbol: symbol }
  notify()
}

export function setChartData(symbol: string, data: SymbolChartData) {
  const newChartData = new Map(state.chartData)
  newChartData.set(symbol, data)
  state = { ...state, chartData: newChartData, chartLoading: false }
  notify()
}

export function setChartLoading(loading: boolean) {
  state = { ...state, chartLoading: loading }
  notify()
}

export function setChartOptions(options: Partial<ChartOptions>) {
  state = { ...state, chartOptions: { ...state.chartOptions, ...options } }
  notify()
}

// Trade history
export function setTradeHistory(trades: Trade[] | null, symbol: string | null) {
  state = { ...state, tradeHistory: trades, tradeHistorySymbol: symbol }
  notify()
}

// Costs
export function setCostBreakdown(costs: CostBreakdown) {
  state = { ...state, costBreakdown: costs }
  notify()
}

// Reset
export function resetBacktestState() {
  state = { ...initialBacktestState, currentView: state.currentView }
  notify()
}

// Export a readonly state getter for components
export function getBacktestState(): Readonly<BacktestState> {
  return state
}
