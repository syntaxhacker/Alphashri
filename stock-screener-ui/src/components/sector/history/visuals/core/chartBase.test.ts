// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CHART_CROSSHAIR,
  MONO,
  TEXT,
  TOOLTIP_BG,
  TOOLTIP_BORDER,
  TOOLTIP_TEXT,
} from "@/ui/palette";
import { typeSize } from "@/ui/typography";
import { CHART_MUTED, CHART_NEUTRAL } from "../chartPalette";
import {
  GRID_AXIS_BAND,
  GRID_LEFT,
  GRID_RIGHT,
  GRID_TOP,
  baseOption,
  categoryAxis,
  gridFor,
  tooltipStyle,
  valueAxis,
  yearMarkLine,
} from "./chartBase";

type Dict = Record<string, any>;

const asDict = (value: unknown): Dict => value as Dict;
const asGrid = (
  value: unknown,
): { left: number; right: number; top: number; bottom: number; containLabel: boolean } =>
  value as { left: number; right: number; top: number; bottom: number; containLabel: boolean };

const MONTHS = ["2023-11", "2023-12", "2024-01", "2024-02", "2024-03", "2024-04"];

describe("baseOption", () => {
  it("disables animation and paints over the panel instead of a white canvas", () => {
    const option = baseOption("Rank history by sector.");
    expect(option.animation).toBe(false);
    expect(option.backgroundColor).toBe("transparent");
    expect(asDict(option.textStyle)).toMatchObject({
      color: TEXT,
      fontFamily: MONO,
      fontSize: typeSize("micro"),
    });
  });

  it("turns the description into the aria label readers announce", () => {
    const aria = asDict(baseOption("Each row is a sector; higher is stronger.").aria);
    expect(aria.enabled).toBe(true);
    expect(asDict(aria.label).description).toBe("Each row is a sector; higher is stronger.");
  });
});

describe("categoryAxis", () => {
  it("keeps the category order and formats ticks at the micro floor", () => {
    const axis = categoryAxis({
      data: MONTHS,
      formatter: (value, index) => (index === 0 ? value : value.slice(5)),
    });
    expect(axis.type).toBe("category");
    expect(axis.data).toEqual(MONTHS);
    expect(axis.inverse).toBe(false);
    expect(axis.boundaryGap).toBe(false);

    const label = asDict(axis.axisLabel);
    expect(label.formatter("2023-11", 0)).toBe("2023-11");
    expect(label.formatter("2024-02", 3)).toBe("02");
    expect(label.color).toBe(CHART_MUTED);
    expect(label.fontSize).toBe(typeSize("micro"));
    expect(label.hideOverlap).toBe(true);
    expect(asDict(axis.axisTick).show).toBe(false);
  });

  it("can hide the label and the spine together for upper small-multiple rows", () => {
    const axis = categoryAxis({ data: MONTHS, showLabels: false });
    expect(asDict(axis.axisLabel).show).toBe(false);
    expect(asDict(axis.axisLine).show).toBe(false);
    expect(asDict(categoryAxis({ data: MONTHS }).axisLine).show).toBe(true);
  });

  it("inverts a category axis when the caller asks for a top-down rank order", () => {
    expect(categoryAxis({ data: MONTHS, inverse: true }).inverse).toBe(true);
  });
});

describe("valueAxis", () => {
  it("passes a zero bound through instead of dropping it as falsy", () => {
    const axis = valueAxis({ min: 0, max: 0, inverse: true, name: "Drawdown" });
    expect(axis.min).toBe(0);
    expect(axis.max).toBe(0);
    expect(axis.inverse).toBe(true);
    expect(axis.name).toBe("Drawdown");
    expect(asDict(axis.nameTextStyle).color).toBe(CHART_MUTED);
    expect(asDict(axis.nameTextStyle).fontSize).toBe(typeSize("micro"));
  });

  it("formats ticks and keeps the history splitter ink", () => {
    const axis = valueAxis({ formatter: (value) => `${value.toFixed(1)}%` });
    expect(asDict(axis.axisLabel).formatter(-4.25)).toBe("-4.3%");
    expect(asDict(axis.axisLabel).color).toBe(CHART_MUTED);
    expect(asDict(axis.axisLabel).fontSize).toBe(typeSize("micro"));
    expect(asDict(axis.axisLine).show).toBe(false);
    expect(asDict(axis.axisTick).show).toBe(false);
    expect(asDict(asDict(axis.splitLine).lineStyle).color).toBe(CHART_NEUTRAL);
  });

  it("omits bounds and the name when the caller does not supply them", () => {
    const axis = valueAxis();
    expect("min" in axis).toBe(false);
    expect("max" in axis).toBe(false);
    expect("name" in axis).toBe(false);
    expect("nameTextStyle" in axis).toBe(false);
  });
});

