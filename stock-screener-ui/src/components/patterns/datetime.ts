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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toDatetimeLocalValue(date: Date): string {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

export function nowDatetimeLocal(): string {
  return toDatetimeLocalValue(new Date());
}

export function daysAgoDatetimeLocal(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return toDatetimeLocalValue(d);
}

export function startOfMonthDatetimeLocal(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  return toDatetimeLocalValue(d);
}

export function formatAsOfLabel(iso: string): string {
  return iso.includes("T") ? iso.replace("T", " ") : iso;
}
