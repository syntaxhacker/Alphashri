import { TZ_IST } from "@/config/constants";

/**
 * Shared IST formatters for chart timestamps and time axes.
 *
 * lightweight-charts renders `UTCTimestamp` values in UTC by default, so an
 * intraday bar at 03:45Z would read "03:45" instead of the trader's "09:15" IST — these
 * helpers pin every tick / crosshair label to the exchange timezone. Candle
 * timestamps from the detector arrive as ISO strings (Upstox daily candles land at
 * 18:30 UTC = 00:00 IST the next trading day, intraday candles carry a real time),
 * so the ISO-string parse + format lives here too — one source of truth for both
 * the lightweight-charts axis and the ECharts category axis / tooltip.
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

const yearFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ_IST, year: "numeric" });
const monthFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ_IST, month: "short" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ_IST, day: "2-digit" });
const timeSecFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ_IST,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Tick-mark granularity requested by lightweight-charts' `tickMarkFormatter`. */
export type ISTTickKind = "year" | "month" | "day" | "time" | "timeSeconds";

/**
 * lightweight-charts axis tick label, formatted in the exchange timezone.
 */
export function formatISTTick(epochSeconds: number, kind: ISTTickKind): string {
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  switch (kind) {
    case "year":
      return yearFmt.format(date);
    case "month":
      return monthFmt.format(date);
    case "day":
      return dayFmt.format(date);
    case "timeSeconds":
      return timeSecFmt.format(date);
    default:
      return timeFmt.format(date);
  }
}

/** True when the instant resolves to IST midnight (a daily candle boundary). */
function isISTMidnight(date: Date): boolean {
  const hour = Number(timeFmt.formatToParts(date).find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(timeFmt.formatToParts(date).find((p) => p.type === "minute")?.value ?? "0");
  return hour === 0 && minute === 0;
}

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
  return dateOnly || isISTMidnight(date);
}

/** "04 May 2026" on a daily boundary, else "04 May, 09:20". */
function formatISTMoment(date: Date, daily: boolean): string {
  if (daily) return dateFmt.format(date);
  return `${dayMonthFmt.format(date)}, ${timeFmt.format(date)}`;
}

/** lightweight-charts crosshair time label, formatted in IST (date-only when daily). */
export function formatISTCrosshair(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return formatISTMoment(date, isISTMidnight(date));
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
  return formatISTMoment(parsed.date, isDaily(parsed));
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
