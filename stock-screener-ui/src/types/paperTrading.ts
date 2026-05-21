/**
 * Paper Trading Types
 */

// Open position from paper trader
export type { StrategyConfig } from "./strategies";

import type { StrategyConfig } from "./strategies";

export interface PaperPosition {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  entry_price: number;
  current_price: number;
  entry_time: string;
  stop_loss: number;
  take_profit: number;
  pnl: number;
  pnl_pct: number;
  margin_used: number;
  order_id: string;
  strategy_id: number;
  strategy_name: string;
  strategy_type?: string;
  entry_reason?: string;
  exit_reason?: string;
  peak_price?: number;
  low_price?: number;
  high_52w?: number;
  low_52w?: number;
  notes?: string;
}

// Completed trade from journal
export interface PaperTrade {
  trade_id: string;
  symbol: string;
  side: string; // 'BUY' or 'SELL'
  quantity: number;
  entry_price: number;
  exit_price: number;
  entry_time: string;
  exit_time: string;
  pnl: number;
  pnl_pct: number;
  exit_reason: string; // 'SL', 'TP', 'EOD', 'MANUAL'
  costs: number;
  net_pnl: number;
  stop_loss: number;
  take_profit: number;
  peak_price: number; // Highest price during trade
  low_price: number; // Lowest price during trade
  hold_duration_minutes: number | null; // Entry to exit duration
  notes: string;
  reason: string;
  strategy_id: number;
  strategy_name: string;
  strategy_type?: string;
  bot_id: string | null;
  bot_name: string | null;
}

// Portfolio status - matches API response from /api/paper/portfolio
export interface PortfolioStatus {
  initial_capital: number;
  cash: number;
  margin_used: number;
  position_value: number;
  unrealized_pnl: number;
  realized_pnl: number;
  total_value: number;
  total_pnl: number;
  total_pnl_pct: number;
  positions: number;
  trades: number;
  daily_pnl: number;
  daily_pnl_pct: number;
  daily_trades: number;
  open_positions: number;
  max_daily_loss_pct?: number;
  daily_loss_limit_exceeded?: boolean;
}

// Daily trading summary
export interface DailySummary {
  date: string;
  trades: number;
  winners: number;
  losers: number;
  total_pnl: number;
  net_pnl: number;
  total_costs: number;
  symbols: string[];
}

// Performance summary
export interface PerformanceSummary {
  total_trades: number;
  winners: number;
  losers: number;
  win_rate: number;
  total_pnl: number;
  net_pnl: number;
  total_costs: number;
  avg_win: number;
  avg_loss: number;
  profit_factor: number;
}

// Symbol performance
export interface SymbolPerformance {
  symbol: string;
  trades: number;
  winners: number;
  losers: number;
  win_rate: number;
  net_pnl: number;
  total_costs: number;
}

export interface Week52Levels {
  high_52w: number;
  low_52w: number;
  distance_to_high_pct: number;
  distance_to_low_pct: number;
  near_high: boolean;
}

export interface PivotLevels {
  pp: number;
  r1: number;
  r2: number;
  s1: number;
  s2: number;
}

// Chart data for paper trading
export interface PaperChartData {
  symbol: string;
  date: string;
  actual_date?: string | null; // Actual data date (differs from requested on weekends/holidays)
  candles: CandleData[];
  trades: PaperTrade[];
  orb_levels: ORBLevels | null;
  week52_levels: Week52Levels | null;
  pivot_levels: PivotLevels | null;
  current_position: PaperPosition | null;
  ema_series?: {
    ema_fast: { label: string; color: string; data: number[] };
    ema_slow: { label: string; color: string; data: number[] };
  } | null;
}

export interface CandleData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ORBLevels {
  or_high: number;
  or_low: number;
  or_open: number;
  or_range: number;
  or_range_pct: number;
  or_minutes?: number;
}

// 52-week high levels for swing strategies
export interface Week52Levels {
  high_52w: number; // 52-week high price
  low_52w: number; // 52-week low price
  distance_to_high_pct: number; // How far from 52W high (%)
  distance_to_low_pct: number; // How far from 52W low (%)
  near_high: boolean; // Within entry threshold of high
}

export interface PaperScanItem {
  symbol: string;
  status: string;
  side?: "LONG" | "SHORT";
  price?: number;
  or_high?: number;
  or_low?: number;
  or_range_pct?: number;
  high_52w?: number;
  reason?: string;
  strategy_name?: string;
  strategy_id?: number;
}

export interface PaperBotSnapshot {
  timestamp: string | null;
  watchlist: string[];
  open_positions: string[];
  scan_items: PaperScanItem[];
  signals: Array<{
    symbol: string;
    side: "LONG" | "SHORT";
    price: number;
    notes?: string;
  }>;
}

