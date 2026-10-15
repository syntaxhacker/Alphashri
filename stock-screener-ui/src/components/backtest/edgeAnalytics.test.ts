import { describe, expect, test } from "vitest";
import type { Trade } from "../../types/backtest";
import {
  bestBucket,
  bucketBy,
  entryHour,
  entryWeekday,
  exitReasonEdge,
  holdEdge,
  hourEdge,
  sideEdge,
  weekdayEdge,
  winRate,
  worstBucket,
} from "./edgeAnalytics";

function makeTrade(over: Partial<Trade> = {}): Trade {
  return {
    entry_price: 100,
    exit_price: 102,
    entry_time: "2026-02-16T09:30:00+05:30",
    exit_time: "2026-02-16T10:00:00+05:30",
    quantity: 10,
    gross_pnl: 20,
    gross_pnl_pct: 1,
    trading_costs: 2,
    net_pnl: 18,
    net_pnl_pct: 1.8,
    exit_reason: "TP",
    hold_duration_minutes: 30,
    date: "2026-02-16",
    ...over,
  } as Trade;
}

describe("bucketBy", () => {
  test("aggregates count, wins and net P&L, ordered by `order`", () => {
    const out = bucketBy(
      [makeTrade(), makeTrade({ net_pnl: -5 }), makeTrade({ net_pnl: 10 })],
      () => ({ key: "a", label: "A", order: 0 }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ count: 3, wins: 2, netPnl: 23 });
    expect(winRate(out[0])).toBeCloseTo(66.67, 1);
  });

  test("sorts by net P&L when requested", () => {
    const out = bucketBy(
      [makeTrade({ net_pnl: 5 }), makeTrade({ net_pnl: -5 })],
      (t) => ({ key: t.net_pnl >= 0 ? "win" : "loss", label: String(t.net_pnl), order: t.net_pnl }),
      true,
    );
    expect(out.map((b) => b.key)).toEqual(["win", "loss"]);
  });
});

describe("time parsing (IST)", () => {
  test("entryHour handles +05:30 offset", () => {
    expect(entryHour(makeTrade({ entry_time: "2026-02-16T09:30:00+05:30" }))).toBe(9);
  });

  test("entryHour converts UTC to IST", () => {
    expect(entryHour(makeTrade({ entry_time: "2026-02-16T03:45:00Z" }))).toBe(9);
  });

  test("entryHour handles space-separated IST string", () => {
    expect(entryHour(makeTrade({ entry_time: "2026-02-16 14:05:00" }))).toBe(14);
  });

  test("entryWeekday resolves the IST weekday", () => {
    expect(entryWeekday(makeTrade({ entry_time: "2026-02-16T09:30:00+05:30" }))).toBe("Mon");
  });
});

describe("edge groupings", () => {
  test("hourEdge buckets by IST hour with range labels", () => {
    const out = hourEdge([
      makeTrade({ entry_time: "2026-02-16T09:30:00+05:30", net_pnl: 10 }),
      makeTrade({ entry_time: "2026-02-16T09:50:00+05:30", net_pnl: -4 }),
      makeTrade({ entry_time: "2026-02-16T13:10:00+05:30", net_pnl: 7 }),
    ]);
    expect(out.map((b) => b.label)).toEqual(["09–10", "13–14"]);
    expect(out[0]).toMatchObject({ count: 2, netPnl: 6 });
  });

  test("weekdayEdge ordered Mon→Sun", () => {
    const out = weekdayEdge([
      makeTrade({ entry_time: "2026-02-17T09:30:00+05:30" }), // Tue
      makeTrade({ entry_time: "2026-02-16T09:30:00+05:30" }), // Mon
    ]);
    expect(out.map((b) => b.label)).toEqual(["Mon", "Tue"]);
  });

  test("holdEdge buckets durations", () => {
    const out = holdEdge([
      makeTrade({ hold_duration_minutes: 5 }),
      makeTrade({ hold_duration_minutes: 40 }),
      makeTrade({ hold_duration_minutes: 120 }),
      makeTrade({ hold_duration_minutes: 400 }),
    ]);
    expect(out.map((b) => b.label)).toEqual(["<15m", "15–60m", "1–4h", ">4h"]);
    expect(out.map((b) => b.count)).toEqual([1, 1, 1, 1]);
  });

  test("sideEdge defaults to Long when side is absent", () => {
    const out = sideEdge([makeTrade(), makeTrade({ side: "SHORT" } as never)]);
    expect(out.map((b) => b.label)).toEqual(["Long", "Short"]);
  });

  test("exitReasonEdge ranks by net P&L", () => {
    const out = exitReasonEdge([
      makeTrade({ exit_reason: "SL", net_pnl: -30 }),
      makeTrade({ exit_reason: "TP", net_pnl: 50 }),
    ]);
    expect(out.map((b) => b.label)).toEqual(["TP", "SL"]);
  });
});

describe("best/worst bucket", () => {
  test("picks extremes only when sign matches", () => {
    const buckets = [
      { key: "a", label: "A", count: 1, wins: 1, netPnl: 10 },
      { key: "b", label: "B", count: 1, wins: 0, netPnl: -5 },
    ];
    expect(bestBucket(buckets)?.key).toBe("a");
    expect(worstBucket(buckets)?.key).toBe("b");
    expect(bestBucket([{ key: "n", label: "N", count: 1, wins: 0, netPnl: -1 }])).toBeNull();
    expect(worstBucket([{ key: "p", label: "P", count: 1, wins: 1, netPnl: 1 }])).toBeNull();
  });
});
