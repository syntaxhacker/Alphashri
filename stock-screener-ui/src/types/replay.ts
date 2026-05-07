export interface ReplayConfig {
  date: string;
  strategy: string;
  symbols: string | null;
  refresh_cache: boolean;
  bot_uuid: string;
}

export interface ReplayCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ReplayORLevels {
  strategy: string;
  symbol: string;
  or_high: number;
  or_low: number;
  or_range_pct: number;
  from_index: number;
  to_index: number;
}

export interface ReplayPivotLevels {
  strategy: string;
  symbol: string;
  pp: number;
  r1: number;
  s1: number;
  r2: number;
  s2: number;
  from_index: number;
  to_index: number;
}

export interface Replay52WLevel {
  strategy: string;
  symbol: string;
  high_52w: number;
  low_52w: number;
  from_index: number;
  to_index: number;
}

export interface ReplayEMAData {
  symbol: string;
  ema_fast_period: number;
  ema_slow_period: number;
  timeframes: Record<string, { ema_fast: number[]; ema_slow: number[] }>;
}

export interface ReplayTrade {
  id: number;
  strategy: string;
  symbol: string;
  side: string;
  entry_price: number;
  exit_price: number;
  entry_time: string;
  exit_time: string;
  pnl: number;
  net_pnl: number;
  costs: number;
  exit_reason: string;
  quantity: number;
}

export interface ReplayOpenPosition {
  id: number;
  strategy: string;
  symbol: string;
  side: string;
  entry_price: number;
  sl: number;
  tp: number;
  entry_time: string;
  quantity: number;
}

export interface ReplayProgress {
  candle: number;
  total: number;
  time: string;
  symbol: string;
}

export type ReplayEvent =
  | { type: "loaded"; symbols: number; candles: number }
  | { type: "progress"; candle: number; total: number; time: string; symbol: string }
  | {
      type: "or_levels";
      strategy: string;
      symbol: string;
      or_high: number;
      or_low: number;
      or_range_pct: number;
      from_index: number;
      to_index: number;
    }
  | {
      type: "pivot_levels";
      strategy: string;
      symbol: string;
      pp: number;
      r1: number;
      s1: number;
      r2: number;
      s2: number;
      from_index: number;
      to_index: number;
    }
  | {
      type: "52w_high";
      strategy: string;
      symbol: string;
      high_52w: number;
      low_52w: number;
      from_index: number;
      to_index: number;
    }
  | {
      type: "ema_series";
      symbol: string;
      ema_fast_period: number;
      ema_slow_period: number;
      timeframes: Record<string, { ema_fast: number[]; ema_slow: number[] }>;
    }
  | {
      type: "trade_open";
      strategy: string;
      symbol: string;
      side: string;
      price: number;
      sl: number;
      tp: number;
      time: string;
      quantity: number;
    }
  | {
      type: "trade_close";
      strategy: string;
      symbol: string;
      side: string;
      entry_price: number;
      exit_price: number;
      reason: string;
      pnl: number;
      net_pnl: number;
      costs: number;
      entry_time: string;
      exit_time: string;
      quantity: number;
    }
  | {
      type: "summary";
      total_trades: number;
      winners: number;
      losers: number;
      win_rate: number;
      profit_factor: number;
      gross_pnl: number;
      total_costs: number;
      net_pnl: number;
      avg_win?: number;
      avg_loss?: number;
      strategy_breakdown: Record<
        string,
        {
          trades: number;
          win_rate: number;
          net_pnl: number;
          profit_factor: number;
        }
      >;
    }
  | { type: "candles"; symbol: string; candles: ReplayCandle[] }
  | { type: "done"; success: boolean; duration_ms: number }
  | { type: "error"; message: string };

export interface ReplayState {
  config: ReplayConfig;
  isRunning: boolean;
  progress: ReplayProgress | null;
  trades: ReplayTrade[];
  openPositions: ReplayOpenPosition[];
  orLevels: ReplayORLevels[];
  pivotLevels: ReplayPivotLevels[];
  high52wLevels: Replay52WLevel[];
  emaData: Record<string, ReplayEMAData>;
  summary: ReplaySummary | null;
  candlesBySymbol: Record<string, ReplayCandle[]>;
  selectedSymbol: string;
  strategyFilter: string;
  error: string | null;
  totalCandles: number;
  totalSymbols: number;
  chartOptions: ReplayChartOptions;
  highlightedTradeId: number | null;
}

export interface ReplayChartOptions {
  show_orb_zones: boolean;
  show_pivot_levels: boolean;
  show_52w_high: boolean;
  show_ema: boolean;
  show_markers: boolean;
  show_all_trades: boolean;
}

export interface ReplaySummary {
  total_trades: number;
  winners: number;
  losers: number;
  win_rate: number;
  profit_factor: number | null;
  gross_pnl: number;
  total_costs: number;
  net_pnl: number;
  avg_win?: number;
  avg_loss?: number;
  strategy_breakdown: Record<
    string,
    {
      trades: number;
      win_rate: number;
      net_pnl: number;
      profit_factor: number | null;
    }
  >;
}
