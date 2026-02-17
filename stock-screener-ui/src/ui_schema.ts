export type ColumnKey =
  | 'symbol'
  | 'score'
  | 'tv_price'
  | 'upstox_price'
  | 'broker_diff'
  | 'to_52w_high'
  | 'time_to_52w'
  | 'recent_return_5d'
  | 'perf_w'
  | 'sector'
  | 'day_change'
  | 'rsi'
  | 'stoch_k'
  | 'wick_close_pct'
  | 'volume_surge'
  | 'volatility_d'
  | 'adx'
  | 'interest_score'
  | 'gap_pct'
  | 'premarket_change'
  | 'impact_score'
  | 'market_cap_b'
  | 'volume_m'

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  symbol: 'Symbol',
  score: 'Score',
  tv_price: 'TV Price',
  upstox_price: 'Upstox',
  broker_diff: 'Broker Diff',
  to_52w_high: 'To 52W High',
  time_to_52w: 'Time to 52W',
  recent_return_5d: '5D Return',
  perf_w: 'Perf.W',
  sector: 'Sector',
  day_change: 'Day %',
  rsi: 'RSI',
  stoch_k: 'Stoch K',
  wick_close_pct: 'Wick %',
  volume_surge: 'Vol Surge',
  volatility_d: 'Vol.D',
  adx: 'ADX',
  interest_score: 'Interest',
  gap_pct: 'Gap %',
  premarket_change: 'Pre-Mkt %',
  impact_score: 'Impact',
  market_cap_b: 'Cap B',
  volume_m: 'Volume M',
}

export const NUMERIC_COLUMNS = new Set<ColumnKey>([
  'score', 'tv_price', 'upstox_price', 'broker_diff', 'to_52w_high', 'time_to_52w',
  'recent_return_5d', 'perf_w', 'day_change', 'rsi', 'stoch_k', 'gap_pct',
  'premarket_change', 'impact_score', 'market_cap_b', 'volume_m',
  'wick_close_pct', 'volume_surge', 'volatility_d', 'adx', 'interest_score'
])

export function getColumnKeysForProfile(screener: string, touched: boolean): ColumnKey[] {
  if (screener === 'market_open_gap') {
    return ['symbol', 'score', 'gap_pct', 'premarket_change', 'day_change', 'volume_m', 'sector']
  }
  if (screener === 'rsi_reversal') {
    return ['symbol', 'score', 'rsi', 'stoch_k', 'day_change', 'volume_m', 'sector']
  }
  if (screener === 'nifty_movers') {
    return ['symbol', 'score', 'impact_score', 'market_cap_b', 'day_change', 'volume_m', 'sector']
  }
  if (screener === 'high_momentum') {
    return ['symbol', 'score', 'rsi', 'day_change', 'volume_m', 'recent_return_5d', 'perf_w', 'sector']
  }
  if (screener === 'buyer_interest') {
    return ['symbol', 'score', 'wick_close_pct', 'volume_surge', 'rsi', 'day_change', 'volume_m', 'sector']
  }
  if (screener === 'buyer_interest_enhanced') {
    return ['symbol', 'score', 'wick_close_pct', 'volume_surge', 'gap_pct', 'rsi', 'day_change', 'sector']
  }
  if (screener === 'volatility_trend') {
    return ['symbol', 'score', 'volatility_d', 'adx', 'rsi', 'day_change', 'perf_w', 'sector']
  }
  if (screener === 'nifty50_activity') {
    return ['symbol', 'score', 'interest_score', 'volume_surge', 'rsi', 'day_change', 'volume_m', 'sector']
  }

  const cols: ColumnKey[] = ['symbol', 'score', 'tv_price', 'upstox_price', 'broker_diff', 'to_52w_high']
  if (!touched) cols.push('time_to_52w')
  cols.push('recent_return_5d', 'perf_w', 'sector')
  return cols
}
