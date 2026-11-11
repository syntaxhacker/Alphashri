/** Market Screener — snapshot contract shared by api/hooks/components. */

export type MarketUniverse = "all_equity" | "nifty500" | "nifty50" | "nse_fo";

export type MarketCapTier = "large" | "mid" | "small" | "micro";

export interface MarketRow {
  symbol: string;
  name: string;
  sector: string | null;
  exchange: string | null;
  /** Last traded price. */
  close: number | null;
  /** Day change in percent. */
  change: number | null;
  /** Today's volume vs the trailing average (x). */
  relativeVolume: number | null;
  /** Market cap in ₹ crore (derived from raw market cap server-side). */
  marketCapCr: number | null;
  capTier: string | null;
  rsi: number | null;
  adx: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  /** Performance over the last week in percent. */
  perfW: number | null;
  /** Performance over the last month in percent. */
  perf1m: number | null;
  high52w: number | null;
  low52w: number | null;
  /** Position within the 52-week range, 0–100. */
  pos52w: number | null;
  fno: boolean;
  etf: boolean;
}

export interface MarketSnapshot {
  asOf: string | null;
  universe: string;
  total: number;
  /** e.g. "streaming" (live) vs anything else (delayed). */
  updateMode: string;
  rows: MarketRow[];
}
