import { TZ_IST } from "@/config/constants";

/**
 * Shared IST formatters for lightweight-charts time axes.
 *
 * The library renders `UTCTimestamp` values in UTC by default, so an intraday
 * bar at 03:45Z would read "03:45" instead of the trader's "09:15" IST — these
 * helpers pin every tick / crosshair label to the exchange timezone.
 */

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

/** lightweight-charts crosshair time label, formatted in IST (date-only when daily). */
export function formatISTCrosshair(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  if (isISTMidnight(date)) return dateFmt.format(date);
  return `${dayMonthFmt.format(date)}, ${timeFmt.format(date)}`;
}
