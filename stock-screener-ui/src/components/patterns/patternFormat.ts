/**
 * Compact number formatting for the pattern result surfaces (card, grid,
 * matrix). Every helper is null/NaN-safe and renders "—" when it cannot
 * produce a meaningful value, so call sites don't re-implement the guards.
 */

import { formatPercentage } from "@/utils/ui-helpers";
import type { PatternHitDTO } from "@/types/chartPatterns";

/** Score (confidence-like): "—" when missing/non-finite, else one decimal. */
export function formatScore(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(1);
}

/** Range position (0–100): "—" when missing/non-finite, else a whole percent. */
export function formatRangePos(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${Math.round(value)}%`;
}

/**
 * At most one decimal, trimming a trailing ".0" ("13" not "13.0"). Returns
 * "—" for missing/non-finite input so a half-streamed hit cannot print "NaN".
 */
export function formatOneDecimal(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Signed one-decimal percent with a true minus sign (U+2212): "+4.7%" /
 * "−0.8%". "—" when missing/non-finite.
 */
export function formatSignedPct1(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}%`;
}

/** Latest tradable price: live close falling back to the pattern end price. */
export function hitLastPrice(
  hit: Pick<PatternHitDTO, "last_close" | "end_price">,
): number {
  return hit.last_close ?? hit.end_price;
}

/**
 * Day change when available, otherwise the pattern-window move
 * (0 when the start price is 0).
 */
export function hitChangePct(
  hit: Pick<PatternHitDTO, "day_change_pct" | "start_price" | "end_price">,
): number {
  if (hit.day_change_pct != null) return hit.day_change_pct;
  return hit.start_price !== 0 ? ((hit.end_price - hit.start_price) / hit.start_price) * 100 : 0;
}

/** Price → "—" when missing/non-finite, else ₹-prefixed with thousands separators and 2 decimals. */
export function formatMatrixPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `₹${v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Signed two-decimal percentage: "—" when missing/non-finite. */
export function formatMatrixPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatPercentage(v, 2);
}
