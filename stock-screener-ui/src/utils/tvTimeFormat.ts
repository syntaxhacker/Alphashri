import { TickMarkType, type Time } from "lightweight-charts";
import { MARKET_TIME_ZONE } from "@/utils/chart/time";
import { formatISTCrosshair, formatISTTick } from "@/utils/istChartTime";

/**
 * lightweight-charts time-axis formatters shared by the replay chart and the
 * pattern chart. The library renders `UTCTimestamp` values in UTC by default,
 * so both callbacks pin every label to the requested session zone (default IST).
 * A caller that knows the market's zone passes it as the last argument.
 */

/** Crosshair time label — requested zone (default IST). */
export function tvTimeFormatter(time: Time, timeZone: string = MARKET_TIME_ZONE.india): string {
  return typeof time === "number" ? formatISTCrosshair(time, timeZone) : "";
}

export interface TvTickFormatContext {
  /** Chart timeframe (`3h`/`4h` get month labels on multi-month views). */
  timeframe?: string | null;
  /** True when the visible window spans multiple months. */
  multiMonth?: boolean;
}

const COARSE_INTRADAY_TIMEFRAMES = new Set(["3h", "4h"]);

/**
 * Axis tick labels — requested zone (default IST), granularity-aware.
 *
 * A 3h/4h chart scrolled out to months still emits day/hour tick weights, which
 * would mix `12:00`/`02` among month ticks. In that view the day/time kinds are
 * promoted to the month label; zoomed into days they keep their normal
 * day/time formatting.
 */
export function tvTickMarkFormatter(
  time: Time,
  tickMarkType: TickMarkType,
  timeZone: string = MARKET_TIME_ZONE.india,
  context?: TvTickFormatContext,
): string {
  if (typeof time !== "number") return "";
  const coarseMultiMonth =
    context?.multiMonth === true &&
    context.timeframe != null &&
    COARSE_INTRADAY_TIMEFRAMES.has(context.timeframe);
  if (
    coarseMultiMonth &&
    (tickMarkType === TickMarkType.DayOfMonth ||
      tickMarkType === TickMarkType.Time ||
      tickMarkType === TickMarkType.TimeWithSeconds)
  ) {
    return formatISTTick(time, "month", timeZone);
  }
  switch (tickMarkType) {
    case TickMarkType.Year:
      return formatISTTick(time, "year", timeZone);
    case TickMarkType.Month:
      return formatISTTick(time, "month", timeZone);
    case TickMarkType.DayOfMonth:
      return formatISTTick(time, "day", timeZone);
    case TickMarkType.TimeWithSeconds:
      return formatISTTick(time, "timeSeconds", timeZone);
    default:
      return formatISTTick(time, "time", timeZone);
  }
}
