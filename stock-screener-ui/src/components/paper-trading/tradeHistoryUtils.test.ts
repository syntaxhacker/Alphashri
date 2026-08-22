import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import {
  getUniqueStrategies,
  getUniqueBots,
  filterByRange,
  groupTradesByDate,
  getPeriodFromDateRange,
} from "./tradeHistoryUtils";
import { mockTrade } from "./testFixtures";

describe("getUniqueStrategies", () => {
  test("returns empty array for empty trades", () => {
    expect(getUniqueStrategies([])).toEqual([]);
  });

  test("returns single strategy", () => {
    const trades = [mockTrade({ strategy_id: 1, strategy_name: "ORB Strategy" })];
    expect(getUniqueStrategies(trades)).toEqual([{ id: 1, name: "ORB Strategy" }]);
  });

  test("returns multiple strategies sorted by name", () => {
    const trades = [
      mockTrade({ strategy_id: 2, strategy_name: "Breakout Strategy" }),
      mockTrade({ strategy_id: 1, strategy_name: "ORB Strategy" }),
      mockTrade({ strategy_id: 3, strategy_name: "EMA Cross Strategy" }),
    ];
    expect(getUniqueStrategies(trades)).toEqual([
      { id: 2, name: "Breakout Strategy" },
      { id: 3, name: "EMA Cross Strategy" },
      { id: 1, name: "ORB Strategy" },
    ]);
  });

  test("skips trades without strategy_id", () => {
    const trades = [
      mockTrade({ strategy_id: null, strategy_name: null }),
      mockTrade({ strategy_id: 1, strategy_name: "ORB Strategy" }),
    ];
    expect(getUniqueStrategies(trades)).toEqual([{ id: 1, name: "ORB Strategy" }]);
  });

  test("deduplicates same strategy across multiple trades", () => {
    const trades = [
      mockTrade({ trade_id: "1", strategy_id: 1, strategy_name: "ORB Strategy" }),
      mockTrade({ trade_id: "2", strategy_id: 1, strategy_name: "ORB Strategy" }),
      mockTrade({ trade_id: "3", strategy_id: 2, strategy_name: "Breakout Strategy" }),
    ];
    expect(getUniqueStrategies(trades)).toEqual([
      { id: 2, name: "Breakout Strategy" },
      { id: 1, name: "ORB Strategy" },
    ]);
  });

  test("handles duplicate strategy_id with different names (last wins)", () => {
    const trades = [
      mockTrade({ trade_id: "1", strategy_id: 1, strategy_name: "Old Name" }),
      mockTrade({ trade_id: "2", strategy_id: 1, strategy_name: "New Name" }),
    ];
    const result = getUniqueStrategies(trades);
    const found = result.find((s) => s.id === 1);
    expect(found?.name).toBe("New Name");
  });
});

describe("getUniqueBots", () => {
  test("returns empty array for empty trades", () => {
    expect(getUniqueBots([])).toEqual([]);
  });

  test("returns single bot", () => {
    const trades = [mockTrade({ bot_id: "bot-1", bot_name: "Alpha Bot" })];
    expect(getUniqueBots(trades)).toEqual([{ id: "bot-1", name: "Alpha Bot" }]);
  });

  test("returns multiple bots sorted by name", () => {
    const trades = [
      mockTrade({ bot_id: "bot-2", bot_name: "Beta Bot" }),
      mockTrade({ bot_id: "bot-1", bot_name: "Alpha Bot" }),
      mockTrade({ bot_id: "bot-3", bot_name: "Gamma Bot" }),
    ];
    expect(getUniqueBots(trades)).toEqual([
      { id: "bot-1", name: "Alpha Bot" },
      { id: "bot-2", name: "Beta Bot" },
      { id: "bot-3", name: "Gamma Bot" },
    ]);
  });

  test("skips trades without bot_id", () => {
    const trades = [
      mockTrade({ bot_id: null, bot_name: null }),
      mockTrade({ bot_id: "bot-1", bot_name: "Alpha Bot" }),
    ];
    expect(getUniqueBots(trades)).toEqual([{ id: "bot-1", name: "Alpha Bot" }]);
  });

  test("deduplicates same bot across multiple trades", () => {
    const trades = [
      mockTrade({ trade_id: "1", bot_id: "bot-1", bot_name: "Alpha Bot" }),
      mockTrade({ trade_id: "2", bot_id: "bot-1", bot_name: "Alpha Bot" }),
      mockTrade({ trade_id: "3", bot_id: "bot-2", bot_name: "Beta Bot" }),
    ];
    expect(getUniqueBots(trades)).toEqual([
      { id: "bot-1", name: "Alpha Bot" },
      { id: "bot-2", name: "Beta Bot" },
    ]);
  });

  test("handles explicit null bot_id gracefully", () => {
    const trades = [
      mockTrade({ trade_id: "1", bot_id: null as any, bot_name: null as any }),
      mockTrade({ trade_id: "2", bot_id: "bot-1", bot_name: "Alpha Bot" }),
    ];
    expect(getUniqueBots(trades)).toEqual([{ id: "bot-1", name: "Alpha Bot" }]);
  });

  test("handles empty string bot_name (skipped as falsy)", () => {
    const trades = [
      mockTrade({ trade_id: "1", bot_id: "bot-1", bot_name: "" }),
    ];
    expect(getUniqueBots(trades)).toEqual([]);
  });
});

