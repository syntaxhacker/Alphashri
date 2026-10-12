/** Event Watch API response shapes
 * (GET /api/reports/events/upcoming, GET /api/reports/events/recent).
 * Both endpoints are new and may be absent (404) on older backends —
 * the fetchers return null in that case so the screen stays
 * backward-compatible and shows whichever section loads. */

export type EventWatchKind =
  | "results"
  | "update"
  | "qip"
  | "order"
  | "upgrade"
  | "dividend"
  | "split"
  | "bonus"
  | "agm";

export interface EventWatchEvent {
  date: string;
  symbol: string;
  name?: string;
  kind: EventWatchKind;
  title: string;
  source?: string;
}

export interface EventWatchResponse {
  as_of: string;
  events: EventWatchEvent[];
}

/** Market-regime snapshot (GET /api/reports/events/regime).
 * Nifty 50 close vs its 20-day moving average — the `regime_long_ok`
 * signal. `close`/`dma20`/`above` are null when the backend has no
 * Nifty closes (fail-soft); callers omit the chip in that case. */
export interface RegimeResponse {
  as_of: string;
  symbol: string;
  name: string;
  close: number | null;
  dma20: number | null;
  above: boolean | null;
  cached?: boolean;
  rule?: string;
}

/** Client-side technical snapshot derived from the /api/reports/daily
 * payload (moves panels). All fields optional: shown as "—" when absent. */
export interface EventWatchTech {
  price?: number;
  chg_pct_5d?: number;
  vol_ratio?: number;
  dist_52w_pct?: number;
  accum_ok?: boolean;
}

export interface EventWatchRow extends EventWatchEvent {
  tech: EventWatchTech;
}
