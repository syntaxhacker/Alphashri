/**
 * Shared limits for the multi-expiry options analytics UI.
 *
 * Kept free of React/DOM so the API client, the pure math helpers and the chart
 * panels can all read the same numbers — a request default, its upper clamp,
 * and the IV-surface column budget must not drift apart.
 */

/** Expiries requested when the caller does not specify a ladder. */
export const ANALYTICS_DEFAULT_EXPIRIES = 3;

/** Upper bound on the expiry count accepted by the analytics request. */
export const ANALYTICS_MAX_EXPIRIES = 6;

/** Maximum number of strike columns sampled into the IV surface heatmap. */
export const SURFACE_MAX_STRIKES = 21;
