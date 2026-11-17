/**
 * Dashboard store — one payload per symbol, no polling.
 *
 * `loadDashboard()` is the only read path: a repeat open of the same symbol is a
 * zero-request cache hit, two concurrent opens share one in-flight request, and
 * a generation guard makes an abort or a symbol switch a no-op instead of a late
 * paint. A failed fetch keeps the last good frame and surfaces a typed error the
 * page renders as a banner + Retry.
 *
 * The single-flight / LRU / generation mechanism lives in
 * `createSingleFlightStore`; this module is a thin, named wrapper over it so
 * existing imports and the public store API stay unchanged.
 */

import { fetchDashboard } from "../api/optionsDashboard";
import type { OptionsDashboardData } from "../types/optionsDashboard";
import {
  createSingleFlightStore,
  type SingleFlightError,
  type SingleFlightState,
  type SingleFlightStatus,
} from "./createSingleFlightStore";

export const MAX_CACHED_SYMBOLS = 5;

export type DashboardStatus = SingleFlightStatus;
export type DashboardError = SingleFlightError;
export type OptionsDashboardState = SingleFlightState<OptionsDashboardData>;

const store = createSingleFlightStore<OptionsDashboardData>({
  cacheSize: MAX_CACHED_SYMBOLS,
  fetcher: (symbol, signal) => fetchDashboard(symbol, signal),
});

export const optionsDashboardState = store.state;
export const setOptionsDashboardState = store.setState;

/** Test/introspection hook — no UI reads this directly. */
export const __dashboardCache = store.cache;

/** Cache hit costs zero requests; concurrent opens share the one flight. */
export const loadDashboard = store.load;

/** One forced re-read of the current symbol, keeping the painted frame. */
export const refreshDashboard = store.refresh;

/** Cancel an in-flight read; the cache and the last painted frame survive. */
export const abortDashboard = store.abort;

export const clearDashboard = store.clear;

export const __resetDashboard = store.reset;
