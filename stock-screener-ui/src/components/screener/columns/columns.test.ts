import { describe, expect, test } from "vitest";
import { getMarketOpenGapColumns } from "./marketOpenGap";
import { getTrendingColumns } from "./trending";
import { getRsiReversalColumns } from "./rsiReversal";
import { getHighMomentumColumns } from "./highMomentum";
import { getNiftyMoversColumns } from "./niftyMovers";
import { getBuyerInterestColumns } from "./buyerInterest";
import { get52wHighColumns } from "./52wHigh";
import { getColumnsForScreener } from "./index";
import { cellOf, cellText } from "./columnTestFixtures";
import type { Stock } from "../../../types";

const mockStock: Stock = {
  symbol: "RELIANCE",
  score: 85,
  tv_price: 2450.5,
  upstox_price: 2451.0,
  broker_diff: 0.02,
  high_52w: 2600,
  to_52w_high: -5.76,
  recent_return_5d: 3.2,
  perf_w: 1.5,
  sector: "Energy",
  touched_52w: false,
  day_change: 1.25,
  rsi: 65.3,
  stoch_k: 72.1,
  gap_pct: 0.5,
  premarket_change: 0.8,
  impact_score: 2.5,
  market_cap_b: 185.3,
  volume_m: 12.45,
};

function fmt(
  columns: ReturnType<typeof getMarketOpenGapColumns>,
  key: string,
  value: any,
  stock: Stock = mockStock,
): () => any {
  const col = columns.find((c) => c.key === key);
  if (!col || !col.format) return () => value;
  return () => col.format!(value, stock);
}

function expectCell(
  columns: ReturnType<typeof getMarketOpenGapColumns>,
  key: string,
  value: any,
  text: string,
  tone?: string,
) {
  const cell = cellOf(fmt(columns, key, value));
  expect(cell.text).toBe(text);
  if (tone !== undefined) expect(cell.tone).toBe(tone);
}

describe("getColumnsForScreener", () => {
  test("returns trending columns for 'trending'", () => {
    const cols = getColumnsForScreener("trending");
    expect(cols.length).toBeGreaterThan(0);
    expect(cols[0].key).toBe("symbol");
  });

  test("returns buyer_interest columns for 'buyer_interest_enhanced'", () => {
    const cols = getColumnsForScreener("buyer_interest_enhanced");
    expect(cols[0].key).toBe("symbol");
  });

  test("returns market_open_gap columns for 'market_open_gap'", () => {
    const cols = getColumnsForScreener("market_open_gap");
    expect(cols[0].key).toBe("symbol");
  });

  test("returns rsi_reversal columns for 'rsi_reversal'", () => {
    const cols = getColumnsForScreener("rsi_reversal");
    expect(cols[0].key).toBe("symbol");
  });

  test("returns nifty_movers columns for 'nifty_movers'", () => {
    const cols = getColumnsForScreener("nifty_movers");
    expect(cols[0].key).toBe("symbol");
  });

  test("returns high_momentum columns for 'high_momentum'", () => {
    const cols = getColumnsForScreener("high_momentum");
    expect(cols[0].key).toBe("symbol");
  });

  test("returns 52w_high columns (now includes volume/rsi/adx from TV enrichment)", () => {
    const cols = getColumnsForScreener("52w_high");
    const keys = cols.map((c) => c.key);
    expect(keys).toContain("symbol");
    expect(keys).toContain("score");
    expect(keys).toContain("to_52w_high");
    expect(keys).toContain("volume_m");
    expect(keys).toContain("volume");
    expect(keys).toContain("rsi");
    expect(keys).toContain("adx");
  });

  test("defaults to trending for unknown screener id", () => {
    const cols = getColumnsForScreener("unknown_screener");
    const trendingCols = getTrendingColumns();
    expect(cols.length).toBe(trendingCols.length);
    cols.forEach((col, i) => {
      expect(col.key).toBe(trendingCols[i].key);
      expect(col.label).toBe(trendingCols[i].label);
      expect(col.type).toBe(trendingCols[i].type);
    });
  });
});

