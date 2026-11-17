/**
 * App-wide analytics store — one payload per open dock, no polling.
 *
 * The UI lane calls `loadAnalytics()` when the analytics tab is first shown.
 * A repeated open of the same symbol costs zero requests (module LRU); a
 * `refreshAnalytics()` costs exactly one. A single in-flight request per symbol
 * is shared by concurrent callers, and a generation guard makes an abort or a
 * symbol switch a no-op instead of a late paint.
 *
 * The single-flight / LRU / generation mechanism lives in
 * `createSingleFlightStore`; this module is a thin, named wrapper over it so
 * existing imports and the public store API stay unchanged.
 */

import { fetchAnalytics, type OptionsAnalytics } from "../api/optionsAnalytics";
import {
  createSingleFlightStore,
  type SingleFlightError,
  type SingleFlightState,
  type SingleFlightStatus,
} from "./createSingleFlightStore";

export const MAX_CACHED_SYMBOLS = 5;

export type AnalyticsStatus = SingleFlightStatus;
export type AnalyticsError = SingleFlightError;
export type OptionsAnalyticsState = SingleFlightState<OptionsAnalytics>;

const store = createSingleFlightStore<OptionsAnalytics>({
  cacheSize: MAX_CACHED_SYMBOLS,
  fetcher: (symbol, signal) => fetchAnalytics(symbol, signal),
});

export const optionsAnalyticsState = store.state;
export const setOptionsAnalyticsState = store.setState;

/** Test/introspection hook — no UI reads this directly. */
export const __analyticsCache = store.cache;

/** Cache hit costs zero requests; concurrent opens share the one flight. */
export const loadAnalytics = store.load;

/** One forced re-read of the current symbol, keeping the painted frame. */
export const refreshAnalytics = store.refresh;

/** Cancel an in-flight read; the cache and the last painted frame survive. */
export const abortAnalytics = store.abort;

export const clearAnalytics = store.clear;

export const __resetAnalytics = store.reset;
