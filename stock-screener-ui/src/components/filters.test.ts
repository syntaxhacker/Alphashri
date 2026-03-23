import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Stock } from "../types";
import * as state from "../state";
import { sortStocks, handleSort, renderSortIndicator, renderSortableHeader } from "./filters";

const makeStock = (overrides: Partial<Stock> = {}): Stock => ({
  symbol: "ABC",
  score: 50,
  tv_price: 100,
  upstox_price: 101,
  broker_diff: -1,
  high_52w: 200,
  to_52w_high: 50,
  recent_return_5d: 5,
  perf_w: 10,
  sector: "Finance",
  touched_52w: false,
  ...overrides,
});

beforeEach(() => {
  state.setSortColumn(null);
  state.setSortDirection("desc");
});

describe("sortStocks", () => {
  const stockA = makeStock({ symbol: "AAA", score: 10, tv_price: 100 });
  const stockB = makeStock({ symbol: "BBB", score: 90, tv_price: 200 });

  it("returns stocks unchanged when sortColumn is null", () => {
    const result = sortStocks([stockA, stockB]);
    expect(result).toEqual([stockA, stockB]);
  });

  it("does not mutate the original array", () => {
    const original = [stockA, stockB];
    state.setSortColumn("score");
    const result = sortStocks(original);
    expect(result).not.toBe(original);
  });

  it("sorts by symbol ascending", () => {
    state.setSortColumn("symbol");
    state.setSortDirection("asc");
    const result = sortStocks([stockB, stockA]);
    expect(result[0].symbol).toBe("AAA");
    expect(result[1].symbol).toBe("BBB");
  });

  it("sorts by symbol descending", () => {
    state.setSortColumn("symbol");
    state.setSortDirection("desc");
    const result = sortStocks([stockA, stockB]);
    expect(result[0].symbol).toBe("BBB");
    expect(result[1].symbol).toBe("AAA");
  });

  it("sorts by score descending", () => {
    state.setSortColumn("score");
    const result = sortStocks([stockA, stockB]);
    expect(result[0].score).toBe(90);
    expect(result[1].score).toBe(10);
  });

  it("sorts by score ascending", () => {
    state.setSortColumn("score");
    state.setSortDirection("asc");
    const result = sortStocks([stockA, stockB]);
    expect(result[0].score).toBe(10);
    expect(result[1].score).toBe(90);
  });

  it("sorts by tv_price", () => {
    state.setSortColumn("tv_price");
    const result = sortStocks([stockA, stockB]);
    expect(result[0].tv_price).toBe(200);
  });

  it("sorts by upstox_price", () => {
    state.setSortColumn("upstox_price");
    const s1 = makeStock({ upstox_price: 100 });
    const s2 = makeStock({ upstox_price: 200 });
    const result = sortStocks([s1, s2]);
    expect(result[0].upstox_price).toBe(200);
  });

  it("sorts by broker_diff", () => {
    state.setSortColumn("broker_diff");
    const s1 = makeStock({ broker_diff: -5 });
    const s2 = makeStock({ broker_diff: 10 });
    const result = sortStocks([s1, s2]);
    expect(result[0].broker_diff).toBe(10);
  });

  it("sorts by high_52w", () => {
    state.setSortColumn("high_52w");
    const s1 = makeStock({ high_52w: 100 });
    const s2 = makeStock({ high_52w: 300 });
    const result = sortStocks([s1, s2]);
    expect(result[0].high_52w).toBe(300);
  });

  it("sorts by to_52w_high", () => {
    state.setSortColumn("to_52w_high");
    const s1 = makeStock({ to_52w_high: 10 });
    const s2 = makeStock({ to_52w_high: 80 });
    const result = sortStocks([s1, s2]);
    expect(result[0].to_52w_high).toBe(80);
  });

  it("sorts by time_to_52w using days", () => {
    state.setSortColumn("time_to_52w");
    const s1 = makeStock({ time_to_52w: { days: 30, confidence: "HIGH" } });
    const s2 = makeStock({ time_to_52w: { days: 5, confidence: "MED" } });
    const result = sortStocks([s1, s2]);
    expect(result[0].time_to_52w?.days).toBe(30);
  });

  it("defaults time_to_52w to 999 when undefined", () => {
    state.setSortColumn("time_to_52w");
    const s1 = makeStock({ time_to_52w: undefined });
    const s2 = makeStock({ time_to_52w: { days: 10, confidence: "HIGH" } });
    const result = sortStocks([s1, s2]);
    expect(result[0].time_to_52w).toBeUndefined();
  });

  it("sorts by recent_return_5d", () => {
    state.setSortColumn("recent_return_5d");
    const s1 = makeStock({ recent_return_5d: 2 });
    const s2 = makeStock({ recent_return_5d: 15 });
    const result = sortStocks([s1, s2]);
    expect(result[0].recent_return_5d).toBe(15);
  });

  it("sorts by perf_w", () => {
    state.setSortColumn("perf_w");
    const s1 = makeStock({ perf_w: 1 });
    const s2 = makeStock({ perf_w: 20 });
    const result = sortStocks([s1, s2]);
    expect(result[0].perf_w).toBe(20);
  });

  it("sorts by day_change with undefined defaulting to 0", () => {
    state.setSortColumn("day_change");
    const s1 = makeStock({ day_change: undefined });
    const s2 = makeStock({ day_change: 5 });
    const result = sortStocks([s1, s2]);
    expect(result[0].day_change).toBe(5);
  });

  it("sorts by rsi with undefined defaulting to 0", () => {
    state.setSortColumn("rsi");
    const s1 = makeStock({ rsi: undefined });
    const s2 = makeStock({ rsi: 70 });
    const result = sortStocks([s1, s2]);
    expect(result[0].rsi).toBe(70);
  });

  it("sorts by stoch_k with undefined defaulting to 0", () => {
    state.setSortColumn("stoch_k");
    const s1 = makeStock({ stoch_k: undefined });
    const s2 = makeStock({ stoch_k: 80 });
    const result = sortStocks([s1, s2]);
    expect(result[0].stoch_k).toBe(80);
  });

  it("sorts by wick_close_pct with undefined defaulting to 0", () => {
    state.setSortColumn("wick_close_pct");
    const s1 = makeStock({ wick_close_pct: undefined });
    const s2 = makeStock({ wick_close_pct: 0.5 });
    const result = sortStocks([s1, s2]);
    expect(result[0].wick_close_pct).toBe(0.5);
  });

  it("sorts by volume_surge with undefined defaulting to 0", () => {
    state.setSortColumn("volume_surge");
    const s1 = makeStock({ volume_surge: undefined });
    const s2 = makeStock({ volume_surge: 3.2 });
    const result = sortStocks([s1, s2]);
    expect(result[0].volume_surge).toBe(3.2);
  });

  it("sorts by atr_pct with undefined defaulting to 0", () => {
    state.setSortColumn("atr_pct");
    const s1 = makeStock({ atr_pct: undefined });
    const s2 = makeStock({ atr_pct: 1.5 });
    const result = sortStocks([s1, s2]);
    expect(result[0].atr_pct).toBe(1.5);
  });

  it("sorts by adx with undefined defaulting to 0", () => {
    state.setSortColumn("adx");
    const s1 = makeStock({ adx: undefined });
    const s2 = makeStock({ adx: 25 });
    const result = sortStocks([s1, s2]);
    expect(result[0].adx).toBe(25);
  });

  it("sorts by interest_score with undefined defaulting to 0", () => {
    state.setSortColumn("interest_score");
    const s1 = makeStock({ interest_score: undefined });
    const s2 = makeStock({ interest_score: 8 });
    const result = sortStocks([s1, s2]);
    expect(result[0].interest_score).toBe(8);
  });

  it("sorts by gap_pct with undefined defaulting to 0", () => {
    state.setSortColumn("gap_pct");
    const s1 = makeStock({ gap_pct: undefined });
    const s2 = makeStock({ gap_pct: 2.5 });
    const result = sortStocks([s1, s2]);
    expect(result[0].gap_pct).toBe(2.5);
  });

  it("sorts by premarket_change with undefined defaulting to 0", () => {
    state.setSortColumn("premarket_change");
    const s1 = makeStock({ premarket_change: undefined });
    const s2 = makeStock({ premarket_change: 1.2 });
    const result = sortStocks([s1, s2]);
    expect(result[0].premarket_change).toBe(1.2);
  });

  it("sorts by impact_score with undefined defaulting to 0", () => {
    state.setSortColumn("impact_score");
    const s1 = makeStock({ impact_score: undefined });
    const s2 = makeStock({ impact_score: 95 });
    const result = sortStocks([s1, s2]);
    expect(result[0].impact_score).toBe(95);
  });

  it("sorts by market_cap_b with undefined defaulting to 0", () => {
    state.setSortColumn("market_cap_b");
    const s1 = makeStock({ market_cap_b: undefined });
    const s2 = makeStock({ market_cap_b: 50 });
    const result = sortStocks([s1, s2]);
    expect(result[0].market_cap_b).toBe(50);
  });

  it("sorts by volume_m with undefined defaulting to 0", () => {
    state.setSortColumn("volume_m");
    const s1 = makeStock({ volume_m: undefined });
    const s2 = makeStock({ volume_m: 5.5 });
    const result = sortStocks([s1, s2]);
    expect(result[0].volume_m).toBe(5.5);
  });

  it("sorts by sector", () => {
    state.setSortColumn("sector");
    state.setSortDirection("asc");
    const s1 = makeStock({ sector: "Technology" });
    const s2 = makeStock({ sector: "Finance" });
    const result = sortStocks([s1, s2]);
    expect(result[0].sector).toBe("Finance");
  });

  it("returns 0 for unknown column (maintains original order)", () => {
    state.setSortColumn("unknown_column");
    const result = sortStocks([stockA, stockB]);
    expect(result).toEqual([stockA, stockB]);
  });

  it("handles empty array", () => {
    state.setSortColumn("score");
    const result = sortStocks([]);
    expect(result).toEqual([]);
  });

  it("handles single element array", () => {
    state.setSortColumn("score");
    const result = sortStocks([stockA]);
    expect(result).toEqual([stockA]);
  });
});

