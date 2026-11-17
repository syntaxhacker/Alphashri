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

/** Axis tick labels — requested zone (default IST), granularity-aware. */
export function tvTickMarkFormatter(
  time: Time,
  tickMarkType: TickMarkType,
  timeZone: string = MARKET_TIME_ZONE.india,
): string {
  if (typeof time !== "number") return "";
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
