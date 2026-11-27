import { typeSize } from "@/ui";
/**
 * Shared ECharts option fragments for the dashboard panels. 2D only — the heat
 * maps use ECharts' built-in `heatmap`, nothing imports `echarts-gl`. All colours
 * come from the palette's single source; canvas ink is read from the resolved
 * theme by `chartMutedInk` so a scheme flip repaints the labels.
 */

import * as palette from "@/ui/palette";

/** Tick, axis-name and legend ink. 9px was unreadable on a 1600px canvas. */
export const CHART_LABEL_SIZE = typeSize("micro");

/**
 * Wide grid. The legend owns the top band, the wall-mark labels take two
 * staggered rows under it, and the x-axis name sits below the tick labels.
 *
 * The left inset is a real gutter, not a label shelf: ECharts grows the plot to
 * `left + tickBand + labelMargin` while the tick band fits, so the labels start
 * at `left`. When the band is wider than the canvas can afford, the plot is
 * pulled back to `tickBand + labelMargin` and the labels start at column 0 —
 * the max-pain axis did exactly that at 390px, where "1,200,000,000" is 13
 * glyphs ≈ 78.4px and the first glyph landed on the frame edge. The fix is at
 * the axis, not here: value axes whose ticks reach 10^5+ pass `formatCompact`
 * (7 glyphs ≈ 35.7px, measured), which keeps the band inside `left`. Raising
 * `left` instead only spends plot width (measured at 376px: left 64 → 68.7%
 * plot, left 14 → 82%). The y-axis unit is drawn horizontally above the plot's
 * top-left corner (see `ChartFrame`) because a rotated name cannot coexist with
 * a tick band that grows with the numbers.
 */
export const CHART_GRID = {
  left: 20,
  right: 14,
  top: 56,
  bottom: 32,
  containLabel: true,
} as const;

/**
 * At a narrow viewport the frame is ~376px wide, so the insets shrink. The top
 * band stays tall enough for the legend plus the two mark-label rows, and the
 * 14px left gutter still clears a compact 7-glyph tick (measured plot: 376 − 14
 * − 35.7 − 8 − 10 = 308px, 82% of the frame).
 */
export const COMPACT_CHART_GRID = {
  left: 14,
  right: 10,
  top: 54,
  bottom: 30,
  containLabel: true,
} as const;

export function baseOption(ink: string): Record<string, unknown> {
  return {
    animation: false,
    backgroundColor: "transparent",
    textStyle: { color: ink, fontFamily: palette.MONO, fontSize: CHART_LABEL_SIZE },
  };
}

export function axis(
  ink: string,
  name: string,
  options: {
    type?: "value" | "category";
    data?: unknown[];
    nameGap?: number;
    min?: number | "dataMin";
    max?: number | "dataMax";
    /** Zoom a value axis to the data instead of anchoring it at zero. */
    scale?: boolean;
    /**
     * Tick-label formatting only. A compact formatter caps the label band, which
     * is what keeps a wide value ("1,200,000,000") off the frame's left edge; the
     * series keeps its raw numbers, so the tooltip still shows the full value.
     */
    formatter?: (value: number) => string;
  } = {},
): Record<string, unknown> {
  const type = options.type ?? "value";
  return {
    type,
    name,
    nameLocation: "middle",
    // The x-axis name sits under the tick labels; `ChartFrame` lifts a y-axis
    // name out of the canvas entirely (see `yAxisUnit`).
    nameGap: options.nameGap ?? 34,
    nameTextStyle: { color: ink, fontSize: CHART_LABEL_SIZE },
    ...(options.data ? { data: options.data } : {}),
    ...(options.min != null ? { min: options.min } : {}),
    ...(options.max != null ? { max: options.max } : {}),
    ...(options.scale ? { scale: true } : {}),
    axisLine: { lineStyle: { color: palette.AXIS_LINE } },
    axisTick: { show: false },
    axisLabel: {
      color: ink,
      fontSize: CHART_LABEL_SIZE,
      // The dense-tick strategy: a tick that cannot fit is dropped, never
      // overprinted. No rotation, so nothing spills outside the frame.
      interval: "auto",
      hideOverlap: true,
      ...(options.formatter ? { formatter: options.formatter } : {}),
    },
    splitLine: { show: type === "value", lineStyle: { color: palette.AXIS_SPLIT, type: "dashed" } },
  };
}

