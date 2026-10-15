/** Pattern-profitability screener shapes (GET /api/reports/profitability).
 * `win_rate` is a 0..1 fraction; money fields are in INR. */

export interface StrategyProfitRow {
  id: string;
  label: string;
  trades: number;
  win_rate: number;
  net_pnl: number;
  expectancy: number;
  profit_factor: number;
  max_dd: number;
  avg_hold_days: number;
}

export interface ProfitTopSignal {
  symbol: string;
  strategy: string;
  entry_date: string;
  entry: number;
  exit: number;
  net: number;
}

export interface ProfitabilityResponse {
  weeks: number;
  universe: string;
  as_of: string;
  cached: boolean;
  strategies: StrategyProfitRow[];
  top_signals: ProfitTopSignal[];
}
