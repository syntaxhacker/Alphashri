import { describe, expect, test } from "vitest";
import { deriveProfitKpis, formatSignedMoney } from "./profitFormat";
import type { StrategyProfitRow } from "../../types/profitability";

describe("formatSignedMoney", () => {
  test("puts the sign before the rupee symbol", () => {
    expect(formatSignedMoney(-300)).toBe("-₹300");
    expect(formatSignedMoney(300)).toBe("+₹300");
    expect(formatSignedMoney(-1350)).toBe("-₹1.4K");
    expect(formatSignedMoney(1200.5)).toBe("+₹1.2K");
  });

  test("does not invent a sign for zero and marks missing values", () => {
    expect(formatSignedMoney(0)).toBe("₹0");
    expect(formatSignedMoney(null)).toBe("—");
    expect(formatSignedMoney(Number.NaN)).toBe("—");
  });
});

describe("deriveProfitKpis", () => {
  test("aggregates net, profit factor and worst drawdown", () => {
    const rows = [
      { net_pnl: 1200.5, max_dd: 300 },
      { net_pnl: -400.25, max_dd: 800 },
      { net_pnl: 3125, max_dd: 450 },
    ] as StrategyProfitRow[];
    const kpis = deriveProfitKpis(rows);
    expect(kpis.net).toBe(3925.25);
    expect(kpis.profitFactor).toBeCloseTo(10.81, 2);
    expect(kpis.maxDrawdown).toBe(800);
  });

  test("reports no profit factor when there are no losing strategies", () => {
    expect(deriveProfitKpis([{ net_pnl: 500, max_dd: 0 }] as StrategyProfitRow[]).profitFactor).toBeNull();
  });
});
