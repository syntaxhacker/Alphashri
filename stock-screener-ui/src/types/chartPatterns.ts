/**
 * Chart Patterns — DTOs mirroring `chart_patterns/CONTRACT.md` §5 exactly.
 *
 * Keep these in sync with the frozen contract. These are transport types only;
 * no runtime state lives here.
 */

/** Timeframe registry entry (`chart_patterns/timeframes.py:TFSpec`). */
export interface TFSpec {
  id: string;
  label: string;
  minutes: number;
  /** True when Upstox serves this TF natively; false when produced via resample. */
  native: boolean;
  /** Source timeframe used for resampling (e.g. `1m` → `3m`). Null when native. */
  source_tf: string | null;
  max_lookback_days: number;
  min_bars: number;
}

/** Selectable scan universe (`GET /universes`). */
export interface Universe {
  id: string;
  label: string;
  count: number;
}

export type PatternDirection = "bullish" | "bearish" | "neutral";
export type PatternStatus = "forming" | "confirmed" | "failed" | "marginal";
export type PatternQuality = "textbook" | "strong" | "fair" | "marginal";

/** Pattern family (`GET /patterns`). */
export interface PatternFamily {
  id: string;
  label: string;
}

/** Pattern definition (`GET /patterns`). */
export interface PatternDef {
  pattern_id: string;
  name: string;
  family: string;
  direction: PatternDirection;
  description: string;
}

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

/** Compute job state (`JobDTO`, `GET /jobs/{id}`). */
export interface JobDTO {
  job_id: string;
  universe: string;
  timeframe: string;
  status: JobStatus;
  total: number;
  done: number;
  failed: number;
  skipped: number;
  queue_position: number | null;
  started_at: string | null;
  finished_at: string | null;
  data_through: string | null;
  error: string | null;
}

/** A single trendline is a list of `{t, price}` points. */
export type Trendline = Array<{ t: string; price: number }>;

/** Pattern hit row (`PatternHitDTO`, `GET /results`). */
export interface PatternHitDTO {
  id: number;
  symbol: string;
  name: string | null;
  timeframe: string;
  pattern_id: string;
  pattern_name: string;
  family: string;
  direction: PatternDirection;
  status: PatternStatus;
  quality: PatternQuality;
  confidence: number;
  start_date: string;
  end_date: string;
  start_price: number;
  end_price: number;
  breakout_level: number;
  target: number;
  stop: number;
  rr: number;
  bars_ago: number;
  volume_confirmed: boolean;
  trendlines: Trendline[];
  notes: string;
  /** Swing pivots used to define the pattern: on-chart markers + manual audit. */
  pivots?: Array<{ t: string; price: number; kind?: "high" | "low" }>;
  /** Real OHLCV window covering the pattern (enriched by the API for card charts). */
  candles?: ChartCandle[];
  /** Latest close for the symbol/timeframe (enriched). */
  last_close?: number | null;
  /** Latest bar change % for the symbol/timeframe (enriched). */
  day_change_pct?: number | null;
  /** Consolidation base length in bars/days (`consolidation` pattern only). */
  base_days?: number;
  /** Consolidation range as a percentage of price (`consolidation` pattern only). */
  range_pct?: number;
  /** Position within the consolidation range, 0..1 (`consolidation` pattern only). */
  range_pos?: number;
}

/** Aggregate counts (`GET /summary`). */
export interface PatternSummary {
  scanned: number;
  patterns: number;
  in_view: number;
  confirmed: number;
  bullish: number;
  bearish: number;
  data_through: string | null;
  /** Hit count per `pattern_id` across the whole filtered set (no page limit). */
  pattern_counts?: Record<string, number>;
  /** Hit count per family across the whole filtered set (no page limit). */
  family_counts?: Record<string, number>;
}

/**
 * Per-timeframe availability for a symbol. Contract §5 only shows `timeframes:[...]`
 * for `SymbolDetail`, so the exact element shape is a documented gap. Chosen shape:
 * `{ timeframe, count }`.
 */
export interface SymbolTimeframeInfo {
  timeframe: string;
  count: number;
}

/** Symbol drill-down (`GET /symbol/{symbol}`). */
export interface SymbolDetail {
  symbol: string;
  name: string | null;
  last_close: number | null;
  day_change_pct: number | null;
  history_bars: number;
  timeframes: SymbolTimeframeInfo[];
  counts: { confirmed: number; forming: number };
  patterns: PatternHitDTO[];
}

/** OHLCV candle (`GET /symbol/{symbol}/chart`). */
export interface ChartCandle {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/**
 * Overlay drawn on the symbol chart. Contract §5 leaves `overlays` open; chosen
 * shape is a per-pattern trendline bundle.
 */
export interface PatternOverlay {
  pattern_id?: string;
  pattern_name?: string;
  direction?: PatternDirection;
  status?: PatternStatus;
  trendlines: Trendline[];
}

/** Symbol chart payload (`GET /symbol/{symbol}/chart`). */
export interface ChartPayload {
  symbol: string;
  timeframe: string;
  candles: ChartCandle[];
  overlays: PatternOverlay[];
}

/** User-facing result filters (the filter rail). */
export interface PatternFilters {
  family: string[];
  /** Specific pattern ids (verified sub-filters within a family); empty = any. */
  pattern_id: string[];
  direction: string[];
  status: string[];
  quality: string | null;
  formed_within_bars: number | null;
  volume_confirmed: boolean | null;
  min_rr: number | null;
  symbol: string | null;
  /** Minimum consolidation base length in bars/days (null = any). */
  min_base_days: number | null;
  /** Maximum consolidation range as % of price (null = any). */
  max_range_pct: number | null;
  /** Result ordering: `"confidence"` (default) or `"newest"` (freshest bars first). */
  sort: string;
}

/**
 * Full query accepted by `/results` and `/summary`. Filter fields are optional
 * (they map to optional query params); `universe`, `timeframe` and `job_id` are
 * also supplied by the store; `limit`/`offset` paginate results.
 */
export interface PatternsQuery extends Partial<PatternFilters> {
  job_id?: string | null;
  universe?: string | null;
  timeframe?: string | null;
  limit?: number;
  offset?: number;
}