describe("filterByRange", () => {
  const trades = [
    mockTrade({ trade_id: "1", exit_time: "2026-03-15T10:00:00Z" }),
    mockTrade({ trade_id: "2", exit_time: "2026-03-20T10:00:00Z" }),
    mockTrade({ trade_id: "3", exit_time: "2026-03-25T10:00:00Z" }),
  ];

  test("returns all trades when no dates given", () => {
    expect(filterByRange(trades, "", "")).toEqual(trades);
  });

  test("returns all trades when from/to both null", () => {
    expect(filterByRange(trades, null, null)).toEqual(trades);
  });

  test("filters by fromDate excluding earlier trades", () => {
    const result = filterByRange(trades, "2026-03-20", null);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.trade_id)).toEqual(["2", "3"]);
  });

  test("filters by toDate excluding later trades", () => {
    const result = filterByRange(trades, null, "2026-03-20");
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.trade_id)).toEqual(["1", "2"]);
  });

  test("filters by both from and to", () => {
    const result = filterByRange(trades, "2026-03-16", "2026-03-24");
    expect(result).toHaveLength(1);
    expect(result[0].trade_id).toBe("2");
  });

  test("handles edge of range (same day)", () => {
    const sameDay = [
      mockTrade({ trade_id: "early", exit_time: "2026-03-20T06:00:00Z" }),
      mockTrade({ trade_id: "mid", exit_time: "2026-03-20T12:00:00Z" }),
      mockTrade({ trade_id: "late", exit_time: "2026-03-20T17:00:00Z" }),
      mockTrade({ trade_id: "before", exit_time: "2026-03-18T00:00:00Z" }),
      mockTrade({ trade_id: "after", exit_time: "2026-03-22T00:00:00Z" }),
    ];
    const result = filterByRange(sameDay, "2026-03-20", "2026-03-20");
    expect(result).toHaveLength(3);
    expect(result.map((t) => t.trade_id)).toEqual(["early", "mid", "late"]);
  });

  test("includes trades at day boundary (00:00:00Z)", () => {
    const boundary = [
      mockTrade({ trade_id: "start", exit_time: "2026-03-20T00:00:00Z" }),
      mockTrade({ trade_id: "next", exit_time: "2026-03-21T00:00:00Z" }),
    ];
    const result = filterByRange(boundary, "2026-03-20", "2026-03-20");
    expect(result).toHaveLength(1);
    expect(result[0].trade_id).toBe("start");
  });

  test("handles invalid exit_time date without crashing", () => {
    const trades = [
      mockTrade({ trade_id: "bad", exit_time: "not-a-date" }),
      mockTrade({ trade_id: "good", exit_time: "2026-03-20T14:30:00Z" }),
    ];
    const result = filterByRange(trades, "2026-03-15", "2026-03-25");
    // invalid dates are filtered out, only good remains, but should not crash
    expect(result).toHaveLength(1);
    expect(result[0].trade_id).toBe("good");
  });
});

