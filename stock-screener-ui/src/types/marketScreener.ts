/** Market Screener — snapshot contract shared by api/hooks/components. */

import type { CapTierKey } from "../config/marketUniverses";

export type MarketUniverse =
  | "all_equity"
  | "nifty500"
  | "nifty200"
  | "nifty100"
  | "nifty50"
  | "banknifty"
  | "sensex"
  | "nse_fo"
  | "us";

/** Derived from the descriptor registries; never a second literal vocabulary. */
export type MarketCapTier = CapTierKey;

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
  /** Market cap in ₹ crore (derived from raw market cap server-side). Null for USD rows. */
  marketCapCr: number | null;
  /** Market cap in $ billions. Null for INR rows. */
  marketCapUsdB?: number | null;
  /** Quote currency; absent on legacy cached rows means INR. */
  currency?: "INR" | "USD";
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
  /** Fundamentals (null when the source has no coverage). */
  peRatio: number | null;
  pbRatio: number | null;
  dividendYield: number | null;
  roe: number | null;
  /** Value-filter fundamentals; nullable on purpose — coverage is market-dependent. */
  psRatio: number | null;
  /** Free cash flow / market cap, derived server-side. Null when either is absent. */
  fcfYield: number | null;
  revenue: number | null;
  netIncome: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  /** Year-over-year growth in revenue / diluted EPS, in percent. */
  revYoy: number | null;
  epsYoy: number | null;
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
  /** The frame is being served while a refresh runs; `ageSec` bounds it. */
  stale?: boolean;
  ageSec?: number | null;
  cached?: boolean;
}
