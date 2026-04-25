import { describe, expect, test } from "vitest";
import dayjs from "dayjs";
import { formatTimeOnly, formatDateHeader } from "../../utils/ui-helpers";
import {
  getUniqueStrategies,
  getUniqueBots,
  filterByRange,
  groupTradesByDate,
  getPeriodFromDateRange,
} from "./tradeHistoryUtils";
import { mockTrade } from "./testFixtures";

describe("formatTimeOnly", () => {
  test("returns dash for empty string", () => {
    expect(formatTimeOnly("")).toBe("-");
  });

  test("formats valid ISO string to time only", () => {
    const result = formatTimeOnly("2026-03-20T14:30:00Z");
    expect(result).toMatch(/\d{2}:\d{2}/);
  });

  test("returns original string for invalid input", () => {
    expect(formatTimeOnly("not-a-date")).toBe("not-a-date");
  });

  test("formats time without timezone info", () => {
    const result = formatTimeOnly("2026-03-20T09:15:00");
    expect(result).toMatch(/\d{2}:\d{2}/);
  });
});

describe("getUniqueStrategies", () => {
  test("returns empty array for empty trades", () => {
    expect(getUniqueStrategies([])).toEqual([]);
  });

  test("returns empty array when trades have no strategy_name", () => {
    const trades = [
      mockTrade({ strategy_name: "", strategy_id: 0 }),
      mockTrade({ strategy_name: "", strategy_id: 0 }),
    ];
    expect(getUniqueStrategies(trades)).toEqual([]);
  });

  test("returns unique sorted strategies by id and name", () => {
    const trades = [
      mockTrade({ strategy_name: "Breakout", strategy_id: 2 }),
      mockTrade({ strategy_name: "ORB", strategy_id: 1 }),
      mockTrade({ strategy_name: "Breakout", strategy_id: 2 }),
    ];
    const result = getUniqueStrategies(trades);
    expect(result).toEqual([
      { id: 2, name: "Breakout" },
      { id: 1, name: "ORB" },
    ]);
  });

  test("handles single strategy", () => {
    const trades = [mockTrade({ strategy_name: "ORB", strategy_id: 1 })];
    expect(getUniqueStrategies(trades)).toEqual([{ id: 1, name: "ORB" }]);
  });

  test("skips trades with falsy strategy_id", () => {
    const trades = [
      mockTrade({ strategy_name: "ORB", strategy_id: 1 }),
      mockTrade({ strategy_name: "Missing", strategy_id: 0 }),
    ];
    expect(getUniqueStrategies(trades)).toEqual([{ id: 1, name: "ORB" }]);
  });
});

describe("getUniqueBots", () => {
  test("returns empty array for empty trades", () => {
    expect(getUniqueBots([])).toEqual([]);
  });

  test("returns empty array when trades have no bot info", () => {
    const trades = [mockTrade({ bot_id: null, bot_name: null })];
    expect(getUniqueBots(trades)).toEqual([]);
  });

  test("returns unique bots sorted by name", () => {
    const trades = [
      mockTrade({ bot_id: "2", bot_name: "Zeta Bot" }),
      mockTrade({ bot_id: "1", bot_name: "Alpha Bot" }),
      mockTrade({ bot_id: "2", bot_name: "Zeta Bot" }),
    ];
    const result = getUniqueBots(trades);
    expect(result).toEqual([
      { id: "1", name: "Alpha Bot" },
      { id: "2", name: "Zeta Bot" },
    ]);
  });

  test("handles trades with missing bot_id", () => {
    const trades = [mockTrade({ bot_id: null, bot_name: "Test Bot" })];
    expect(getUniqueBots(trades)).toEqual([]);
  });

  test("handles trades with missing bot_name", () => {
    const trades = [mockTrade({ bot_id: "1", bot_name: null })];
    expect(getUniqueBots(trades)).toEqual([]);
  });
});

