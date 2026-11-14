/**
 * Shared Types
 *
 * Canonical shapes shared by the backtest and experiments chart payloads.
 * `backtest.ts` and `experiments.ts` re-export these so existing imports keep working.
 */

// Strategy configuration
export interface StrategyParam {
  key: string;
  label: string;
  type: "number" | "select" | "boolean";
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

// Chart data types
export interface CandleData {
  time: string; // Comparable format: "YYYY-MM-DDTHH:MM"
  date: string; // Date part: "YYYY-MM-DD"
  date_raw?: string; // Raw date string
  time_str: string; // Time part: "HH:MM"
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ORBZone {
  date: string;
  date_raw: string;
  or_high: number;
  or_low: number;
  or_end_time: string;
}

export interface PivotLevels {
  date: string;
  date_raw: string;
  pp: number; // Pivot Point
  r1: number; // Resistance 1
  s1: number; // Support 1
  r2?: number; // Resistance 2
  s2?: number; // Support 2
  r3?: number; // Resistance 3
  s3?: number; // Support 3
}

export interface Week52Levels {
  date: string;
  date_raw: string;
  "52w_high": number;
  trailing_active?: boolean;
}

export interface ChartTrade {
  trade_id: number;
  type: "entry" | "exit";
  time: string;
  candle_idx?: number; // Index of the candle this trade marker should be placed on
  date: string;
  price: number;
  marker: {
    symbol: string;
    color: string;
    size: number;
  };
  trade: {
    entry_price: number;
    exit_price: number;
    entry_time?: string;
    exit_time?: string;
    quantity: number;
    gross_pnl: number;
    /** Emitted by the backend trade record; absent on some chart payloads. */
    gross_pnl_pct?: number;
    trading_costs: number;
    net_pnl: number;
    net_pnl_pct: number;
    exit_reason: "TP" | "SL" | "EOD" | "TRAILING_STOP" | "MAX_HOLDING" | "NEW_52W_HIGH";
    hold_duration_minutes: number;
    // ORB strategy fields
    or_high?: number;
    or_low?: number;
    // S/R Breakout strategy fields
    pp?: number; // Pivot Point
    r1?: number; // Resistance 1
    s1?: number; // Support 1
    r2?: number; // Resistance 2
    s2?: number; // Support 2
    // 52W Chaser strategy fields (chart_data.py:215/263)
    "52w_high"?: number;
    trailing_active?: boolean;
    /** Trade direction — "LONG" | "SHORT". */
    side?: string;
  };
}

export interface BaseChartData {
  symbol: string;
  candles: CandleData[];
  orb_zones: ORBZone[];
  pivot_levels: PivotLevels[]; // S/R Breakout pivot levels
  week52_levels: Week52Levels[]; // 52W Chaser levels
  trades: ChartTrade[];
  visuals?: {
    overlays: any[];
    ema_series?: Array<{
      label: string;
      color: string;
      data: number[];
    }>;
  };
  date_range: {
    // `chart_data.py` sends null when the candle window is empty.
    start: string | null;
    end: string | null;
  };
  total_candles: number;
  total_trades: number;
}
