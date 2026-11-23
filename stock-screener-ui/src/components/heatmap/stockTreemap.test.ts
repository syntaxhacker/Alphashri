import { describe, expect, it } from "vitest";
import type { HeatmapStock } from "../../api/heatmap";
import {
  CREAM,
  BROWN_DARK,
  SURFACE,
  TRADING_GREEN,
  TRADING_RED,
} from "../../config/colors";
import { BG } from "../../config/colors";
import * as palette from "../../ui/palette";
import { METRICS } from "./heatmapUtils";
import {
  SECTOR_STOCK_METRICS,
  buildStockTreemapOption,
  getStockMetricRange,
  resolveStockMetric,
  safeFmt,
  type MetricConfig,
  type StockTreemapStyle,
} from "./stockTreemap";
import { getMetricValue, getHeatmapMetricColor } from "./heatmapUtils";

const STYLE: StockTreemapStyle = {
  borderDark: "#000",
  borderLight: "#fff",
  label: { fontSize: 12, fontWeight: 600, lineHeight: 13 },
  changePositive: "#0a0",
  changeNegative: "#a00",
};

const stock: HeatmapStock = {
  symbol: "RELIANCE",
  name: "Reliance Industries",
  sector: "Energy",
  market_cap: 15_000_000_000_000,
  pe_ratio: 22.5,
  pb_ratio: 2.5,
  dividend_yield: 0.8,
  perf_1y: 12.3,
  roe: 15.2,
  high_52w: 3000,
  low_52w: 2400,
  price: 2850,
  change_pct: 1.234,
};

type Tile = {
  name?: string;
  value?: number;
  metricLabel?: string;
  metricValue?: string;
  metricNumeric?: number;
  itemStyle?: { color?: string };
};
type Option = {
  series: Array<{
    data: Tile[];
    label: { fontSize: number };
    levels: unknown[];
    nodeClick?: boolean;
    roam?: boolean;
    breadcrumb?: { show: boolean };
  }>;
};

describe("stockTreemap metric definitions", () => {
  it("gives every sector metric a formatter", () => {
    expect(SECTOR_STOCK_METRICS.length).toBeGreaterThan(0);
    for (const metric of SECTOR_STOCK_METRICS) {
      expect(typeof metric.fmt).toBe("function");
      expect(typeof metric.fmt(1.234)).toBe("string");
    }
  });

  it("keeps the sector order and appends the heatmap metrics unchanged", () => {
    expect(SECTOR_STOCK_METRICS.map((m) => m.value)).toEqual([
      "change_pct",
      "market_cap",
      "pe_ratio",
      "pb_ratio",
      "dividend_yield",
      "perf_1y",
      "roe",
    ]);
    expect(SECTOR_STOCK_METRICS.slice(1)).toEqual(METRICS);
  });

  it("resolves an unknown metric to the first entry", () => {
    expect(resolveStockMetric(SECTOR_STOCK_METRICS, "nope").value).toBe("change_pct");
    expect(resolveStockMetric(METRICS, "nope").value).toBe("market_cap");
  });
});

