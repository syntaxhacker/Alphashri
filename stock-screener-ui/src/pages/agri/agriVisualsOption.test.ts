// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGRI_ACCENT, AGRI_SEASON_STOPS } from "@/ui/palette";
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
    expect((option.title as { subtext: string }).subtext).toContain("How to read");
    expect((option.title as { text: string }).text).toContain("as of 2026-11-17");
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
    expect((option.legend as { show: boolean }).show).toBe(false);
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
    expect((option.title as { subtext: string }).subtext).toContain("n ≥ 2");
    const tooltip = option.tooltip.formatter as (params: unknown) => string;
    expect(tooltip([{ value: [0, 0, 10] }])).toContain("Observations");
  });

  it("returns {} with no monthly cells", () => {
    expect(buildAgriSeasonalityOption({ rows: [], unit: "₹/quintal", isDark: true })).toEqual({});
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
    expect(option.yAxis[0].data).toEqual(["E", "D", "C", "B", "A"]);
    expect(option.series[3].data).toHaveLength(1);
    expect((option.xAxis[0] as { min: number }).min).toBeGreaterThanOrEqual(0);
    const tooltip = option.tooltip.formatter as (params: unknown) => string;
    expect(tooltip([{ dataIndex: 0 }])).toContain("outlier");
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
