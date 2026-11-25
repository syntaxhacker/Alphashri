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

/** Minimum gap between a tick label's rendered box and either pane edge. */
export const TICK_EDGE_PADDING_PX = 8;
/** Average glyph width of the library's 12 px axis font (estimate only). */
const TICK_CHAR_WIDTH_PX = 6.5;

export interface TvTickEdgeContext {
  /** Tick centre in time-pane CSS pixels, or null when not resolvable. */
  x?: number | null;
  /** Time-pane width in CSS pixels (excludes the price scale). */
  paneWidth?: number | null;
  /** Optional label measurer; falls back to an average-glyph estimate. */
  measureText?: (text: string) => number;
}

/**
 * True when a tick label centred at `x` would touch or cross either pane edge.
 * Zooming removes the initial fit's padding, so the library can otherwise draw
 * a half-clipped edge label (e.g. `15` rendered as a lone `1`). The check uses
 * the label's measured (or estimated) width plus a small safety gutter.
 */
export function isTickLabelAtPaneEdge(
  label: string,
  edge: TvTickEdgeContext,
  paddingPx: number = TICK_EDGE_PADDING_PX,
): boolean {
  const { x, paneWidth, measureText } = edge;
  if (!label || x == null || paneWidth == null) return false;
  if (!Number.isFinite(x) || !Number.isFinite(paneWidth) || paneWidth <= 0) return false;
  const width = measureText
    ? Math.max(0, measureText(label))
    : label.length * TICK_CHAR_WIDTH_PX;
  const margin = width / 2 + paddingPx;
  return x < margin || x > paneWidth - margin;
}

export interface TvTickFormatContext extends TvTickEdgeContext {
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
  let label: string;
  if (
    coarseMultiMonth &&
    (tickMarkType === TickMarkType.DayOfMonth ||
      tickMarkType === TickMarkType.Time ||
      tickMarkType === TickMarkType.TimeWithSeconds)
  ) {
    label = formatISTTick(time, "month", timeZone);
  } else {
    switch (tickMarkType) {
      case TickMarkType.Year:
        label = formatISTTick(time, "year", timeZone);
        break;
      case TickMarkType.Month:
        label = formatISTTick(time, "month", timeZone);
        break;
      case TickMarkType.DayOfMonth:
        label = formatISTTick(time, "day", timeZone);
        break;
      case TickMarkType.TimeWithSeconds:
        label = formatISTTick(time, "timeSeconds", timeZone);
        break;
      default:
        label = formatISTTick(time, "time", timeZone);
        break;
    }
  }
  // Once the user zooms/pans, the initial fit's edge padding is gone; drop a
  // tick whose label would be rendered as a clipped fragment at either edge.
  return context && isTickLabelAtPaneEdge(label, context) ? "" : label;
}