// View type for paper trading
export type PaperTradingView = "live" | "history" | "settings" | "analytics" | "activity" | "aggregated";

// State interface
export interface PaperTradingState {
  currentView: PaperTradingView;

  // Live positions
  positions: PaperPosition[];
  portfolio: PortfolioStatus | null;

  // Trade history
  trades: PaperTrade[];
  dailySummary: DailySummary | null;
  performanceSummary: PerformanceSummary | null;
  symbolPerformance: SymbolPerformance[];

  // Filters
  filterDate: string | null; // Legacy quick filter (unused by UI)
  filterFromDate: string | null;
  filterToDate: string | null;
  filterSymbol: string | null;
  filterStrategy: number | null; // Filter by strategy ID
  filterBot: string | null; // Filter by bot ID (UUID)

  // Chart state
  selectedSymbol: string | null;
  selectedStrategyId: number | null;
  selectedStrategyTab: string | null; // For multi-strategy position tabs
  selectedTradeId: string | null; // Trade ID to highlight on chart
  showAllTrades: boolean; // Show all trades or just selectedTradeId
  showOrbLines: boolean;
  showPivotLines: boolean;
  show52wLines: boolean;
  showEmaLines: boolean;
  chartData: PaperChartData | null;
  chartLoading: boolean;
  chartTimeframe: string;
  chartFromDate: string | null;

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Auto-refresh
  autoRefreshEnabled: boolean;

  // Paper runner status
  botRunning: boolean;
  botPid: number | null;
  botLogFile: string | null;
  botSnapshot: PaperBotSnapshot | null;

  // Strategy config
  strategyConfig: StrategyConfig | null;
  configLoading: boolean;
  configError: string | null;
  configDirty: boolean; // Has unsaved changes

  // Multi-strategy bots
  availableBots: BotInfo[];

  // Analytics
  analyticsData: AnalyticsData | null;
  analyticsLoading: boolean;

  // Activity feed
  activityEvents: ActivityEvent[];
  activityLoading: boolean;

  // Aggregated dashboard
  aggregatedData: AggregatedDashboardData | null;
  aggregatedLoading: boolean;

}

// View type for paper trading (match the state)
export type PaperView = "live" | "history" | "settings" | "analytics" | "activity" | "aggregated";

// Bot info for multi-strategy
export interface BotInfo {
  id: string; // UUID string
  name: string;
  strategies: Array<{
    id: string; // UUID string
    name: string;
    strategy_type: string;
  }>;
  is_active: boolean;
  live_trading: boolean;
}

export interface DailyPnLPoint {
  date: string;
  pnl: number;
  net_pnl: number;
  trades: number;
  winners: number;
  losers: number;
}

export interface EquityCurvePoint {
  date: string;
  cumulative_pnl: number;
}

export interface DrawdownPoint {
  date: string;
  drawdown: number;
  drawdown_pct: number;
}

export interface MonthlyPnLPoint {
  month: string;
  pnl: number;
}

export interface AnalyticsData {
  summary: {
    total_trades: number;
    winners: number;
    losers: number;
    win_rate: number;
    total_gross_pnl: number;
    total_net_pnl: number;
    total_costs: number;
    avg_win: number;
    avg_loss: number;
    profit_factor: number;
    max_drawdown: number;
    max_drawdown_pct: number;
    final_pnl: number;
  };
  daily_pnl: DailyPnLPoint[];
  equity_curve: EquityCurvePoint[];
  drawdown: DrawdownPoint[];
  monthly_pnl: MonthlyPnLPoint[];
  symbol_performance: SymbolPerformance[];
}

export interface ActivityEvent {
  type: string;
  timestamp: string;
  symbol?: string;
  side?: string;
  direction?: string;
  quantity?: number;
  entry_price?: number;
  exit_price?: number;
  pnl?: number;
  pnl_pct?: number;
  net_pnl?: number;
  exit_reason?: string;
  strategy_name?: string;
  hold_duration_minutes?: number;
  trade_id?: string;
}

export interface AggregatedBotData {
  id: string;
  name: string;
  running: boolean;
  pid: number | null;
  strategies: Array<{ id: number; name: string; strategy_type: string }>;
  position_count: number;
  daily_pnl: number;
  unrealized_pnl: number;
  positions: any[];
}

export interface AggregatedDashboardData {
  bots: AggregatedBotData[];
  summary: {
    total_bots: number;
    running_bots: number;
    total_positions: number;
    total_daily_pnl: number;
    total_unrealized_pnl: number;
    total_value: number;
  };
}

export interface BotSummaryStrategy {
  id: string;
  name: string;
  strategy_type: string;
}

export interface BotSummary {
  id: string;
  name: string;
  is_active: boolean;
  live_trading: boolean;
  running: boolean;
  pid: number | null;
  status: string;
  position_count: number;
  strategies: BotSummaryStrategy[];
}
