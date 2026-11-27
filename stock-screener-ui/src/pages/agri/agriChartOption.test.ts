// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as palette from "@/ui/palette";
import { typeSize } from "@/ui/typography";
import {
  buildAgriChartOption,
  formatAgriDateLabel,
  formatAgriValue,
  robustBandBounds,
  type AgriChartInput,
  type AgriChartSeriesPoint,
  type AgriComparisonSeries,
} from "./agriChartOption";
import {
  asParams,
  baseOption,
  categoryAxis,
  CHART_LAYOUT,
  compactAxisLabel,
  escapeHtml,
  field,
  finite,
  formatAgriDateLabel as themeFormatAgriDateLabel,
  formatAgriValue as themeFormatAgriValue,
  formatIndexLevel,
  formatPct,
  makeDataZoom,
  themeTokens,
  titled,
  tooltipShell,
  valueAxis,
} from "./agriChartTheme";

type Option = Record<string, unknown>;
type Series = Record<string, unknown>;
type Formatter = (params: unknown) => string;

const seriesOf = (option: Option): Series[] => option.series as Series[];
const formatterOf = (option: Option): Formatter =>
  (option.tooltip as { formatter: Formatter }).formatter;

const rows: AgriChartSeriesPoint[] = [
  { date: "2024-01-01", modal: 100, min: 90, max: 110, arrivals_qtl: 500, market_count: 12 },
  { date: "2024-01-02", modal: 120, min: 100, max: 140, arrivals_qtl: 700, market_count: 15 },
  { date: "2024-01-03", modal: null, min: 95, max: null, arrivals_qtl: null, market_count: 8 },
];

const input = (overrides: Partial<AgriChartInput> = {}): AgriChartInput => ({
  mode: "band",
  series: rows,
  comparison: [],
  unit: "₹/quintal",
  isDark: true,
  ...overrides,
});

const comparison: AgriComparisonSeries[] = [
  {
    key: "rice",
    label: "Rice",
    points: [
      { date: "2024-01-01", modal: 100 },
      { date: "2024-01-02", modal: 110 },
      { date: "2024-01-03", modal: null },
    ],
  },
  {
    key: "wheat",
    label: "Wheat",
    points: [
      { date: "2024-01-02", modal: 200 },
      { date: "2024-01-03", modal: 220 },
    ],
  },
];

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

