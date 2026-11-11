/**
 * Event Radar types — mirrors `api/event_radar/contract.py` 1:1.
 *
 * Change one, change the other. The `is_alpha` flag is computed server-side so
 * the UI never has to know which event types are "the interesting ones".
 */

export type EventType =
  | "investor_day"
  | "analyst_day"
  | "capital_markets_day"
  | "strategy_day"
  | "rnd_day"
  | "business_update"
  | "guidance"
  | "shareholder_meeting"
  | "earnings"
  | "dividend"
  | "split"
  | "other";

export type EventSource = "seed" | "edgar" | "ir" | "wire" | "tv";

export interface EventDTO {
  id: string;
  symbol: string;
  event_type: EventType;
  title: string;
  /** YYYY-MM-DD, the day the event happens. */
  event_date: string;
  source: EventSource;
  exchange: string | null;
  name: string | null;
  /** YYYY-MM-DD, the day it was announced (the lead time). */
  announced_at: string | null;
  source_url: string | null;
  confidence: number;
  recurring: boolean;
  notes: string | null;
  /** Signed; negative for past events. Computed server-side. */
  days_until: number;
  is_alpha: boolean;
}

export interface AnomalyDTO {
  symbol: string;
  /** ISO-8601 with offset, the bar's close time. */
  ts: string;
  price: number;
  ret_pct: number;
  /** Signed, in robust sigmas. */
  ret_sigma: number;
  vol_ratio: number;
  has_known_event: boolean;
  suspected: string | null;
  exchange: string | null;
}

export interface EventsMeta {
  as_of: string;
  scanned: number;
  sources: Record<string, number>;
  warnings: string[];
}

export interface EventsResponse {
  events: EventDTO[];
  meta: EventsMeta;
}

export interface AnomaliesResponse {
  anomalies: AnomalyDTO[];
  meta: {
    as_of: string;
    date: string;
    scanned: number;
    thresholds: {
      ret_sigma: number;
      vol_mult: number;
      min_abs_ret: number;
      cooldown_min: number;
    };
    warnings: string[];
  };
}

export type EventMarket = "us" | "india" | "all";

export interface EventsQuery {
  market?: EventMarket;
  /** YYYY-MM-DD inclusive. Defaults to today. */
  from?: string;
  /** YYYY-MM-DD inclusive. Defaults to today + 90. */
  to?: string;
  /** Comma separated event types; omitted = all. */
  types?: string;
  /** Comma separated symbols; omitted = whole market. */
  symbols?: string;
  /** Drop past events. Defaults to true. */
  upcoming_only?: boolean;
  limit?: number;
}
