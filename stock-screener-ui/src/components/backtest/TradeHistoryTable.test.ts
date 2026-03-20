import { describe, expect, test } from "vitest";
import { formatDateHuman, formatDuration, sortTrades } from "./TradeHistoryTable";
import type { Trade } from "../../types/backtest";

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    entry_price: 100,
    exit_price: 110,
    entry_time: "2025-06-15T09:30:00Z",
    exit_time: "2025-06-15T10:45:00Z",
    quantity: 10,
    gross_pnl: 100,
    gross_pnl_pct: 1.0,
    trading_costs: 5,
    net_pnl: 95,
    net_pnl_pct: 0.95,
    exit_reason: "TP",
    hold_duration_minutes: 75,
    date: "2025-06-15",
    ...overrides,
  };
}

describe("formatDateHuman", () => {
  test("formats ISO string with time", () => {
    const result = formatDateHuman("2025-06-15T09:30:00Z");
    expect(result).toContain("15");
    expect(result).toContain("Jun");
    expect(result).toContain("09:30");
  });

  test("handles +05:30 timezone", () => {
    const result = formatDateHuman("2025-06-15T15:00:00+05:30");
    expect(result).toContain("15");
    expect(result).toContain("15:00");
  });

  test("handles +00:00 timezone", () => {
    const result = formatDateHuman("2025-06-15T09:30:00+00:00");
    expect(result).toContain("15");
    expect(result).toContain("09:30");
  });

  test("returns dash for empty string", () => {
    expect(formatDateHuman("")).toBe("-");
  });

  test("formats ordinal suffixes correctly", () => {
    expect(formatDateHuman("2025-01-01T09:00:00Z")).toContain("1st");
    expect(formatDateHuman("2025-01-02T09:00:00Z")).toContain("2nd");
    expect(formatDateHuman("2025-01-03T09:00:00Z")).toContain("3rd");
    expect(formatDateHuman("2025-01-04T09:00:00Z")).toContain("4th");
    expect(formatDateHuman("2025-01-21T09:00:00Z")).toContain("21st");
    expect(formatDateHuman("2025-01-22T09:00:00Z")).toContain("22nd");
    expect(formatDateHuman("2025-01-23T09:00:00Z")).toContain("23rd");
    expect(formatDateHuman("2025-01-31T09:00:00Z")).toContain("31st");
  });

  test("handles string without time part", () => {
    const result = formatDateHuman("2025-06-15");
    expect(result).toContain("15");
    expect(result).toContain("Jun");
  });
});

describe("formatDuration", () => {
  test("formats minutes only", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(5)).toBe("5m");
    expect(formatDuration(1)).toBe("1m");
  });

  test("formats hours and minutes", () => {
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(125)).toBe("2h 5m");
    expect(formatDuration(60)).toBe("1h 0m");
    expect(formatDuration(120)).toBe("2h 0m");
  });

  test("handles zero minutes", () => {
    expect(formatDuration(0)).toBe("0m");
  });

  test("handles fractional minutes", () => {
    expect(formatDuration(90.5)).toBe("1h 30.5m");
  });
});

