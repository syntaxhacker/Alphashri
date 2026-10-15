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
