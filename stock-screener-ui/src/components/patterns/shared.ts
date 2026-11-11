/**
 * Shared helpers for the chart-patterns surfaces.
 *
 * Centralises the bits that were previously copied across the card, list,
 * matrix, pivot-list, filter rail and applied-filters components so every
 * surface renders identical output from one definition.
 */

import { formatCurrency } from "@/utils/ui-helpers";

/** `family` id → display label. Used by the filter rail and the applied
 *  filters chips; kept here so both render identical family names. */
export const FAMILY_LABELS: Record<string, string> = {
  reversal: "Reversal",
  continuation: "Continuation",
  curve_cup: "Curve & Cup",
};

/** Price → `"—"` when null/undefined, else 2-decimal currency. Shared by the
 *  card, list, pivot list and chart body so every price cell renders
 *  identically. */
export function formatPrice(value: number | null | undefined): string {
  return value == null ? "—" : formatCurrency(value, 2);
}
