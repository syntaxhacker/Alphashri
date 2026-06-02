export interface Stock {
  symbol: string;
  score: number;
  tv_price: number;
  upstox_price: number;
  broker_diff: number;
  high_52w: number;
  low_52w?: number;
  to_52w_high: number;
  time_to_52w?: { days: number; confidence: "HIGH" | "MED" | "LOW" };
  recent_return_5d: number;
  perf_w: number;
  sector: string;
  touched_52w: boolean;
  days_ago?: number | null;
  last_touched?: string | null; // ISO date string of last 52w touch
  last_touched_price?: number | null;
  day_change?: number;
  rsi?: number;
  stoch_k?: number;
  wick_close_pct?: number;
  volume_surge?: number;
  atr_pct?: number;
  adx?: number;
  interest_score?: number;
  gap_pct?: number;
  premarket_change?: number;
  impact_score?: number;
  market_cap_b?: number;
  volume_m?: number;
  reversal_signal?: string;
  rationale?: string;
  is_bullish?: boolean;
  sentiment?: "bullish" | "lean_bull" | "neutral" | "lean_bear" | "bearish";
  [key: string]: any;
}

export interface SummaryItem {
  label: string;
  value: string | number;
  color?: string;
}

export interface ProfileFilter {
  key: string;
  label: string;
  type: "number" | "select";
  min?: number;
  max?: number;
  step?: number;
  default?: number | string;
  options?: Array<string | number | { value: string; label: string }>;
}

export interface ProfileMeta {
  section_labels?: { primary: string; secondary: string };
  section_descriptions?: { primary: string; secondary: string };
  filters?: ProfileFilter[];
  default_sort?: { column: string; direction: "asc" | "desc" };
  score_formula?: string;
}

export interface ScreenerData {
  approaching: Stock[];
  touched: Stock[];
  last_updated: string;
  provider: string;
  mode: string;
  screener: string;
  profile_meta?: ProfileMeta;
  summary?: SummaryItem[];
  warning?: string | null;
}

export interface ScreenerOption {
  id: string;
  label: string;
  description?: string;
  status?: "current" | "legacy";
  superseded_by?: string;
  legacy_52w_sections?: boolean;
  indicators?: string[];
  columns?: string[];
  filters?: ProfileFilter[];
  default_sort?: { column: string; direction: SortDirection };
  section_labels?: { primary: string; secondary: string };
  section_descriptions?: { primary: string; secondary: string };
}

export interface ChangeNotification {
  id: number;
  ts: string;
  title: string;
  detail: string;
  kind: "primary" | "secondary";
}

export type NotifFilter = "all" | "primary" | "secondary";

export type SortDirection = "asc" | "desc";

export type { LLMRun, ModelUsage, Aggregate, LLMStats } from "./admin";