describe("filterByRange", () => {
  test("returns all trades when no filters", () => {
    const trades = [
      mockTrade({ exit_time: "2026-01-15T14:30:00Z" }),
      mockTrade({ exit_time: "2026-03-20T14:30:00Z" }),
    ];
    const result = filterByRange(trades, null, null);
    expect(result.length).toBe(2);
  });

  test("filters by fromDate", () => {
    const trades = [
      mockTrade({ exit_time: "2026-01-15T14:30:00Z" }),
      mockTrade({ exit_time: "2026-03-20T14:30:00Z" }),
    ];
    const result = filterByRange(trades, "2026-03-01", null);
    expect(result.length).toBe(1);
    expect(result[0].exit_time).toContain("2026-03-20");
  });

  test("filters by toDate", () => {
    const trades = [
      mockTrade({ exit_time: "2026-01-15T14:30:00Z" }),
      mockTrade({ exit_time: "2026-03-20T14:30:00Z" }),
    ];
    const result = filterByRange(trades, null, "2026-02-01");
    expect(result.length).toBe(1);
    expect(result[0].exit_time).toContain("2026-01-15");
  });

  test("filters by both from and to date", () => {
    const trades = [
      mockTrade({ exit_time: "2026-01-15T14:30:00Z" }),
      mockTrade({ exit_time: "2026-02-15T14:30:00Z" }),
      mockTrade({ exit_time: "2026-03-20T14:30:00Z" }),
    ];
    const result = filterByRange(trades, "2026-02-01", "2026-02-28");
    expect(result.length).toBe(1);
    expect(result[0].exit_time).toContain("2026-02-15");
  });

  test("returns empty for non-overlapping range", () => {
    const trades = [mockTrade({ exit_time: "2026-01-15T14:30:00Z" })];
    const result = filterByRange(trades, "2026-03-01", "2026-03-31");
    expect(result.length).toBe(0);
  });

  test("includes trades on boundary dates", () => {
    const trades = [
      mockTrade({ exit_time: "2026-03-01T12:00:00Z" }),
      mockTrade({ exit_time: "2026-03-31T12:00:00Z" }),
    ];
    const result = filterByRange(trades, "2026-03-01", "2026-03-31");
    expect(result.length).toBe(2);
  });

  test("returns empty for empty trades", () => {
    expect(filterByRange([], "2026-01-01", "2026-12-31")).toEqual([]);
  });
});

describe("groupTradesByDate", () => {
  test("returns empty object for empty trades", () => {
    expect(groupTradesByDate([])).toEqual({});
  });

  test("groups trades by exit_time date", () => {
    const trades = [
      mockTrade({ trade_id: "1", exit_time: "2026-03-20T14:30:00Z" }),
      mockTrade({ trade_id: "2", exit_time: "2026-03-19T10:00:00Z" }),
      mockTrade({ trade_id: "3", exit_time: "2026-03-20T09:30:00Z" }),
    ];
    const result = groupTradesByDate(trades);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result["2026-03-20"]).toHaveLength(2);
    expect(result["2026-03-19"]).toHaveLength(1);
  });

  test("sorts trades within each date group by exit_time descending", () => {
    const trades = [
      mockTrade({ trade_id: "1", exit_time: "2026-03-20T09:30:00Z" }),
      mockTrade({ trade_id: "2", exit_time: "2026-03-20T14:30:00Z" }),
    ];
    const result = groupTradesByDate(trades);
    expect(result["2026-03-20"][0].trade_id).toBe("2");
    expect(result["2026-03-20"][1].trade_id).toBe("1");
  });
});

describe("formatDateHeader", () => {
  test("formats date string to short format", () => {
    const result = formatDateHeader("2026-03-20");
    expect(result).toContain("20");
    expect(result).toContain("Mar");
  });

  test("formats January date", () => {
    const result = formatDateHeader("2026-01-05");
    expect(result).toContain("05");
    expect(result).toContain("Jan");
  });

  test("includes weekday", () => {
    const result = formatDateHeader("2026-03-20");
    expect(result).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
  });
});

describe("getPeriodFromDateRange", () => {
  test("returns 'all' when both dates are null", () => {
    expect(getPeriodFromDateRange(null, null)).toBe("all");
  });

  test("returns 'today' when both dates equal today", () => {
    const today = dayjs().format("YYYY-MM-DD");
    expect(getPeriodFromDateRange(today, today)).toBe("today");
  });

  test("returns 'week' when fromDate is 7 days ago", () => {
    const weekAgo = dayjs().subtract(7, "day").format("YYYY-MM-DD");
    expect(getPeriodFromDateRange(weekAgo, null)).toBe("week");
  });

  test("returns 'month' when fromDate is 1 month ago", () => {
    const monthAgo = dayjs().subtract(1, "month").format("YYYY-MM-DD");
    expect(getPeriodFromDateRange(monthAgo, null)).toBe("month");
  });

  test("returns 'year' when fromDate is 1 year ago", () => {
    const yearAgo = dayjs().subtract(1, "year").format("YYYY-MM-DD");
    expect(getPeriodFromDateRange(yearAgo, null)).toBe("year");
  });
});
