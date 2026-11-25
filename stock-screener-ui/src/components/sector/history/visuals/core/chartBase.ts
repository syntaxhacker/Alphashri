/**
 * ECharts option scaffolding for the sector-history visuals.
 *
 * These fragments are deliberately history-specific: the sector-history charts
 * share one dark tooltip, one axis ink and one small-multiple grid, while the
 * options dashboard keeps its own `components/options-dashboard/chartBase.ts`.
 * Nothing here paints a raw colour — every value comes from `@/ui/palette` or
 * the history palette in `../chartPalette`.
 *
 * Consumers spread the fragment, then add the per-chart keys (`gridIndex`,
 * `inverse`, `name`, …) they need. Returning plain records keeps the helpers
 * usable from both `build*Option` model functions and component tests.
 */

import {
  MONO,
  TEXT,
  TOOLTIP_BG,
  TOOLTIP_BORDER,
  TOOLTIP_TEXT,
  CHART_CROSSHAIR,
} from "@/ui/palette";
import { typeSize } from "@/ui/typography";
import { CHART_MUTED, CHART_NEUTRAL } from "../chartPalette";

/** Dense chart chrome shares the 12px typography floor with the rest of the UI. */
const LABEL_FONT = typeSize("micro");

/** Plot insets for a history chart with a value gutter on the left. */
export const GRID_LEFT = 52;
export const GRID_RIGHT = 20;
export const GRID_TOP = 8;

/** Room under the last small multiple for the shared month axis. */
export const GRID_AXIS_BAND = 26;

const YEAR_PATTERN = /^(\d{4})-/;

function yearOf(month: string): string | null {
  return YEAR_PATTERN.exec(month)?.[1] ?? null;
}

/**
 * Base option for every sector-history ECharts surface: no entrance animation
 * (the panels re-render on a poll), a transparent canvas over the panel, and an
 * aria description so the chart is not a silent rectangle to a screen reader.
 */
export function baseOption(description: string): Record<string, unknown> {
  return {
    animation: false,
    backgroundColor: "transparent",
    textStyle: {
      color: TEXT,
      fontFamily: MONO,
      fontSize: LABEL_FONT,
    },
    aria: {
      enabled: true,
      label: { description },
    },
  };
}

export interface CategoryAxisOptions {
  data: string[];
  /** Rank axes run top-down; month axes keep the natural left-to-right order. */
  inverse?: boolean;
  /** Hidden in the upper rows of a small multiple; the last row carries the axis. */
  showLabels?: boolean;
  formatter?: (value: string, index: number) => string;
}

/**
 * Month/rank category axis. `boundaryGap: false` is the line-chart default used
 * by the history panels; a bar consumer can spread-override it. Suppressing the
 * labels also suppresses the axis line, so a stacked small multiple does not
 * draw a spine between rows.
 */
export function categoryAxis(options: CategoryAxisOptions): Record<string, unknown> {
  const showLabels = options.showLabels !== false;
  return {
    type: "category",
    data: options.data,
    inverse: options.inverse ?? false,
    boundaryGap: false,
    axisLine: {
      show: showLabels,
      lineStyle: { color: CHART_MUTED, opacity: 0.45 },
    },
    axisTick: { show: false },
    axisLabel: {
      show: showLabels,
      color: CHART_MUTED,
      fontSize: LABEL_FONT,
      hideOverlap: true,
      ...(options.formatter ? { formatter: options.formatter } : {}),
    },
    splitLine: { show: false },
  };
}

export interface ValueAxisOptions {
  min?: number | "dataMin" | "dataMax";
  max?: number | "dataMin" | "dataMax";
  inverse?: boolean;
  name?: string;
  interval?: number;
  formatter?: (value: number, index: number) => string;
}

export interface NiceAxis {
  min: number;
  max: number;
  interval: number;
}

/**
 * Integer-friendly bounds/step so value axes never round two ticks to the same
 * label. `minimumStep` keeps a narrow domain (e.g. an RS index hugging 100) on
 * whole-unit ticks instead of half-units that collapse in a 0-decimal formatter.
 */
export function niceAxis(min: number, max: number, targetTicks = 6, minimumStep = 0): NiceAxis {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) {
    return { min: 0, max: 1, interval: 1 };
  }
  const raw = (max - min) / Math.max(2, targetTicks);
  const power = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / power;
  // 1/2/5 keeps every integer minimumStep on an integer multiple; a 2.5 step
  // would let a 0-decimal formatter print an uneven 3-2-3 tick rhythm.
  const nice = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power;
  const step = Number.isFinite(minimumStep) && minimumStep > 0 ? Math.max(nice, minimumStep) : nice;
  const lower = Math.floor(min / step) * step;
  const upper = Math.ceil(max / step) * step;
  return {
    min: Number(lower.toFixed(6)),
    max: Number(upper.toFixed(6)),
    interval: Number(step.toFixed(6)),
  };
}

