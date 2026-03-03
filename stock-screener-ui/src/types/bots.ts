/**
 * Bot Management Types
 */

// Strategy allocation within a bot
export interface StrategyAllocation {
  strategy_id: number;
  max_positions: number;
  capital_allocation_pct: number;
}

// Strategy with allocation info (for UI)
export interface StrategyWithAllocation {
  id: number;
  name: string;
  strategy_type: string;
  max_positions: number;
  capital_allocation_pct: number;
}

// Bot configuration
export interface BotConfig {
  id: number;
  name: string;
  is_active: boolean;
  max_total_positions: number;
  max_total_capital_pct: number;
  strategies: StrategyWithAllocation[];
  created_at: string | null;
  updated_at: string | null;
  running: boolean;
  pid: number | null;
}

// Bot creation request
export interface BotCreate {
  name: string;
  is_active?: boolean;
  max_total_positions?: number;
  max_total_capital_pct?: number;
  strategies: StrategyAllocation[];
}

// Bot update request
export interface BotUpdate {
  name?: string;
  is_active?: boolean;
  max_total_positions?: number;
  max_total_capital_pct?: number;
  strategies?: StrategyAllocation[];
}

// Strategy status within a running bot
export interface StrategyStatus {
  strategy_id: number;
  strategy_name: string;
  status: string;
  positions_count: number;
  max_positions: number;
  capital_used: number;
  allocated_capital: number;
  capital_used_pct: number;
  unrealized_pnl: number;
  realized_pnl: number;
  total_pnl: number;
  trades_count: number;
}

// Position within a bot
export interface BotPosition {
  symbol: string;
  side: string;
  quantity: number;
  entry_price: number;
  current_price: number;
  stop_loss: number;
  take_profit: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  entry_time: string;
  strategy_id: number;
  strategy_name: string;
}

// Portfolio summary
export interface PortfolioSummary {
  initial_capital: number;
  cash: number;
  capital_used: number;
  position_value: number;
  unrealized_pnl: number;
  realized_pnl: number;
  total_value: number;
  total_pnl: number;
  total_pnl_pct: number;
  total_positions: number;
  total_trades: number;
  daily_pnl: number;
  daily_trades: number;
  strategies_count: number;
}

// Bot status response
export interface BotStatus {
  bot_id: number;
  bot_name: string;
  running: boolean;
  pid: number | null;
  portfolio: PortfolioSummary | null;
  strategies: Record<string, StrategyStatus> | null;
  positions: BotPosition[] | null;
  last_update: string | null;
}

// Performance comparison
export interface StrategyComparison {
  strategy_id: number;
  strategy_name: string;
  status: string;
  trades: number;
  positions: number;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  capital_used: number;
  capital_used_pct: number;
}

// Available strategy for adding to bot
export interface AvailableStrategy {
  id: number;
  name: string;
  strategy_type: string;
  is_template: boolean;
  is_default: boolean;
  sl_pct: number;
  tp_pct: number;
  max_positions: number;
}

// Bots view state
export interface BotsState {
  bots: BotConfig[];
  selectedBot: BotConfig | null;
  botStatus: BotStatus | null;
  availableStrategies: AvailableStrategy[];
  isLoading: boolean;
  error: string | null;
  showCreateModal: boolean;
  showEditModal: boolean;
  editingBot: BotConfig | null;
}

// View type
export type BotsView = "list" | "status" | "comparison";