describe("buildStockTreemapOption", () => {
  it("formats the active metric label instead of throwing", () => {
    const option = buildStockTreemapOption(
      [stock],
      "change_pct",
      SECTOR_STOCK_METRICS,
      false,
      STYLE,
    ) as unknown as Option;
    const tile = option.series[0].data[0];
    expect(tile.metricLabel).toBe("Day Change %");
    expect(tile.metricValue).toBe("+1.23%");
  });

  it("formats market cap tiles with the shared formatter", () => {
    const option = buildStockTreemapOption(
      [stock],
      "market_cap",
      SECTOR_STOCK_METRICS,
      false,
      STYLE,
    ) as unknown as Option;
    expect(option.series[0].data[0].metricValue).toBe("₹15.0T");
  });

  it("applies the caller's label style and border colours", () => {
    const light = buildStockTreemapOption([stock], "roe", METRICS, false, STYLE) as unknown as Option;
    expect(light.series[0].label.fontSize).toBe(12);
    // no colorSaturation band when the surface does not ask for one
    expect(light.series[0].levels[1]).toEqual({
      itemStyle: { borderColorSaturation: 0.6, gapWidth: 0, borderWidth: 1 },
    });
  });

  it("disables node-click zoom and breadcrumb, keeps roam off", () => {
    const option = buildStockTreemapOption(
      [stock],
      "change_pct",
      SECTOR_STOCK_METRICS,
      false,
      STYLE,
    ) as unknown as Option;
    expect(option.series[0].nodeClick).toBe(false);
    expect(option.series[0].roam).toBe(false);
    expect(option.series[0].breadcrumb.show).toBe(false);
  });

  it("computes the metric range across stocks", () => {
    expect(getStockMetricRange([stock], "pe_ratio")).toEqual({ min: 22.5, max: 22.5 });
    expect(getStockMetricRange([], "pe_ratio")).toEqual({ min: 0, max: 1 });
  });

  it("renders a missing value as an em dash, never as a zero", () => {
    const pct = { fmt: (v: number) => `${v.toFixed(1)}%` };
    expect(safeFmt(pct, null)).toBe("—");
    expect(safeFmt(pct, undefined)).toBe("—");
    expect(safeFmt(pct, "")).toBe("—");
    expect(safeFmt(pct, Number.NaN)).toBe("—");
    expect(safeFmt(pct, 0)).toBe("0.0%");
  });

  it("does not label a null metric as 0% in the tooltip", () => {
    const bare: HeatmapStock = { ...stock, change_pct: Number.NaN };
    const option = buildStockTreemapOption(
      [bare],
      "change_pct",
      SECTOR_STOCK_METRICS,
      false,
      STYLE,
    ) as unknown as {
      tooltip: { formatter: (p: { data: Record<string, unknown> }) => string };
      series: Array<{ data: Array<Record<string, unknown>> }>;
    };
    const first = option.series[0]!.data[0]!;
    const html = option.tooltip.formatter({ data: first });
    expect(html).toContain("<b>—</b>");
    expect(html).not.toContain("0.0%");
    expect(html).not.toContain("+0.00%");
  });
});

const SIZING_METRICS: MetricConfig[] = [
  ...SECTOR_STOCK_METRICS,
  { value: "rsi", label: "RSI", fmt: (v) => v.toFixed(1) },
];

const tilesOf = (
  stocks: HeatmapStock[],
  metric: string,
  sizeBy: Parameters<typeof buildStockTreemapOption>[5] = "metric",
  style: StockTreemapStyle = STYLE,
) =>
  (
    buildStockTreemapOption(stocks, metric, SIZING_METRICS, false, style, sizeBy) as unknown as Option
  ).series[0].data as Tile[];

