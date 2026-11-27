/**
 * Request caps shared by the market and value API clients.
 *
 * These are the limits the frontend actually sends on the wire. A backend-only
 * validation bound (e.g. the value scan's `1 <= limit <= 500`) is deliberately
 * not here — nothing in the shipped clients duplicates it as a request literal.
 */

/** Default row `limit` for `/api/market/snapshot` and its cache ceiling. */
export const MARKET_ROW_CAP = 4000;
/** Backend hard cap on symbols per `/api/market/snapshot` request. */
export const MARKET_SYMBOL_CAP = 20;
/** Default row `limit` for `/api/value/scan`. */
export const VALUE_ROW_CAP = 100;
