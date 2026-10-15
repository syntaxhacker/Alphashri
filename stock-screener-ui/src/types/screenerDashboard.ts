/**
 * Screener dashboard (StockEdge-style market overview) contract.
 *
 * Backend: `GET /api/screener/dashboard?universe=nifty500`
 * Panels under "movers": gainers / losers / near_52w_high / near_52w_low /
 * most_active / turnover. Legacy backends may still send `near_52w`.
 * Panels under "unusual": volume_surge / gap_up / gap_down / range_expansion.
 *
 * Round-2 fields (all optional for backward compatibility with old payloads):
 * rows may carry `rsi`, `vwap`, `atr`, `price_52_week_high`, `market_cap`
 * (plus volume/value/rel-volume metrics); the response may carry `cached`
 * / `age_sec` and requests accept `limit` / `min_market_cap_cr` / `refresh`.
 */

export interface ScreenerDashboardRow {
  symbol: string;
  name: string;
  close: number;
  change: number;
  logo: string | null;
  sub_label: string;
  sub_value: string;
  spark: number[];
  /** Day volume (shares). Newer backends only. */
  volume?: number | null;
  /** Day traded value (₹). Newer backends only. */
  value?: number | null;
  /** Alias for `value` sent by some backends. */
  turnover?: number | null;
  /** Volume vs average multiple. Newer backends only. */
  rel_volume?: number | null;
  /** Alias for `rel_volume`. */
  relvol?: number | null;
  rsi?: number | null;
  vwap?: number | null;
  atr?: number | null;
  price_52_week_high?: number | null;
  /** Alias for `price_52_week_high`. */
  high_52w?: number | null;
  /** Market cap in ₹ crore. Newer backends only. */
  market_cap?: number | null;
  /** Alias for `market_cap`. */
  market_cap_cr?: number | null;
}

export interface ScreenerDashboardPanel {
  id: string;
  title: string;
  metric_label: string;
  qualify: number;
  rows: ScreenerDashboardRow[];
}

export interface ScreenerDashboardSection {
  id: string;
  title: string;
  panels: ScreenerDashboardPanel[];
}

export interface ScreenerDashboardResponse {
  universe: string;
  as_of: string;
  total: number;
  sections: ScreenerDashboardSection[];
  /** True when the payload is a cached snapshot. Newer backends only. */
  cached?: boolean;
  /** Age of the cached snapshot in seconds. Newer backends only. */
  age_sec?: number;
}
