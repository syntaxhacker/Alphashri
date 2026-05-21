/**
 * Bot Management Types
 */

import type { LoadingState } from "../utils/loading";

// Strategy allocation within a bot
export interface StrategyAllocation {
  strategy_id: string; // UUID string
  max_positions: number;
  capital_allocation_pct: number;
}

// Strategy with allocation info (for UI)
export interface StrategyWithAllocation {
  id: string; // UUID string
  name: string;
  strategy_type: string;
  max_positions: number;
  capital_allocation_pct: number;
}
// Bot configuration
export interface BotConfig {
  id: string; // uuid string
  uuid: string;
  name: string;
  is_active: boolean;
  max_total_positions: number;
  max_total_capital_pct: number;
  max_daily_loss_pct: number;
  live_trading: boolean;
  strategies: StrategyWithAllocation[];
  created_at: string | null;
  updated_at: string | null;
  running: boolean;
  pid: number | null;
  status?: string;
  error?: string | null;
}
// Bot creation request
export interface BotCreate {
  name: string;
  is_active?: boolean;
  max_total_positions?: number;
  max_total_capital_pct?: number;
  live_trading?: boolean;
  strategies: StrategyAllocation[];
}
// Bot update request
export interface BotUpdate {
  name?: string;
  is_active?: boolean;
  max_total_positions?: number;
  max_total_capital_pct?: number;
  max_daily_loss_pct?: number;
  live_trading?: boolean;
  strategies?: StrategyAllocation[];
}
// Bot status (live data)
export interface BotStatus {
  bot_id: string;
  running: boolean;
  pid: number | null;
  status: "running" | "stopped" | "unknown";
  portfolio: PortfolioSummary | null;
  strategies: Record<string, StrategyStatus>;
  positions?: BotPosition[];
  last_update?: string;
  error?: string | null;
}

// Portfolio summary
export interface PortfolioSummary {
  initial_capital: number;
  cash: number;
  margin_used: number;
  total_value: number;
  total_pnl: number;
  total_pnl_pct: number;
  daily_pnl: number;
  total_positions: number;
  max_daily_loss_pct?: number;
  daily_loss_limit_exceeded?: boolean;
}

// Strategy status within bot
export interface StrategyStatus {
  strategy_id: string;
  strategy_name: string;
  status: "running" | "stopped" | "cooldown";
  active_positions: number;
  positions_count: number;
  max_positions: number;
  allocated_capital: number;
  capital_used: number;
  capital_used_pct: number;
  total_pnl: number;
  trades_count: number;
  portfolio_status: BotPortfolioStatus | null;
  error?: string | null;
}
// Bot portfolio status
export interface BotPortfolioStatus {
  initial_capital: number;
  cash: number;
  margin_used: number;
  total_value: number;
  total_pnl: number;
  total_pnl_pct: number;
  daily_pnl: number;
  total_positions: number;
}
// Bot position
export interface BotPosition {
  strategy_id: string;
  strategy_name: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  entry_price: number;
  current_price: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  stop_loss: number;
  take_profit: number;
  entry_time: string;
}

// Bot trade
export interface BotTrade {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  pnl: number;
  pnl_pct: number;
  net_pnl: number;
  realized_pnl: number | null;
  strategy_id: string;
  strategy_name: string;
  entry_time: string;
  exit_time: string | null;
  exit_reason: string;
  is_test: boolean;
  is_test_data: boolean;
}
// Bot trades response (for trades endpoint)
export interface BotTradesResponse {
  trades: BotTrade[];
}
export interface AvailableStrategy {
  id: string;
  name: string;
  strategy_type: string;
  is_template: boolean;
  is_default: boolean;
  sl_pct: number;
  tp_pct: number;
  max_positions: number;
  or_minutes: number;
  min_or_range_pct: number;
  max_or_range_pct: number;
  max_distance_from_or_pct: number;
  cooldown_minutes: number;
  enable_shorts: boolean;
  eod_exit_hour: number;
  eod_exit_minute: number;
  pivot_type: string;
  breakout_buffer_pct: number;
  entry_threshold_pct: number;
  min_breakout_pct: number;
  enable_trailing_stop: boolean;
  trailing_stop_pct: number;
  max_holding_days: number;
  cooldown_days: number;
  ema_fast_period: number;
  ema_slow_period: number;
}
// Strategy comparison
export interface StrategyComparison {
  strategy_id: string;
  strategy_name: string;
  strategy_type: string;
  total_pnl: number;
  total_pnl_pct: number;
  trade_count: number;
  win_rate: number;
  profit_factor: number;
  avg_holding_time_minutes: number;
}
// Bot loading keys
export type BotLoadingKey =
  | "list"
  | "load"
  | "status"
  | "strategies"
  | "create"
  | "update"
  | "delete"
  | "start"
  | "stop"
  | "trades";

// Bot state
export interface BotsState {
  bots: BotConfig[];
  selectedBot: BotConfig | null;
  botStatus: BotStatus | null;
  botTrades: BotTrade[];
  availableStrategies: AvailableStrategy[];
  loading: LoadingState<BotLoadingKey>;
  error: string | null;
  showCreateModal: boolean;
  showEditModal: boolean;
  editingBot: BotConfig | null;
}
