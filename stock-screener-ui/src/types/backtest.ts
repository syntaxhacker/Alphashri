/**
 * Backtest Types
 *
 * Type definitions for the backtesting module.
 */

// Strategy configuration
export interface StrategyParam {
  key: string
  label: string
  type: 'number' | 'select' | 'boolean'
  default: number | string | boolean
  min?: number
  max?: number
  step?: number
  options?: string[]
}

export interface Strategy {
  id: string
  name: string
  description: string
  params: StrategyParam[]
}

// Backtest configuration
export interface BacktestConfig {
  strategy: string
  symbols: string[]
  params: Record<string, number | string | boolean>
  days: number
  include_costs: boolean
}

// Backtest results
export interface BacktestResult {
  symbol: string
  trades: number
  wins: number
  losses: number
  win_rate: number
  gross_pnl: number
  total_costs: number
  net_pnl: number
  pf: number  // Profit factor
  tp_exits: number
  sl_exits: number
  eod_exits: number
}

export interface BacktestTotals {
  gross_pnl: number
  total_costs: number
  net_pnl: number
  trades: number
  win_rate: number
}

export interface BacktestResponse {
  strategy: string
  config: BacktestConfig
  results: BacktestResult[]
  totals: BacktestTotals
  run_time: string
  error?: string
}

// Chart data types
export interface CandleData {
  time: string          // Comparable format: "YYYY-MM-DDTHH:MM"
  date: string          // Date part: "YYYY-MM-DD"
  date_raw?: string     // Raw date string
  time_str: string      // Time part: "HH:MM"
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface ORBZone {
  date: string
  date_raw: string
  or_high: number
  or_low: number
  or_end_time: string
}

export interface PivotLevels {
  date: string
  date_raw: string
  pp: number    // Pivot Point
  r1: number    // Resistance 1
  s1: number    // Support 1
  r2?: number   // Resistance 2
  s2?: number   // Support 2
  r3?: number   // Resistance 3
  s3?: number   // Support 3
}

export interface ChartTrade {
  trade_id: number
  type: 'entry' | 'exit'
  time: string
  candle_idx?: number  // Index of the candle this trade marker should be placed on
  date: string
  price: number
  marker: {
    symbol: string
    color: string
    size: number
  }
  trade: {
    entry_price: number
    exit_price: number
    entry_time?: string
    exit_time?: string
    quantity: number
    gross_pnl: number
    trading_costs: number
    net_pnl: number
    net_pnl_pct: number
    exit_reason: 'TP' | 'SL' | 'EOD'
    hold_duration_minutes: number
    // ORB strategy fields
    or_high?: number
    or_low?: number
    // S/R Breakout strategy fields
    pp?: number   // Pivot Point
    r1?: number   // Resistance 1
    s1?: number   // Support 1
    r2?: number   // Resistance 2
    s2?: number   // Support 2
  }
}

export interface SymbolChartData {
  symbol: string
  candles: CandleData[]
  orb_zones: ORBZone[]
  pivot_levels: PivotLevels[]  // S/R Breakout pivot levels
  trades: ChartTrade[]
  date_range: {
    start: string
    end: string
  }
  total_candles: number
  total_trades: number
}

// Progress state
export interface BacktestProgress {
  current: number
  total: number
  message: string
  running: boolean
  updated?: string
}

// Trading costs
export interface CostBreakdown {
  brokerage: CostInfo
  stt: CostInfo
  exchange_charges: CostInfo
  sebi_fee: CostInfo
  stamp_duty: CostInfo
  gst: CostInfo
  dp_charges: CostInfo
}

export interface CostInfo {
  rate: string
  description: string
  applies_to: string
}

// View types
export type AppView = 'screener' | 'backtest' | 'paper' | 'sector'

// Trade for history table
export interface Trade {
  entry_price: number
  exit_price: number
  entry_time: string
  exit_time: string
  quantity: number
  gross_pnl: number
  gross_pnl_pct: number
  trading_costs: number
  net_pnl: number
  net_pnl_pct: number
  exit_reason: 'TP' | 'SL' | 'EOD'
  hold_duration_minutes: number
  date: string
  // ORB strategy fields
  or_high?: number
  or_low?: number
  // S/R Breakout strategy fields
  pp?: number   // Pivot Point
  r1?: number   // Resistance 1
  s1?: number   // Support 1
  r2?: number   // Resistance 2
  s2?: number   // Support 2
}

// Chart options
export interface ChartOptions {
  show_orb_zones: boolean
  show_entry_markers: boolean
  show_exit_markers: boolean
  show_sl_tp_lines: boolean
  date_range: 'all' | '30d' | '7d' | '1d'
}
