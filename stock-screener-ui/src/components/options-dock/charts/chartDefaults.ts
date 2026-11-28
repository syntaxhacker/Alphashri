import { onCleanup } from "solid-js";
import { typeSize } from "@/ui";
import * as palette from "@/ui/palette";

/**
 * The pieces of the ECharts lifecycle and option skeleton that are identical in
 * the dock's two canvas cores (payoff and analytics). Host-specific behaviour —
 * the recompute gate, ResizeObserver coalescing, empty-state chrome — stays in
 * the host; only the shared init/paint/dispose calls and the option defaults
 * live here.
 */

/** Canvas labels cannot resolve `var(...)`; both cores read the same token. */
export { chartMutedInk, useChartInk } from "../analytics/chartInk";

/** Chart text floor: a sub-10px tick vanishes in the 206px analytics band. */
export const CHART_LABEL_FONT_SIZE = typeSize("micro");

export const CANVAS_RENDERER = { renderer: "canvas" } as const;
export const SET_OPTION_OPTS = { notMerge: false, lazyUpdate: true } as const;

/** A late loader result must never revive a disposed host. */
export function initCanvasChart(
  lib: any,
  el: HTMLElement | undefined,
  isStale: () => boolean,
): any {
  if (isStale() || !lib || !el) return null;
  return lib.init(el, undefined, CANVAS_RENDERER);
}

export function setChartOption(chart: any, option: unknown): void {
  if (!chart) return;
  chart.setOption(option, SET_OPTION_OPTS);
}

export function disposeCanvasChart(chart: any): null {
  chart?.dispose();
  return null;
}

export function onWindowResize(handler: () => void): void {
  window.addEventListener("resize", handler);
  onCleanup(() => window.removeEventListener("resize", handler));
}

/** Shared option defaults — assigned by reference, never mutated by a host. */
export const CHART_BASE = { animation: false, backgroundColor: "transparent" } as const;
export const AXIS_LINE = { lineStyle: { color: palette.AXIS_LINE } } as const;
export const AXIS_TICK_OFF = { show: false } as const;
export const AXIS_SPLIT = { lineStyle: { color: palette.AXIS_SPLIT } } as const;

export function axisLabelInk(ink: string) {
  return { color: ink, fontSize: CHART_LABEL_FONT_SIZE };
}

/** The tooltip chrome is identical in the payoff and all three analytics plots. */
export const TOOLTIP_BASE = {
  backgroundColor: palette.TOOLTIP_BG,
  borderColor: palette.TOOLTIP_BORDER,
  textStyle: { color: palette.OPTION_PAYOFF_TOOLTIP_TEXT, fontSize: CHART_LABEL_FONT_SIZE },
} as const;
