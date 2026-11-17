import { describe, expect, test } from "vitest";
import {
  MARKET_METRICS,
  isMarketSignedMetric,
  marketRowsByCapDesc,
  marketSortMetric,
  marketTreemapMetrics,
  toTreemapRow,
} from "./marketTreemap";
import { currencyFor } from "@/config/currency";
import { MARKET_SORT_OPTIONS, type MarketSortKey } from "./marketFilters";
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
    expect(out.perf_w).toBe(2.1);
    expect(out.perf_1m).toBe(4.6);
  });

  test("does not pass the 1-month return off as 1-year", () => {
    expect(toTreemapRow(base).perf_1y).toBeNull();
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

describe("marketRowsByCapDesc", () => {
  const row = (symbol: string, marketCapCr: number | null, rsi: number | null): MarketRow => ({
    ...base,
    symbol,
    marketCapCr,
    rsi,
  });

  test("orders by market cap descending with missing caps last", () => {
    const out = marketRowsByCapDesc([
      row("SMALL", 12_000, 71),
      row("NOCAP", null, 44),
      row("HUGE", 1_805_376, 22),
      row("MID", 240_000, 63),
      row("UNDEFINED", undefined as unknown as null, 55),
    ]);
    expect(out.map((r) => r.symbol)).toEqual(["HUGE", "MID", "SMALL", "NOCAP", "UNDEFINED"]);
  });

  test("keeps equal caps in their incoming order", () => {
    const out = marketRowsByCapDesc([
      row("B", 500, 1),
      row("A", 500, 2),
      row("C", 900, 3),
      row("D", 500, 4),
    ]);
    expect(out.map((r) => r.symbol)).toEqual(["C", "B", "A", "D"]);
  });

  test("does not mutate the incoming rows", () => {
    const input = [row("SMALL", 12_000, 71), row("HUGE", 1_805_376, 22)];
    const snapshot = input.map((r) => r.symbol);
    marketRowsByCapDesc(input);
    expect(input.map((r) => r.symbol)).toEqual(snapshot);
  });

  test("returns a new array even for an already-sorted list", () => {
    const input = [row("HUGE", 1_805_376, 22), row("SMALL", 12_000, 71)];
    const out = marketRowsByCapDesc(input);
    expect(out).not.toBe(input);
    expect(out.map((r) => r.symbol)).toEqual(["HUGE", "SMALL"]);
  });

  test("the layout order is cap-desc even when the table sort hands over an RSI order", () => {
    // The reported bug: table sorted by RSI ↓ gives small caps first, and the
    // treemap squarifies in array order → tall slivers with clipped labels.
    const rsiSorted = [
      row("SMALL", 12_000, 91),
      row("MID", 240_000, 74),
      row("HUGE", 1_805_376, 21),
    ];
    const laidOut = marketRowsByCapDesc(rsiSorted).map((row) => toTreemapRow(row));
    const data = buildStockTreemapOption(laidOut as HeatmapStock[], "change_pct", MARKET_METRICS, true, {
      borderDark: "#000",
      borderLight: "#fff",
      label: { fontSize: 11, fontWeight: 600, lineHeight: 1 },
      changePositive: "#0f0",
      changeNegative: "#f00",
    }, "market_cap").series[0].data as { name: string; value: number }[];

    expect(data.map((d) => d.name)).toEqual(["HUGE", "MID", "SMALL"]);
    // The unfixed order would have been the RSI order — the shard layout.
    expect(rsiSorted.map((r) => r.symbol)).not.toEqual(data.map((d) => d.name));
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

describe("marketSortMetric", () => {
  test("maps every sort that has a metric to a real MARKET_METRICS value", () => {
    const metricValues = new Set(MARKET_METRICS.map((m) => m.value));
    const mapped = MARKET_SORT_OPTIONS.map((o) => marketSortMetric(o.value)).filter(
      (m): m is string => m !== null,
    );
    // 9 sorts, one of which (symbol_asc) carries no metric.
    expect(mapped).toHaveLength(8);
    for (const metric of mapped) {
      expect(metricValues.has(metric), `${metric} is not a map metric`).toBe(true);
    }
  });

  test("is the mapping the user asked for", () => {
    const expected: Record<Exclude<MarketSortKey, "symbol_asc">, string> = {
      day_desc: "change_pct",
      day_asc: "change_pct",
      relvol_desc: "relative_volume",
      mcap_desc: "market_cap",
      rsi_desc: "rsi",
      perf_1m_desc: "perf_1m",
      perf_w_desc: "perf_w",
      pos_52w_desc: "pos_52w",
    };
    for (const [sort, metric] of Object.entries(expected)) {
      expect(marketSortMetric(sort as MarketSortKey)).toBe(metric);
    }
  });

  test("symbol A–Z leaves the colour alone", () => {
    expect(marketSortMetric("symbol_asc")).toBeNull();
  });
});

describe("currency-aware treemap caps", () => {
  const usRow: MarketRow = {
    ...base,
    currency: "USD",
    marketCapCr: null,
    marketCapUsdB: 1805.376,
  };

  test("India keeps its crore scale by default", () => {
    expect(toTreemapRow(base).market_cap).toBeCloseTo(
      1805376 * currencyFor("INR").mcapScale,
      0,
    );
  });

  test("USD uses the descriptor scale and the row's own cap field", () => {
    expect(toTreemapRow(usRow, "USD").market_cap).toBeCloseTo(
      1805.376 * currencyFor("USD").mcapScale,
      0,
    );
  });

  test("USD rows sort by their own cap field", () => {
    const small: MarketRow = { ...usRow, symbol: "SMALL", marketCapUsdB: 12 };
    expect(marketRowsByCapDesc([small, usRow], "USD").map((r) => r.symbol)).toEqual([
      "RELIANCE",
      "SMALL",
    ]);
  });

  test("the cap metric carries the currency's symbol and suffix", () => {
    const india = MARKET_METRICS.find((m) => m.value === "market_cap")!;
    const usd = marketTreemapMetrics("USD").find((m) => m.value === "market_cap")!;
    expect(india.fmt(2.5e9)).toBe("₹2.5B");
    expect(usd.fmt(2.5e9)).toBe("$2.5B");
    expect(usd.fmt(1.2e10)).toBe("$12.0B");
  });
});
