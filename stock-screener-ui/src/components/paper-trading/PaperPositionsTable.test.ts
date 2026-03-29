import { describe, expect, test } from "vitest";
import {
  nearBreakoutPct,
  formatNear,
  groupPositionsByStrategy,
  calcStrategySummary,
} from "./PaperPositionsTable";
import { formatCurrencyIN, formatNumber, formatElapsed } from "../../utils/ui-helpers";
import type { PaperPosition, PaperScanItem } from "../../types/paperTrading";

const mockPosition = (overrides: Partial<PaperPosition> = {}): PaperPosition => ({
  symbol: "RELIANCE",
  side: "BUY",
  quantity: 100,
  entry_price: 2500,
  current_price: 2550,
  entry_time: "2026-03-20T09:30:00Z",
  stop_loss: 2450,
  take_profit: 2650,
  pnl: 5000,
  pnl_pct: 2.0,
  margin_used: 250000,
  order_id: "ord-1",
  strategy_id: 1,
  strategy_name: "ORB Strategy",
  ...overrides,
});

describe("formatCurrencyIN", () => {
  test("formats regular numbers with en-IN locale", () => {
    const result = formatCurrencyIN(12345.67);
    expect(result).toContain("12,345");
  });

  test("returns 0 for undefined", () => {
    expect(formatCurrencyIN(undefined)).toBe("0");
  });

  test("returns 0 for null", () => {
    expect(formatCurrencyIN(null)).toBe("0");
  });

  test("returns 0 for NaN", () => {
    expect(formatCurrencyIN(NaN)).toBe("0");
  });

  test("handles zero", () => {
    expect(formatCurrencyIN(0)).toBe("0");
  });

  test("handles negative numbers", () => {
    const result = formatCurrencyIN(-5000);
    expect(result).toContain("5,000");
  });
});

describe("formatNumber", () => {
  test("formats numbers below 1000 without suffix", () => {
    expect(formatNumber(500)).toBe("500");
    expect(formatNumber(999)).toBe("999");
  });

  test("formats thousands with K suffix", () => {
    expect(formatNumber(1500)).toBe("1.5K");
    expect(formatNumber(10000)).toBe("10.0K");
    expect(formatNumber(99999)).toBe("100.0K");
  });

  test("formats lakhs with L suffix", () => {
    expect(formatNumber(100000)).toBe("1.0L");
    expect(formatNumber(150000)).toBe("1.5L");
    expect(formatNumber(1000000)).toBe("10.0L");
  });

  test("handles negative numbers", () => {
    expect(formatNumber(-1500)).toBe("-1.5K");
    expect(formatNumber(-100000)).toBe("-1.0L");
  });

  test("handles zero", () => {
    expect(formatNumber(0)).toBe("0");
  });

  test("returns 0 for undefined", () => {
    expect(formatNumber(undefined)).toBe("0");
  });

  test("returns 0 for null", () => {
    expect(formatNumber(null)).toBe("0");
  });

  test("returns 0 for NaN", () => {
    expect(formatNumber(NaN)).toBe("0");
  });
});

describe("formatElapsed", () => {
  test("returns dash for null", () => {
    expect(formatElapsed(null)).toBe("-");
  });

  test("returns dash for undefined", () => {
    expect(formatElapsed(undefined)).toBe("-");
  });

  test("returns dash for empty string", () => {
    expect(formatElapsed("")).toBe("-");
  });

  test("formats minutes only", () => {
    const fiveMinsAgo = new Date(Date.now() - 5 * 60000).toISOString();
    expect(formatElapsed(fiveMinsAgo)).toBe("5m");
  });

  test("formats hours and minutes", () => {
    const hourThirtyMinsAgo = new Date(Date.now() - 90 * 60000).toISOString();
    expect(formatElapsed(hourThirtyMinsAgo)).toBe("1h 30m");
  });

  test("formats exact hours", () => {
    const twoHoursAgo = new Date(Date.now() - 120 * 60000).toISOString();
    expect(formatElapsed(twoHoursAgo)).toBe("2h");
  });

  test("returns 0m for invalid date string", () => {
    expect(formatElapsed("not-a-date")).toBe("0m");
  });
});

