// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { loadPaperTrades, savePaperTrades, newPaperTrade, tradePnl, tradePnlPct } from "./paperTrades";

beforeEach(() => {
  localStorage.clear();
});

describe("paperTrades store", () => {
  it("round-trips trades through localStorage", () => {
    const trade = newPaperTrade({
      date: "2026-09-28",
      underlying: "NIFTY",
      side: "CE",
      strike: 23150,
      qty: 65,
      entry: 90,
      note: "morning breakout",
    });
    expect(trade.exit).toBeNull();
    savePaperTrades([trade]);
    expect(loadPaperTrades()).toHaveLength(1);
  });

  it("returns empty array on corrupt storage", () => {
    localStorage.setItem("premium-paper-trades", "not-json{{{");
    expect(loadPaperTrades()).toEqual([]);
  });

  it("computes rupee and percent pnl", () => {
    const trade = { ...newPaperTrade({
      date: "2026-09-28", underlying: "NIFTY" as const, side: "CE" as const,
      strike: 23150, qty: 65, entry: 100, note: "",
    }), exit: 150 };
    expect(tradePnl(trade)).toBe(3250);
    expect(tradePnlPct(trade)).toBe(50);
  });

  it("returns null pnl for open trades", () => {
    const trade = newPaperTrade({
      date: "2026-09-28", underlying: "BANKNIFTY", side: "PE",
      strike: 55600, qty: 15, entry: 250, note: "",
    });
    expect(tradePnl(trade)).toBeNull();
    expect(tradePnlPct(trade)).toBeNull();
  });
});
