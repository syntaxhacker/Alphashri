// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as palette from "@/ui/palette";
import {
  buildDistributionOption,
  buildEdaOption,
  buildHeatmapOption,
  buildRollingOption,
  buildSeasonalityOption,
  buildSupplyDemandOption,
  type EdaBox,
  type EdaHeatmapRow,
  type EdaScatter,
  type EdaSeriesPoint,
} from "./agriEdaOptions";

type Option = Record<string, unknown>;
type Series = Record<string, unknown>;
type Formatter = (params: unknown) => string;

const seriesOf = (option: Option): Series[] => (option.series as Series[]) ?? [];
const formatterOf = (option: Option): Formatter => (option.tooltip as { formatter: Formatter }).formatter;
const axisOf = (option: Option, index = 0): Series => (option.xAxis as Series[])[index];
const yAxisOf = (option: Option, index = 0): Series => (option.yAxis as Series[])[index];

function fontSizes(value: unknown, found: number[] = []): number[] {
  if (Array.isArray(value)) {
    for (const entry of value) fontSizes(entry, found);
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === "fontSize" && typeof entry === "number") found.push(entry);
      else fontSizes(entry, found);
    }
  }
  return found;
}

const boxes: EdaBox[] = [
  { month: "2024-01", label: "Jan", min: 80, q1: 90, median: 100, q3: 110, max: 120, mean: 101, count: 12 },
  { month: "2024-02", label: "Feb", min: 85, q1: 95, median: 105, q3: 115, max: 125, mean: 106, count: 8 },
  { month: "2024-03", label: "Mar", min: 90, q1: 100, median: 110, q3: 120, max: 130, mean: 111, count: 6 },
];

const series: EdaSeriesPoint[] = [
  { date: "2024-01-01", modal: 100, min: 90, max: 110, arrivals_qtl: 500, market_count: 10 },
  { date: "2024-01-02", modal: 120, min: 100, max: 140, arrivals_qtl: 600, market_count: 12 },
  { date: "2024-01-03", modal: 110, min: 100, max: 130, arrivals_qtl: 700, market_count: 11 },
  { date: "2024-01-04", modal: 140, min: 120, max: 160, arrivals_qtl: 800, market_count: 14 },
  { date: "2024-01-05", modal: 130, min: 110, max: 150, arrivals_qtl: 900, market_count: 13 },
  { date: "2024-01-06", modal: 150, min: 130, max: 170, arrivals_qtl: 1000, market_count: 15 },
];

const scatter: EdaScatter = {
  points: [
    { date: "2024-01-01", arrivals_qtl: 500, modal: 260, laggedModal: 250 },
    { date: "2024-01-02", arrivals_qtl: 600, modal: 270, laggedModal: 260 },
    { date: "2024-01-03", arrivals_qtl: 700, modal: 280, laggedModal: 270 },
    { date: "2024-01-04", arrivals_qtl: 800, modal: 300, laggedModal: 280 },
  ],
  pearson: 0.97,
  slope: 0.125,
  intercept: 197.5,
  r2: 0.94,
  n: 4,
};

const rows: EdaHeatmapRow[] = [
  { key: "rice", label: "Rice", months: [{ month: "2024-01", modal: 100 }, { month: "2", modal: 110 }] },
  { key: "wheat", label: "Wheat", months: [{ month: "Jan", modal: 220 }, { month: "Mar", modal: 240 }, { month: "Apr", modal: null }] },
];

