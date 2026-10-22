/**
 * Shared formatting for the Deep Value panel.
 *
 * The table (`valueColumns.tsx`), the detail drawer and the score cell each
 * used to carry their own copy of the same percent/number helpers, and they
 * disagreed on the "no value" glyph: the table printed an en dash while the
 * drawer printed "n/a". This module is the single place the panel's numbers
 * are formatted, with the glyph chosen by the caller.
 *
 * The percentages here are *signed* ("+1.2%") and ungrouped — they are ratios,
 * not index levels, so the Indian digit grouping of the report panels would
 * only get in the way.
 */

import type { ValueRow } from "../../api/valueScan";

/** Glyph the table prints for a missing value. */
const VALUE_DASH = "–";

/** Glyph the drawer and the score cell print for a missing value. */
export const VALUE_NA = "n/a";

/** Currency symbol for a market's quote currency. */
function currencyPrefix(currency: string): string {
  if (currency === "INR") return "₹";
  if (currency === "USD") return "$";
  return "";
}

/**
 * Signed percentage — `+1.2%` / `-0.8%` / `0.0%`.
 * A missing value prints `dash`.
 */
export function formatValuePct(
  value: number | null | undefined,
  digits = 1,
  dash = VALUE_DASH,
): string {
  if (value === null || value === undefined) return dash;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

/** Fixed-decimal number — `12.3`. A missing value prints `dash`. */
export function formatValueNum(
  value: number | null | undefined,
  digits = 1,
  dash = VALUE_DASH,
): string {
  if (value === null || value === undefined) return dash;
  return value.toFixed(digits);
}

/** Fixed-decimal number with an optional suffix — used for the peer medians. */
export function formatValueMedian(
  value: number | null | undefined,
  suffix = "",
  digits = 1,
  dash = VALUE_NA,
): string {
  if (value === null || value === undefined) return dash;
  return `${value.toFixed(digits)}${suffix}`;
}

/** Quoted price with the row's currency symbol — `₹1,234.50`. */
export function formatValuePrice(row: ValueRow): string {
  return `${currencyPrefix(row.currency)}${row.price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Market capitalisation in billions, prefixed with the currency symbol. */
export function formatValueMcap(row: ValueRow): string {
  return `${currencyPrefix(row.currency)}${row.mcap_bn.toFixed(1)}B`;
}
