export interface StrategyRunnerConfig {
  bot_uuids: string[];
  date: string;
  end_date: string;
  symbols: string[];
}

export interface BotInfo {
  uuid: string;
  name: string;
  strategy_name: string;
  strategy_type: string;
  sl_pct: number;
  tp_pct: number;
  watchlist: string[];
}

export interface StrategyRunnerTrade {
  bot_name: string;
  bot_uuid: string;
  symbol: string;
  side: string;
  entry_price: number;
  exit_price: number;
  pnl: number;
  net_pnl: number;
  reason: string;
  entry_time: string;
  exit_time: string;
}

export interface BotSummary {
  total_trades: number;
  winners: number;
  losers: number;
  win_rate: number;
  net_pnl: number;
  profit_factor: number;
}

export interface SymbolSummary {
  total_trades: number;
  winners: number;
  losers: number;
  win_rate: number;
  net_pnl: number;
  profit_factor: number;
  bots_traded: number;
  total_bots: number;
  best_bot: string;
}

export interface StrategyRunnerSummary {
  total_trades: number;
  winners: number;
  losers: number;
  win_rate: number;
  net_pnl: number;
  profit_factor: number;
  total_costs: number;
  by_bot: Record<string, { trades: StrategyRunnerTrade[]; summary: BotSummary }>;
  by_symbol: Record<string, SymbolSummary>;
}

export interface StrategyRunnerState {
  config: StrategyRunnerConfig;
  bots: BotInfo[];
  isRunning: boolean;
  progress: { currentBot: number; totalBots: number; currentBotName: string };
  trades: StrategyRunnerTrade[];
  summary: StrategyRunnerSummary | null;
  error: string | null;
}