describe("metric-driven tile sizing", () => {
  const rows: Array<HeatmapStock & { rsi: number }> = [
    { ...stock, symbol: "UP", change_pct: 2.5, rsi: 70, roe: 15 },
    { ...stock, symbol: "DOWN", change_pct: -3.25, rsi: 25, roe: -8 },
  ];

  test("tile area is the absolute value of each active metric", () => {
    expect(tilesOf(rows, "change_pct").map((d) => [d.name, d.value])).toEqual([
      ["UP", 2.5],
      ["DOWN", 3.25],
    ]);
    expect(tilesOf(rows, "rsi").map((d) => [d.name, d.value])).toEqual([
      ["UP", 70],
      ["DOWN", 25],
    ]);
    expect(tilesOf(rows, "roe").map((d) => [d.name, d.value])).toEqual([
      ["UP", 15],
      ["DOWN", 8],
    ]);
  });

  test("a negative day change gets a positive area equal to its magnitude", () => {
    const down = tilesOf([rows[1]], "change_pct")[0]!;
    expect(down.value).toBe(3.25);
    expect(down.value).toBe(Math.abs(getMetricValue(rows[1], "change_pct")));
  });

  test("missing metric values are dropped, never emitted as a zero/NaN area", () => {
    const mixed: HeatmapStock[] = [
      { ...stock, symbol: "GOOD", change_pct: 4 },
      { ...stock, symbol: "NAN", change_pct: Number.NaN },
      { ...stock, symbol: "INF", change_pct: Number.POSITIVE_INFINITY },
    ];
    const data = tilesOf(mixed, "change_pct");
    expect(data.map((d) => d.name)).toEqual(["GOOD"]);
    expect(data[0]!.value).toBe(4);
    expect(data.every((d) => Number.isFinite(d.value) && d.value! > 0)).toBe(true);
  });

  test("size and colour are derived from the same signed metric value", () => {
    const row = rows[1]!;
    const tile = tilesOf([row], "change_pct")[0]!;
    expect(tile.metricNumeric).toBe(getMetricValue(row, "change_pct"));
    expect(tile.value).toBe(Math.abs(tile.metricNumeric!));
    expect(tile.itemStyle!.color).toBe(
      getHeatmapMetricColor("change_pct", tile.metricNumeric!, tile.metricNumeric!, tile.metricNumeric!),
    );
  });

  test("legacy uniform and market_cap sizing stay byte-identical", () => {
    const legacy: HeatmapStock[] = [
      { ...stock, symbol: "A", market_cap: 12_000_000_000 },
      { ...stock, symbol: "B", market_cap: 0 },
      { ...stock, symbol: "C", market_cap: 30_000_000_000 },
    ];
    expect(tilesOf(legacy, "roe", "uniform").map((d) => d.value)).toEqual([1, 1, 1]);
    expect(tilesOf(legacy, "roe", "market_cap").map((d) => d.value)).toEqual([
      12_000_000_000, 0, 30_000_000_000,
    ]);
    // Dropping zero weights is a metric-mode rule only; legacy callers keep every row.
    expect(tilesOf(legacy, "roe", "market_cap").map((d) => d.name)).toEqual(["A", "B", "C"]);
  });

  test("a real zero stays visible at a floored area below every non-zero tile", () => {
    const mixed: HeatmapStock[] = [
      { ...stock, symbol: "BIG", change_pct: 4 },
      { ...stock, symbol: "SMALL", change_pct: 0.5 },
      { ...stock, symbol: "FLAT", change_pct: 0 },
      { ...stock, symbol: "MISSING", change_pct: Number.NaN },
    ];
    const data = tilesOf(mixed, "change_pct");
    expect(data.map((d) => d.name)).toEqual(["BIG", "SMALL", "FLAT"]);
    const flat = data.find((d) => d.name === "FLAT")!;
    expect(flat.value).toBeGreaterThan(0);
    expect(flat.value!).toBeLessThan(0.5);
    // 1% of the smallest non-zero area, not a floor relative to the largest.
    expect(flat.value).toBeCloseTo(0.005, 10);
  });

  test("when every metric is zero the tiles share a uniform area", () => {
    const zeros: HeatmapStock[] = [
      { ...stock, symbol: "A", change_pct: 0 },
      { ...stock, symbol: "B", change_pct: 0 },
    ];
    expect(tilesOf(zeros, "change_pct").map((d) => d.value)).toEqual([1, 1]);
  });

  test("a kept zero tile is coloured by its real zero value", () => {
    const mixed: HeatmapStock[] = [
      { ...stock, symbol: "UP", change_pct: 2 },
      { ...stock, symbol: "FLAT", change_pct: 0 },
    ];
    const flat = tilesOf(mixed, "change_pct").find((d) => d.name === "FLAT")!;
    expect(flat.metricNumeric).toBe(0);
    expect(flat.itemStyle!.color).toBe(getHeatmapMetricColor("change_pct", 0, 0, 2));
  });

  test("the tooltip states that tile area follows the metric", () => {
    const built = buildStockTreemapOption(
      [rows[1]!],
      "change_pct",
      SIZING_METRICS,
      false,
      STYLE,
      "metric",
    ) as unknown as {
      tooltip: { formatter: (p: { data: Tile }) => string };
      series: Array<{ data: Tile[] }>;
    };
    const html = built.tooltip.formatter({ data: built.series[0]!.data[0]! });
    expect(html).toContain("Tile size");
    expect(html).toContain("Day Change %");
  });

  test("legacy tooltips do not gain a size line", () => {
    const buildTooltip = (sizeBy: Parameters<typeof buildStockTreemapOption>[5]) =>
      (
        buildStockTreemapOption([rows[1]!], "change_pct", SIZING_METRICS, false, STYLE, sizeBy) as unknown as {
          tooltip: { formatter: (p: { data: Tile }) => string };
          series: Array<{ data: Tile[] }>;
        }
      ).tooltip.formatter;
    const formatter = buildTooltip("market_cap");
    expect(formatter({ data: { name: "DOWN" } })).not.toContain("Tile size");
  });
});

