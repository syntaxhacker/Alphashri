// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import type { PaperTrade } from "../../types/paperTrading";

const mockTrade = (overrides: Partial<PaperTrade> = {}): PaperTrade => ({
  trade_id: "TRADE-000001",
  symbol: "TCS",
  side: "BUY",
  quantity: 10,
  entry_price: 100,
  exit_price: 110,
  entry_time: "2026-04-15T09:30:00",
  exit_time: "2026-04-15T14:30:00",
  pnl: 100,
  pnl_pct: 10,
  exit_reason: "TP",
  costs: 5,
  net_pnl: 95,
  stop_loss: 95,
  take_profit: 115,
  peak_price: 112,
  low_price: 98,
  hold_duration_minutes: 300,
  notes: "test notes",
  reason: "test reason",
  strategy_id: 1,
  strategy_name: "ORB Best",
  strategy_type: "ORB",
  bot_id: null,
  bot_name: null,
  ...overrides,
});

describe("PaperTrade type", () => {
  test("has reason and notes fields", () => {
    const trade = mockTrade();
    expect(trade.reason).toBe("test reason");
    expect(trade.notes).toBe("test notes");
  });

  test("has hold_duration_minutes field", () => {
    const trade = mockTrade({ hold_duration_minutes: 120 });
    expect(trade.hold_duration_minutes).toBe(120);
  });

  test("has nullable hold_duration_minutes", () => {
    const trade = mockTrade({ hold_duration_minutes: null });
    expect(trade.hold_duration_minutes).toBeNull();
  });

  test("has strategy_type field", () => {
    const trade = mockTrade({ strategy_type: "SR_BREAKOUT" });
    expect(trade.strategy_type).toBe("SR_BREAKOUT");
  });

  test("has optional strategy_type field", () => {
    const trade = mockTrade({ strategy_type: undefined });
    expect(trade.strategy_type).toBeUndefined();
  });

  test("supports all exit reasons", () => {
    for (const reason of ["SL", "TP", "EOD", "MANUAL"] as const) {
      const trade = mockTrade({ exit_reason: reason });
      expect(trade.exit_reason).toBe(reason);
    }
  });

  test("has nullable bot fields", () => {
    const trade = mockTrade({ bot_id: null, bot_name: null });
    expect(trade.bot_id).toBeNull();
    expect(trade.bot_name).toBeNull();
  });

  test("has bot fields when set", () => {
    const trade = mockTrade({ bot_id: "bot-uuid", bot_name: "My Bot" });
    expect(trade.bot_id).toBe("bot-uuid");
    expect(trade.bot_name).toBe("My Bot");
  });

  test("computes pnl correctly", () => {
    const trade = mockTrade({ entry_price: 1000, exit_price: 1050, quantity: 10, pnl: 500 });
    expect(trade.entry_price).toBe(1000);
    expect(trade.exit_price).toBe(1050);
    expect(trade.quantity).toBe(10);
    expect(trade.pnl).toBe(500);
  });

  test("net_pnl accounts for costs", () => {
    const trade = mockTrade({ pnl: 500, costs: 25, net_pnl: 475 });
    expect(trade.pnl).toBe(500);
    expect(trade.costs).toBe(25);
    expect(trade.net_pnl).toBe(475);
  });
});
