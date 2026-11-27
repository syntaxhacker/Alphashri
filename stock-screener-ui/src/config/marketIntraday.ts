/**
 * One source for the Market Screener's intraday change columns.
 *
 * TradingView exposes these as `change|1` / `change|5`; the backend shapes them
 * as `change_1m` / `change_5m` and the client maps them to `change1m` /
 * `change5m`. Keeping all four names in one table prevents the API mapper and
 * the table columns from drifting apart when a period is added.
 */
export interface MarketIntradayChange {
  /** TanStack column id (also the persisted column-pref id). */
  id: "change_1m" | "change_5m";
  /** Camel-case field on `MarketRow`. */
  field: "change1m" | "change5m";
  /** Backend wire key. */
  raw: "change_1m" | "change_5m";
  /** Header shown in the table. */
  header: "1m %" | "5m %";
  /** Dash-cell test-id suffix. */
  dash: "change-1m" | "change-5m";
}

export const MARKET_INTRADAY_CHANGES = [
  {
    id: "change_1m",
    field: "change1m",
    raw: "change_1m",
    header: "1m %",
    dash: "change-1m",
  },
  {
    id: "change_5m",
    field: "change5m",
    raw: "change_5m",
    header: "5m %",
    dash: "change-5m",
  },
] as const satisfies readonly MarketIntradayChange[];

/** Typed key set used by the mapper's `Object.fromEntries` result. */
export type MarketIntradayField = (typeof MARKET_INTRADAY_CHANGES)[number]["field"];