describe("sortTrades", () => {
  const trades: Trade[] = [
    makeTrade({ net_pnl: 200, entry_price: 100, quantity: 10, entry_time: "2025-06-15T09:30:00Z", exit_time: "2025-06-15T10:45:00Z", hold_duration_minutes: 75, exit_reason: "TP" }),
    makeTrade({ net_pnl: -50, entry_price: 200, quantity: 5, entry_time: "2025-06-14T09:30:00Z", exit_time: "2025-06-14T10:00:00Z", hold_duration_minutes: 30, exit_reason: "SL" }),
    makeTrade({ net_pnl: 100, entry_price: 150, quantity: 8, entry_time: "2025-06-16T09:30:00Z", exit_time: "2025-06-16T11:00:00Z", hold_duration_minutes: 90, exit_reason: "TP" }),
  ];

  test("sorts by net_pnl ascending", () => {
    const sorted = sortTrades(trades, "net_pnl", "asc");
    expect(sorted[0].net_pnl).toBe(-50);
    expect(sorted[1].net_pnl).toBe(100);
    expect(sorted[2].net_pnl).toBe(200);
  });

  test("sorts by net_pnl descending", () => {
    const sorted = sortTrades(trades, "net_pnl", "desc");
    expect(sorted[0].net_pnl).toBe(200);
    expect(sorted[1].net_pnl).toBe(100);
    expect(sorted[2].net_pnl).toBe(-50);
  });

  test("sorts by entry_price ascending", () => {
    const sorted = sortTrades(trades, "entry_price", "asc");
    expect(sorted[0].entry_price).toBe(100);
    expect(sorted[2].entry_price).toBe(200);
  });

  test("sorts by quantity ascending", () => {
    const sorted = sortTrades(trades, "quantity", "asc");
    expect(sorted[0].quantity).toBe(5);
    expect(sorted[2].quantity).toBe(10);
  });

  test("sorts by entry_time ascending (string)", () => {
    const sorted = sortTrades(trades, "entry_time", "asc");
    expect(sorted[0].entry_time).toBe("2025-06-14T09:30:00Z");
    expect(sorted[2].entry_time).toBe("2025-06-16T09:30:00Z");
  });

  test("sorts by exit_reason ascending (string)", () => {
    const sorted = sortTrades(trades, "exit_reason", "asc");
    expect(sorted[0].exit_reason).toBe("SL");
    expect(sorted[1].exit_reason).toBe("TP");
    expect(sorted[2].exit_reason).toBe("TP");
  });

  test("sorts by hold_duration_minutes ascending", () => {
    const sorted = sortTrades(trades, "hold_duration_minutes", "asc");
    expect(sorted[0].hold_duration_minutes).toBe(30);
    expect(sorted[2].hold_duration_minutes).toBe(90);
  });

  test("returns empty array for empty input", () => {
    expect(sortTrades([], "net_pnl", "asc")).toEqual([]);
  });

  test("does not mutate original array", () => {
    const original = [...trades];
    sortTrades(trades, "net_pnl", "desc");
    expect(trades).toEqual(original);
  });

  test("returns original order for unknown column", () => {
    const sorted = sortTrades(trades, "unknown_column", "asc");
    expect(sorted.map((t) => t.net_pnl)).toEqual(trades.map((t) => t.net_pnl));
  });

  test("sorts by net_pnl_pct when net_pnl_pct is provided", () => {
    const tradesWithPct: Trade[] = [
      makeTrade({ net_pnl_pct: 2.0 }),
      makeTrade({ net_pnl_pct: -1.0 }),
      makeTrade({ net_pnl_pct: 0.5 }),
    ];
    const sorted = sortTrades(tradesWithPct, "net_pnl_pct", "asc");
    expect(sorted[0].net_pnl_pct).toBe(-1.0);
    expect(sorted[2].net_pnl_pct).toBe(2.0);
  });

  test("sorts by level_high using or_high fallback", () => {
    const tradesWithLevels: Trade[] = [
      makeTrade({ or_high: 300 }),
      makeTrade({ or_high: 100 }),
      makeTrade({ or_high: 200 }),
    ];
    const sorted = sortTrades(tradesWithLevels, "level_high", "asc");
    expect(sorted[0].or_high).toBe(100);
    expect(sorted[2].or_high).toBe(300);
  });

  test("sorts by level_low using or_low fallback", () => {
    const tradesWithLevels: Trade[] = [
      makeTrade({ or_low: 50 }),
      makeTrade({ or_low: 80 }),
      makeTrade({ or_low: 30 }),
    ];
    const sorted = sortTrades(tradesWithLevels, "level_low", "asc");
    expect(sorted[0].or_low).toBe(30);
    expect(sorted[2].or_low).toBe(80);
  });
});
