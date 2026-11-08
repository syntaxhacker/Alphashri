/**
 * Backtest Types
 *
 * Type definitions for the backtesting module.
 * Shared shapes live in ./shared and are re-exported here so existing imports keep working.
 */

import type { BaseChartData, StrategyParam } from "./shared";

export type {
  CandleData,
  ChartTrade,
  ORBZone,
  PivotLevels,
  StrategyParam,
  Week52Levels,
} from "./shared";

// Strategy configuration
export interface Strategy {
  id: string;
  name: string;
  description: string;
  params: StrategyParam[];
}

export interface StrategyVariation {
  id: string;
  internal_id: number;
  name: string;
  strategy_type: string;
  description: string;
  is_template: boolean;
  is_default: boolean;
  // Generic params bucket
  [key: string]: any;
}

// Backtest configuration
export interface BacktestConfig {
  strategy: string;
  symbols: string[];
  params: Record<string, number | string | boolean>;
  days: number;
  include_costs: boolean;
}

// Backtest results
export interface BacktestResult {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  gross_pnl: number;
  total_costs: number;
  net_pnl: number;
  pf: number; // Profit factor
  tp_exits: number;
  sl_exits: number;
  eod_exits: number;
}

export interface BacktestTotals {
  gross_pnl: number;
  total_costs: number;
  net_pnl: number;
  trades: number;
  win_rate: number;
}

export interface BacktestResponse {
  strategy: string;
  config: BacktestConfig;
  results: BacktestResult[];
  totals: BacktestTotals;
  run_time: string;
  error?: string;
}

// Chart data types — canonical shapes in ./shared (re-exported above);
// SymbolChartData adds the backtest-only RSI overlay on the shared payload.
export interface SymbolChartData extends BaseChartData {
  /** RSI(period) aligned index-wise to `candles` (may contain nulls for the warm-up). */
  rsi?: { period: number; data: (number | null)[] };
}

// Progress state
export interface BacktestProgress {
  current: number;
  total: number;
  message: string;
  running: boolean;
  updated?: string;
}

// History types
export interface BacktestHistoryItem {
  id: string;
  user_id: number;
  strategy_id: string;
  strategy_name: string;
  parameters: Record<string, any>;
  symbols: string[];
  metrics: {
    total_pnl: number;
    total_pnl_pct: number;
    win_rate: number;
    total_trades: number;
    sharpe_ratio?: number;
    max_drawdown_pct?: number;
  };
  created_at: string;
}

export interface BacktestHistoryDetails extends BacktestHistoryItem {
  results: BacktestResult[];
  totals: BacktestTotals;
  variation_id?: string | null;
  chart_data?: Record<string, SymbolChartData>;
}

// Trading costs
export interface CostBreakdown {
  brokerage: CostInfo;
  stt: CostInfo;
  exchange_charges: CostInfo;
  sebi_fee: CostInfo;
  stamp_duty: CostInfo;
  gst: CostInfo;
  dp_charges: CostInfo;
}

export interface CostInfo {
  rate: string;
  description: string;
  applies_to: string;
}

// View types
export type AppView = "screener" | "backtest" | "paper" | "sector" | "strategies" | "bots";

// Trade for history table
export interface Trade {
  entry_price: number;
  exit_price: number;
  entry_time: string;
  exit_time: string;
  quantity: number;
  gross_pnl: number;
  gross_pnl_pct: number;
  trading_costs: number;
  net_pnl: number;
  net_pnl_pct: number;
  exit_reason: "TP" | "SL" | "EOD" | "TRAILING_STOP" | "MAX_HOLDING" | "NEW_52W_HIGH";
  hold_duration_minutes: number;
  date: string;
  // ORB strategy fields
  or_high?: number;
  or_low?: number;
  // S/R Breakout strategy fields
  pp?: number; // Pivot Point
  r1?: number; // Resistance 1
  s1?: number; // Support 1
  r2?: number; // Resistance 2
  s2?: number; // Support 2
  // 52W Chaser strategy fields
  "52w_high"?: number;
  trailing_active?: boolean;
  /** Trade direction — "LONG" | "SHORT" (absent on legacy payloads → treated as LONG). */
  side?: string;
}

// Chart options
export interface ChartOptions {
  show_orb_zones: boolean;
  show_entry_markers: boolean;
  show_exit_markers: boolean;
  show_sl_tp_lines: boolean;
  date_range: "all" | "30d" | "7d" | "1d";
}