describe("shared option contracts", () => {
  it("keeps a transparent background in every builder", () => {
    const options = [
      buildDistributionOption({ boxes }),
      buildSupplyDemandOption({ scatter }),
      buildHeatmapOption({ rows }),
      buildRollingOption({ series, rolling: 3 }),
      buildSeasonalityOption({ seasonality: boxes }),
    ];
    for (const option of options) expect(option.backgroundColor).toBe("transparent");
  });

  it("uses palette tokens for theme-aware text in dark and light modes", () => {
    const dark = buildDistributionOption({ boxes, isDark: true }) as { title: { textStyle: { color: string } } };
    const light = buildDistributionOption({ boxes, isDark: false }) as { title: { textStyle: { color: string } } };
    expect(dark.title.textStyle.color).toBe(palette.CHART_DARK_TEXT);
    expect(light.title.textStyle.color).toBe(palette.CHART_LIGHT_TEXT);
  });

  it("never sets a font below 10px", () => {
    const options = [
      buildDistributionOption({ boxes }),
      buildSupplyDemandOption({ scatter }),
      buildHeatmapOption({ rows }),
      buildRollingOption({ series, rolling: 3 }),
      buildSeasonalityOption({ seasonality: boxes }),
    ];
    for (const option of options) {
      expect(fontSizes(option).every((size) => size >= 10)).toBe(true);
    }
  });

  it("reads colours only from the palette module", () => {
    const source = readFileSync(new URL("./agriEdaOptions.ts", import.meta.url), "utf8");
    expect(source.match(/#[0-9a-f]{6}\b/gi) ?? []).toEqual([]);
  });

  it("returns {} on null input for every builder", () => {
    expect(buildDistributionOption(null)).toEqual({});
    expect(buildSupplyDemandOption(null)).toEqual({});
    expect(buildHeatmapOption(null)).toEqual({});
    expect(buildRollingOption(null)).toEqual({});
    expect(buildSeasonalityOption(null)).toEqual({});
  });
});

describe("buildDistributionOption", () => {
  it("builds a boxplot plus an explicit median line", () => {
    const option = buildDistributionOption({ boxes });
    expect(seriesOf(option).map((s) => s.type)).toEqual(["boxplot", "line"]);
    expect(seriesOf(option)[0].data).toEqual([
      [80, 90, 100, 110, 120],
      [85, 95, 105, 115, 125],
      [90, 100, 110, 120, 130],
    ]);
    expect(seriesOf(option)[1].name).toBe("Median");
    expect(seriesOf(option)[1].data).toEqual([100, 105, 110]);
  });

  it("labels the price axis with the ₹/quintal unit", () => {
    const option = buildDistributionOption({ boxes });
    expect(yAxisOf(option).name).toBe("₹/quintal");
    expect(String((option.title as { text: string }).text)).toContain("₹/quintal");
  });

  it("honours a custom unit and keeps month names readable", () => {
    const option = buildDistributionOption({ boxes, unit: "₹/kg" });
    expect(yAxisOf(option).name).toBe("₹/kg");
    expect(axisOf(option).data).toEqual(["Jan", "Feb", "Mar"]);
    expect((axisOf(option).axisLabel as Series).hideOverlap).toBe(true);
  });

  it("shows min, quartiles, median, max and count in the tooltip", () => {
    const tooltip = formatterOf(buildDistributionOption({ boxes }));
    const text = tooltip([{ dataIndex: 0 }]);
    for (const label of ["Min", "Q1", "Median", "Q3", "Max", "Observations"]) {
      expect(text).toContain(label);
    }
    expect(text).toContain("100 ₹/quintal");
    expect(text).toContain("12");
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it("returns {} when no box has a median", () => {
    const partial = boxes.map((box) => ({ ...box, median: null, q1: null, q3: null }));
    expect(buildDistributionOption({ boxes: partial })).toEqual({});
    expect(buildDistributionOption({ boxes: [] })).toEqual({});
  });

  it("skips malformed entries without leaking undefined into labels", () => {
    const option = buildDistributionOption({
      boxes: [null, boxes[0], { ...boxes[1], label: undefined, median: Number.NaN }] as unknown as EdaBox[],
      unit: "₹/quintal",
    });
    expect((seriesOf(option)[0].data as unknown[]).length).toBe(1);
    expect(axisOf(option).data).toEqual(["Jan"]);
    expect(formatterOf(option)([{ dataIndex: 0 }])).not.toMatch(/undefined|NaN/);
  });
});

describe("buildSupplyDemandOption", () => {
  it("builds scatter observations and a regression line", () => {
    const option = buildSupplyDemandOption({ scatter });
    expect(seriesOf(option).map((s) => s.type)).toEqual(["scatter", "line"]);
    expect(seriesOf(option)[0].data).toEqual([[500, 260], [600, 270], [700, 280], [800, 300]]);
    expect(seriesOf(option)[1].name).toBe("Regression fit");
    expect(seriesOf(option)[1].data).toEqual([[500, 260], [800, 297.5]]);
  });

  it("annotates r, R² and n without NaN", () => {
    const option = buildSupplyDemandOption({ scatter });
    const graphic = option.graphic as { style: { text: string } }[];
    expect(graphic[0].style.text).toContain("r = 0.97");
    expect(graphic[0].style.text).toContain("R² = 0.94");
    expect(graphic[0].style.text).toContain("n = 4");
    expect(graphic[0].style.text).not.toMatch(/undefined|NaN/);
  });

  it("labels axes with qtl and ₹/quintal", () => {
    const option = buildSupplyDemandOption({ scatter });
    expect(axisOf(option).name).toBe("Arrivals (qtl)");
    expect(yAxisOf(option).name).toBe("₹/quintal");
  });

  it("honours a custom arrivals unit in the axis and tooltip", () => {
    const option = buildSupplyDemandOption({ scatter, arrivalsUnit: "quintals" });
    expect(axisOf(option).name).toBe("Arrivals (quintals)");
    expect(formatterOf(option)([{ dataIndex: 0, value: [500, 260] }])).toContain("500 quintals");
  });

  it("shows date, arrivals, modal and lagged modal in the tooltip", () => {
    const text = formatterOf(buildSupplyDemandOption({ scatter }))([{ dataIndex: 1, value: [600, 270] }]);
    expect(text).toContain("2024-01-02");
    expect(text).toContain("600 qtl");
    expect(text).toContain("270 ₹/quintal");
    expect(text).toContain("Lagged modal");
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it("omits the regression line when slope or intercept is unavailable", () => {
    const option = buildSupplyDemandOption({ scatter: { ...scatter, slope: null, intercept: null } });
    expect(seriesOf(option).map((s) => s.type)).toEqual(["scatter"]);
  });

  it("renders unavailable regression statistics as dashes", () => {
    const option = buildSupplyDemandOption({
      scatter: { ...scatter, slope: null, intercept: null, pearson: null, r2: null, n: 0 },
    });
    const text = (option.graphic as { style: { text: string } }[])[0].style.text;
    expect(text).toContain("r = —");
    expect(text).toContain("R² = —");
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it("returns {} when no finite arrivals/modal pair exists", () => {
    expect(buildSupplyDemandOption({ scatter: { ...scatter, points: [] } })).toEqual({});
    expect(buildSupplyDemandOption({ scatter: null })).toEqual({});
  });

  it("drops null, NaN and malformed points safely", () => {
    const option = buildSupplyDemandOption({
      scatter: {
        ...scatter,
        points: [
          { date: "a", arrivals_qtl: null, modal: 100, laggedModal: null },
          { date: "b", arrivals_qtl: Number.NaN, modal: 100, laggedModal: null },
          null,
          { date: "c", arrivals_qtl: 100, modal: 200, laggedModal: null },
        ] as unknown as EdaScatter["points"],
      },
    });
    expect(seriesOf(option)[0].data).toEqual([[100, 200]]);
    expect(formatterOf(option)([{ dataIndex: 0, value: [100, 200] }])).not.toMatch(/undefined|NaN/);
  });
});

describe("buildHeatmapOption", () => {
  it("builds a heatmap with 12 month cells per commodity", () => {
    const option = buildHeatmapOption({ rows });
    expect(seriesOf(option)[0].type).toBe("heatmap");
    const data = seriesOf(option)[0].data as (number | null)[][];
    expect(data).toHaveLength(24);
    expect(data[0]).toEqual([0, 0, 100]);
    expect(data[1]).toEqual([1, 0, 110]);
    expect(data[12]).toEqual([0, 1, 220]);
    expect(data[14]).toEqual([2, 1, 240]);
  });

  it("leaves missing months blank", () => {
    const data = seriesOf(buildHeatmapOption({ rows }))[0].data as (number | null)[][];
    expect(data[2]).toEqual([2, 0, null]);
    expect(data[15]).toEqual([3, 1, null]);
  });

  it("uses a palette ramp and a labelled visualMap", () => {
    const option = buildHeatmapOption({ rows });
    const visualMap = option.visualMap as {
      min: number;
      max: number;
      inRange: { color: string[] };
      textStyle: { fontSize: number };
    };
    expect(visualMap.min).toBe(100);
    expect(visualMap.max).toBe(240);
    expect(visualMap.inRange.color).toEqual([...palette.VIRIDIS_STOPS]);
    expect(visualMap.textStyle.fontSize).toBeGreaterThanOrEqual(10);
  });

  it("uses readable commodity and month labels", () => {
    const option = buildHeatmapOption({ rows });
    expect(axisOf(option).data).toHaveLength(12);
    expect(axisOf(option).data[0]).toBe("Jan");
    expect(yAxisOf(option).data).toEqual(["Rice", "Wheat"]);
    expect((axisOf(option).axisLabel as Series).hideOverlap).toBe(true);
    expect((yAxisOf(option).axisLabel as Series).width).toBeGreaterThan(0);
  });

  it("shows the modal price and unit in the tooltip", () => {
    const tooltip = formatterOf(buildHeatmapOption({ rows }));
    const filled = tooltip([{ value: [0, 0, 100] }]);
    expect(filled).toContain("Rice");
    expect(filled).toContain("Jan");
    expect(filled).toContain("100 ₹/quintal");
    const blank = tooltip([{ value: [2, 0, null] }]);
    expect(blank).toContain("—");
    expect(blank).not.toMatch(/undefined|NaN/);
  });

  it("returns {} for empty, all-null or malformed rows", () => {
    expect(buildHeatmapOption({ rows: [] })).toEqual({});
    expect(buildHeatmapOption({ rows: [{ key: "x", label: "X", months: [{ month: "Jan", modal: null }] }] })).toEqual({});
    expect(buildHeatmapOption({ rows: [null] as unknown as EdaHeatmapRow[] })).toEqual({});
  });

  it("falls back to the row key and normalises month formats", () => {
    const option = buildHeatmapOption({
      rows: [{ key: "gram", label: "", months: [{ month: "march", modal: 150 }, { month: "bad", modal: 160 }] }],
    });
    expect(yAxisOf(option).data).toEqual(["gram"]);
    expect((seriesOf(option)[0].data as (number | null)[][])[2]).toEqual([2, 0, 150]);
  });
});

describe("buildRollingOption", () => {
  it("builds modal, rolling mean, lower and upper band series", () => {
    const option = buildRollingOption({ series, rolling: 3 });
    expect(seriesOf(option).map((s) => s.name)).toEqual([
      "Modal", "Rolling mean (3)", "Lower band", "Upper band",
    ]);
    expect(seriesOf(option).map((s) => s.type)).toEqual(["line", "line", "line", "line"]);
    expect(seriesOf(option)[0].data).toEqual([100, 120, 110, 140, 130, 150]);
  });

  it("stacks the band legs and keeps each lower bound below its mean", () => {
    const option = buildRollingOption({ series, rolling: 3 });
    const lower = seriesOf(option)[2];
    const upper = seriesOf(option)[3];
    expect(lower.stack).toBe(upper.stack);
    const lowers = lower.data as (number | null)[];
    const means = seriesOf(option)[1].data as (number | null)[];
    const spans = upper.data as (number | null)[];
    expect(lowers[0]).toBeNull();
    for (let i = 1; i < lowers.length; i += 1) {
      expect(lowers[i] as number).toBeLessThanOrEqual(means[i] as number);
      expect((lowers[i] as number) + (spans[i] as number)).toBeGreaterThanOrEqual(means[i] as number);
    }
  });

  it("includes inside and slider dataZoom with readable labels", () => {
    const option = buildRollingOption({ series, rolling: 3 });
    expect((option.dataZoom as Series[]).map((z) => z.type)).toEqual(["inside", "slider"]);
    expect((axisOf(option).axisLabel as Series).hideOverlap).toBe(true);
  });

  it("shows all four values with the ₹/quintal unit in the tooltip", () => {
    const tooltip = formatterOf(buildRollingOption({ series, rolling: 3 }));
    const text = tooltip([{ dataIndex: 2 }]);
    expect(text).toContain("03 Jan");
    expect(text).toContain("Rolling mean (3)");
    expect(text).toContain("Lower band");
    expect(text).toContain("Upper band");
    expect(text.match(/₹\/quintal/g)?.length).toBe(4);
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it("returns {} for empty or all-null modal series", () => {
    expect(buildRollingOption({ series: [] })).toEqual({});
    expect(buildRollingOption({ series: series.map((point) => ({ ...point, modal: null })) })).toEqual({});
  });

  it("clamps invalid rolling windows and skips non-finite modal values", () => {
    const noisy = [...series, { ...series[0], modal: Number.NaN }] as EdaSeriesPoint[];
    const option = buildRollingOption({ series: noisy, rolling: Number.NaN });
    expect(String((option.title as { text: string }).text)).toContain("6-observation");
    expect((seriesOf(option)[0].data as (number | null)[]).every((value) => value !== null)).toBe(true);
    expect(seriesOf(option)[0].data).toHaveLength(6);
  });
});

describe("buildSeasonalityOption", () => {
  it("builds month-of-year median bars with a mean line", () => {
    const option = buildSeasonalityOption({ seasonality: boxes });
    expect(seriesOf(option).map((s) => s.type)).toEqual(["bar", "line"]);
    expect(axisOf(option).data).toEqual([
      "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]);
    const medians = seriesOf(option)[0].data as (number | null)[];
    expect(medians.slice(0, 3)).toEqual([100, 105, 110]);
    expect(medians.filter((value) => value == null)).toHaveLength(9);
  });

  it("uses the ₹/quintal unit and honours a custom unit", () => {
    expect(yAxisOf(buildSeasonalityOption({ seasonality: boxes })).name).toBe("₹/quintal");
    expect(yAxisOf(buildSeasonalityOption({ seasonality: boxes, unit: "₹/kg" })).name).toBe("₹/kg");
  });

  it("omits the weak-history note when every month has enough seasons", () => {
    const option = buildSeasonalityOption({ seasonality: boxes });
    expect((option.title as { subtext?: string }).subtext).toBeUndefined();
  });

  it("adds a weak-history note when a month has fewer than three seasons", () => {
    const option = buildSeasonalityOption({
      seasonality: [{ ...boxes[0], count: 1 }, boxes[1], boxes[2]],
    });
    expect((option.title as { subtext?: string }).subtext).toContain("Weak history");
  });

  it("shows median, mean and observation count in the tooltip", () => {
    const tooltip = formatterOf(buildSeasonalityOption({ seasonality: boxes }));
    const text = tooltip([{ dataIndex: 0 }]);
    expect(text).toContain("101 ₹/quintal");
    expect(text).toContain("Observations");
    expect(text).toContain("12");
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it("returns {} for empty or median-less input", () => {
    expect(buildSeasonalityOption({ seasonality: [] })).toEqual({});
    expect(buildSeasonalityOption({ seasonality: boxes.map((box) => ({ ...box, median: null })) })).toEqual({});
  });

  it("accepts numeric month buckets that name their mean avg", () => {
    const bucket = { month: 5, avg: 142, median: 140, min: 120, max: 160, years: 3, count: 9 };
    const option = buildSeasonalityOption({ seasonality: [bucket] });
    const medians = seriesOf(option)[0].data as (number | null)[];
    const means = seriesOf(option)[1].data as (number | null)[];
    expect(medians[4]).toBe(140);
    expect(means[4]).toBe(142);
    const text = formatterOf(option)([{ dataIndex: 4 }]);
    expect(text).toContain("May");
    expect(text).toContain("142 ₹/quintal");
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it("normalises month formats and ignores malformed entries safely", () => {
    const option = buildSeasonalityOption({
      seasonality: [null, { ...boxes[0], month: "feb", median: 150 }] as unknown as EdaBox[],
    });
    const medians = seriesOf(option)[0].data as (number | null)[];
    expect(medians[1]).toBe(150);
    expect(medians[0]).toBeNull();
    expect(formatterOf(option)([{ dataIndex: 1 }])).not.toMatch(/undefined|NaN/);
  });
});

describe("buildEdaOption dispatcher", () => {
  it("routes each mode to the correct builder", () => {
    const cases: [string, Option, Option][] = [
      ["distribution", buildEdaOption("distribution", { boxes }), buildDistributionOption({ boxes })],
      ["supplyDemand", buildEdaOption("supplyDemand", { scatter }), buildSupplyDemandOption({ scatter })],
      ["heatmap", buildEdaOption("heatmap", { rows }), buildHeatmapOption({ rows })],
      ["rolling", buildEdaOption("rolling", { series, rolling: 3 }), buildRollingOption({ series, rolling: 3 })],
      ["seasonality", buildEdaOption("seasonality", { seasonality: boxes }), buildSeasonalityOption({ seasonality: boxes })],
    ];
    for (const [mode, actual, expected] of cases) {
      expect((actual.title as { text: string }).text, mode).toBe((expected.title as { text: string }).text);
      expect(seriesOf(actual).map((s) => s.type), mode).toEqual(seriesOf(expected).map((s) => s.type));
      expect(axisOf(actual).data, mode).toEqual(axisOf(expected).data);
    }
  });

  it("accepts common mode aliases", () => {
    expect((seriesOf(buildEdaOption("boxplot", { boxes }))[0] as { type: string }).type).toBe("boxplot");
    expect((seriesOf(buildEdaOption("supply-demand", { scatter }))[0] as { type: string }).type).toBe("scatter");
  });

  it("returns {} for unknown modes and empty inputs", () => {
    expect(buildEdaOption("unknown", { boxes })).toEqual({});
    expect(buildEdaOption(null, { boxes })).toEqual({});
    expect(buildEdaOption("distribution", null)).toEqual({});
    expect(buildEdaOption("rolling", { series: [] })).toEqual({});
  });
});
