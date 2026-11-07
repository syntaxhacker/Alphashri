import { TickMarkType, type Time } from "lightweight-charts";
import { formatISTCrosshair, formatISTTick } from "@/utils/istChartTime";

/**
 * lightweight-charts time-axis formatters shared by the replay chart and the
 * pattern chart. The library renders `UTCTimestamp` values in UTC by default,
 * so both callbacks pin every label to IST via `istChartTime`.
 */

/** Crosshair time label — IST. */
export function tvTimeFormatter(time: Time): string {
  return typeof time === "number" ? formatISTCrosshair(time) : "";
}

/** Axis tick labels — IST, granularity-aware. */
export function tvTickMarkFormatter(time: Time, tickMarkType: TickMarkType): string {
  if (typeof time !== "number") return "";
  switch (tickMarkType) {
    case TickMarkType.Year:
      return formatISTTick(time, "year");
    case TickMarkType.Month:
      return formatISTTick(time, "month");
    case TickMarkType.DayOfMonth:
      return formatISTTick(time, "day");
    case TickMarkType.TimeWithSeconds:
      return formatISTTick(time, "timeSeconds");
    default:
      return formatISTTick(time, "time");
  }
}
