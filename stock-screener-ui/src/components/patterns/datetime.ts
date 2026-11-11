/**
 * IST chart-time formatting lives in `@/utils/istChartTime` and is re-exported
 * here so existing `./datetime` importers keep working. This module keeps the
 * `datetime-local` form controls and as-of helpers, which are local-time and
 * timezone-agnostic.
 */

export type { ISTTickKind } from "@/utils/istChartTime";
export {
  formatChartTick,
  formatChartTimestamp,
  formatISTCrosshair,
  formatISTTick,
} from "@/utils/istChartTime";

/** Pad a number to two digits. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Format a `Date` as an HTML `datetime-local` value (`YYYY-MM-DDTHH:MM`) in
 * local time. Used by the as-of replay controls.
 */
export function toDatetimeLocalValue(date: Date): string {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

/** Current time as a `datetime-local` value. */
export function nowDatetimeLocal(): string {
  return toDatetimeLocalValue(new Date());
}

/** Local midnight N days ago as a `datetime-local` value. */
export function daysAgoDatetimeLocal(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return toDatetimeLocalValue(d);
}

/** First of the current month at local midnight as a `datetime-local` value. */
export function startOfMonthDatetimeLocal(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  return toDatetimeLocalValue(d);
}

/**
 * Human label for an as-of cutoff: `datetime-local` values render with a
 * space (`2026-09-30 14:30`); date-only values pass through unchanged.
 */
export function formatAsOfLabel(iso: string): string {
  return iso.includes("T") ? iso.replace("T", " ") : iso;
}