describe("descending tile order (market map only)", () => {
  const ordered: HeatmapStock[] = [
    { ...stock, symbol: "SMALL", change_pct: 2, market_cap: 10_000_000_000 },
    { ...stock, symbol: "BIG", change_pct: 5, market_cap: 90_000_000_000 },
    { ...stock, symbol: "MID", change_pct: -3, market_cap: 50_000_000_000 },
  ];
  const descStyle: StockTreemapStyle = { ...STYLE, sortTilesByValueDesc: true };

  it("emits tiles largest-first, so the first tile is the max", () => {
    const tiles = tilesOf(ordered, "change_pct", "metric", descStyle);
    expect(tiles.map((d) => d.name)).toEqual(["BIG", "MID", "SMALL"]);
    expect(tiles.map((d) => d.value)).toEqual([5, 3, 2]);
    expect(tiles[0]!.value).toBe(Math.max(...tiles.map((d) => d.value!)));
  });

  it("keeps equal-area tiles in their incoming order", () => {
    const tied: HeatmapStock[] = [
      { ...stock, symbol: "A", change_pct: 2 },
      { ...stock, symbol: "B", change_pct: -2 },
      { ...stock, symbol: "C", change_pct: 2 },
    ];
    expect(tilesOf(tied, "change_pct", "metric", descStyle).map((d) => d.name)).toEqual([
      "A", "B", "C",
    ]);
  });

  it("leaves the floored zero tile visible at the bottom of the ranking", () => {
    const withZero: HeatmapStock[] = [
      { ...stock, symbol: "ZERO", change_pct: 0 },
      { ...stock, symbol: "HALF", change_pct: 0.5 },
      { ...stock, symbol: "BIG", change_pct: 4 },
    ];
    const tiles = tilesOf(withZero, "change_pct", "metric", descStyle);
    expect(tiles.map((d) => d.name)).toEqual(["BIG", "HALF", "ZERO"]);
    expect(tiles[2]!.value!).toBeGreaterThan(0);
    expect(tiles[2]!.value!).toBeCloseTo(0.005, 10);
  });

  it("does not mutate the caller's stock array", () => {
    const input = [...ordered];
    tilesOf(input, "change_pct", "metric", descStyle);
    expect(input.map((s) => s.symbol)).toEqual(["SMALL", "BIG", "MID"]);
  });
});