describe("marketOpenGap columns", () => {
  const columns = getMarketOpenGapColumns();

  test("returns correct number of columns", () => {
    expect(columns.length).toBe(7);
  });

  test("first column is symbol", () => {
    expect(columns[0].key).toBe("symbol");
    expect(columns[0].label).toBe("Symbol");
    expect(columns[0].type).toBe("string");
    expect(columns[0].sortable).toBe(true);
  });

  test("all columns are sortable", () => {
    columns.forEach((col) => {
      expect(col.sortable).toBe(true);
    });
  });

  test("score column has badge type and no format function", () => {
    const scoreCol = columns.find((c) => c.key === "score");
    expect(scoreCol?.type).toBe("badge");
    expect(scoreCol?.format).toBeUndefined();
  });

  test("gap_pct formats positive values with green tone", () => {
    expectCell(columns, "gap_pct", 2.5, "+2.50%", "success");
  });

  test("gap_pct formats negative values with red tone", () => {
    expectCell(columns, "gap_pct", -3.1, "-3.10%", "error");
  });

  test("gap_pct formats zero with green tone", () => {
    expectCell(columns, "gap_pct", 0, "+0.00%", "success");
  });

  test("premarket_change formats positive with green", () => {
    expectCell(columns, "premarket_change", 1.5, "+1.50%", "success");
  });

  test("premarket_change formats negative with red", () => {
    expectCell(columns, "premarket_change", -0.5, "-0.50%", "error");
  });

  test("day_change formats positive with green", () => {
    expectCell(columns, "day_change", 3.45, "+3.45%", "success");
  });

  test("day_change formats negative with red", () => {
    expectCell(columns, "day_change", -2.1, "-2.10%", "error");
  });

  test("volume_m formats with 2 decimal places", () => {
    expect(cellText(fmt(columns, "volume_m", 12.345))).toBe("12.35");
  });

  test("volume_m handles null with fallback to 0", () => {
    expect(cellText(fmt(columns, "volume_m", null))).toBe("0.00");
  });

  test("volume_m handles undefined with fallback to 0", () => {
    expect(cellText(fmt(columns, "volume_m", undefined))).toBe("0.00");
  });
});

describe("trending columns", () => {
  const columns = getTrendingColumns();

  test("returns correct number of columns", () => {
    expect(columns.length).toBe(10);
  });

  test("all columns are sortable", () => {
    columns.forEach((col) => {
      expect(col.sortable).toBe(true);
    });
  });

  test("touched_52w formats false as No", () => {
    expect(cellText(fmt(columns, "touched_52w", false))).toBe("No");
  });

  test("touched_52w formats true without last_touched as Yes", () => {
    expect(cellText(fmt(columns, "touched_52w", true))).toBe("Yes");
  });

  test("touched_52w formats true with last_touched as Yes (time ago)", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const cell = cellOf(
      fmt(columns, "touched_52w", true, { ...mockStock, last_touched: twoDaysAgo }),
    );
    expect(cell.text).toContain("Yes");
    expect(cell.text).toContain("2d ago");
    const labelled = document.body.querySelector("[aria-label^='Touched on']");
    expect(labelled?.getAttribute("aria-label")).toContain("Touched on");
    expect(labelled?.getAttribute("aria-label")).toContain("2d ago");
  });

  test("tv_price formats with rupee symbol", () => {
    expect(cellText(fmt(columns, "tv_price", 2450.5))).toBe("₹2450.50");
    expect(cellText(fmt(columns, "tv_price", 100))).toBe("₹100.00");
  });

  test("upstox_price formats with rupee symbol", () => {
    expect(cellText(fmt(columns, "upstox_price", 2451.0))).toBe("₹2451.00");
  });

  test("to_52w_high negative gets green tone", () => {
    expectCell(columns, "to_52w_high", -5.76, "-5.76%", "success");
  });

  test("to_52w_high small positive gets no tone", () => {
    expectCell(columns, "to_52w_high", 0.3, "+0.30%", "");
  });

  test("to_52w_high large positive gets red tone", () => {
    expectCell(columns, "to_52w_high", 1.2, "+1.20%", "error");
  });

  test("recent_return_5d high positive shows rocket", () => {
    expectCell(columns, "recent_return_5d", 8.5, "🚀 +8.5%", "success");
  });

  test("recent_return_5d moderate positive shows green circle", () => {
    expectCell(columns, "recent_return_5d", 3.2, "🟢 +3.2%", "success");
  });

  test("recent_return_5d negative shows red circle", () => {
    expectCell(columns, "recent_return_5d", -2.1, "🔴 -2.1%", "error");
  });

  test("perf_w positive gets green", () => {
    expectCell(columns, "perf_w", 1.5, "+1.5%", "success");
  });

  test("perf_w negative gets red", () => {
    expectCell(columns, "perf_w", -3.2, "-3.2%", "error");
  });

  test("perf_w zero gets red (not > 0)", () => {
    expectCell(columns, "perf_w", 0, "0.0%", "error");
  });
});

