// @vitest-environment happy-dom
import { describe, it, expect, test } from "vitest";
import {
  nearBreakoutPct,
  formatNear,
  groupPositionsByStrategy,
  calcStrategySummary,
} from "./PositionsHelpers";
import type { PaperPosition, PaperScanItem } from "../../types/paperTrading";
import { mockPosition } from "./testFixtures";

describe("PositionsHelpers", () => {
  describe("nearBreakoutPct", () => {
    const baseItem: PaperScanItem = {
      symbol: "RELIANCE",
      price: 2800,
      or_high: 2850,
      or_low: 2750,
      high_52w: null,
    };

    it("returns 0 when price is at OR high", () => {
      const item = { ...baseItem, price: 2850 };
      expect(nearBreakoutPct(item)).toBe(0);
    });

    it("returns 0 when price is at OR low", () => {
      const item = { ...baseItem, price: 2750 };
      expect(nearBreakoutPct(item)).toBe(0);
    });

    it("returns positive when price is inside OR range", () => {
      const item = { ...baseItem, price: 2800 };
      expect(nearBreakoutPct(item)).toBeCloseTo(1.75, 2);
    });

    it("returns positive when price is above OR high", () => {
      const item = { ...baseItem, price: 2900 };
      expect(nearBreakoutPct(item)).toBeCloseTo(1.75, 2);
    });

    it("returns positive when price is below OR low", () => {
      const item = { ...baseItem, price: 2700 };
      expect(nearBreakoutPct(item)).toBeCloseTo(1.818, 2);
    });

    it("uses 52W high when OR levels unavailable", () => {
      const item = { ...baseItem, or_high: null, or_low: null, high_52w: 3000 };
      expect(nearBreakoutPct(item)).toBeCloseTo(6.66, 1);
    });

    it("returns 9999 when all levels unavailable", () => {
      const item = { ...baseItem, or_high: null, or_low: null, high_52w: null };
      expect(nearBreakoutPct(item)).toBe(9999);
    });

    it("handles zero OR levels", () => {
      const item = { ...baseItem, or_high: 0, or_low: 0, high_52w: null };
      expect(nearBreakoutPct(item)).toBe(9999);
    });

    it("handles negative OR levels", () => {
      const item = { ...baseItem, or_high: -1, or_low: -1 };
      expect(nearBreakoutPct(item)).toBe(9999);
    });

    it("handles null price", () => {
      const item = { ...baseItem, price: null as any };
      expect(nearBreakoutPct(item)).toBe(9999);
    });
  });

  describe("formatNear", () => {
    it("formats valid percentage", () => {
      const item: PaperScanItem = { symbol: "TEST", price: 2800, or_high: 2850, or_low: 2750 };
      expect(formatNear(item)).toBe("1.75%");
    });

    it("returns dash for invalid values", () => {
      const item: PaperScanItem = {
        symbol: "TEST",
        price: null as any,
        or_high: null,
        or_low: null,
      };
      expect(formatNear(item)).toBe("-");
    });

    it("returns dash for infinity", () => {
      const item: PaperScanItem = { symbol: "TEST", price: 100, or_high: 0, or_low: 0 };
      expect(formatNear(item)).toBe("-");
    });
  });

  describe("groupPositionsByStrategy", () => {
    it("groups positions by strategy_id", () => {
      const positions = [
        mockPosition({ symbol: "TCS", order_id: "1", quantity: 10, entry_price: 4000, current_price: 4100, pnl: 1000, pnl_pct: 2.5, stop_loss: 3950, take_profit: 4100, margin_used: 40000 }),
        mockPosition({ symbol: "INFY", order_id: "2", quantity: 20, entry_price: 1800, current_price: 1850, pnl: 1000, pnl_pct: 2.78, stop_loss: 1780, take_profit: 1900, margin_used: 36000 }),
        mockPosition({ symbol: "RELIANCE", order_id: "3", quantity: 15, entry_price: 2800, current_price: 2900, pnl: 1500, pnl_pct: 3.57, stop_loss: 2750, take_profit: 3000, margin_used: 42000, strategy_id: 2 }),
      ];

      const result = groupPositionsByStrategy(positions);

      expect(result.size).toBe(2);
      expect(result.get(1)?.length).toBe(2);
      expect(result.get(2)?.length).toBe(1);
    });

    it("handles empty array", () => {
      const result = groupPositionsByStrategy([]);
      expect(result.size).toBe(0);
    });

    it("groups same symbol from different strategies separately", () => {
      const positions = [
        mockPosition({ order_id: "1", strategy_id: 1 }),
        mockPosition({ order_id: "2", strategy_id: 2 }),
      ];

      const result = groupPositionsByStrategy(positions);

      expect(result.size).toBe(2);
      expect(result.get(1)?.length).toBe(1);
      expect(result.get(2)?.length).toBe(1);
      expect(result.get(1)?.[0].symbol).toBe("RELIANCE");
      expect(result.get(2)?.[0].symbol).toBe("RELIANCE");
    });

    it("groups same symbol from same strategy together", () => {
      const positions = [
        mockPosition({ order_id: "1" }),
        mockPosition({ order_id: "2", side: "SELL", quantity: 15, entry_price: 2850, current_price: 2800, pnl: 750, pnl_pct: 1.75, stop_loss: 2900, take_profit: 2700, margin_used: 42750 }),
      ];

      const result = groupPositionsByStrategy(positions);

      expect(result.size).toBe(1);
      expect(result.get(1)?.length).toBe(2);
    });

    it("groups positions with null strategy_id under key 0", () => {
      const positions = [
        mockPosition({ symbol: "TCS", strategy_id: undefined as any, order_id: "1" }),
      ];

      const result = groupPositionsByStrategy(positions);

      expect(result.size).toBe(1);
      expect(result.get(0)?.length).toBe(1);
    });
  });

  describe("calcStrategySummary", () => {
    it("calculates total P&L correctly", () => {
      const positions = [
        mockPosition({ symbol: "TCS", order_id: "1", quantity: 10, entry_price: 4000, current_price: 4100, pnl: 1000, pnl_pct: 2.5, stop_loss: 3950, take_profit: 4100, margin_used: 40000 }),
        mockPosition({ symbol: "INFY", order_id: "2", quantity: 20, entry_price: 1800, current_price: 1700, pnl: -2000, pnl_pct: -5.56, stop_loss: 1780, take_profit: 1900, margin_used: 36000 }),
      ];

      const result = calcStrategySummary(positions);

      expect(result.totalPnl).toBe(-1000);
      expect(result.marginUsed).toBe(76000);
      expect(result.count).toBe(2);
    });

    it("handles empty positions array", () => {
      const positions: PaperPosition[] = [];

      const result = calcStrategySummary(positions);

      expect(result.totalPnl).toBe(0);
      expect(result.marginUsed).toBe(0);
      expect(result.count).toBe(0);
    });

    it("handles positions without pnl or margin values", () => {
      const positions = [
        mockPosition({ pnl: 0, margin_used: 0, pnl_pct: 0 }) as PaperPosition,
      ];

      const result = calcStrategySummary(positions);

      expect(result.totalPnl).toBe(0);
      expect(result.marginUsed).toBe(0);
      expect(result.count).toBe(1);
    });

    it("handles positions with null pnl or undefined margin_used", () => {
      const positions = [
        mockPosition({ pnl: null as any, margin_used: undefined as any, pnl_pct: 2.5 }) as any,
      ];

      const result = calcStrategySummary(positions);

      expect(result.totalPnl).toBe(0);
      expect(result.marginUsed).toBe(0);
      expect(result.count).toBe(1);
    });
  });

  describe("nearBreakoutPct edge cases", () => {
    test("handles NaN price without crashing", () => {
      const item = { symbol: "TEST", price: NaN as any, or_high: 2850, or_low: 2750 };
      const result = nearBreakoutPct(item);
      expect(Number.isNaN(result) || result === 9999).toBe(true);
    });

    test("handles Infinity price without crashing", () => {
      const item = { symbol: "TEST", price: Infinity, or_high: 2850, or_low: 2750 };
      const result = nearBreakoutPct(item);
      expect(Number.isFinite(result)).toBe(false);
    });

    test("handles orHigh/orLow both null with 52w_high = 0", () => {
      const item = { symbol: "TEST", price: 2800, or_high: null, or_low: null, high_52w: 0 };
      expect(nearBreakoutPct(item)).toBe(9999);
    });

    test("handles very large price values", () => {
      const item = { symbol: "TEST", price: 1e10, or_high: 2850, or_low: 2750 };
      const result = nearBreakoutPct(item);
      expect(Number.isFinite(result)).toBe(true);
    });
  });
});
