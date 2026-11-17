/**
 * IV conventions shared by the report's smile/25Δ readers.
 *
 * Mirror of `api/options_conventions.py`. The report backend already sources
 * these from that module; the frontend kept its own `0.12` delta tolerance and
 * `120` chart cap, which silently disagreed with the payload it renders. Keep
 * the values here (and only here) on the UI side.
 */

/** The desk's 25-delta convention for the skew wings. */
export const IV_DELTA_TARGET = 0.25;

/** A leg is a 25-delta wing only when its |delta| lands in this band. */
export const IV_DELTA_BAND: readonly [number, number] = [0.15, 0.35];

/** Upper bound of a believable IV print, in vol points. */
export const IV_MAX_PCT = 100;

/** Lower bound for the report surface (a sub-1% print is a dead strike). */
export const SURFACE_IV_MIN_PCT = 1;

/** Lower bound for the analytics engine (strictly positive). */
export const IV_MIN_PCT = 0;