describe("buildAgriChartOption — shared behaviour", () => {
  it("returns {} for empty series and null input", () => {
    expect(buildAgriChartOption(input({ series: [] }))).toEqual({});
    expect(buildAgriChartOption(null as unknown as AgriChartInput)).toEqual({});
  });

  it("returns {} for compare with no comparison series", () => {
    expect(buildAgriChartOption(input({ mode: "compare", comparison: [] }))).toEqual({});
  });

  it("returns {} for empty input in every mode", () => {
    for (const mode of ["band", "arrivals", "ohlc"] as const) {
      expect(buildAgriChartOption(input({ mode, series: [] }))).toEqual({});
    }
    expect(buildAgriChartOption(input({ mode: "compare", comparison: [] }))).toEqual({});
  });

  it("leaves the plot background transparent and takes ink from theme tokens", () => {
    const dark = buildAgriChartOption(input({ isDark: true }));
    const light = buildAgriChartOption(input({ isDark: false }));
    expect(dark.backgroundColor).toBe("transparent");
    expect(light.backgroundColor).toBe("transparent");

    const darkTooltip = dark.tooltip as { backgroundColor: string; textStyle: { color: string } };
    const lightTooltip = light.tooltip as { backgroundColor: string; textStyle: { color: string } };
    expect(darkTooltip.backgroundColor).toBe(palette.CHART_DARK_OVERLAY);
    expect(darkTooltip.textStyle.color).toBe(palette.CHART_DARK_TEXT);
    expect(lightTooltip.backgroundColor).toBe(palette.CHART_LIGHT_OVERLAY);
    expect(lightTooltip.textStyle.color).toBe(palette.CHART_LIGHT_TEXT);
    expect(((light.yAxis as Series[])[0].splitLine as { lineStyle: { color: string } }).lineStyle.color).toBe(
      palette.CHART_LIGHT_SPLIT,
    );
  });

  it("has no raw hex colour in the source", () => {
    const source = readFileSync(new URL("./agriChartOption.ts", import.meta.url), "utf8");
    expect(source.match(/#[0-9a-f]{6}\b/gi) ?? []).toEqual([]);
  });

  it("formats dates as DD MMM or YYYY-MM", () => {
    expect(formatAgriDateLabel("2024-01-03")).toBe("03 Jan");
    expect(formatAgriDateLabel("2024-11")).toBe("2024-11");
    const option = buildAgriChartOption(input());
    expect((option.xAxis as Series[])[0].data).toEqual(["01 Jan", "02 Jan", "03 Jan"]);
  });

  it("keeps category labels short and compacts the value axis", () => {
    const option = buildAgriChartOption(input());
    const axis = (option.xAxis as Series[])[0];
    expect(axis.data).toEqual(["01 Jan", "02 Jan", "03 Jan"]);
    const label = axis.axisLabel as { interval: string; hideOverlap: boolean };
    expect(label.interval).toBe("auto");
    expect(label.hideOverlap).toBe(true);

    const formatter = ((option.yAxis as Series[])[0].axisLabel as { formatter: (v: number) => string }).formatter;
    expect(formatter(120)).toBe("120");
    expect(formatter(1200)).toBe("1.2k");
  });

  it("clips data to asOf", () => {
    const option = buildAgriChartOption(input({ asOf: "2024-01-02" }));
    expect((option.xAxis as Series[])[0].data).toEqual(["01 Jan", "02 Jan"]);
    expect(String((option.title as { text: string }).text)).toContain("as of 2024-01-02");
  });
});

describe("band mode (default)", () => {
  it("builds modal line plus stacked min/max band, without symbol clutter", () => {
    const option = buildAgriChartOption(input());
    const series = seriesOf(option);
    expect(series.map((s) => s.name)).toEqual(["Modal", "Min", "Min–Max band"]);
    expect(series[0].type).toBe("line");
    expect(series[0].showSymbol).toBe(false);
    expect(series[0].data).toEqual([100, 120, null]);
    expect(series[1].stack).toBe(series[2].stack);
    expect(series[1].data).toEqual([90, 100, 95]);
    expect(series[2].data).toEqual([20, 40, null]);
    expect(series[2].areaStyle).toBeDefined();
  });

  it("keeps the modal line distinct from an INFO-tinted min–max band", () => {
    const option = buildAgriChartOption(input());
    const [modal, min, band] = seriesOf(option);
    expect((option.legend as { data: string[] }).data).toEqual(["Modal", "Min–Max band"]);
    expect((modal.lineStyle as { color: string }).color).toBe(palette.PRIMARY);
    expect((band.areaStyle as { color: string }).color).toBe(palette.alpha(palette.INFO, 0.15));
    expect(Number(modal.z)).toBeGreaterThan(Number(band.z));
    expect(min.stack).toBe(band.stack);
  });

  it("includes inside and slider dataZoom", () => {
    const zoom = buildAgriChartOption(input()).dataZoom as Series[];
    expect(zoom.map((z) => z.type)).toEqual(["inside", "slider"]);
  });

  it("tooltip is unit-aware and null-safe", () => {
    const option = buildAgriChartOption(input());
    const tooltip = formatterOf(option);
    const full = tooltip([{ dataIndex: 1, axisValue: "2024-01-02" }]);
    expect(full).toContain("120 ₹/quintal");
    expect(full).toMatch(/Min:.*100 ₹\/quintal/);
    expect(full).toMatch(/Max:.*140 ₹\/quintal/);
    expect(full).not.toMatch(/undefined|NaN/);
    expect(full).not.toMatch(/₹(?!\/quintal)/);

    const missing = tooltip([{ dataIndex: 2 }]);
    expect(missing).toContain("—");
    expect(missing).not.toMatch(/undefined|NaN/);
    expect(tooltip(null)).toBe("");
    expect(tooltip([{ dataIndex: 99 }])).toBe("");
  });
});

describe("arrivals mode", () => {
  it("adds arrivals bars on a second grid and axis", () => {
    const option = buildAgriChartOption(input({ mode: "arrivals" }));
    expect((option.grid as unknown[]).length).toBe(2);
    expect((option.yAxis as unknown[]).length).toBe(2);
    const series = seriesOf(option);
    expect(series[0].type).toBe("line");
    const bars = series.find((s) => s.type === "bar");
    expect(bars?.name).toBe("Arrivals");
    expect(bars?.xAxisIndex).toBe(1);
    expect(bars?.yAxisIndex).toBe(1);
    expect(bars?.data).toEqual([500, 700, null]);
  });

  it("labels the volume axis in qtl and keeps the modal line above the bars", () => {
    const option = buildAgriChartOption(input({ mode: "arrivals" }));
    expect(((option.yAxis as Series[])[1] as { name: string }).name).toBe("qtl");
    const series = seriesOf(option);
    const bars = series.find((s) => s.type === "bar") as Series;
    const modal = series.find((s) => s.name === "Modal") as Series;
    expect((bars.itemStyle as { color: string }).color).toBe(palette.alpha(palette.INFO, 0.55));
    expect(Number(bars.barMaxWidth)).toBeGreaterThanOrEqual(14);
    expect(Number(modal.z)).toBeGreaterThan(Number(bars.z));
  });

  it("tooltip shows both modal and arrivals quantity with the unit", () => {
    const tooltip = formatterOf(buildAgriChartOption(input({ mode: "arrivals" })));
    const text = tooltip([{ dataIndex: 1 }]);
    expect(text).toContain("120 ₹/quintal");
    expect(text).toContain("700 qtl");
    expect(text).not.toMatch(/undefined|NaN/);
    expect(text).not.toMatch(/₹(?!\/quintal)/);
  });
});

describe("compare mode", () => {
  it("indexes every series to 100 at the common first date", () => {
    const option = buildAgriChartOption(input({ mode: "compare", comparison }));
    const series = seriesOf(option);
    expect(series).toHaveLength(2);
    expect(series[0].data).toEqual([100, null]);
    expect(series[1].data).toEqual([100, 110]);
    expect((option.legend as { data: string[] }).data).toEqual(["Rice", "Wheat"]);
    expect((option.xAxis as Series[])[0].data).toEqual(["02 Jan", "03 Jan"]);
  });

  it("tooltip reports indexed level and percent change", () => {
    const tooltip = formatterOf(buildAgriChartOption(input({ mode: "compare", comparison })));
    const text = tooltip([
      { axisValue: "2024-01-03", seriesName: "Wheat", value: 110, marker: "•" },
      { axisValue: "2024-01-03", seriesName: "Rice", value: null },
    ]);
    expect(text).toContain("110.0");
    expect(text).toContain("+10.0%");
    expect(text).not.toContain("Rice");
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it("states the indexed-to-100 base in the title, tooltip and legend", () => {
    const option = buildAgriChartOption(input({ mode: "compare", comparison }));
    expect(String((option.title as { text: string }).text).toLowerCase()).toContain("indexed to 100");
    expect((option.legend as { data: string[] }).data).toEqual(["Rice", "Wheat"]);
    const text = formatterOf(option)([
      { axisValue: "2024-01-03", seriesName: "Wheat", value: 110, marker: "•" },
    ]);
    expect(text.toLowerCase()).toContain("indexed to 100 at 02 jan");
    expect(text).toContain("110.0");
  });

  it("caps at five series with stable palette colours and handles duplicate labels", () => {
    const many: AgriComparisonSeries[] = Array.from({ length: 7 }, (_, i) => ({
      key: `k${i}`,
      label: "Same",
      points: [{ date: "2024-01-01", modal: 100 + i }],
    }));
    const option = buildAgriChartOption(input({ mode: "compare", comparison: many }));
    expect(seriesOf(option)).toHaveLength(5);
    expect(seriesOf(option).map((s) => (s.lineStyle as { color: string }).color)).toEqual([
      palette.PRIMARY,
      palette.INFO,
      palette.POSITIVE,
      palette.SCALE_VIOLET[4],
      palette.SCALE_CYAN[4],
    ]);
    expect((option.legend as { data: string[] }).data).toEqual([
      "Same",
      "Same (2)",
      "Same (3)",
      "Same (4)",
      "Same (5)",
    ]);
  });

  it("returns {} when the series share no common date", () => {
    const disjoint: AgriComparisonSeries[] = [
      { key: "a", label: "A", points: [{ date: "2024-01-01", modal: 100 }] },
      { key: "b", label: "B", points: [{ date: "2024-02-01", modal: 200 }] },
    ];
    expect(buildAgriChartOption(input({ mode: "compare", comparison: disjoint }))).toEqual({});
  });

  it("never emits NaN or Infinity for invalid values", () => {
    const invalid: AgriComparisonSeries[] = [
      {
        key: "a",
        label: "A",
        points: [
          { date: "2024-01-01", modal: 100 },
          { date: "2024-01-02", modal: Number.NaN },
          { date: "2024-01-03", modal: 0 },
        ],
      },
      {
        key: "b",
        label: "B",
        points: [
          { date: "2024-01-01", modal: 200 },
          { date: "2024-01-02", modal: 220 },
          { date: "2024-01-03", modal: 240 },
        ],
      },
    ];
    const option = buildAgriChartOption(input({ mode: "compare", comparison: invalid }));
    const all = seriesOf(option).flatMap((s) => (s.data as unknown[]).map((v) => String(v)));
    expect(all.every((v) => v === "null" || !/NaN|Infinity|undefined/.test(v))).toBe(true);
    expect(seriesOf(option)[0].data).toEqual([100, null, 0]);
  });

  it("does not divide by a zero base", () => {
    const zeroBase: AgriComparisonSeries[] = [
      {
        key: "a",
        label: "A",
        points: [
          { date: "2024-01-01", modal: 0 },
          { date: "2024-01-02", modal: 10 },
        ],
      },
      {
        key: "b",
        label: "B",
        points: [
          { date: "2024-01-01", modal: 100 },
          { date: "2024-01-02", modal: 110 },
        ],
      },
    ];
    const option = buildAgriChartOption(input({ mode: "compare", comparison: zeroBase }));
    expect(seriesOf(option)[0].data).toEqual([null, null]);
  });
});

describe("ohlc mode", () => {
  it("builds proxy candlesticks from min, previous modal and modal", () => {
    const option = buildAgriChartOption(input({ mode: "ohlc" }));
    const series = seriesOf(option);
    expect(series).toHaveLength(1);
    expect(series[0].type).toBe("candlestick");
    expect(series[0].data).toEqual([
      [100, 100, 90, 110],
      [100, 120, 100, 140],
    ]);
  });

  it("labels the candles as a proxy, not traded OHLC", () => {
    const option = buildAgriChartOption(input({ mode: "ohlc" }));
    const name = String(seriesOf(option)[0].name);
    const title = String((option.title as { text: string }).text);
    expect(name.toLowerCase()).toContain("proxy");
    expect(title.toLowerCase()).toContain("proxy");
    expect(title.toLowerCase()).toContain("not traded ohlc");
  });

  it("uses palette up/down colours and opens zoomed to limit wick density", () => {
    const option = buildAgriChartOption(input({ mode: "ohlc" }));
    const candle = seriesOf(option)[0];
    const style = candle.itemStyle as Record<string, string>;
    expect(style.color).toBe(palette.POSITIVE);
    expect(style.color0).toBe(palette.NEGATIVE);
    expect(style.borderColor).toBe(palette.POSITIVE);
    expect(style.borderColor0).toBe(palette.NEGATIVE);
    expect(Number(candle.barMaxWidth)).toBeGreaterThan(0);

    const denseRows: AgriChartSeriesPoint[] = Array.from({ length: 120 }, (_, i) => ({
      date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
      modal: 100 + (i % 5),
      min: 95 + (i % 5),
      max: 110 + (i % 5),
      arrivals_qtl: null,
      market_count: 1,
    }));
    const zoom = buildAgriChartOption(input({ mode: "ohlc", series: denseRows })).dataZoom as Series[];
    expect(Number(zoom[0].start)).toBeGreaterThan(0);
    expect(zoom[0].end).toBe(100);
  });

  it("returns {} when no modal value is available", () => {
    const noModal = rows.map((r) => ({ ...r, modal: null }));
    expect(buildAgriChartOption(input({ mode: "ohlc", series: noModal }))).toEqual({});
  });
});

describe("value formatting", () => {
  it("never prints undefined or NaN", () => {
    expect(formatAgriValue(null, "₹/quintal")).toBe("—");
    expect(formatAgriValue(undefined, "₹/quintal")).toBe("—");
    expect(formatAgriValue(Number.NaN, "₹/quintal")).toBe("—");
    expect(formatAgriValue(1234, "₹/quintal")).toBe("1,234 ₹/quintal");
  });

  it("uses a default unit when the caller omits one", () => {
    const tooltip = formatterOf(buildAgriChartOption(input({ unit: "" })));
    expect(tooltip([{ dataIndex: 0 }])).toContain("₹/quintal");
  });

  it("never prints a bare rupee sign without /quintal", () => {
    for (const mode of ["band", "arrivals", "ohlc"] as const) {
      const text = formatterOf(buildAgriChartOption(input({ mode })))([{ dataIndex: 1 }]);
      expect(text).not.toMatch(/₹(?!\/quintal)/);
    }
  });
});

describe("agriChartTheme — extracted pure helpers", () => {
  it("keeps the public formatting re-exports identical to the pure module", () => {
    // The entry point must stay the single import surface for existing callers.
    expect(formatAgriDateLabel).toBe(themeFormatAgriDateLabel);
    expect(formatAgriValue).toBe(themeFormatAgriValue);
  });

  it("has no raw hex colour in the extracted module", () => {
    const source = readFileSync(new URL("./agriChartTheme.ts", import.meta.url), "utf8");
    expect(source.match(/#[0-9a-f]{6}\b/gi) ?? []).toEqual([]);
  });

  it("reuses two frozen theme token sets instead of rebuilding them", () => {
    const dark = themeTokens(true);
    const light = themeTokens(false);
    expect(dark).toBe(themeTokens(true));
    expect(light).toBe(themeTokens(false));
    expect(dark).not.toBe(light);
    expect(Object.isFrozen(dark)).toBe(true);
    expect(Object.isFrozen(light)).toBe(true);

    expect(dark.text).toBe(palette.CHART_DARK_TEXT);
    expect(dark.muted).toBe(palette.CHART_DARK_MUTED);
    expect(dark.border).toBe(palette.BORDER);
    expect(dark.split).toBe(palette.CHART_DARK_SPLIT);
    expect(dark.tooltipBg).toBe(palette.CHART_DARK_OVERLAY);
    expect(dark.crosshair).toBe(palette.CHART_CROSSHAIR);
    expect(light.text).toBe(palette.CHART_LIGHT_TEXT);
    expect(light.muted).toBe(palette.CHART_LIGHT_MUTED);
    expect(light.border).toBe(palette.CHART_LIGHT_BORDER);
    expect(light.split).toBe(palette.CHART_LIGHT_SPLIT);
    expect(light.tooltipBg).toBe(palette.CHART_LIGHT_OVERLAY);
    expect(light.crosshair).toBe(palette.CHART_CROSSHAIR);
  });

  it("finite rejects null, undefined, NaN and infinities", () => {
    expect(finite(0)).toBe(0);
    expect(finite(-12.5)).toBe(-12.5);
    expect(finite(null)).toBeNull();
    expect(finite(undefined)).toBeNull();
    expect(finite(Number.NaN)).toBeNull();
    expect(finite(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("formats dates defensively", () => {
    expect(formatAgriDateLabel("")).toBe("");
    expect(formatAgriDateLabel("not-a-date-that-is-long")).toBe("not-a-date");
    expect(formatAgriDateLabel(undefined as unknown as string)).toBe("");
  });

  it("compacts axis levels in millions, thousands and units", () => {
    expect(compactAxisLabel(120)).toBe("120");
    expect(compactAxisLabel(1_200)).toBe("1.2k");
    expect(compactAxisLabel(1_200_000)).toBe("1.2M");
    expect(compactAxisLabel(-1_500)).toBe("-1.5k");
  });

  it("formats indexed levels and percentages with one decimal", () => {
    expect(formatIndexLevel(110)).toBe("110.0");
    expect(formatIndexLevel(100.04)).toBe("100.0");
    expect(formatPct(10)).toBe("+10.0%");
    expect(formatPct(-2.5)).toBe("-2.5%");
    expect(formatPct(Number.NaN)).toBe("—");
  });

  it("escapes tooltip text and drops empty rows", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
    expect(tooltipShell("H", ["a", "", "b"])).toBe(
      `<div style="font-family:monospace;font-size:${typeSize("micro")}px;line-height:1.5">` +
        `<div style="font-weight:600;margin-bottom:4px">H</div>ab</div>`,
    );
    expect(tooltipShell("<b>", [])).toContain("&lt;b&gt;");
    expect(field("Modal", "₹100")).toBe("<div>Modal: <b>₹100</b></div>");
    expect(field("A&B", "x")).toBe("<div>A&amp;B: <b>x</b></div>");
  });

  it("normalises ECharts tooltip params", () => {
    const param = { dataIndex: 2 };
    expect(asParams(param)).toEqual([param]);
    expect(asParams([param, null, 3, { dataIndex: 4 }])).toEqual([param, { dataIndex: 4 }]);
    expect(asParams(null)).toEqual([]);
    expect(asParams("nope")).toEqual([]);
  });

  it("builds axes, dataZoom and the option shell from theme tokens", () => {
    const t = themeTokens(false);
    const category = categoryAxis(["01 Jan"], t, 0, true);
    expect(category.type).toBe("category");
    expect(category.boundaryGap).toBe(false);
    expect(category.axisLabel).toMatchObject({
      interval: "auto",
      hideOverlap: true,
      margin: CHART_LAYOUT.axisMargin,
    });
    expect(categoryAxis([], t, 1, false)).toMatchObject({ boundaryGap: true, axisLabel: { show: false } });

    const axis = valueAxis(t, 0, "qtl");
    expect(axis).toMatchObject({ type: "value", scale: true, name: "qtl", gridIndex: 0 });
    const labelFormatter = (axis.axisLabel as { formatter: (v: number) => string }).formatter;
    expect(labelFormatter(1_200)).toBe("1.2k");

    const zoom = makeDataZoom(t, [0, 1], 25);
    expect(zoom.map((z) => z.type)).toEqual(["inside", "slider"]);
    expect(zoom[0].start).toBe(25);
    expect(zoom[0].end).toBe(100);
    expect((zoom[1].textStyle as { color: string }).color).toBe(t.muted);

    const formatter = () => "tip";
    const shell = baseOption(t, "T", ["A"], formatter);
    expect(shell.animation).toBe(false);
    expect(shell.backgroundColor).toBe("transparent");
    expect((shell.title as { text: string }).text).toBe("T");
    expect((shell.legend as { show: boolean; data: string[] }).show).toBe(true);
    expect((shell.tooltip as { formatter: typeof formatter }).formatter).toBe(formatter);
    expect((baseOption(t, "T", [], formatter).legend as { show: boolean }).show).toBe(false);

    expect(titled("Mode")).toBe("Mode");
    expect(titled("Mode", "2024-01-02")).toBe("Mode · as of 2024-01-02");
  });
});

describe("band/compare output contracts", () => {
  it("locks the band header, grid and category axis", () => {
    const option = buildAgriChartOption(input());
    expect((option.title as { text: string }).text).toBe("Modal price with min–max band");
    expect((option.legend as { data: string[] }).data).toEqual(["Modal", "Min–Max band"]);
    expect((option.grid as unknown[])).toHaveLength(1);
    expect((option.xAxis as Series[])[0].boundaryGap).toBe(false);
    expect(((option.xAxis as Series[])[0].axisLabel as { margin: number }).margin).toBe(CHART_LAYOUT.axisMargin);
    const zoom = option.dataZoom as Series[];
    expect(zoom.map((z) => z.type)).toEqual(["inside", "slider"]);
    expect(zoom[0].start).toBe(0);
  });

  it("locks compare indexing, base markLine and zoom", () => {
    const option = buildAgriChartOption(input({ mode: "compare", comparison }));
    const series = seriesOf(option);
    expect(series.map((s) => s.connectNulls)).toEqual([false, false]);
    expect((series[0].lineStyle as { width: number }).width).toBe(1.75);
    const markLine = series[0].markLine as { data: { yAxis: number; label: { formatter: string } }[] };
    expect(markLine.data[0].yAxis).toBe(100);
    expect(markLine.data[0].label.formatter).toBe("100 (base)");
    expect(series[1].markLine).toBeUndefined();
    expect((option.xAxis as Series[])[0].data).toEqual(["02 Jan", "03 Jan"]);
    expect((option.dataZoom as Series[]).map((z) => z.type)).toEqual(["inside", "slider"]);
  });

  it("shortens the compare header and end-labels series on a 390 panel", () => {
    const option = buildAgriChartOption(input({ mode: "compare", comparison, compact: true }));
    expect((option.title as { text: string }).text).toBe("Indexed to 100 · common start");
    const series = seriesOf(option);
    expect(series[0].endLabel).toMatchObject({ show: true, formatter: "Rice" });
    expect(series[1].endLabel).toMatchObject({ show: true, formatter: "Wheat" });
    const markLine = series[0].markLine as { data: { label: { formatter: string } }[] };
    expect(markLine.data[0].label.formatter).toBe("100");
  });
});

describe("layout and legibility invariants", () => {
  const cases: Array<[string, Option]> = [
    ["band", buildAgriChartOption(input())],
    ["arrivals", buildAgriChartOption(input({ mode: "arrivals" }))],
    ["compare", buildAgriChartOption(input({ mode: "compare", comparison }))],
    ["ohlc", buildAgriChartOption(input({ mode: "ohlc" }))],
  ];

  it("stacks title → legend → plot in every mode", () => {
    for (const [mode, option] of cases) {
      const title = option.title as { top: number; textStyle: { fontSize: number } };
      const legend = option.legend as { top: number; textStyle: { fontSize: number } };
      const grid = (option.grid as Array<{ top: number }>)[0];
      expect(title.top, mode).toBeLessThan(legend.top);
      expect(legend.top + 14, mode).toBeLessThanOrEqual(grid.top);
      expect(title.textStyle.fontSize, mode).toBe(typeSize("label"));
      expect(legend.textStyle.fontSize, mode).toBe(typeSize("micro"));
    }
  });

  it("keeps visible x labels clear of the plot edge and the zoom slider", () => {
    for (const [mode, option] of cases) {
      const axes = option.xAxis as Series[];
      const visible = axes.find((axis) => (axis.axisLabel as Series)?.show !== false);
      const label = visible?.axisLabel as { margin: number; hideOverlap: boolean; fontSize: number };
      expect(label.margin, mode).toBeGreaterThanOrEqual(8);
      expect(label.hideOverlap, mode).toBe(true);
      expect(label.fontSize, mode).toBe(typeSize("micro"));
    }
    for (const [mode, option] of cases) {
      const grids = option.grid as Array<{ bottom: number | string }>;
      const last = grids[grids.length - 1];
      expect(typeof last.bottom === "number" && last.bottom >= 40, mode).toBe(true);
    }
  });

  it("never sets a chart font below the 12px token floor in any mode", () => {
    for (const [mode, option] of cases) {
      expect(fontSizes(option).every((size) => size >= typeSize("micro")), mode).toBe(true);
    }
  });
});

describe("band scale robustness", () => {
  const withOutlier: AgriChartSeriesPoint[] = [
    ...Array.from({ length: 8 }, (_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, "0")}`,
      modal: 100 + i,
      min: 90 + i,
      max: 115 + i,
      arrivals_qtl: null,
      market_count: 3,
    })),
    { date: "2024-01-09", modal: 104, min: 0, max: 100_000, arrivals_qtl: null, market_count: 3 },
  ];

  it("clips the displayed band range to a robust IQR fence", () => {
    const bounds = robustBandBounds(withOutlier);
    expect(bounds).not.toBeNull();
    expect(bounds!.max).toBeLessThan(1_000);
    expect(bounds!.min).toBeGreaterThan(-100);
    const option = buildAgriChartOption(input({ series: withOutlier }));
    const yAxis = (option.yAxis as Series[])[0] as { min: number; max: number };
    expect(yAxis.max).toBeLessThan(1_000);
    const modals = withOutlier.map((row) => row.modal as number);
    expect(yAxis.min).toBeLessThanOrEqual(Math.min(...modals));
    expect(yAxis.max).toBeGreaterThanOrEqual(Math.max(...modals));
  });

  it("keeps the raw min/max in the tooltip while the band is clipped", () => {
    const tooltip = formatterOf(buildAgriChartOption(input({ series: withOutlier })));
    const text = tooltip([{ dataIndex: 8 }]);
    expect(text).toContain("0 ₹/quintal");
    expect(text).toContain("1,00,000 ₹/quintal");
    expect(text).not.toMatch(/undefined|NaN/);
  });
});

describe("gap markers", () => {
  const gapped: AgriChartSeriesPoint[] = [
    { date: "2024-01-01", modal: 100, min: 90, max: 110, arrivals_qtl: null, market_count: 4 },
    { date: "2024-01-02", modal: 110, min: 100, max: 120, arrivals_qtl: null, market_count: 4 },
    { date: "2024-02-01", modal: 200, min: 190, max: 210, arrivals_qtl: null, market_count: 4 },
  ];

  it("renders a blank category label and a null break at the gap", () => {
    const option = buildAgriChartOption(input({ series: gapped }));
    expect((option.xAxis as Series[])[0].data).toEqual(["01 Jan", "02 Jan", "", "01 Feb"]);
    expect(seriesOf(option)[0].data).toEqual([100, 110, null, 200]);
    expect(seriesOf(option)[0].connectNulls).toBeUndefined();
  });

  it("explains the gap in the tooltip", () => {
    const text = formatterOf(buildAgriChartOption(input({ series: gapped })))([{ dataIndex: 2 }]);
    expect(text).toContain("Data gap");
    expect(text).toContain("Interval");
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it("blanks gap labels in compare mode without altering indexed values", () => {
    const option = buildAgriChartOption(
      input({
        mode: "compare",
        comparison: [
          {
            key: "a",
            label: "A",
            points: [
              { date: "2024-01-01", modal: 100 },
              { date: "2024-02-01", modal: 110 },
            ],
          },
        ],
      }),
    );
    expect((option.xAxis as Series[])[0].data).toEqual(["01 Jan", "", "01 Feb"]);
    expect(seriesOf(option)[0].data).toEqual([100, null, 110]);
  });
});