describe("tooltipStyle", () => {
  it("uses the raised dark surface and readable ink, not the ECharts white default", () => {
    const tip = tooltipStyle("item");
    expect(tip.trigger).toBe("item");
    expect(tip.confine).toBe(true);
    expect(tip.backgroundColor).toBe(TOOLTIP_BG);
    expect(tip.borderColor).toBe(TOOLTIP_BORDER);
    expect(tip.borderWidth).toBe(1);

    const text = asDict(tip.textStyle);
    expect(text.color).toBe(TOOLTIP_TEXT);
    expect(text.fontFamily).toBe(MONO);
    expect(text.fontSize).toBe(typeSize("micro"));
    expect(tip.axisPointer).toBeUndefined();
  });

  it("adds the shared crosshair and the formatter for axis tooltips", () => {
    const formatter = (params: { axisValue?: string }) => params.axisValue ?? "";
    const tip = tooltipStyle("axis", formatter);
    expect(tip.formatter).toBe(formatter);
    expect(asDict(asDict(tip.axisPointer).lineStyle).color).toBe(CHART_CROSSHAIR);
  });
});

describe("yearMarkLine", () => {
  it("anchors one separator at the first month of every later year", () => {
    const mark = yearMarkLine(MONTHS);
    const data = mark.data as Array<{ xAxis: string; name: string; label: { formatter: string } }>;
    expect(data.map((item) => item.xAxis)).toEqual(["2024-01"]);
    expect(data.map((item) => item.name)).toEqual(["2024"]);
    expect(data[0].label.formatter).toBe("2024");
  });

  it("does not draw a separator on the first month, even when it is January", () => {
    const data = yearMarkLine(["2024-01", "2024-02", "2024-03"]).data as unknown[];
    expect(data).toEqual([]);
    expect(yearMarkLine([]).data).toEqual([]);
  });

  it("styles the separators with muted dashed ink and a micro label", () => {
    const mark = yearMarkLine(["2024-12", "2025-01"]);
    expect(mark.silent).toBe(true);
    expect(mark.symbol).toBe("none");
    expect(asDict(mark.lineStyle).color).toBe(CHART_MUTED);
    expect(asDict(mark.lineStyle).type).toBe("dashed");
    expect(asDict(mark.label).color).toBe(CHART_MUTED);
    expect(asDict(mark.label).fontSize).toBe(typeSize("micro"));
    // `inside*` would rotate the year label 90° on a vertical separator.
    expect(asDict(mark.label).position).toBe("end");
  });

  it("skips malformed months instead of anchoring a line at NaN", () => {
    const data = yearMarkLine(["2024-12", "n/a", "2025-01"]).data as unknown[];
    expect(data).toEqual([]);
  });
});

describe("gridFor", () => {
  it("stacks rows and leaves exactly the axis band under the last one", () => {
    const rows = 3;
    const rowHeight = 24;
    const top = 4;
    const canvasHeight = top + rows * rowHeight + GRID_AXIS_BAND;
    const grids = [0, 1, 2].map((index) => asGrid(gridFor(index, rows, rowHeight, top)));

    expect(grids.map((grid) => grid.top)).toEqual([4, 28, 52]);
    expect(grids.map((grid) => canvasHeight - grid.top - grid.bottom)).toEqual([24, 24, 24]);
    expect(grids[2].bottom).toBe(GRID_AXIS_BAND);
  });

  it("uses the shared insets, default top and a fixed-label grid", () => {
    const grid = asGrid(gridFor(0, 1, 24));
    expect(grid.left).toBe(GRID_LEFT);
    expect(grid.right).toBe(GRID_RIGHT);
    expect(grid.top).toBe(GRID_TOP);
    expect(grid.bottom).toBe(GRID_AXIS_BAND);
    expect(grid.containLabel).toBe(false);
  });
});