/**
 * Value axis with the history ink hierarchy: no axis line, faint neutral
 * splitters, and a muted unit label. Bounds are passed through verbatim because
 * the callers already own their domain maths (`buildDrawdownAxis`, padded
 * ratios, …); `0` is a valid bound and must survive the spread.
 */
export function valueAxis(options: ValueAxisOptions = {}): Record<string, unknown> {
  return {
    type: "value",
    inverse: options.inverse ?? false,
    ...(options.min != null ? { min: options.min } : {}),
    ...(options.max != null ? { max: options.max } : {}),
    ...(options.interval != null ? { interval: options.interval } : {}),
    ...(options.name
      ? {
          name: options.name,
          nameLocation: "middle",
          nameGap: 32,
          nameTextStyle: { color: CHART_MUTED, fontSize: LABEL_FONT },
        }
      : {}),
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      color: CHART_MUTED,
      fontSize: LABEL_FONT,
      hideOverlap: true,
      ...(options.formatter ? { formatter: options.formatter } : {}),
    },
    splitLine: {
      show: true,
      lineStyle: { color: CHART_NEUTRAL, opacity: 0.16 },
    },
  };
}

/**
 * One dark tooltip for every history chart. ECharts falls back to a white
 * popover when a chart omits these keys, which is how the four lab charts
 * ended up with light tooltips on the black canvas. The axis variant adds the
 * shared crosshair; item tooltips stay pointer-only.
 */
export function tooltipStyle<T = unknown>(
  trigger: "item" | "axis",
  formatter?: (params: T) => string,
): Record<string, unknown> {
  return {
    trigger,
    confine: true,
    backgroundColor: TOOLTIP_BG,
    borderColor: TOOLTIP_BORDER,
    borderWidth: 1,
    textStyle: {
      color: TOOLTIP_TEXT,
      fontFamily: MONO,
      fontSize: LABEL_FONT,
    },
    ...(trigger === "axis"
      ? { axisPointer: { type: "line", lineStyle: { color: CHART_CROSSHAIR } } }
      : {}),
    ...(formatter ? { formatter } : {}),
  };
}

export interface YearMark {
  xAxis: string;
  name: string;
  label: { formatter: string };
}

/**
 * Vertical separators at the first month of each new year. The first month of
 * the series is not a separator, so it is skipped even when it is January; a
 * malformed month cannot anchor a line and is ignored. The x positions are the
 * category values themselves (`"2024-01"`), which ECharts resolves on a
 * category axis.
 */
export function yearMarkLine(months: string[]): Record<string, unknown> {
  const data: YearMark[] = [];
  for (let index = 1; index < months.length; index++) {
    const year = yearOf(months[index]);
    const previousYear = yearOf(months[index - 1]);
    if (!year || !previousYear || year === previousYear) continue;
    data.push({
      xAxis: months[index],
      name: year,
      label: { formatter: year },
    });
  }

  return {
    silent: true,
    symbol: "none",
    animation: false,
    lineStyle: { color: CHART_MUTED, type: "dashed", width: 1, opacity: 0.45 },
    label: {
      show: true,
      // `end` keeps a label on a vertical line horizontal; an `inside*`
      // position rotates it 90° and the year reads sideways.
      position: "end",
      distance: [0, 2],
      color: CHART_MUTED,
      fontSize: LABEL_FONT,
    },
    data,
  };
}

/**
 * Grid slot for one row of a small multiple. The canvas must be
 * `top + rows * rowHeight + GRID_AXIS_BAND` tall; each grid then resolves to
 * exactly `rowHeight` because its bottom reserves the remaining rows plus the
 * axis band. Passing the count (`rows`) rather than pre-computed bounds keeps
 * the call sites from repeating the arithmetic.
 */
export function gridFor(
  index: number,
  rows: number,
  rowHeight: number,
  top = GRID_TOP,
): Record<string, unknown> {
  const totalRows = Math.max(1, rows);
  return {
    left: GRID_LEFT,
    right: GRID_RIGHT,
    top: top + index * rowHeight,
    bottom: (totalRows - 1 - index) * rowHeight + GRID_AXIS_BAND,
    containLabel: false,
  };
}
