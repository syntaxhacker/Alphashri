// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGRI_ACCENT, AGRI_SEASON_STOPS, alpha } from "@/ui/palette";
import { buildAgriHeroOption } from "./agriHeroOption";
import { buildAgriRankOption } from "./agriRankOption";
import { buildAgriSeasonalityOption } from "./agriSeasonalityOption";
import { buildAgriDispersionOption } from "./agriDispersionOption";
import { buildDispersionRows, buildRankBoard, buildSeasonRows } from "./agriRedesignData";

const heroInput = () => ({
  title: "Onion",
  series: [
    { date: "2026-11-10", modal: 100, min: 90, max: 110, arrivals_qtl: null, market_count: 4 },
    { date: "2026-11-17", modal: 120, min: 100, max: 130, arrivals_qtl: null, market_count: 5 },
  ],
  comparison: [{ key: "wheat", label: "Wheat", points: [{ date: "2026-11-10", modal: 110 }, { date: "2026-11-17", modal: 115 }] }],
  unit: "₹/quintal",
  isDark: true,
  asOf: "2026-11-17",
});

const rankRows = () =>
  buildRankBoard([
    {
      key: "onion",
      label: "Onion",
      points: [{ date: "2026-01-15", modal: 100 }, { date: "2026-02-15", modal: 200 }],
    },
    {
      key: "wheat",
      label: "Wheat",
      points: [{ date: "2026-01-15", modal: 110 }, { date: "2026-02-15", modal: 150 }],
    },
  ]);

const seasonRows = () =>
  buildSeasonRows([
    {
      key: "onion",
      label: "Onion",
      points: [
        { date: "2025-01-15", modal: 100 },
        { date: "2026-01-15", modal: 120 },
        { date: "2025-02-15", modal: 80 },
        { date: "2026-02-15", modal: 100 },
      ],
    },
  ]);

describe("hero option", () => {
  it("has one focused line, muted context, a direct end label and an as-of rule", () => {
    const option = buildAgriHeroOption(heroInput()) as Record<string, any>;
    expect(option.series).toHaveLength(2);
    expect(option.series[0].endLabel.show).toBe(true);
    expect(option.series[0].endLabel.formatter).toContain("120");
    expect((option.series[0].lineStyle as { color: string }).color).toBe(AGRI_ACCENT);
    expect(option.series[0].markLine.data[0].label.formatter).toContain("as of");
    // The panel header owns the only title and the only "How to read" line.
    expect(option.title).toBeUndefined();
    expect(option.legend).toBeUndefined();
  });

  it("scales to the drawn modal instead of the undrawn daily min–max band", () => {
    const option = buildAgriHeroOption({
      ...heroInput(),
      // A 13,000 daily max used to force an 18k axis around a ~120 modal.
      series: [
        { date: "2026-11-10", modal: 100, min: 99, max: 13_000, arrivals_qtl: null, market_count: 4 },
        { date: "2026-11-17", modal: 120, min: 118, max: 13_400, arrivals_qtl: null, market_count: 5 },
      ],
    }) as Record<string, any>;
    const axis = (option.yAxis as Array<{ max?: number }>)[0];
    expect(axis.max).toBeLessThan(400);
    expect(axis.max).toBeGreaterThan(120);
  });

  it("direct-labels the context series and formats tooltip dates", () => {
    const option = buildAgriHeroOption(heroInput()) as Record<string, any>;
    expect(option.series).toHaveLength(2);
    expect(option.series[1].endLabel.show).toBe(true);
    expect(option.series[1].endLabel.formatter).toBe("Wheat");
    const tooltip = option.tooltip.formatter as (params: unknown) => string;
    expect(tooltip([{ dataIndex: 1 }])).toContain("17 Nov");
    expect(tooltip([{ dataIndex: 1 }])).not.toContain("2026-11-17");
  });

  it("keeps the tooltip unit-aware and null-safe", () => {
    const option = buildAgriHeroOption(heroInput()) as Record<string, any>;
    const tooltip = option.tooltip.formatter as (params: unknown) => string;
    const text = tooltip([{ dataIndex: 1 }]);
    expect(text).toContain("₹/quintal");
    expect(text).not.toMatch(/undefined|NaN/);
    expect(tooltip(null)).toBe("");
  });

  it("returns {} when no modal value can be drawn", () => {
    expect(buildAgriHeroOption({ ...heroInput(), series: [] })).toEqual({});
    expect(buildAgriHeroOption(null)).toEqual({});
  });
});

