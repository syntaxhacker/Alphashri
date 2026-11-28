import { describe, expect, test, vi } from "vitest";
import { typeSize } from "@/ui";
import * as palette from "@/ui/palette";
import {
  AXIS_LINE,
  AXIS_SPLIT,
  AXIS_TICK_OFF,
  CANVAS_RENDERER,
  CHART_BASE,
  CHART_LABEL_FONT_SIZE,
  SET_OPTION_OPTS,
  TOOLTIP_BASE,
  axisLabelInk,
  disposeCanvasChart,
  initCanvasChart,
  setChartOption,
} from "./chartDefaults";

describe("shared chart defaults", () => {
  test("keep the option values the cores used inline", () => {
    expect(CHART_LABEL_FONT_SIZE).toBe(typeSize("micro"));
    expect(CHART_BASE).toEqual({ animation: false, backgroundColor: "transparent" });
    expect(AXIS_LINE).toEqual({ lineStyle: { color: palette.AXIS_LINE } });
    expect(AXIS_TICK_OFF).toEqual({ show: false });
    expect(AXIS_SPLIT).toEqual({ lineStyle: { color: palette.AXIS_SPLIT } });
    expect(axisLabelInk("ink")).toEqual({ color: "ink", fontSize: typeSize("micro") });
    expect(TOOLTIP_BASE).toEqual({
      backgroundColor: palette.TOOLTIP_BG,
      borderColor: palette.TOOLTIP_BORDER,
      textStyle: {
        color: palette.OPTION_PAYOFF_TOOLTIP_TEXT,
        fontSize: typeSize("micro"),
      },
    });
  });
});

describe("shared ECharts lifecycle calls", () => {
  test("init uses the canvas renderer on the live element only", () => {
    const el = {} as HTMLElement;
    const instance = {};
    const init = vi.fn(() => instance);
    expect(initCanvasChart({ init }, el, () => false)).toBe(instance);
    expect(init).toHaveBeenCalledWith(el, undefined, { renderer: "canvas" });

    init.mockClear();
    expect(initCanvasChart({ init }, el, () => true)).toBeNull();
    expect(initCanvasChart({ init }, undefined, () => false)).toBeNull();
    expect(initCanvasChart(null, el, () => false)).toBeNull();
    expect(init).not.toHaveBeenCalled();
  });

  test("paint and dispose use the same merge flags both cores used", () => {
    const setOption = vi.fn();
    const dispose = vi.fn();
    const chart = { setOption, dispose };
    const option = { title: { text: "x" } };

    setChartOption(chart, option);
    expect(setOption).toHaveBeenCalledWith(option, { notMerge: false, lazyUpdate: true });

    expect(CANVAS_RENDERER).toEqual({ renderer: "canvas" });
    expect(SET_OPTION_OPTS).toEqual({ notMerge: false, lazyUpdate: true });
    expect(disposeCanvasChart(chart)).toBeNull();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
