/**
 * Strategy Management Types
 */

// Strategy configuration from database
export interface StrategyConfig {
  id: number;
  name: string;
  strategy_type: string;
  parent_id: number | null;
  is_template: boolean;
  is_active: boolean;
  is_default: boolean;
  description: string | null;
  // ORB Parameters
  or_minutes: number;
  sl_pct: number;
  tp_pct: number;
  min_or_range_pct: number;
  max_or_range_pct: number;
  // Risk Parameters
  max_positions: number;
  max_capital_per_trade_pct: number;
  max_daily_loss_pct: number;
  max_total_exposure_pct: number;
  risk_per_trade_pct: number;
  min_trade_value: number;
  max_trade_value: number;
  // Runner Parameters
  cooldown_minutes: number;
  max_distance_from_or_pct: number;
  // Cost Parameters
  brokerage_pct: number;
  min_brokerage: number;
  stt_pct: number;
  exchange_pct: number;
  sebi_pct: number;
  stamp_pct: number;
  gst_pct: number;
  // Timestamps
  created_at: string | null;
  updated_at: string | null;
}

// Strategy creation request
export interface StrategyCreate {
  name: string;
  strategy_type: string;
  parent_id?: number | null;
  description?: string;
  // ORB parameters
  or_minutes?: number;
  sl_pct?: number;
  tp_pct?: number;
  min_or_range_pct?: number;
  max_or_range_pct?: number;
  // Risk parameters
  max_positions?: number;
  max_capital_per_trade_pct?: number;
  max_daily_loss_pct?: number;
  max_total_exposure_pct?: number;
  risk_per_trade_pct?: number;
  min_trade_value?: number;
  max_trade_value?: number;
  // Runner parameters
  cooldown_minutes?: number;
  max_distance_from_or_pct?: number;
}

// Strategy update request
export interface StrategyUpdate {
  name?: string;
  description?: string;
  is_active?: boolean;
  is_default?: boolean;
  or_minutes?: number;
  sl_pct?: number;
  tp_pct?: number;
  min_or_range_pct?: number;
  max_or_range_pct?: number;
  max_positions?: number;
  max_capital_per_trade_pct?: number;
  max_daily_loss_pct?: number;
  max_total_exposure_pct?: number;
  risk_per_trade_pct?: number;
  min_trade_value?: number;
  max_trade_value?: number;
  cooldown_minutes?: number;
  max_distance_from_or_pct?: number;
}

// Strategy with variations (for template view)
export interface StrategyWithVariations {
  strategy: StrategyConfig;
  variations: StrategyConfig[];
}

// Strategy performance stats
export interface StrategyPerformance {
  strategy_id: number;
  strategy_name: string;
  total_trades: number;
  winners: number;
  losers: number;
  win_rate: number;
  total_pnl: number;
  net_pnl: number;
}

// Bot configuration
export interface BotConfig {
  id: string; // UUID string
  name: string;
  is_active: boolean;
  max_total_positions: number;
  max_total_capital_pct: number;
  strategies: StrategyConfig[];
  created_at: string | null;
  updated_at: string | null;
}

// Strategies state
export interface StrategiesState {
  strategies: StrategyConfig[];
  templates: StrategyConfig[];
  selectedStrategy: StrategyConfig | null;
  selectedVariations: StrategyConfig[];
  performance: StrategyPerformance | null;
  allPerformance: StrategyPerformance[]; // Performance data for all strategies
  bots: BotConfig[];
  isLoading: boolean;
  error: string | null;
  // Form state
  showCreateModal: boolean;
  showEditModal: boolean;
  editingStrategy: StrategyConfig | null;
  parentTemplate: StrategyConfig | null;
}

// View type
export type StrategiesView = "list" | "templates" | "bots" | "performance";