describe("groupTradesByDate", () => {
  test("groups trades by date key", () => {
    const trades = [
      mockTrade({ trade_id: "1", exit_time: "2026-03-20T14:30:00Z" }),
      mockTrade({ trade_id: "2", exit_time: "2026-03-21T10:00:00Z" }),
      mockTrade({ trade_id: "3", exit_time: "2026-03-20T09:00:00Z" }),
    ];
    const result = groupTradesByDate(trades);
    expect(Object.keys(result).sort()).toEqual(["2026-03-20", "2026-03-21"]);
    expect(result["2026-03-20"]).toHaveLength(2);
    expect(result["2026-03-21"]).toHaveLength(1);
  });

  test("within-date ordering by exit_time desc when no sortColumn", () => {
    const trades = [
      mockTrade({ trade_id: "1", exit_time: "2026-03-20T14:30:00Z" }),
      mockTrade({ trade_id: "2", exit_time: "2026-03-20T10:00:00Z" }),
      mockTrade({ trade_id: "3", exit_time: "2026-03-20T09:15:00Z" }),
    ];
    const result = groupTradesByDate(trades);
    expect(result["2026-03-20"].map((t) => t.trade_id)).toEqual(["1", "2", "3"]);
  });

  test("sorts by specified column ascending", () => {
    const trades = [
      mockTrade({ trade_id: "1", pnl: 5000, exit_time: "2026-03-20T14:30:00Z" }),
      mockTrade({ trade_id: "2", pnl: 1000, exit_time: "2026-03-20T10:00:00Z" }),
    ];
    const result = groupTradesByDate(trades, "pnl", "asc");
    expect(result["2026-03-20"].map((t) => t.trade_id)).toEqual(["2", "1"]);
  });

  test("sorts by specified column descending", () => {
    const trades = [
      mockTrade({ trade_id: "1", pnl: 1000, exit_time: "2026-03-20T10:00:00Z" }),
      mockTrade({ trade_id: "2", pnl: 5000, exit_time: "2026-03-20T14:30:00Z" }),
    ];
    const result = groupTradesByDate(trades, "pnl", "desc");
    expect(result["2026-03-20"].map((t) => t.trade_id)).toEqual(["2", "1"]);
  });

  test("empty array returns empty object", () => {
    expect(groupTradesByDate([])).toEqual({});
  });

  test("no sortColumn with all trades on same date sorts by exit_time desc", () => {
    const trades = [
      mockTrade({ trade_id: "mid", exit_time: "2026-03-20T12:00:00Z" }),
      mockTrade({ trade_id: "early", exit_time: "2026-03-20T09:00:00Z" }),
      mockTrade({ trade_id: "late", exit_time: "2026-03-20T15:00:00Z" }),
    ];
    const result = groupTradesByDate(trades);
    expect(Object.keys(result)).toEqual(["2026-03-20"]);
    expect(result["2026-03-20"].map((t) => t.trade_id)).toEqual(["late", "mid", "early"]);
  });

  test("handles empty exit_time string gracefully", () => {
    const trades = [
      mockTrade({ trade_id: "1", exit_time: "" }),
    ];
    const result = groupTradesByDate(trades);
    // empty/invalid dates are skipped, no group created
    expect(Object.keys(result)).toEqual([]);
  });
});

describe("getPeriodFromDateRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('returns "all" when no dates', () => {
    expect(getPeriodFromDateRange(null, null)).toBe("all");
    expect(getPeriodFromDateRange("", "")).toBe("all");
  });

  test('returns "today" when both dates are today', () => {
    expect(getPeriodFromDateRange("2026-07-15", "2026-07-15")).toBe("today");
  });

  test('returns "week" when from is exactly 7 days ago', () => {
    expect(getPeriodFromDateRange("2026-07-08", null)).toBe("week");
  });

  test('returns "month" when from is exactly 1 month ago', () => {
    expect(getPeriodFromDateRange("2026-06-15", null)).toBe("month");
  });

  test('returns "year" when from is exactly 1 year ago', () => {
    expect(getPeriodFromDateRange("2025-07-15", null)).toBe("year");
  });

  test('returns "week" when from is within last 7 days', () => {
    expect(getPeriodFromDateRange("2026-07-10", null)).toBe("week");
  });

  test('returns "month" when from is within last month', () => {
    expect(getPeriodFromDateRange("2026-06-20", null)).toBe("month");
  });

  test('returns "year" when from is within last year', () => {
    expect(getPeriodFromDateRange("2025-08-15", null)).toBe("year");
  });

  test('returns "all" for custom non-matching range', () => {
    expect(getPeriodFromDateRange("2024-01-01", null)).toBe("all");
    expect(getPeriodFromDateRange("2024-01-01", "2024-06-01")).toBe("all");
  });

  test('returns "week" for near future date (isAfter logic)', () => {
    expect(getPeriodFromDateRange("2026-07-16", "2026-07-16")).toBe("week");
    expect(getPeriodFromDateRange("2026-08-01", null)).toBe("week");
  });
});
