import { MARKET_TIME_ZONE, formatChartTimeLabel } from "@/utils/chart/time";

/**
 * Chart-time formatters for lightweight-charts axes and crosshairs.
 *
 * lightweight-charts renders `UTCTimestamp` values in UTC by default, so an
 * intraday bar at 03:45Z would read "03:45" instead of the trader's "09:15" IST —
 * these helpers pin every tick / crosshair label to the requested zone (default
 * IST, the exchange zone). The ECharts category axes use the ISO-string helpers
 * below from the same module, so one source of truth serves both charts.
 *
 * Epoch numbers are rendered in `timeZone` (DST-aware for named zones); an ISO
 * string carrying an explicit offset is the true instant and is likewise
 * rendered in the requested zone. India output is unchanged.
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

type FmtKind =
  | "date"
  | "dayMonth"
  | "time"
  | "timeSeconds"
  | "year"
  | "month"
  | "day"
  | "hourMinute";

function optionsFor(kind: FmtKind): Intl.DateTimeFormatOptions {
  switch (kind) {
    case "date":
      return { day: "2-digit", month: "short", year: "numeric" };
    case "dayMonth":
      return { day: "2-digit", month: "short" };
    case "time":
    case "hourMinute":
      return { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
    case "timeSeconds":
      return { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };
    case "year":
      return { year: "numeric" };
    case "month":
      return { month: "short" };
    case "day":
      return { day: "2-digit" };
  }
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

/** Zone-aware `en-GB` formatter, cached per (zone, kind); invalid zones fall back to IST. */
function zoneFormatter(timeZone: string, kind: FmtKind): Intl.DateTimeFormat {
  const key = `${timeZone}|${kind}`;
  let fmt = fmtCache.get(key);
  if (!fmt) {
    const options = optionsFor(kind);
    try {
      fmt = new Intl.DateTimeFormat("en-GB", { timeZone, ...options });
    } catch {
      fmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: MARKET_TIME_ZONE.india,
        ...options,
      });
    }
    fmtCache.set(key, fmt);
  }
  return fmt;
}

function formatInZone(date: Date, kind: FmtKind, timeZone: string): string {
  return zoneFormatter(timeZone, kind).format(date);
}

/** Tick-mark granularity requested by lightweight-charts' `tickMarkFormatter`. */
export type ISTTickKind = "year" | "month" | "day" | "time" | "timeSeconds";

/**
 * lightweight-charts axis tick label, formatted in `timeZone`.
 */
export function formatISTTick(
  epochSeconds: number,
  kind: ISTTickKind,
  timeZone: string = MARKET_TIME_ZONE.india,
): string {
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  switch (kind) {
    case "year":
      return formatInZone(date, "year", timeZone);
    case "month":
      return formatInZone(date, "month", timeZone);
    case "day":
      return formatInZone(date, "day", timeZone);
    case "timeSeconds":
      return formatInZone(date, "timeSeconds", timeZone);
    default:
      return formatChartTimeLabel(epochSeconds, "HM", timeZone);
  }
}

/** True when the instant resolves to midnight in `timeZone` (a daily candle boundary). */
function isMidnight(date: Date, timeZone: string): boolean {
  const parts = zoneFormatter(timeZone, "hourMinute").formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
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
  return dateOnly || isMidnight(date, MARKET_TIME_ZONE.india);
}

/** "04 May 2026" on a daily boundary, else "04 May, 09:20" (IST). */
function formatISTMoment(date: Date, daily: boolean): string {
  const zone = MARKET_TIME_ZONE.india;
  if (daily) return formatInZone(date, "date", zone);
  return `${formatInZone(date, "dayMonth", zone)}, ${formatChartTimeLabel(date.getTime(), "HM", zone)}`;
}

/** lightweight-charts crosshair time label, formatted in `timeZone` (date-only when daily). */
export function formatISTCrosshair(
  epochSeconds: number,
  timeZone: string = MARKET_TIME_ZONE.india,
): string {
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  if (isMidnight(date, timeZone)) return formatInZone(date, "date", timeZone);
  return `${formatInZone(date, "dayMonth", timeZone)}, ${formatChartTimeLabel(epochSeconds, "HM", timeZone)}`;
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
  const zone = MARKET_TIME_ZONE.india;
  if (isDaily(parsed)) return formatInZone(parsed.date, "dayMonth", zone);
  return `${formatInZone(parsed.date, "dayMonth", zone)} ${formatChartTimeLabel(parsed.date.getTime(), "HM", zone)}`;
}
