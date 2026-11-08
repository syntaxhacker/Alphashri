import type { ColumnDef, FormattedCell } from "./index";
import { getPnLTextColor, formatPercentage } from "../../../utils/ui-helpers";

// ── fixed-decimal cells ──────────────────────────────────────────────

export function fixedOrDash(value: number | null | undefined, precision: number): string {
  return value != null ? value.toFixed(precision) : "-";
}

export function fixedOrZero(value: number | null | undefined, precision: number): string {
  return (value ?? 0).toFixed(precision);
}

/** Rounds and locale-groups integers, dash on null/undefined. */
export function intLocaleOrDash(value: number | null | undefined): string {
  return value != null ? Math.round(value).toLocaleString() : "-";
}

/** Percent string only when strictly positive, silent otherwise (e.g. div yield). */
export function pctOrEmpty(value: number | null | undefined, precision = 1): string {
  return value && value > 0 ? `${value.toFixed(precision)}%` : "";
}

/** Rupee price with 2 decimals; null/undefined renders as ₹0.00. */
export function rupeePrice(value: number | null | undefined): string {
  return `₹${(value ?? 0).toFixed(2)}`;
}

/** FormattedCell with fixed decimals, dash when empty — always a cell object. */
export function fixedCellDash(value: number | null | undefined, precision: number): FormattedCell {
  return { value: value?.toFixed(precision) || "-" };
}

/** Dash string for null/undefined, FormattedCell otherwise. */
export function fixedCellOrString(
  value: number | null | undefined,
  precision: number,
): string | FormattedCell {
  if (value === null || value === undefined) return "-";
  return { value: value.toFixed(precision) };
}

// ── signed cells ─────────────────────────────────────────────────────

/** Signed percent, plus only when value > 0 (0 renders without sign). */
export function signedPercent(value: number, precision: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(precision)}%`;
}

/** Signed number without percent suffix; plus when >= 0 if plusAtZero. */
export function signedFixed(value: number, precision: number, plusAtZero = false): string {
  const plus = plusAtZero ? value >= 0 : value > 0;
  return `${plus ? "+" : ""}${value.toFixed(precision)}`;
}

/** Strictly-positive P&L tone: "success" when value > 0 else "error". */
export function tonePositive(value: number): "success" | "error" {
  return value > 0 ? "success" : "error";
}

/** Signed ≥0-tone percent cell via formatPercentage + getPnLTextColor. */
export function pnlPctCell(value: number, precision = 2): FormattedCell {
  return { value: formatPercentage(value, precision, true), className: getPnLTextColor(value) };
}

/** Signed >0-tone percent cell (used for strictly-positive momentum/perf metrics). */
export function signedPercentCell(value: number, precision: number): FormattedCell {
  return { value: signedPercent(value, precision), className: tonePositive(value) };
}

// ── 52W gap cells ────────────────────────────────────────────────────

/** Below zero → basing (success); above errorAbove → extended (error); else neutral. */
export function gapTone(value: number, errorAbove: number): "" | "success" | "error" {
  return value < 0 ? "success" : value > errorAbove ? "error" : "";
}

/** 2-dp signed-percent gap cell with the standard 52W gap tone. */
export function gapCell(value: number, errorAbove: number): FormattedCell {
  return { value: signedPercent(value, 2), className: gapTone(value, errorAbove) };
}

// ── days-ago cells ───────────────────────────────────────────────────

/**
 * Relative age of a touched level. Dash on null/undefined, `${n}d` otherwise;
 * pass todayLabel to render a friendlier label for 0 (e.g. "Today").
 */
export function daysAgoCell(
  value: number | null | undefined,
  todayLabel?: string,
): string | FormattedCell {
  if (value === null || value === undefined) return "-";
  if (todayLabel !== undefined && value === 0) return { value: todayLabel };
  return { value: `${value}d` };
}

// ── reusable column factories ────────────────────────────────────────

export function numCol(
  key: string,
  label: string,
  format?: ColumnDef["format"],
): ColumnDef {
  return { key, label, type: "number", sortable: true, ...(format ? { format } : {}) };
}
