import { describe, expect, test } from "vitest";
import { DEFAULT_TRADE_FILTERS, filterTrades, matchesTradeFilters, tradeReason } from "./tradeFilters";

const t = (over: Partial<{ net_pnl: number; exit_reason: string; side: string }>) => ({
  net_pnl: 10,
  exit_reason: "TP",
  side: "LONG",
  ...over,
});

describe("matchesTradeFilters", () => {
  test("default filters match everything", () => {
    expect(matchesTradeFilters(t({}), DEFAULT_TRADE_FILTERS)).toBe(true);
  });

  test("WIN keeps only positive net_pnl", () => {
    const f = { ...DEFAULT_TRADE_FILTERS, result: "WIN" };
    expect(matchesTradeFilters(t({ net_pnl: 5 }), f)).toBe(true);
    expect(matchesTradeFilters(t({ net_pnl: 0 }), f)).toBe(false);
    expect(matchesTradeFilters(t({ net_pnl: -5 }), f)).toBe(false);
  });

  test("LOSS keeps only non-positive net_pnl", () => {
    const f = { ...DEFAULT_TRADE_FILTERS, result: "LOSS" };
    expect(matchesTradeFilters(t({ net_pnl: -5 }), f)).toBe(true);
    expect(matchesTradeFilters(t({ net_pnl: 0 }), f)).toBe(true);
    expect(matchesTradeFilters(t({ net_pnl: 5 }), f)).toBe(false);
  });

  test("side filter matches explicit and default LONG", () => {
    const f = { ...DEFAULT_TRADE_FILTERS, side: "SHORT" };
    expect(matchesTradeFilters(t({ side: "SHORT" }), f)).toBe(true);
    expect(matchesTradeFilters(t({ side: "LONG" }), f)).toBe(false);
    expect(matchesTradeFilters({ net_pnl: 1 }, f)).toBe(false);
  });

  test("canonicalizes BUY/SELL to LONG/SHORT across data models", () => {
    const long = { ...DEFAULT_TRADE_FILTERS, side: "LONG" };
    const short = { ...DEFAULT_TRADE_FILTERS, side: "SHORT" };
    expect(matchesTradeFilters({ net_pnl: 1, side: "BUY" }, long)).toBe(true);
    expect(matchesTradeFilters({ net_pnl: 1, side: "BUY" }, short)).toBe(false);
    expect(matchesTradeFilters({ net_pnl: 1, side: "SELL" }, short)).toBe(true);
    expect(matchesTradeFilters({ net_pnl: 1, side: "SELL" }, long)).toBe(false);
  });

  test("reason filter and EOD fallback", () => {
    const f = { ...DEFAULT_TRADE_FILTERS, reason: "SL" };
    expect(matchesTradeFilters(t({ exit_reason: "SL" }), f)).toBe(true);
    expect(matchesTradeFilters(t({ exit_reason: "TP" }), f)).toBe(false);
    expect(tradeReason({ net_pnl: 1 })).toBe("EOD");
  });
});

describe("filterTrades", () => {
  test("composes multiple filters", () => {
    const trades = [
      t({ net_pnl: 5, side: "LONG", exit_reason: "TP" }),
      t({ net_pnl: -5, side: "LONG", exit_reason: "SL" }),
      t({ net_pnl: 5, side: "SHORT", exit_reason: "TP" }),
    ];
    const out = filterTrades(trades, { side: "LONG", result: "WIN", reason: "ALL" });
    expect(out).toHaveLength(1);
    expect(out[0].net_pnl).toBe(5);
    expect(out[0].side).toBe("LONG");
  });
});

// Counting only numeric index reads: Array#filter visits each element exactly
// once via Get(O, Pk), so this is a deterministic proxy for predicate work —
// no timing, no spies on shared module internals.
function countedTrades(count: { reads: number }, n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({
    net_pnl: i % 2 === 0 ? 10 : -10,
    exit_reason: i % 3 === 0 ? "SL" : "TP",
    side: i % 5 === 0 ? "SELL" : "BUY",
  }));
  return new Proxy(rows, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && /^\d+$/.test(prop)) count.reads += 1;
      return Reflect.get(target, prop, receiver);
    },
  });
}

describe("filterTrades identity cache", () => {
  const N = 400;
  const win = { side: "ALL", result: "WIN", reason: "ALL" };

  test("two consumers filtering the same snapshot pay for one pass", () => {
    const count = { reads: 0 };
    const trades = countedTrades(count, N);
    const blotter = filterTrades(trades, { ...win });
    expect(count.reads).toBe(N);

    // Edge AI panel + per-trade chart list re-filter with equal-valued objects.
    const edge = filterTrades(trades, win);
    const charts = filterTrades(trades, { ...win });
    expect(edge).toBe(blotter);
    expect(charts).toBe(blotter);
    expect(count.reads).toBe(N);
  });

  test("a distinct filter fingerprint rescans once, then reuses that result", () => {
    const count = { reads: 0 };
    const trades = countedTrades(count, N);
    const winOut = filterTrades(trades, win);
    const lossOut = filterTrades(trades, { ...win, result: "LOSS" });
    expect(lossOut).not.toBe(winOut);
    expect(count.reads).toBe(2 * N);

    filterTrades(trades, { ...win, result: "LOSS" });
    filterTrades(trades, win);
    expect(count.reads).toBe(2 * N);
  });

  test("different trades snapshots never share a cached result", () => {
    const a = { reads: 0 };
    const b = { reads: 0 };
    const tradesA = countedTrades(a, N);
    const tradesB = countedTrades(b, N);
    const outA = filterTrades(tradesA, win);
    const outB = filterTrades(tradesB, win);
    expect(outA).not.toBe(outB);
    expect(a.reads).toBe(N);
    expect(b.reads).toBe(N);
    expect(outA).toEqual(outB);
  });

  test("cached results stay semantically identical to a naive filter", () => {
    const count = { reads: 0 };
    const trades = countedTrades(count, N);
    const combos = [
      win,
      { ...win, result: "LOSS" },
      { ...win, side: "LONG" },
      { ...win, side: "SHORT", reason: "SL" },
    ];
    for (const f of combos) {
      expect(filterTrades(trades, f)).toEqual(trades.filter((t) => matchesTradeFilters(t, f)));
    }
    // Warm pass for each combo, then confirm no extra traversal on reuse.
    const warm = count.reads;
    for (const f of combos) filterTrades(trades, { ...f });
    expect(count.reads).toBe(warm);
  });
});
