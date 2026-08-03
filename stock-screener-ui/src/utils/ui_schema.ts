export type ColumnKey =
  | "symbol"
  | "score"
  | "tv_price"
  | "upstox_price"
  | "broker_diff"
  | "high_52w"
  | "to_52w_high"
  | "time_to_52w"
  | "recent_return_5d"
  | "perf_w"
  | "sector"
  | "day_change"
  | "rsi"
  | "stoch_k"
  | "wick_close_pct"
  | "volume_surge"
  | "atr_pct"
  | "adx"
  | "interest_score"
  | "gap_pct"
  | "premarket_change"
  | "impact_score"
  | "market_cap_b"
  | "volume_m"
  | "is_bullish"
  | "move_pct"
  | "move_5m"
  | "move_10m"
  | "move_15m";

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  symbol: "Symbol",
  score: "Score",
  tv_price: "TV Price",
  upstox_price: "Upstox",
  broker_diff: "Broker Diff",
  high_52w: "52W High",
  to_52w_high: "To 52W",
  time_to_52w: "Time to 52W",
  recent_return_5d: "5D Return",
  perf_w: "Perf.W",
  sector: "Sector",
  day_change: "Day %",
  rsi: "RSI",
  stoch_k: "Stoch K",
  wick_close_pct: "Wick %",
  volume_surge: "Vol Surge",
  atr_pct: "ATR%",
  adx: "ADX",
  interest_score: "Interest",
  gap_pct: "Gap %",
  premarket_change: "Pre-Mkt %",
  impact_score: "Impact",
  market_cap_b: "Cap B",
  volume_m: "Volume M",
  is_bullish: "Sentiment",
  move_pct: "Move %",
  move_5m: "5-Min Move",
  move_10m: "10-Min Move",
  move_15m: "15-Min Move",
};

export const COLUMN_TOOLTIPS: Record<ColumnKey, string> = {
  symbol: "Stock symbol",
  score:
    "Composite score based on RSI (30pts), ADX (20pts), Relative Volume (20pts), and Distance to 52W High (30pts). Higher = stronger trend candidate.",
  tv_price: "TradingView price",
  upstox_price: "Upstox broker price",
  broker_diff: "Price difference between TV and broker",
  high_52w: "52-week high price",
  to_52w_high: "Percentage distance to 52-week high",
  time_to_52w: "Estimated days to reach 52W high",
  recent_return_5d: "5-day return percentage",
  perf_w: "Weekly performance percentage",
  sector: "Industry sector",
  day_change: "Intraday change percentage",
  rsi: "Relative Strength Index (14)",
  stoch_k: "Stochastic K indicator",
  wick_close_pct: "Where price closed in day's range (0=low, 100=high)",
  volume_surge: "Volume relative to 10-day average",
  atr_pct: "Average True Range as % of price",
  adx: "Average Directional Index (trend strength)",
  interest_score: "Buying interest score",
  gap_pct: "Gap opening percentage",
  premarket_change: "Pre-market change percentage",
  impact_score: "Market impact score (cap × move)",
  market_cap_b: "Market capitalization in billions",
  volume_m: "Volume in millions",
  is_bullish: "Market sentiment direction",
  move_pct: "Price change % over lookback period (5/15/30 min)",
  move_5m: "Price change % in last 5 minutes from Upstox 1-min candles",
  move_10m: "Price change % in last 10 minutes from Upstox 1-min candles",
  move_15m: "Price change % in last 15 minutes from Upstox 1-min candles",
};

export const NUMERIC_COLUMNS = new Set<ColumnKey>([
  "score",
  "tv_price",
  "upstox_price",
  "broker_diff",
  "high_52w",
  "to_52w_high",
  "time_to_52w",
  "recent_return_5d",
  "perf_w",
  "day_change",
  "rsi",
  "stoch_k",
  "gap_pct",
  "premarket_change",
  "impact_score",
  "market_cap_b",
  "volume_m",
  "wick_close_pct",
  "volume_surge",
  "atr_pct",
  "adx",
  "interest_score",
  "move_pct",
  "move_5m",
  "move_10m",
  "move_15m",
]);

export function getColumnKeysForProfile(screener: string, _touched: boolean): ColumnKey[] {
  if (screener === "market_open_gap") {
    return ["symbol", "score", "gap_pct", "premarket_change", "day_change", "volume_m", "sector"];
  }
  if (screener === "rsi_reversal") {
    return ["symbol", "score", "rsi", "stoch_k", "day_change", "volume_m", "sector"];
  }
  if (screener === "nifty_movers") {
    return ["symbol", "score", "impact_score", "market_cap_b", "day_change", "volume_m", "sector"];
  }
  if (screener === "high_momentum") {
    return [
      "symbol",
      "score",
      "rsi",
      "day_change",
      "volume_m",
      "recent_return_5d",
      "perf_w",
      "sector",
    ];
  }
  if (screener === "buyer_interest") {
    return [
      "symbol",
      "score",
      "wick_close_pct",
      "volume_surge",
      "rsi",
      "day_change",
      "volume_m",
      "sector",
    ];
  }
  if (screener === "buyer_interest_enhanced") {
    return [
      "symbol",
      "score",
      "is_bullish",
      "wick_close_pct",
      "volume_surge",
      "gap_pct",
      "rsi",
      "day_change",
      "sector",
    ];
  }
  if (screener === "volatility_trend") {
    return ["symbol", "score", "atr_pct", "adx", "rsi", "day_change", "perf_w", "sector"];
  }
  if (screener === "nifty50_activity") {
    return [
      "symbol",
      "score",
      "interest_score",
      "volume_surge",
      "rsi",
      "day_change",
      "volume_m",
      "sector",
    ];
  }
  if (screener === "intraday_momentum") {
    return [
      "symbol",
      "move_pct",
      "score",
      "volume_surge",
      "rsi",
      "upstox_price",
      "day_change",
      "volume_m",
      "sector",
    ];
  }
  if (screener === "intraday_5m") {
    return [
      "symbol",
      "move_5m",
      "score",
      "volume_surge",
      "rsi",
      "upstox_price",
      "day_change",
      "volume_m",
      "sector",
    ];
  }
  if (screener === "intraday_10m") {
    return [
      "symbol",
      "move_10m",
      "score",
      "volume_surge",
      "rsi",
      "upstox_price",
      "day_change",
      "volume_m",
      "sector",
    ];
  }
  if (screener === "intraday_15m") {
    return [
      "symbol",
      "move_15m",
      "score",
      "volume_surge",
      "rsi",
      "upstox_price",
      "day_change",
      "volume_m",
      "sector",
    ];
  }

  const cols: ColumnKey[] = [
    "symbol",
    "score",
    "tv_price",
    "upstox_price",
    "day_change",
    "high_52w",
    "to_52w_high",
  ];
  cols.push("recent_return_5d", "perf_w", "sector");
  return cols;
}
