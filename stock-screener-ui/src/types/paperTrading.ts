/**
 * Paper Trading Types
 */

// Open position from paper trader
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
  sl_price: number;
  tp_price: number;
  notes: string;
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

// Chart data for paper trading
export interface PaperChartData {
  symbol: string;
  date: string;
  candles: CandleData[];
  trades: PaperTrade[];
  orb_levels: ORBLevels | null;
  current_position: PaperPosition | null;
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
}

export interface PaperScanItem {
  symbol: string;
  status: string;
  side?: "LONG" | "SHORT";
  price?: number;
  or_high?: number;
  or_low?: number;
  reason?: string;
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
export type PaperTradingView = "live" | "history";

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

  // Chart state
  selectedSymbol: string | null;
  chartData: PaperChartData | null;
  chartLoading: boolean;

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
}

// View type for paper trading (match the state)
export type PaperView = "live" | "history";