/**
 * Value-axis bounds that hug the data with ~5% padding. Anchoring a strike axis
 * at zero wasted 40% of the plot on the analytics page — every strike ladder
 * starts well above 0 — and a strike domain never needs a zero origin. The pad
 * is at least half a strike step so the outermost bar is not clipped.
 */
export function paddedDomain(
  values: Array<number | null | undefined>,
  padPct = 0.05,
): { min?: number; max?: number } {
  const unique = [...new Set(values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)))]
    .sort((a, b) => a - b);
  if (unique.length === 0) return {};
  if (unique.length === 1) return { min: unique[0] * 0.95, max: unique[0] * 1.05 };
  const lo = unique[0];
  const hi = unique[unique.length - 1];
  const steps = unique.slice(1).map((value, index) => value - unique[index]).sort((a, b) => a - b);
  const step = steps[Math.floor(steps.length / 2)] ?? 0;
  const pad = Math.max((hi - lo) * padPct, step / 2);
  // ECharts prints the exact bounds as the first/last tick, so an unrounded
  // domain labels the axis "60.1 … 101.9". Strike ladders are integers.
  const span = hi - lo;
  if (span >= 5) return { min: Math.floor(lo - pad), max: Math.ceil(hi + pad) };
  const round = (value: number) => Number(value.toFixed(2));
  return { min: round(lo - pad), max: round(hi + pad) };
}

export function tooltip(): Record<string, unknown> {
  return {
    trigger: "axis",
    backgroundColor: palette.TOOLTIP_BG,
    borderColor: palette.TOOLTIP_BORDER,
    borderWidth: 1,
    textStyle: { color: palette.TOOLTIP_TEXT, fontSize: typeSize("micro") },
    axisPointer: { type: "line", lineStyle: { color: palette.CHART_CROSSHAIR } },
  };
}

/**
 * Legend lives in the top band, above the plot and the wall-mark labels. It is
 * right-aligned so the frame's top-left corner stays free for the y-axis unit
 * (`ChartFrame` renders it as DOM text). The bottom is reserved for the x-axis
 * name, which the old bottom legend used to overprint.
 */
export function legend(ink: string, data: string[]): Record<string, unknown> {
  return {
    data,
    top: 0,
    right: 8,
    itemWidth: 10,
    itemHeight: 6,
    itemGap: 10,
    textStyle: { color: ink, fontSize: CHART_LABEL_SIZE },
  };
}

export interface Mark {
  xAxis: number;
  name: string;
  color: string;
  label?: string;
}

/**
 * Vertical level rails (walls, spot, flip). Neighbouring strikes are often a
 * few points apart, so the labels cycle through three rows inside the top
 * band — `distance` is `[x, y]` and a vertical markLine's label is anchored
 * above the plot, so a positive `y` lifts it by that many pixels. Rows are
 * assigned after sorting by strike, otherwise a mark that arrives late in the
 * list (SPOT) lands in the same row as the wall it sits next to.
 */
export function guideSeries(ink: string, marks: Mark[]): Record<string, unknown> {
  const rows = new Map<number, number>();
  marks
    .map((mark, index) => ({ mark, index }))
    .sort((a, b) => a.mark.xAxis - b.mark.xAxis)
    .forEach((entry, rank) => rows.set(entry.index, rank % 3));
  return {
    name: "marks",
    type: "line",
    data: [],
    silent: true,
    markLine: {
      silent: true,
      symbol: "none",
      data: marks.map((mark, index) => ({
        xAxis: mark.xAxis,
        name: mark.name,
        lineStyle: { color: mark.color, width: 1, type: "dashed" as const },
        label: {
          show: true,
          formatter: mark.label ?? mark.name,
          // `end` keeps the label horizontal (an `inside*` position rotates it
          // 90° on a vertical line) while still anchoring it above the plot.
          position: "end" as const,
          distance: [0, 2 + (rows.get(index) ?? 0) * 13],
          color: ink,
          fontSize: CHART_LABEL_SIZE,
          backgroundColor: palette.SURFACE,
          padding: [1, 3],
          borderRadius: 2,
        },
      })),
    },
  };
}

export const WALL_COLOR: Record<string, string> = {
  CW: palette.LEVEL_CALL_WALL,
  PW: palette.LEVEL_PUT_WALL,
  MP: palette.LEVEL_MAX_PAIN,
  SUP: palette.LEVEL_SUPPORT,
  RES: palette.LEVEL_RESISTANCE,
};
