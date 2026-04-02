import { describe, expect, test } from "vitest";
import type { BacktestTotals } from "../../types/backtest";
import { formatPnl as formatPnlShared, getPnLTextColor } from "../../utils/ui-helpers";
import { resolveTotals, formatCosts, formatWinRate } from "./BacktestSummary";

describe("BacktestSummary", () => {
  describe("resolveTotals", () => {
    test("returns null when totals is null", () => {
      expect(resolveTotals(null)).toBeNull();
    });

    test("resolves all fields from totals", () => {
      const totals: BacktestTotals = {
        net_pnl: 50000,
        total_costs: 2000,
        trades: 100,
        win_rate: 65.5,
        gross_pnl: 52000,
      };
      const result = resolveTotals(totals);
      expect(result).toEqual({
        netPnl: 50000,
        totalCosts: 2000,
        winRate: 65.5,
        trades: 100,
      });
    });

    test("defaults missing fields to zero", () => {
      const totals = {
        net_pnl: undefined,
        total_costs: undefined,
        win_rate: undefined,
        trades: undefined,
        gross_pnl: 0,
      } as unknown as BacktestTotals;
      const result = resolveTotals(totals);
      expect(result).toEqual({
        netPnl: 0,
        totalCosts: 0,
        winRate: 0,
        trades: 0,
      });
    });
  });

  describe("getPnLTextColor", () => {
    test("returns green for positive PnL", () => {
      expect(getPnLTextColor(1000)).toBe("green");
    });

    test("returns green for zero PnL", () => {
      expect(getPnLTextColor(0)).toBe("green");
    });

    test("returns red for negative PnL", () => {
      expect(getPnLTextColor(-500)).toBe("red");
    });
  });

  describe("formatPnl (shared)", () => {
    test("formats positive PnL with sign and K suffix", () => {
      expect(formatPnlShared(50000)).toBe("+₹50.0K");
    });

    test("formats zero PnL with sign", () => {
      expect(formatPnlShared(0)).toBe("+₹0.0K");
    });

    test("formats negative PnL without sign prefix", () => {
      expect(formatPnlShared(-15000)).toBe("₹-15.0K");
    });

    test("handles fractional thousands", () => {
      expect(formatPnlShared(1500)).toBe("+₹1.5K");
      expect(formatPnlShared(-2500)).toBe("₹-2.5K");
    });

    test("handles sub-thousand values", () => {
      expect(formatPnlShared(500)).toBe("+₹0.5K");
      expect(formatPnlShared(-100)).toBe("₹-0.1K");
    });

    test("handles large values", () => {
      expect(formatPnlShared(500000)).toBe("+₹500.0K");
      expect(formatPnlShared(1234567)).toBe("+₹1234.6K");
    });
  });

  describe("formatCosts", () => {
    test("formats costs with rupee symbol and K suffix", () => {
      expect(formatCosts(2000)).toBe("₹2.0K");
    });

    test("handles zero costs", () => {
      expect(formatCosts(0)).toBe("₹0.0K");
    });

    test("handles fractional thousands", () => {
      expect(formatCosts(500)).toBe("₹0.5K");
    });

    test("handles large costs", () => {
      expect(formatCosts(50000)).toBe("₹50.0K");
    });
  });

  describe("formatWinRate", () => {
    test("formats win rate as percentage with no decimals", () => {
      expect(formatWinRate(65.5)).toBe("66%");
    });

    test("handles zero win rate", () => {
      expect(formatWinRate(0)).toBe("0%");
    });

    test("handles 100% win rate", () => {
      expect(formatWinRate(100)).toBe("100%");
    });

    test("rounds down", () => {
      expect(formatWinRate(65.4)).toBe("65%");
    });

    test("handles negative win rate edge case", () => {
      expect(formatWinRate(-10.5)).toBe("-11%");
    });
  });
});
