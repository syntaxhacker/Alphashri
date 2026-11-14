import { describe, expect, it } from "vitest";
import type { HeatmapStock } from "../../api/heatmap";
import { METRICS } from "./heatmapUtils";
import {
  SECTOR_STOCK_METRICS,
  buildStockTreemapOption,
  getStockMetricRange,
  resolveStockMetric,
  type StockTreemapStyle,
} from "./stockTreemap";

const STYLE: StockTreemapStyle = {
  borderDark: "#000",
  borderLight: "#fff",
  label: { fontSize: 10, fontWeight: 600, lineHeight: 13 },
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

type Tile = { metricLabel?: string; metricValue?: string };
type Option = {
  series: Array<{ data: Tile[]; label: { fontSize: number }; levels: unknown[] }>;
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
    expect(light.series[0].label.fontSize).toBe(10);
    // no colorSaturation band when the surface does not ask for one
    expect(light.series[0].levels[1]).toEqual({
      itemStyle: { borderColorSaturation: 0.6, gapWidth: 0, borderWidth: 1 },
    });
  });

  it("computes the metric range across stocks", () => {
    expect(getStockMetricRange([stock], "pe_ratio")).toEqual({ min: 22.5, max: 22.5 });
    expect(getStockMetricRange([], "pe_ratio")).toEqual({ min: 0, max: 1 });
  });
});
