import { describe, expect, test } from "vitest";
import { MARKET_METRICS, isMarketSignedMetric, toTreemapRow } from "./marketTreemap";
import { getMetricValue, getHeatmapMetricColor } from "@/components/heatmap/heatmapUtils";
import { buildStockTreemapOption, getStockMetricRange, safeFmt } from "@/components/heatmap/stockTreemap";
import type { HeatmapStock } from "@/api/heatmap";
import type { MarketRow } from "@/types/marketScreener";

const base: MarketRow = {
  symbol: "RELIANCE",
  name: "Reliance Industries",
  sector: "Energy",
  exchange: "NSE",
  close: 1339.7,
  change: 1.25,
  relativeVolume: 1.4,
  marketCapCr: 1805376,
  capTier: "large",
  rsi: 58.2,
  adx: 31.4,
  sma20: 1300,
  sma50: 1280,
  sma200: 1200,
  perfW: 2.1,
  perf1m: 4.6,
  high52w: 1600,
  low52w: 1100,
  pos52w: 48.2,
  peRatio: 22.1,
  pbRatio: 1.92,
  dividendYield: 0.35,
  roe: 9.01,
  fno: true,
  etf: false,
};

/** The shape that blanked the screener: a name TV has no fundamentals for. */
const noFundamentals: MarketRow = {
  ...base,
  symbol: "NOFUND",
  peRatio: null,
  pbRatio: null,
  dividendYield: null,
  roe: null,
  rsi: null,
  adx: null,
  pos52w: null,
  perfW: null,
  perf1m: null,
  relativeVolume: null,
  close: null,
  change: null,
  marketCapCr: null,
};

describe("toTreemapRow", () => {
  test("converts ₹ crore market cap to rupees for the treemap formatter", () => {
    expect(toTreemapRow(base).market_cap).toBeCloseTo(1805376 * 1e7, 0);
  });

  test("maps the live metrics the heatmap rows do not carry", () => {
    const out = toTreemapRow(base);
    expect(out.rsi).toBe(58.2);
    expect(out.adx).toBe(31.4);
    expect(out.relative_volume).toBe(1.4);
    expect(out.pos_52w).toBe(48.2);
  });

  test("carries the fundamentals the market snapshot now returns", () => {
    const out = toTreemapRow(base);
    expect(out.pe_ratio).toBe(22.1);
    expect(out.pb_ratio).toBe(1.92);
    expect(out.dividend_yield).toBe(0.35);
    expect(out.roe).toBe(9.01);
  });

  test("keeps a missing sector renderable", () => {
    expect(toTreemapRow({ ...base, sector: null }).sector).toBe("—");
  });
});

describe("a row with no fundamentals must never crash the map", () => {
  test("every metric resolves to a finite number", () => {
    const row = toTreemapRow(noFundamentals);
    for (const metric of MARKET_METRICS) {
      const value = getMetricValue(row as HeatmapStock, metric.value);
      expect(Number.isFinite(value), `${metric.value} was ${value}`).toBe(true);
    }
  });

  test("every metric formats to a string, never throws", () => {
    const row = toTreemapRow(noFundamentals);
    for (const metric of MARKET_METRICS) {
      const value = getMetricValue(row as HeatmapStock, metric.value);
      expect(() => safeFmt(metric, value), metric.value).not.toThrow();
      expect(typeof safeFmt(metric, value)).toBe("string");
    }
  });

  test("safeFmt renders a dash for undefined and NaN", () => {
    const metric = MARKET_METRICS.find((m) => m.value === "pe_ratio")!;
    expect(safeFmt(metric, undefined)).toBe("—");
    expect(safeFmt(metric, Number.NaN)).toBe("—");
    expect(safeFmt(metric, Number.POSITIVE_INFINITY)).toBe("—");
  });

  test("safeFmt still formats a real number", () => {
    const metric = MARKET_METRICS.find((m) => m.value === "pe_ratio")!;
    expect(safeFmt(metric, 22.14)).toBe("22.1");
  });

  test("safeFmt survives a formatter that throws", () => {
    const angry = { value: "x", label: "X", fmt: () => { throw new Error("boom"); } };
    expect(safeFmt(angry, 5)).toBe("—");
  });

  test("the metric range is finite even when every row lacks the value", () => {
    const rows = [toTreemapRow(noFundamentals), toTreemapRow({ ...noFundamentals, symbol: "B" })];
    const { min, max } = getStockMetricRange(rows as HeatmapStock[], "pe_ratio");
    expect(Number.isFinite(min)).toBe(true);
    expect(Number.isFinite(max)).toBe(true);
    expect(max).toBeGreaterThanOrEqual(min);
  });

  test("building the whole treemap option for a mixed universe does not throw", () => {
    const rows = [
      toTreemapRow(base),
      toTreemapRow(noFundamentals),
      toTreemapRow({ ...base, symbol: "MID", peRatio: null, rsi: 40 }),
    ] as HeatmapStock[];
    for (const metric of MARKET_METRICS) {
      expect(() =>
        buildStockTreemapOption(rows, metric.value, MARKET_METRICS, true, {
          borderDark: "#000",
          borderLight: "#fff",
          label: { fontSize: 11, fontWeight: 600, lineHeight: 1 },
          changePositive: "#0f0",
          changeNegative: "#f00",
        }),
        metric.value,
      ).not.toThrow();
    }
  });

  test("colouring a missing value stays within the ramp instead of returning NaN", () => {
    const row = toTreemapRow(noFundamentals);
    for (const metric of MARKET_METRICS) {
      const value = getMetricValue(row as HeatmapStock, metric.value);
      const colour = getHeatmapMetricColor(metric.value, value, 0, 100);
      expect(colour, metric.value).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    }
  });
});

describe("MARKET_METRICS", () => {
  test("offers both live technicals and fundamentals", () => {
    const values = MARKET_METRICS.map((m) => m.value);
    expect(values).toEqual(
      expect.arrayContaining(["change_pct", "rsi", "pos_52w", "pe_ratio", "roe"]),
    );
  });

  test("treats direction-carrying metrics as signed", () => {
    expect(isMarketSignedMetric("change_pct")).toBe(true);
    expect(isMarketSignedMetric("pos_52w")).toBe(true);
    expect(isMarketSignedMetric("rsi")).toBe(false);
  });
});
