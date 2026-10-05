import { TZ_IST } from "@/config/constants";

export type { ISTTickKind } from "@/utils/istChartTime";
export { formatISTCrosshair, formatISTTick } from "@/utils/istChartTime";

/**
 * Candle timestamps arrive from the detector as ISO strings (Upstox daily
 * candles land at 18:30 UTC = 00:00 IST the next trading day, intraday candles
 * carry a real time). Format them in the exchange timezone so labels read as the
 * trading date/time an Indian trader expects instead of a raw UTC machine stamp.
 *
 * Kept separate from the chart option builder so both the axis labels and the
 * tooltip share one source of truth.
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ_IST,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const dayMonthFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ_IST,
  day: "2-digit",
  month: "short",
});

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ_IST,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

interface ParsedTimestamp {
  date: Date;
  /** True when the input had no time component at all (e.g. "2026-05-04"). */
  dateOnly: boolean;
}

/**
 * Parse an ISO timestamp defensively. Date-only strings are anchored at UTC
 * noon so the calendar date survives the timezone conversion unchanged.
 * Returns null when the value cannot be parsed.
 */
function parseTimestamp(iso: string): ParsedTimestamp | null {
  if (typeof iso !== "string") return null;
  const trimmed = iso.trim();
  if (trimmed === "") return null;

  if (DATE_ONLY_RE.test(trimmed)) {
    const [y, m, d] = trimmed.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d, 12));
    return Number.isNaN(date.getTime()) ? null : { date, dateOnly: true };
  }

  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return null;
  return { date: new Date(ms), dateOnly: false };
}

/** True for date-only inputs and for intraday timestamps that resolve to IST midnight. */
function isDaily({ date, dateOnly }: ParsedTimestamp): boolean {
  if (dateOnly) return true;
  const hour = Number(timeFmt.formatToParts(date).find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(timeFmt.formatToParts(date).find((p) => p.type === "minute")?.value ?? "0");
  return hour === 0 && minute === 0;
}

/**
 * Full, human-readable timestamp for tooltips.
 * - daily / date-only → "04 May 2026"
 * - intraday          → "04 May, 09:20"
 * Falls back to the raw string when it cannot be parsed.
 */
export function formatChartTimestamp(iso: string): string {
  const parsed = parseTimestamp(iso);
  if (!parsed) return iso;
  if (isDaily(parsed)) return dateFmt.format(parsed.date);
  return `${dayMonthFmt.format(parsed.date)}, ${timeFmt.format(parsed.date)}`;
}

/**
 * Shorter, ECharts-axis-friendly timestamp for category axis labels.
 * - daily / date-only → "04 May"
 * - intraday          → "04 May 09:20"
 * Falls back to the raw string when it cannot be parsed.
 */
export function formatChartTick(iso: string): string {
  const parsed = parseTimestamp(iso);
  if (!parsed) return iso;
  if (isDaily(parsed)) return dayMonthFmt.format(parsed.date);
  return `${dayMonthFmt.format(parsed.date)} ${timeFmt.format(parsed.date)}`;
}

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