describe("52wHigh columns", () => {
  const columns = get52wHighColumns();

  test("returns correct number of columns", () => {
    expect(columns.length).toBe(12);
  });

  test("includes tv enriched columns from 52w_high screener", () => {
    const keys = columns.map((c) => c.key);
    expect(keys).toContain("volume_m");
    expect(keys).toContain("volume");
    expect(keys).toContain("rsi");
    expect(keys).toContain("adx");
  });

  test("to_52w_high negative gets green tone", () => {
    expectCell(columns, "to_52w_high", -5.76, "-5.76%", "success");
  });

  test("upstox_price formats as LTP with rupee symbol", () => {
    expect(cellText(fmt(columns, "upstox_price", 2451.0))).toBe("₹2451.00");
  });

  test("low_52w missing returns dash", () => {
    expect(cellText(fmt(columns, "low_52w", undefined))).toBe("-");
  });
});

describe("rsiReversal columns", () => {
  const columns = getRsiReversalColumns();

  test("returns correct number of columns", () => {
    expect(columns.length).toBe(7);
  });

  test("rsi formats with 1 decimal", () => {
    expect(cellText(fmt(columns, "rsi", 65.3))).toBe("65.3");
    expect(cellText(fmt(columns, "rsi", 100))).toBe("100.0");
  });

  test("rsi handles null with fallback", () => {
    expect(cellText(fmt(columns, "rsi", null))).toBe("0.0");
  });

  test("rsi handles undefined with fallback", () => {
    expect(cellText(fmt(columns, "rsi", undefined))).toBe("0.0");
  });

  test("stoch_k formats with 1 decimal", () => {
    expect(cellText(fmt(columns, "stoch_k", 72.1))).toBe("72.1");
  });

  test("stoch_k handles null with fallback", () => {
    expect(cellText(fmt(columns, "stoch_k", null))).toBe("0.0");
  });

  test("day_change positive green, negative red", () => {
    expectCell(columns, "day_change", 1.25, "+1.25%", "success");
    expectCell(columns, "day_change", -0.5, "-0.50%", "error");
  });

  test("day_change zero is green", () => {
    expectCell(columns, "day_change", 0, "+0.00%", "success");
  });

  test("volume_m formats and handles null", () => {
    expect(cellText(fmt(columns, "volume_m", 5.678))).toBe("5.68");
    expect(cellText(fmt(columns, "volume_m", null))).toBe("0.00");
    expect(cellText(fmt(columns, "volume_m", undefined))).toBe("0.00");
  });
});

describe("highMomentum columns", () => {
  const columns = getHighMomentumColumns();

  test("returns correct number of columns", () => {
    expect(columns.length).toBe(8);
  });

  test("rsi formats with null fallback", () => {
    expect(cellText(fmt(columns, "rsi", 78.9))).toBe("78.9");
    expect(cellText(fmt(columns, "rsi", null))).toBe("0.0");
  });

  test("day_change zero is green", () => {
    expectCell(columns, "day_change", 0, "+0.00%", "success");
  });

  test("recent_return_5d > 5 shows rocket", () => {
    expectCell(columns, "recent_return_5d", 6.0, "🚀 +6.0%", "success");
  });

  test("recent_return_5d 0-5 shows green circle", () => {
    expectCell(columns, "recent_return_5d", 3.0, "🟢 +3.0%", "success");
  });

  test("recent_return_5d negative shows red circle", () => {
    expectCell(columns, "recent_return_5d", -4.5, "🔴 -4.5%", "error");
  });

  test("recent_return_5d zero shows red circle", () => {
    expectCell(columns, "recent_return_5d", 0, "🔴 0.0%", "error");
  });

  test("perf_w positive green, zero/negative red", () => {
    expectCell(columns, "perf_w", 2.1, "+2.1%", "success");
    expectCell(columns, "perf_w", -1.0, "-1.0%", "error");
    expectCell(columns, "perf_w", 0, "0.0%", "error");
  });
});

