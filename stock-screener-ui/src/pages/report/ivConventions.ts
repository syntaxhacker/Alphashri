/**
 * IV conventions shared by the report's smile/25Δ readers.
 *
 * Mirror of `api/options_conventions.py`. The report backend already sources
 * these from that module; the frontend kept its own `0.12` delta tolerance and
 * `120` chart cap, which silently disagreed with the payload it renders. Keep
 * the values here (and only here) on the UI side.
 */

export const IV_DELTA_TARGET = 0.25;

export const IV_DELTA_BAND: readonly [number, number] = [0.15, 0.35];

export const IV_MAX_PCT = 100;
