export interface LLMRun {
  id: number;
  url: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  response_time_ms: number;
  status: string;
  created_at: string;
}

export interface ModelUsage {
  model: string;
  count: number;
}

export interface Aggregate {
  total_runs: number;
  total_tokens: number;
  total_cost_usd: number;
  avg_response_time_ms: number;
  models_used: ModelUsage[];
}

export interface LLMStats {
  recent_runs: LLMRun[];
  aggregate: Aggregate;
  error?: string;
}

export interface Week52RangeJobStatus {
  status: "idle" | "running" | "completed" | "failed";
  total?: number;
  processed?: number;
  ok?: number;
  failed?: number;
  skipped?: number;
  progress_pct?: number;
  last_symbol?: string;
  started_at?: string;
  finished_at?: string;
  elapsed_sec?: number;
  message?: string;
  error?: string;
  updated_at?: string;
}

export interface Week52RangeDbStats {
  db_row_count: number;
  db_latest_updated_at: string | null;
  expected_universe: number;
  coverage_pct: number;
}

export interface Week52RangeSchedule {
  interval_sec: number;
  mode: string;
  description: string;
}

export interface Week52RangeAdminStatus {
  job: Week52RangeJobStatus;
  database: Week52RangeDbStats;
  fetched_at: string;
  run_hint?: string;
  schedule?: Week52RangeSchedule;
}

export interface NewsAnalysisQueueStatus {
  pending: number;
  processing: number;
  done: number;
  failed: number;
  total: number;
}

export interface NewsQueueNeedsAnalysis {
  broken_summary: number;
  null_analysis: number;
}

export interface NewsQueueFailure {
  queue_id: number;
  article_id: number;
  headline: string;
  error: string;
  updated_at: string;
}

export interface NewsAnalysisQueueStatusResponse {
  queue: NewsAnalysisQueueStatus;
  needs_analysis: NewsQueueNeedsAnalysis;
  recent_failures: NewsQueueFailure[];
  error?: string;
}

/** Session-minute gap with no stored order-flow data. */
export interface OrderFlowJournalGap {
  from: string;
  to: string;
  minutes: number;
}

/** One symbol's stored order-flow data for a day (one journal file). */
export interface OrderFlowJournalRow {
  symbol: string;
  file: string;
  /** "fyers_tbt" | "fyers" | "upstox" | "mixed" | "unknown" */
  broker: string;
  brokers_seen: string[];
  bytes: number;
  records: number;
  ticks: number;
  signals: number;
  malformed: number;
  first_ts: number | null;
  last_ts: number | null;
  covered_minutes: number;
  coverage_pct: number;
  gaps: OrderFlowJournalGap[];
}

export interface OrderFlowJournalSummary {
  day: string;
  session_start: string;
  session_close: string;
  session_minutes: number;
  rows: OrderFlowJournalRow[];
  total_bytes: number;
  total_records: number;
  overall_coverage_pct: number;
  available_days: string[];
  broker_available: boolean;
  fetched_at: string;
}