describe("rank bump option", () => {
  it("puts rank 1 at the top and labels every line at its end", () => {
    const option = buildAgriRankOption({
      rows: rankRows(),
      selected: "onion",
      isDark: true,
    }) as Record<string, any>;
    expect(option.yAxis[0].inverse).toBe(true);
    expect(option.yAxis[0].max).toBe(2);
    expect(option.series).toHaveLength(2);
    expect(option.series.every((series: { endLabel: { show: boolean } }) => series.endLabel.show)).toBe(true);
    expect((option.series[0].lineStyle as { color: string }).color).toBe(AGRI_ACCENT);
    expect(option.title).toBeUndefined();
    expect(option.legend).toBeUndefined();
    const xAxis = option.xAxis[0];
    const visibleTicks =
      Math.floor((xAxis.data.length - 1) / (xAxis.axisLabel.interval + 1)) + 1;
    expect(visibleTicks).toBeLessThanOrEqual(4);
  });

  it("needs at least two months and two commodities", () => {
    expect(buildAgriRankOption({ rows: rankRows().slice(0, 1), selected: "a", isDark: true })).toEqual({});
    expect(buildAgriRankOption(null)).toEqual({});
  });
});

describe("seasonality option", () => {
  it("uses the curated diverging ramp with direct labels and an n annotation", () => {
    const option = buildAgriSeasonalityOption({
      rows: seasonRows(),
      unit: "₹/quintal",
      isDark: true,
    }) as Record<string, any>;
    expect(option.visualMap[0].inRange.color).toEqual([...AGRI_SEASON_STOPS]);
    expect(option.visualMap[0].min).toBe(-20);
    expect(option.visualMap[0].max).toBe(20);
    // HeatmapView rejects a cartesian heatmap without boundaryGap on both axes.
    expect(option.xAxis[0].boundaryGap).toBe(true);
    expect(option.yAxis[0].boundaryGap).toBe(true);
    expect((option.series[0].label as { show: boolean }).show).toBe(true);
    expect(option.title).toBeUndefined();
    expect(option.legend).toBeUndefined();
    expect(option.visualMap[0].splitNumber).toBeLessThanOrEqual(3);
    expect(option.xAxis[0].data).toHaveLength(12);
    expect(option.xAxis[0].axisLabel.width).toBeLessThanOrEqual(28);
    const formatter = (option.series[0].label as { formatter: (p: { value: number[] }) => string }).formatter;
    expect(formatter({ value: [0, 0, 10.4] })).toBe("+10%");
    const tooltip = option.tooltip.formatter as (params: unknown) => string;
    expect(tooltip([{ value: [0, 0, 10] }])).toContain("Observations");
  });

  it("returns {} with no monthly cells", () => {
    expect(buildAgriSeasonalityOption({ rows: [], unit: "₹/quintal", isDark: true })).toEqual({});
  });

  it("labels alternate months on the compact board so ticks do not merge", () => {
    const compact = buildAgriSeasonalityOption({
      rows: seasonRows(),
      unit: "₹/quintal",
      isDark: true,
      compact: true,
    }) as Record<string, any>;
    expect(compact.xAxis[0].axisLabel.interval).toBe(1);
    expect(compact.xAxis[0].axisLabel.width).toBeLessThanOrEqual(26);
  });

  it("paints every row's full cell set even when deviations exceed the colour scale", () => {
    const rows = ["Onion", "Tomato", "Wheat"].map((label, rowIndex) => ({
      key: label.toLowerCase(),
      label,
      hitRate: 0.5,
      minYears: 1,
      cells: Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        avg: 100 + index * 10,
        // Onion-like series run far past the ±20% colour scale.
        pct: rowIndex === 0 ? 60 + index : index - 6,
        years: 1,
        count: 4,
      })),
    }));
    const option = buildAgriSeasonalityOption({
      rows,
      unit: "₹/quintal",
      isDark: true,
    }) as Record<string, any>;
    expect(option.series[0].data).toHaveLength(36);
    expect(option.visualMap[0].dimension).toBe(3);
    // Every data row keeps its honest value in dimension 2 and a clamped
    // colour value in dimension 3.
    for (const datum of option.series[0].data) {
      expect(datum.value).toHaveLength(4);
      expect(Math.abs(datum.value[3])).toBeLessThanOrEqual(20);
    }
  });

  it("reads the hovered row for all three commodities, not the first axis row", () => {
    const rows = ["Onion", "Tomato", "Wheat"].map((label) => ({
      key: label.toLowerCase(),
      label,
      hitRate: 0.5,
      minYears: 1,
      cells: Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        avg: 100 + index,
        pct: index,
        years: 1,
        count: 3,
      })),
    }));
    const option = buildAgriSeasonalityOption({
      rows,
      unit: "₹/quintal",
      isDark: true,
    }) as Record<string, any>;
    expect(option.tooltip.trigger).toBe("item");
    const tooltip = option.tooltip.formatter as (params: unknown) => string;
    for (const [rowIndex, label] of ["Onion", "Tomato", "Wheat"].entries()) {
      const html = tooltip([{ value: [4, rowIndex, 4, 4] }]);
      expect(html).toContain(label);
      expect(html).toContain("May");
    }
  });
});