describe("shared builder regression guard — NSE and sector callers are byte-identical", () => {
  // Exact `JSON.stringify` of the option produced for each surface by the
  // builder BEFORE the market-map-only sort flag was added (functions replaced
  // by a stable marker). Neither caller sets the flag, so their output must
  // stay exactly this — including the incoming ZZZ, AAA tile order.
  const NSE_BEFORE =
    '{"tooltip":{"trigger":"item","backgroundColor":"#1F242D","borderColor":"#2C313B","textStyle":{"color":"#E8E8E8"},"formatter":"[fn]"},"series":[{"type":"treemap","sort":false,"top":0,"left":0,"right":0,"bottom":0,"roam":false,"nodeClick":false,"squareRatio":1,"label":{"show":true,"formatter":"[fn]","font-size":"12px","font-weight":"bold","line-height":14,"textBorderColor":"#000000","textBorderWidth":0.5},"breadcrumb":{"show":false},"itemStyle":{"borderColor":"#13161C","borderWidth":1,"gapWidth":0},"levels":[{"itemStyle":{"borderColor":"#13161C","borderWidth":0,"gapWidth":0}},{"colorSaturation":[0.35,0.5],"itemStyle":{"borderColorSaturation":0.6,"gapWidth":0,"borderWidth":1}}],"data":[{"name":"ZZZ","value":1,"path":"ZZZ","nameFull":"Reliance Industries","sector":"Energy","price":2850,"change":-2.5,"mcap":15000000000000,"pe":22.5,"metricLabel":"Day Change %","metricValue":"-2.50%","metricNumeric":-2.5,"label":{"color":"#F0F6FC"},"itemStyle":{"color":"rgb(168,41,50)"}},{"name":"AAA","value":1,"path":"AAA","nameFull":"Reliance Industries","sector":"Energy","price":2850,"change":1.25,"mcap":15000000000000,"pe":22.5,"metricLabel":"Day Change %","metricValue":"+1.25%","metricNumeric":1.25,"label":{"color":"#F0F6FC"},"itemStyle":{"color":"rgb(24,155,95)"}}]}]}';
  const SECTOR_BEFORE =
    '{"tooltip":{"trigger":"item","backgroundColor":"#FFFFFF","borderColor":"#D0D7DE","textStyle":{"color":"#0D1117"},"formatter":"[fn]"},"series":[{"type":"treemap","sort":false,"top":0,"left":0,"right":0,"bottom":0,"roam":false,"nodeClick":false,"squareRatio":1,"label":{"show":true,"formatter":"[fn]","fontSize":12,"fontWeight":600,"lineHeight":13,"textShadowColor":"rgba(0, 0, 0, 0.45)","textShadowBlur":2},"breadcrumb":{"show":false},"itemStyle":{"borderColor":"#F0F6FC","borderWidth":1,"gapWidth":0},"levels":[{"itemStyle":{"borderColor":"#F0F6FC","borderWidth":0,"gapWidth":0}},{"itemStyle":{"borderColorSaturation":0.6,"gapWidth":0,"borderWidth":1}}],"data":[{"name":"ZZZ","value":1,"path":"ZZZ","nameFull":"Reliance Industries","sector":"Energy","price":2850,"change":-2.5,"mcap":15000000000000,"pe":22.5,"metricLabel":"Day Change %","metricValue":"-2.50%","metricNumeric":-2.5,"label":{"color":"#F0F6FC"},"itemStyle":{"color":"rgb(168,41,50)"}},{"name":"AAA","value":1,"path":"AAA","nameFull":"Reliance Industries","sector":"Energy","price":2850,"change":1.25,"mcap":15000000000000,"pe":22.5,"metricLabel":"Day Change %","metricValue":"+1.25%","metricNumeric":1.25,"label":{"color":"#F0F6FC"},"itemStyle":{"color":"rgb(24,155,95)"}}]}]}';

  // The exact style objects used by HeatmapTreemap.tsx and SectorHeatmapView.tsx.
  const nseStyle: StockTreemapStyle = {
    borderDark: SURFACE,
    borderLight: CREAM,
    label: { "font-size": "12px", "font-weight": "bold", "line-height": 14, textBorderColor: BG, textBorderWidth: 0.5 } as never,
    colorSaturation: [0.35, 0.5],
    changePositive: palette.POSITIVE_COLOR,
    changeNegative: palette.NEGATIVE_COLOR,
  };
  const sectorStyle: StockTreemapStyle = {
    borderDark: BROWN_DARK,
    borderLight: CREAM,
    label: {
      fontSize: 12,
      fontWeight: 600,
      lineHeight: 13,
      textShadowColor: "rgba(0, 0, 0, 0.45)",
      textShadowBlur: 2,
    },
    changePositive: TRADING_GREEN,
    changeNegative: TRADING_RED,
  };
  const inputs: HeatmapStock[] = [
    { ...stock, symbol: "ZZZ", change_pct: -2.5 },
    { ...stock, symbol: "AAA", change_pct: 1.25 },
  ];
  const replacer = (_key: string, value: unknown) => (typeof value === "function" ? "[fn]" : value);

  it("NSE heatmap option is unchanged, including tile order", () => {
    const option = buildStockTreemapOption(inputs, "change_pct", SECTOR_STOCK_METRICS, true, nseStyle);
    expect(JSON.stringify(option, replacer)).toBe(NSE_BEFORE);
  });

  it("sector stock heatmap option is unchanged, including tile order", () => {
    const option = buildStockTreemapOption(inputs, "change_pct", SECTOR_STOCK_METRICS, false, sectorStyle);
    expect(JSON.stringify(option, replacer)).toBe(SECTOR_BEFORE);
  });

  it("legacy sizing modes still keep every caller's order", () => {
    for (const sizeBy of ["uniform", "market_cap"] as const) {
      const option = buildStockTreemapOption(inputs, "change_pct", SECTOR_STOCK_METRICS, false, STYLE, sizeBy);
      expect((option as unknown as Option).series[0].data.map((d) => d.name)).toEqual(["ZZZ", "AAA"]);
      expect((option as unknown as { series: Array<{ sort: boolean }> }).series[0].sort).toBe(false);
    }
  });
});
