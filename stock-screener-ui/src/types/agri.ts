/**
 * Shared contract for `/api/agri/*`. Field names stay snake_case to match the
 * wire payload; display metadata (labels, units) lives in `src/config/agri.ts`.
 */

export type AgriGroupKey = "cereals" | "pulses" | "vegetables" | "oilseeds" | "spices";
export type AgriRangeKey = "1m" | "3m" | "6m" | "1y" | "max";
export type AgriChartMode = "band" | "arrivals" | "compare" | "ohlc";

export interface AgriOption {
  key: string;
  label: string;
}

export type AgriFilterOption = AgriOption;

export interface AgriGroupFilter {
  key: string;
  label: string;
}

export interface AgriCommodityFilter {
  key: string;
  label: string;
  group: string;
  unit: string;
}

export interface AgriFiltersResponse {
  ok: boolean;
  as_of: string | null;
  freshness_days: number | null;
  commodities: AgriCommodityFilter[];
  groups: AgriGroupFilter[];
  /** The backend currently sends plain names; option objects are also accepted. */
  states: Array<string | AgriOption>;
  districts: Array<string | AgriOption>;
  markets: Array<string | AgriOption>;
}

export type AgriFiltersPayload = AgriFiltersResponse;

export interface AgriPricesParams {
  commodity?: string;
  group?: string;
  state?: string;
  district?: string;
  market?: string;
  range?: AgriRangeKey | string;
  from?: string;
  to?: string;
  compare?: readonly string[] | string;
  limit?: number;
}

export type AgriPricesQuery = AgriPricesParams;

/** The filter echo on a prices response; compare is always normalised to a list. */
export interface AgriAppliedFilters {
  commodity?: string | null;
  group?: string | null;
  state?: string | null;
  district?: string | null;
  market?: string | null;
  range?: AgriRangeKey | string | null;
  from?: string | null;
  to?: string | null;
  compare?: string[];
  limit?: number | null;
}

export interface AgriKpis {
  modal: number | null;
  min: number | null;
  max: number | null;
  unit: string;
  chg_1w_pct: number | null;
  chg_1m_pct: number | null;
  chg_6m_pct: number | null;
  market_count: number;
  arrivals_qtl: number | null;
  arrivals_unit: string;
  msp: number | null;
  distance_to_msp_pct: number | null;
}

export interface AgriSeriesPoint {
  date: string;
  modal: number | null;
  min: number | null;
  max: number | null;
  arrivals_qtl: number | null;
  market_count: number;
  /** Legacy DD/MM/YYYY arrival label, kept for older consumers. */
  arrival?: string;
}

export interface AgriSnapshot {
  key: string;
  label: string;
  group: string;
  date: string;
  modal: number | null;
  min: number | null;
  max: number | null;
  markets: number;
  chg_1w_pct: number | null;
  chg_1m_pct: number | null;
  chg_6m_pct: number | null;
}

export interface AgriQuote {
  date: string;
  state: string;
  district: string;
  market: string;
  variety: string;
  grade: string;
  min: number | null;
  max: number | null;
  modal: number | null;
  arrivals_qtl: number | null;
}

export interface AgriComparisonPoint {
  date: string;
  modal: number | null;
}

export interface AgriComparisonSeries {
  key: string;
  label: string;
  points: AgriComparisonPoint[];
}

export interface AgriPricesResponse {
  ok: boolean;
  as_of: string | null;
  freshness_days: number | null;
  data_source: string;
  filters: AgriAppliedFilters;
  kpis: AgriKpis;
  series: AgriSeriesPoint[];
  snapshot: AgriSnapshot[];
  quotes: AgriQuote[];
  comparison: AgriComparisonSeries[];
  warnings: string[];
  /** Legacy fields from the pre-redesign endpoint; absent on new payloads. */
  source?: string;
  rows_loaded?: number;
  selected?: AgriSelected | null;
}

export type AgriPricesPayload = AgriPricesResponse;

/** Legacy option shape from `GET /api/agri/commodities`. */
export interface AgriCommodity {
  key: string;
  label: string;
  group?: string;
  unit?: string;
}

export interface AgriCommoditiesResponse {
  ok: boolean;
  commodities: AgriCommodity[];
}

export interface AgriSelected {
  key: string;
  label: string;
}