describe("dispersion option", () => {
  const quotes = [
    { date: "2026-11-17", state: "MH", district: "Nashik", market: "A", variety: "Onion", grade: "A", min: 90, modal: 100, max: 110, arrivals_qtl: 10 },
    { date: "2026-11-17", state: "MH", district: "Nashik", market: "B", variety: "Onion", grade: "A", min: 100, modal: 110, max: 120, arrivals_qtl: 10 },
    { date: "2026-11-17", state: "MH", district: "Nashik", market: "C", variety: "Onion", grade: "A", min: 110, modal: 120, max: 130, arrivals_qtl: 10 },
    { date: "2026-11-17", state: "MH", district: "Nashik", market: "D", variety: "Onion", grade: "A", min: 120, modal: 130, max: 140, arrivals_qtl: 10 },
    { date: "2026-11-17", state: "MH", district: "Nashik", market: "E", variety: "Onion", grade: "A", min: 990, modal: 1000, max: 1010, arrivals_qtl: 10 },
  ];

  it("plots a sorted range bar, modal dots and a separated outlier series", () => {
    const rows = buildDispersionRows(quotes);
    const option = buildAgriDispersionOption({ rows, unit: "₹/quintal", isDark: true }) as Record<string, any>;
    expect((option.series as Array<{ name: string }>).map((series) => series.name)).toEqual([
      "Floor",
      "Min–max",
      "Modal",
      "Outlier",
    ]);
    expect(option.yAxis[0].data).toEqual(["A", "B", "C", "D", "E"]);
    expect(option.title).toBeUndefined();
    expect(option.legend).toBeUndefined();
    expect(option.series[1].barMaxWidth).toBeGreaterThanOrEqual(10);
    expect(option.series[1].itemStyle.color).toBe(alpha(AGRI_ACCENT, 0.34));
    expect(option.series[1].itemStyle.borderWidth).toBeGreaterThanOrEqual(1);
    expect(option.xAxis[0].splitNumber).toBeLessThanOrEqual(5);
    expect(option.xAxis[0].axisLabel.formatter(2_300_000_000)).toMatch(/^₹[\d.]+Cr$/);
    expect(option.series[3].data).toHaveLength(1);
    expect((option.xAxis[0] as { min: number }).min).toBeGreaterThanOrEqual(0);
    // The modal dot must stay visible when a mandi is also an outlier.
    expect(option.series[2].z).toBeGreaterThan(option.series[3].z);
    expect(option.series[3].label.show).toBe(false);
    expect(option.xAxis[0].interval).toBeGreaterThan(0);
    const tooltip = option.tooltip.formatter as (params: unknown) => string;
    expect(tooltip([{ dataIndex: 4 }])).toContain("outlier");
  });

  it("keeps only the top eight mandis on the plot", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      date: "2026-11-17",
      state: "MH",
      district: "Nashik",
      market: `M${index}`,
      variety: "Onion",
      grade: "A",
      min: 90 + index * 10,
      max: 110 + index * 10,
      modal: 100 + index * 10,
      arrivals_qtl: 10,
    }));
    const option = buildAgriDispersionOption({
      rows: buildDispersionRows(many),
      unit: "₹/quintal",
      isDark: true,
    }) as Record<string, any>;
    expect(option.yAxis[0].data).toHaveLength(8);
  });

  it("returns {} without a modal price", () => {
    expect(buildAgriDispersionOption({ rows: [], unit: "₹/quintal", isDark: true })).toEqual({});
  });
});

describe("new agri option modules keep colours in the palette", () => {
  it.each(["agriHeroOption.ts", "agriRankOption.ts", "agriSeasonalityOption.ts", "agriDispersionOption.ts"])(
    "%s hardcodes no hex colour",
    (file) => {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(source.match(/#[0-9a-f]{6}\b/gi) ?? []).toEqual([]);
    },
  );
});
