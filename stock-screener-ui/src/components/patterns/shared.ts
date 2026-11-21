/**
 * Shared helpers for the chart-patterns surfaces.
 *
 * Centralises the bits that were previously copied across the card, list,
 * matrix, pivot-list, filter rail and applied-filters components so every
 * surface renders identical output from one definition.
 */

/** `family` id → display label. Used by the filter rail and the applied
 *  filters chips; kept here so both render identical family names. */
export const FAMILY_LABELS: Record<string, string> = {
  reversal: "Reversal",
  continuation: "Continuation",
  curve_cup: "Curve & Cup",
};
