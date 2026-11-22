// @vitest-environment node
import { describe, expect, test } from "vitest";
import type { MarketRow } from "../../types/marketScreener";
import {
  BREADTH_MIN_COVERAGE,
  computeMarketBreadth,
  type MarketBreadth,
} from "./marketBreadth";

/** Deliberately mixed coverage: 7/8 change, 7/8 high, 8/8 low, 7/8 volume. */
function fixtureRow(symbol: string, overrides: Partial<MarketRow> = {}): MarketRow {
  return {
    symbol,
    name: `${symbol} Ltd`,
    sector: "IT",
    exchange: "NSE",
    close: 100,
    change: 0,
    relativeVolume: 1,
    marketCapCr: 1000,
    capTier: "mid",
    rsi: 50,
    adx: 20,
    sma20: 90,
    sma50: 85,
    sma200: 70,
    perfW: 1,
    perf1m: 2,
    high52w: 100,
    low52w: 80,
    pos52w: 50,
    peRatio: null,
    pbRatio: null,
    dividendYield: null,
    roe: null,
    psRatio: null,
    fcfYield: null,
    revenue: null,
    netIncome: null,
    debtToEquity: null,
    currentRatio: null,
    grossMargin: null,
    operatingMargin: null,
    revYoy: null,
    epsYoy: null,
    volume: 1000,
    avgVolume: 1000,
    gap: null,
    atr: null,
    high: null,
    low: null,
    valueTraded: null,
    to52wHighPct: null,
    from52wLowPct: null,
    rangeVsAtr: null,
    fno: false,
    etf: false,
    ...overrides,
  };
}

const ROWS: MarketRow[] = [
  fixtureRow("AAA", { change: 2, close: 105, volume: 1200 }),
  fixtureRow("BBB", { change: -1, close: 95, low52w: 90, volume: 900 }),
  fixtureRow("CCC", { change: 0, low52w: 60, volume: 2000 }),
  fixtureRow("DDD", {
    change: 3.5,
    close: 110,
    high52w: null,
    to52wHighPct: 0.5,
    low52w: null,
    from52wLowPct: 10,
    volume: 500,
  }),
  fixtureRow("EEE", { change: -2, close: 50, low52w: 50, volume: 1500 }),
  fixtureRow("FFF", {
    change: null,
    close: null,
    high52w: null,
    low52w: null,
    to52wHighPct: null,
    from52wLowPct: null,
    volume: null,
    avgVolume: null,
  }),
  fixtureRow("GGG", { change: 0.5, close: 70, low52w: 70, volume: 1000 }),
  fixtureRow("HHH", { change: -0.25, close: 90, from52wLowPct: 0.9, volume: 800 }),
  fixtureRow("IETF", { etf: true, change: 9, close: 200, volume: 5000, avgVolume: 100 }),
];

describe("computeMarketBreadth", () => {
  test("fixture measurements: 8 stock rows, 3 advances, 3 declines, 2 unchanged", () => {
    const b = computeMarketBreadth(ROWS);
    expect(b.loadedRows).toBe(9);
    expect(b.total).toBe(8);
    expect(b.etfsExcluded).toBe(1);
    expect(b.advances).toBe(3);
    expect(b.declines).toBe(3);
    // Missing-change rows land in unchanged, as in the retired report.
    expect(b.unchanged).toBe(2);
    expect(b.changeCoverage).toMatchObject({ covered: 7, total: 8, reliable: true });
  });

  test("52W touches come from raw levels or the signed pct fields", () => {
    const b = computeMarketBreadth(ROWS);
    // AAA, CCC at/above high52w; DDD above via to52wHighPct >= 0.
    expect(b.newHighs).toBe(3);
    // EEE, GGG at/below low52w; HHH above its low via from52wLowPct > 0.
    expect(b.newLows).toBe(2);
    expect(b.high52Coverage).toMatchObject({ covered: 7, reliable: true });
    expect(b.low52Coverage).toMatchObject({ covered: 7, reliable: true });
  });

  test("up/down volume are counts of names with a signed move and volume >= avg", () => {
    const b = computeMarketBreadth(ROWS);
    // Up: AAA (1200>=1000), GGG (1000>=1000). DDD's 500<1000 is excluded.
    expect(b.upVolumeCount).toBe(2);
    // Down: EEE (1500>=1000). BBB 900, HHH 800 are below average.
    expect(b.downVolumeCount).toBe(1);
    expect(b.volumeCoverage).toMatchObject({ covered: 7, total: 8, reliable: true });
  });

  test("average and median ignore missing changes and are rounded to report precision", () => {
    const b = computeMarketBreadth(ROWS);
    // (2 -1 +0 +3.5 -2 +0.5 -0.25) / 7 = 0.392857...
    expect(b.avgChange).toBe(0.3929);
    expect(b.medianChange).toBe(0);
  });

  test("ETFs are excluded by default and can be opted back in", () => {
    const all = computeMarketBreadth(ROWS, { includeEtfs: true });
    expect(all.total).toBe(9);
    expect(all.etfsExcluded).toBe(0);
    expect(all.advances).toBe(4);
    expect(all.newHighs).toBe(4);
    expect(all.upVolumeCount).toBe(3);
  });

  test("poor 52W and volume coverage hide the derived stats instead of showing 0", () => {
    const thin = ROWS.map((row) =>
      fixtureRow(row.symbol, {
        ...row,
        high52w: null,
        low52w: null,
        to52wHighPct: null,
        from52wLowPct: null,
        volume: null,
        avgVolume: null,
      }),
    );
    const b = computeMarketBreadth(thin);
    expect(b.newHighs).toBeNull();
    expect(b.newLows).toBeNull();
    expect(b.upVolumeCount).toBeNull();
    expect(b.downVolumeCount).toBeNull();
    expect(b.high52Coverage.reliable).toBe(false);
    expect(b.low52Coverage.reliable).toBe(false);
    expect(b.volumeCoverage.reliable).toBe(false);
  });

  test("coverage below the threshold is hidden even when some rows have data", () => {
    const thin = ROWS.map((row, i) =>
      i === 0 ? fixtureRow(row.symbol, { ...row, high52w: null, to52wHighPct: null }) : row,
    );
    // One extra missing high drops 7/8 to 6/8 = 75% < 80%.
    const b = computeMarketBreadth(thin);
    expect(b.high52Coverage.ratio).toBeLessThan(BREADTH_MIN_COVERAGE);
    expect(b.newHighs).toBeNull();
    // A different field with good coverage still renders a number.
    expect(b.newLows).toBe(2);
  });

  test("NaN and Infinity never become counts or percentages", () => {
    const b = computeMarketBreadth([
      fixtureRow("NAN", {
        change: Number.NaN,
        high52w: Number.NaN,
        low52w: Number.NaN,
        volume: Number.POSITIVE_INFINITY,
        avgVolume: 10,
      }),
    ]);
    expect(b.changeCoverage.covered).toBe(0);
    expect(b.advances).toBeNull();
    expect(b.avgChange).toBeNull();
    expect(b.newHighs).toBeNull();
    expect(b.upVolumeCount).toBeNull();
  });

  test("an empty snapshot yields zero counts and no derived stats", () => {
    const b: MarketBreadth = computeMarketBreadth([]);
    expect(b.total).toBe(0);
    expect(b.loadedRows).toBe(0);
    expect(b.advances).toBe(0);
    expect(b.unchanged).toBe(0);
    expect(b.newHighs).toBeNull();
    expect(b.upVolumeCount).toBeNull();
    expect(b.avgChange).toBeNull();
    expect(b.high52Coverage.reliable).toBe(false);
  });
});
