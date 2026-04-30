// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { nearBreakoutPct, formatNear } from "./PositionsHelpers";
import type { PaperScanItem } from "../../types/paperTrading";

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
});