describe("niftyMovers columns", () => {
  const columns = getNiftyMoversColumns();

  test("returns correct number of columns", () => {
    expect(columns.length).toBe(7);
  });

  test("impact_score positive green", () => {
    expectCell(columns, "impact_score", 2.5, "+2.50", "success");
  });

  test("impact_score negative red", () => {
    expectCell(columns, "impact_score", -1.3, "-1.30", "error");
  });

  test("impact_score zero green", () => {
    expectCell(columns, "impact_score", 0, "+0.00", "success");
  });

  test("market_cap_b formats with B suffix", () => {
    expect(cellText(fmt(columns, "market_cap_b", 185.3))).toBe("185.3B");
    expect(cellText(fmt(columns, "market_cap_b", 10))).toBe("10.0B");
  });

  test("market_cap_b handles null with fallback", () => {
    expect(cellText(fmt(columns, "market_cap_b", null))).toBe("0.0B");
  });

  test("market_cap_b handles undefined with fallback", () => {
    expect(cellText(fmt(columns, "market_cap_b", undefined))).toBe("0.0B");
  });

  test("day_change positive/negative formatting", () => {
    expectCell(columns, "day_change", 1.5, "+1.50%", "success");
    expectCell(columns, "day_change", -2.0, "-2.00%", "error");
  });
});

describe("buyerInterest columns", () => {
  const columns = getBuyerInterestColumns();

  test("returns correct number of columns", () => {
    expect(columns.length).toBe(7);
  });

  test("touched_52w badge formats", () => {
    expect(cellText(fmt(columns, "touched_52w", true))).toBe("Yes");
    expect(cellText(fmt(columns, "touched_52w", false))).toBe("No");
  });

  test("day_change positive/negative", () => {
    expectCell(columns, "day_change", 1.25, "+1.25%", "success");
    expectCell(columns, "day_change", -0.75, "-0.75%", "error");
  });

  test("day_change zero is green", () => {
    expectCell(columns, "day_change", 0, "+0.00%", "success");
  });

  test("recent_return_5d positive green, negative red", () => {
    expectCell(columns, "recent_return_5d", 3.2, "+3.2%", "success");
    expectCell(columns, "recent_return_5d", -1.5, "-1.5%", "error");
  });

  test("recent_return_5d zero is red", () => {
    expectCell(columns, "recent_return_5d", 0, "0.0%", "error");
  });
});

describe("common column structure", () => {
  const allColumnSets = [
    getMarketOpenGapColumns(),
    getTrendingColumns(),
    getRsiReversalColumns(),
    getHighMomentumColumns(),
    getNiftyMoversColumns(),
    getBuyerInterestColumns(),
  ];

  test("every column set starts with symbol", () => {
    allColumnSets.forEach((cols) => {
      expect(cols[0].key).toBe("symbol");
      expect(cols[0].type).toBe("string");
    });
  });

  test("every column set has a score column as second", () => {
    allColumnSets.forEach((cols) => {
      expect(cols[1].key).toBe("score");
      expect(cols[1].type).toBe("badge");
    });
  });

  test("every column has a non-empty key and label", () => {
    allColumnSets.forEach((cols) => {
      cols.forEach((col) => {
        expect(col.key).toBeTruthy();
        expect(col.label).toBeTruthy();
      });
    });
  });

  test("no duplicate keys within any column set", () => {
    allColumnSets.forEach((cols) => {
      const keys = cols.map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  test("every column set ends with sector", () => {
    allColumnSets.forEach((cols) => {
      const lastCol = cols[cols.length - 1];
      expect(lastCol.key).toBe("sector");
      expect(lastCol.type).toBe("string");
    });
  });

  test("volume_m handles null/undefined in column sets that have it", () => {
    allColumnSets.forEach((columns) => {
      const volCol = columns.find((c) => c.key === "volume_m");
      if (volCol?.format) {
        expect(cellText(fmt(columns, "volume_m", null))).toBe("0.00");
        expect(cellText(fmt(columns, "volume_m", undefined))).toBe("0.00");
      }
    });
  });
});