describe("handleSort", () => {
  beforeEach(() => {
    vi.spyOn(state, "setSortDirection");
    vi.spyOn(state, "setSortColumn");
  });

  it("toggles direction when same column is sorted again", () => {
    state.setSortColumn("score");
    state.setSortDirection("desc");
    handleSort("score");
    expect(state.setSortDirection).toHaveBeenCalledWith("asc");
  });

  it("sets new column and direction desc when different column", () => {
    state.setSortColumn("score");
    handleSort("symbol");
    expect(state.setSortColumn).toHaveBeenCalledWith("symbol");
    expect(state.setSortDirection).toHaveBeenCalledWith("desc");
  });

  it("sets direction to asc when current is desc and same column", () => {
    state.setSortColumn("tv_price");
    state.setSortDirection("desc");
    handleSort("tv_price");
    expect(state.setSortDirection).toHaveBeenCalledWith("asc");
  });
});

describe("renderSortIndicator", () => {
  it("renders empty indicator when column is not sorted", () => {
    state.setSortColumn("score");
    const result = renderSortIndicator("symbol");
    expect(result).toBe('<span class="sort-indicator"></span>');
  });

  it("renders asc arrow when column is sorted ascending", () => {
    state.setSortColumn("score");
    state.setSortDirection("asc");
    const result = renderSortIndicator("score");
    expect(result).toBe('<span class="sort-indicator asc">↑</span>');
  });

  it("renders desc arrow when column is sorted descending", () => {
    state.setSortColumn("score");
    state.setSortDirection("desc");
    const result = renderSortIndicator("score");
    expect(result).toBe('<span class="sort-indicator desc">↓</span>');
  });
});

describe("renderSortableHeader", () => {
  it("renders header with label, column, and indicator", () => {
    state.setSortColumn(null);
    const result = renderSortableHeader("Score", "score");
    expect(result).toContain("Score");
    expect(result).toContain('data-column="score"');
    expect(result).toContain('class=" sortable"');
    expect(result).toContain("onclick=\"window.handleSort('score')\"");
    expect(result).toContain("sort-indicator");
  });

  it("includes className when provided", () => {
    const result = renderSortableHeader("Price", "tv_price", "text-right");
    expect(result).toContain('class="text-right sortable"');
  });

  it("includes tooltip title when provided", () => {
    const result = renderSortableHeader("52W High", "high_52w", "", "Highest in 52 weeks");
    expect(result).toContain('title="Highest in 52 weeks"');
  });

  it("omits tooltip when empty string", () => {
    const result = renderSortableHeader("Sector", "sector", "", "");
    expect(result).not.toContain("title");
  });

  it("omits tooltip when not provided", () => {
    const result = renderSortableHeader("Sector", "sector");
    expect(result).not.toContain("title");
  });
});