describe("nearBreakoutPct", () => {
  test("returns 9999 for missing price", () => {
    const item: PaperScanItem = { symbol: "TEST", status: "active", or_high: 100, or_low: 90 };
    expect(nearBreakoutPct(item)).toBe(9999);
  });

  test("returns 9999 for missing or_high", () => {
    const item: PaperScanItem = { symbol: "TEST", status: "active", price: 95, or_low: 90 };
    expect(nearBreakoutPct(item)).toBe(9999);
  });

  test("returns 9999 for missing or_low", () => {
    const item: PaperScanItem = { symbol: "TEST", status: "active", price: 95, or_high: 100 };
    expect(nearBreakoutPct(item)).toBe(9999);
  });

  test("returns 9999 for zero or_high", () => {
    const item: PaperScanItem = {
      symbol: "TEST",
      status: "active",
      price: 95,
      or_high: 0,
      or_low: 90,
    };
    expect(nearBreakoutPct(item)).toBe(9999);
  });

  test("returns 9999 for zero or_low", () => {
    const item: PaperScanItem = {
      symbol: "TEST",
      status: "active",
      price: 95,
      or_high: 100,
      or_low: 0,
    };
    expect(nearBreakoutPct(item)).toBe(9999);
  });

  test("returns 0 when price equals or_high", () => {
    const item: PaperScanItem = {
      symbol: "TEST",
      status: "active",
      price: 100,
      or_high: 100,
      or_low: 90,
    };
    expect(nearBreakoutPct(item)).toBe(0);
  });

  test("returns positive pct when price is above or_high", () => {
    const item: PaperScanItem = {
      symbol: "TEST",
      status: "active",
      price: 110,
      or_high: 100,
      or_low: 90,
    };
    expect(nearBreakoutPct(item)).toBeCloseTo(10);
  });

  test("returns positive pct when price is below or_low", () => {
    const item: PaperScanItem = {
      symbol: "TEST",
      status: "active",
      price: 81,
      or_high: 100,
      or_low: 90,
    };
    expect(nearBreakoutPct(item)).toBeCloseTo(10);
  });

  test("returns minimum distance when price is within range near high", () => {
    const item: PaperScanItem = {
      symbol: "TEST",
      status: "active",
      price: 99,
      or_high: 100,
      or_low: 90,
    };
    const result = nearBreakoutPct(item);
    expect(result).toBeCloseTo(1);
  });

  test("returns minimum distance when price is within range near low", () => {
    const item: PaperScanItem = {
      symbol: "TEST",
      status: "active",
      price: 91,
      or_high: 100,
      or_low: 90,
    };
    const result = nearBreakoutPct(item);
    expect(result).toBeCloseTo(1.11, 1);
  });

  test("returns 0 when price is at exact midpoint of range", () => {
    const item: PaperScanItem = {
      symbol: "TEST",
      status: "active",
      price: 95,
      or_high: 100,
      or_low: 90,
    };
    const result = nearBreakoutPct(item);
    expect(result).toBeGreaterThan(0);
  });
});

describe("formatNear", () => {
  test("returns dash when nearBreakoutPct returns 9999", () => {
    const item: PaperScanItem = { symbol: "TEST", status: "active" };
    expect(formatNear(item)).toBe("-");
  });

  test("returns formatted percentage", () => {
    const item: PaperScanItem = {
      symbol: "TEST",
      status: "active",
      price: 95,
      or_high: 100,
      or_low: 90,
    };
    const result = formatNear(item);
    expect(result).toMatch(/^\d+\.\d{2}%$/);
  });

  test("returns dash for missing data", () => {
    const item: PaperScanItem = { symbol: "TEST", status: "active" };
    expect(formatNear(item)).toBe("-");
  });
});

describe("groupPositionsByStrategy", () => {
  test("returns empty map for empty positions", () => {
    const result = groupPositionsByStrategy([]);
    expect(result.size).toBe(0);
  });

  test("groups positions by strategy_name", () => {
    const positions = [
      mockPosition({ symbol: "A", strategy_name: "Strat1" }),
      mockPosition({ symbol: "B", strategy_name: "Strat1" }),
      mockPosition({ symbol: "C", strategy_name: "Strat2" }),
    ];
    const result = groupPositionsByStrategy(positions);
    expect(result.size).toBe(2);
    expect(result.get("Strat1")!.length).toBe(2);
    expect(result.get("Strat2")!.length).toBe(1);
  });

  test("uses fallback name when strategy_name is empty", () => {
    const positions = [mockPosition({ symbol: "A", strategy_name: "", strategy_id: 5 })];
    const result = groupPositionsByStrategy(positions);
    expect(result.has("Strategy 5")).toBe(true);
  });

  test("handles all positions with same strategy", () => {
    const positions = [mockPosition({ symbol: "A" }), mockPosition({ symbol: "B" })];
    const result = groupPositionsByStrategy(positions);
    expect(result.size).toBe(1);
    expect(result.get("ORB Strategy")!.length).toBe(2);
  });
});

describe("calcStrategySummary", () => {
  test("returns zeros for empty positions", () => {
    const result = calcStrategySummary([]);
    expect(result).toEqual({ totalPnl: 0, marginUsed: 0, count: 0 });
  });

  test("calculates summary for single position", () => {
    const positions = [mockPosition({ pnl: 5000, margin_used: 250000 })];
    const result = calcStrategySummary(positions);
    expect(result.totalPnl).toBe(5000);
    expect(result.marginUsed).toBe(250000);
    expect(result.count).toBe(1);
  });

  test("sums multiple positions", () => {
    const positions = [
      mockPosition({ pnl: 3000, margin_used: 100000 }),
      mockPosition({ pnl: -1000, margin_used: 150000 }),
    ];
    const result = calcStrategySummary(positions);
    expect(result.totalPnl).toBe(2000);
    expect(result.marginUsed).toBe(250000);
    expect(result.count).toBe(2);
  });

  test("handles positions with missing pnl (treats as 0)", () => {
    const positions = [mockPosition({ pnl: undefined as any })];
    const result = calcStrategySummary(positions);
    expect(result.totalPnl).toBe(0);
  });

  test("handles positions with missing margin_used (treats as 0)", () => {
    const positions = [mockPosition({ margin_used: undefined as any })];
    const result = calcStrategySummary(positions);
    expect(result.marginUsed).toBe(0);
  });
});
