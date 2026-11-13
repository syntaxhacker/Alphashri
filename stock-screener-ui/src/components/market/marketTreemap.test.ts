import { describe, expect, test } from "vitest";
import { MARKET_METRICS, isMarketSignedMetric, toTreemapRow } from "./marketTreemap";
import type { MarketRow } from "@/types/marketScreener";

const row: MarketRow = {
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

describe("toTreemapRow", () => {
  test("converts ₹ crore market cap to rupees for the treemap formatter", () => {
    expect(toTreemapRow(row).market_cap).toBeCloseTo(1805376 * 1e7, 0);
  });

  test("maps the live metrics the heatmap rows do not carry", () => {
    const out = toTreemapRow(row);
    expect(out.rsi).toBe(58.2);
    expect(out.adx).toBe(31.4);
    expect(out.relative_volume).toBe(1.4);
    expect(out.pos_52w).toBe(48.2);
    expect(out.perf_w).toBe(2.1);
    expect(out.perf_1m).toBe(4.6);
  });

  test("carries the fundamentals the market snapshot now returns", () => {
    const out = toTreemapRow(row);
    expect(out.pe_ratio).toBe(22.1);
    expect(out.pb_ratio).toBe(1.92);
    expect(out.dividend_yield).toBe(0.35);
    expect(out.roe).toBe(9.01);
  });

  test("keeps a missing sector renderable instead of empty", () => {
    expect(toTreemapRow({ ...row, sector: null }).sector).toBe("—");
  });

  test("survives a row with no fundamentals at all", () => {
    const bare: MarketRow = {
      ...row,
      peRatio: null,
      pbRatio: null,
      dividendYield: null,
      roe: null,
      rsi: null,
      close: null,
      change: null,
      marketCapCr: null,
    };
    const out = toTreemapRow(bare);
    expect(out.price).toBe(0);
    expect(out.market_cap).toBe(0);
    expect(Number.isNaN(out.pe_ratio)).toBe(true);
  });
});

describe("MARKET_METRICS", () => {
  test("offers both live technicals and fundamentals", () => {
    const values = MARKET_METRICS.map((m) => m.value);
    expect(values).toContain("change_pct");
    expect(values).toContain("rsi");
    expect(values).toContain("pos_52w");
    expect(values).toContain("pe_ratio");
  });

  test("every metric has a working formatter", () => {
    for (const metric of MARKET_METRICS) {
      expect(typeof metric.fmt(1.234)).toBe("string");
    }
  });

  test("treats direction-carrying metrics as signed", () => {
    expect(isMarketSignedMetric("change_pct")).toBe(true);
    expect(isMarketSignedMetric("pos_52w")).toBe(true);
    expect(isMarketSignedMetric("rsi")).toBe(false);
  });
});
