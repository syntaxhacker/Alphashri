import { describe, it, expect } from "vitest";
import {
  nearBreakoutPct,
  formatNear,
  groupPositionsByStrategy,
  calcStrategySummary,
  tableStyles,
} from "./PositionsHelpers";
import type { PaperPosition, PaperScanItem } from "../types/paperTrading";

describe("PositionsHelpers", () => {
  describe("nearBreakoutPct", () => {
    it("returns correct percentage when price is within ORB range", () => {
      const item: PaperScanItem = {
        symbol: "TCS",
        status: "READY",
        price: 4000,
        or_high: 4020,
        or_low: 3980,
      };

      const result = nearBreakoutPct(item);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(2);
    });

    it("returns correct percentage when price is above ORB high", () => {
      const item: PaperScanItem = {
        symbol: "TCS",
        status: "READY",
        price: 4050,
        or_high: 4020,
        or_low: 3980,
      };

      const result = nearBreakoutPct(item);
      expect(result).toBeGreaterThan(0);
    });

    it("returns correct percentage when price is below ORB low", () => {
      const item: PaperScanItem = {
        symbol: "TCS",
        status: "READY",
        price: 3950,
        or_high: 4020,
        or_low: 3980,
      };

      const result = nearBreakoutPct(item);
      expect(result).toBeGreaterThan(0);
    });

    it("returns 9999 when price is null but ORB levels exist", () => {
      const item: PaperScanItem = {
        symbol: "TCS",
        status: "READY",
        price: undefined as any,
        or_high: 4020,
        or_low: 3980,
      };

      const result = nearBreakoutPct(item);
      expect(result).toBe(9999);
    });

    it("returns 9999 when ORB levels are null", () => {
      const item: PaperScanItem = {
        symbol: "TCS",
        status: "READY",
        price: 4000,
        or_high: undefined,
        or_low: undefined,
      };

      const result = nearBreakoutPct(item);
      expect(result).toBe(9999);
    });

    it("returns 9999 when ORB levels are zero", () => {
      const item: PaperScanItem = {
        symbol: "TCS",
        status: "READY",
        price: 4000,
        or_high: 0,
        or_low: 0,
      };

      const result = nearBreakoutPct(item);
      expect(result).toBe(9999);
    });

    it("uses 52W high when ORB levels are invalid", () => {
      const item: PaperScanItem = {
        symbol: "TCS",
        status: "READY",
        price: 4000,
        or_high: undefined,
        or_low: undefined,
        high_52w: 4500,
      };

      const result = nearBreakoutPct(item);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(100);
    });

    it("returns 9999 when price is null and no 52W high", () => {
      const item: PaperScanItem = {
        symbol: "TCS",
        status: "READY",
        price: undefined as any,
      };

      const result = nearBreakoutPct(item);
      expect(result).toBe(9999);
    });

    it("handles zero prices correctly", () => {
      const item: PaperScanItem = {
        symbol: "TCS",
        status: "READY",
        price: 0,
        or_high: 4020,
        or_low: 3980,
      };

      const result = nearBreakoutPct(item);
      expect(result).toBeGreaterThan(0);
    });

    it("returns 9999 for Infinity or very large values", () => {
      const item1: PaperScanItem = {
        symbol: "TCS",
        status: "READY",
        price: 0,
        or_high: 0,
        or_low: 0,
      };
      expect(nearBreakoutPct(item1)).toBe(9999);

      const item2: PaperScanItem = {
        symbol: "TCS",
        status: "READY",
        price: Infinity,
        or_high: 0,
        or_low: 0,
      };
      expect(nearBreakoutPct(item2)).toBe(9999);
    });

    it("uses 52W high when ORB levels are missing and calculates correct percentage", () => {
      const item: PaperScanItem = {
        symbol: "TCS",
        status: "READY",
        price: 4500,
        high_52w: 5000,
      };

      const result = nearBreakoutPct(item);
      expect(result).toBe(10);
    });

    it("calculates percentage with price 0 and valid ORB levels", () => {
      const item: PaperScanItem = {
        symbol: "TCS",
        status: "READY",
        price: 0,
        or_high: 100,
        or_low: 90,
      };

      const result = nearBreakoutPct(item);
      expect(result).not.toBe(9999);
      expect(result).toBe(100);
    });
  });

  describe("formatNear", () => {
    it("formats valid percentage correctly", () => {
      const item: PaperScanItem = {
        symbol: "TCS",
        status: "READY",
        price: 4000,
        or_high: 4020,
        or_low: 3980,
      };

      const result = formatNear(item);
      expect(result).toMatch(/^\d+\.\d+%$/);
    });

    it("returns '-' for invalid data", () => {
      const item: PaperScanItem = {
        symbol: "TCS",
        status: "READY",
      };

      const result = formatNear(item);
      expect(result).toBe("-");
    });

    it("returns '-' for infinite values", () => {
      const item: PaperScanItem = {
        symbol: "TCS",
        status: "READY",
        price: 0,
        or_high: 0,
        or_low: 0,
      };

      const result = formatNear(item);
      expect(result).toBe("-");
    });
  });

  describe("groupPositionsByStrategy", () => {
    it("groups positions by strategy_id", () => {
      const positions: PaperPosition[] = [
        {
          symbol: "TCS",
          strategy_id: 1,
          order_id: "1",
          side: "LONG",
          quantity: 10,
          entry_price: 4000,
          current_price: 4100,
          pnl: 1000,
          pnl_pct: 2.5,
          stop_loss: 3950,
          take_profit: 4100,
          entry_time: new Date().toISOString(),
          margin_used: 40000,
        },
        {
          symbol: "INFY",
          strategy_id: 1,
          order_id: "2",
          side: "LONG",
          quantity: 20,
          entry_price: 1800,
          current_price: 1850,
          pnl: 1000,
          pnl_pct: 2.78,
          stop_loss: 1780,
          take_profit: 1900,
          entry_time: new Date().toISOString(),
          margin_used: 36000,
        },
        {
          symbol: "RELIANCE",
          strategy_id: 2,
          order_id: "3",
          side: "LONG",
          quantity: 15,
          entry_price: 2800,
          current_price: 2900,
          pnl: 1500,
          pnl_pct: 3.57,
          stop_loss: 2750,
          take_profit: 3000,
          entry_time: new Date().toISOString(),
          margin_used: 42000,
        },
      ];

      const result = groupPositionsByStrategy(positions);

      expect(result.size).toBe(2);
      expect(result.get(1)?.length).toBe(2);
      expect(result.get(2)?.length).toBe(1);
    });

    it("handles empty array", () => {
      const positions: PaperPosition[] = [];

      const result = groupPositionsByStrategy(positions);

      expect(result.size).toBe(0);
    });

    it("groups same symbol from different strategies separately", () => {
      const positions: PaperPosition[] = [
        {
          symbol: "RELIANCE",
          strategy_id: 1,
          order_id: "1",
          side: "LONG",
          quantity: 10,
          entry_price: 2800,
          current_price: 2900,
          pnl: 1000,
          pnl_pct: 3.57,
          stop_loss: 2750,
          take_profit: 3000,
          entry_time: new Date().toISOString(),
          margin_used: 28000,
        },
        {
          symbol: "RELIANCE",
          strategy_id: 2,
          order_id: "2",
          side: "LONG",
          quantity: 15,
          entry_price: 2850,
          current_price: 2950,
          pnl: 1500,
          pnl_pct: 3.51,
          stop_loss: 2800,
          take_profit: 3100,
          entry_time: new Date().toISOString(),
          margin_used: 42750,
        },
      ];

      const result = groupPositionsByStrategy(positions);

      expect(result.size).toBe(2);
      expect(result.get(1)?.length).toBe(1);
      expect(result.get(2)?.length).toBe(1);
      expect(result.get(1)?.[0].symbol).toBe("RELIANCE");
      expect(result.get(2)?.[0].symbol).toBe("RELIANCE");
    });

    it("groups same symbol from same strategy together", () => {
      const positions: PaperPosition[] = [
        {
          symbol: "RELIANCE",
          strategy_id: 1,
          order_id: "1",
          side: "LONG",
          quantity: 10,
          entry_price: 2800,
          current_price: 2900,
          pnl: 1000,
          pnl_pct: 3.57,
          stop_loss: 2750,
          take_profit: 3000,
          entry_time: new Date().toISOString(),
          margin_used: 28000,
        },
        {
          symbol: "RELIANCE",
          strategy_id: 1,
          order_id: "2",
          side: "SHORT",
          quantity: 15,
          entry_price: 2850,
          current_price: 2800,
          pnl: 750,
          pnl_pct: 1.75,
          stop_loss: 2900,
          take_profit: 2700,
          entry_time: new Date().toISOString(),
          margin_used: 42750,
        },
      ];

      const result = groupPositionsByStrategy(positions);

      expect(result.size).toBe(1);
      expect(result.get(1)?.length).toBe(2);
    });

    it("groups positions with null strategy_id under key 0", () => {
      const positions: PaperPosition[] = [
        {
          symbol: "TCS",
          order_id: "1",
          side: "LONG",
          quantity: 10,
          entry_price: 4000,
          current_price: 4100,
          pnl: 1000,
          pnl_pct: 2.5,
          stop_loss: 3950,
          take_profit: 4100,
          entry_time: new Date().toISOString(),
          margin_used: 40000,
        },
      ];

      const result = groupPositionsByStrategy(positions);

      expect(result.size).toBe(1);
      expect(result.get(0)?.length).toBe(1);
    });
  });

  describe("calcStrategySummary", () => {
    it("calculates total P&L correctly", () => {
      const positions: PaperPosition[] = [
        {
          symbol: "TCS",
          strategy_id: 1,
          order_id: "1",
          side: "LONG",
          quantity: 10,
          entry_price: 4000,
          current_price: 4100,
          pnl: 1000,
          pnl_pct: 2.5,
          stop_loss: 3950,
          take_profit: 4100,
          entry_time: new Date().toISOString(),
          margin_used: 40000,
        },
        {
          symbol: "INFY",
          strategy_id: 1,
          order_id: "2",
          side: "LONG",
          quantity: 20,
          entry_price: 1800,
          current_price: 1700,
          pnl: -2000,
          pnl_pct: -5.56,
          stop_loss: 1780,
          take_profit: 1900,
          entry_time: new Date().toISOString(),
          margin_used: 36000,
        },
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
      const positions: PaperPosition[] = [
        {
          symbol: "TCS",
          strategy_id: 1,
          order_id: "1",
          side: "LONG",
          quantity: 10,
          entry_price: 4000,
          current_price: 4100,
          stop_loss: 3950,
          take_profit: 4100,
          entry_time: new Date().toISOString(),
        },
      ];

      const result = calcStrategySummary(positions);

      expect(result.totalPnl).toBe(0);
      expect(result.marginUsed).toBe(0);
      expect(result.count).toBe(1);
    });

    it("handles positions with null pnl or undefined margin_used", () => {
      const positions: PaperPosition[] = [
        {
          symbol: "TCS",
          strategy_id: 1,
          order_id: "1",
          side: "LONG",
          quantity: 10,
          entry_price: 4000,
          current_price: 4100,
          pnl: null as any,
          pnl_pct: 2.5,
          stop_loss: 3950,
          take_profit: 4100,
          entry_time: new Date().toISOString(),
          margin_used: undefined as any,
        },
      ];

      const result = calcStrategySummary(positions);

      expect(result.totalPnl).toBe(0);
      expect(result.marginUsed).toBe(0);
      expect(result.count).toBe(1);
    });
  });

  describe("tableStyles export", () => {
    it("exports TABLE_STYLES as tableStyles", () => {
      expect(tableStyles).toBeDefined();
      expect(typeof tableStyles).toBe("object");
    });

    it("has required style properties", () => {
      expect(tableStyles.thead).toBeDefined();
      expect(tableStyles.th).toBeDefined();
      expect(tableStyles.td).toBeDefined();
    });

    it("has correct thead styles", () => {
      expect(tableStyles.thead.position).toBe("sticky");
      expect(tableStyles.thead.top).toBe(0);
      expect(tableStyles.thead.zIndex).toBe(1);
    });

    it("has correct th styles", () => {
      expect(tableStyles.th.fontSize).toBe("11px");
      expect(tableStyles.th.fontWeight).toBe(600);
      expect(tableStyles.th.textTransform).toBe("uppercase");
    });

    it("has correct td styles", () => {
      expect(tableStyles.td.fontSize).toBe("12px");
      expect(tableStyles.td.whiteSpace).toBe("nowrap");
    });
  });
});
