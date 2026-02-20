/**
 * Type definitions for Stock Screener UI
 */

export interface Stock {
  symbol: string
  score: number
  tv_price: number
  upstox_price: number
  broker_diff: number
  to_52w_high: number
  time_to_52w?: { days: number; confidence: 'HIGH' | 'MED' | 'LOW' }
  recent_return_5d: number
  perf_w: number
  sector: string
  touched_52w: boolean
  day_change?: number
  rsi?: number
  stoch_k?: number
  wick_close_pct?: number
  volume_surge?: number
  atr_pct?: number
  adx?: number
  interest_score?: number
  gap_pct?: number
  premarket_change?: number
  impact_score?: number
  market_cap_b?: number
  volume_m?: number
  reversal_signal?: string
  rationale?: string
  is_bullish?: boolean
  sentiment?: 'bullish' | 'lean_bull' | 'neutral' | 'lean_bear' | 'bearish'
}

export interface SummaryItem {
  label: string
  value: string
}

export interface ProfileFilter {
  key: string
  label: string
  type: 'number' | 'select'
  min?: number
  max?: number
  step?: number
  default?: number | string
  options?: string[]
}

export interface ProfileMeta {
  section_labels?: { primary: string; secondary: string }
  filters?: ProfileFilter[]
  default_sort?: { column: string; direction: 'asc' | 'desc' }
}

export interface ScreenerData {
  approaching: Stock[]
  touched: Stock[]
  last_updated: string
  provider: string
  mode: string
  screener: string
  profile_meta?: ProfileMeta
  summary?: SummaryItem[]
  demo_mode?: boolean
}

export interface Filters {
  minScore: number
  maxPrice: number
  minReturn: number
  sector: string
}

export interface ScreenerOption {
  id: string
  label: string
  description: string
}

export interface ChangeNotification {
  id: number
  ts: string
  title: string
  detail: string
  kind: 'primary' | 'secondary'
}

export type NotifFilter = 'all' | 'primary' | 'secondary'

export type SortDirection = 'asc' | 'desc'
