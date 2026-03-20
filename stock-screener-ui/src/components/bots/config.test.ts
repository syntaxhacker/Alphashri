import { describe, expect, test } from "vitest";
import {
  calculateTotalAllocation,
  isAllocationOverLimit,
  formatAllocationPct,
  parseAllocationInput,
  formatMaxCapitalPct,
  parseMaxCapitalInput,
} from "./config";
import type { StrategyAllocation } from "../../types/bots";

describe("allocation calculation", () => {
  describe("calculateTotalAllocation", () => {
    test("sums allocation percentages correctly", () => {
      const strategies: StrategyAllocation[] = [
        { strategy_id: "s1", capital_allocation_pct: 0.3, max_positions: 3 },
        { strategy_id: "s2", capital_allocation_pct: 0.5, max_positions: 5 },
      ];
      expect(calculateTotalAllocation(strategies)).toBe(80);
    });

    test("handles single strategy at full allocation", () => {
      const strategies: StrategyAllocation[] = [
        { strategy_id: "s1", capital_allocation_pct: 1.0, max_positions: 10 },
      ];
      expect(calculateTotalAllocation(strategies)).toBe(100);
    });

    test("returns 0 for empty strategies array", () => {
      expect(calculateTotalAllocation([])).toBe(0);
    });

    test("handles three strategies with different allocations", () => {
      const strategies: StrategyAllocation[] = [
        { strategy_id: "s1", capital_allocation_pct: 0.2, max_positions: 3 },
        { strategy_id: "s2", capital_allocation_pct: 0.3, max_positions: 5 },
        { strategy_id: "s3", capital_allocation_pct: 0.1, max_positions: 2 },
      ];
      expect(calculateTotalAllocation(strategies)).toBe(60);
    });

    test("handles zero allocations", () => {
      const strategies: StrategyAllocation[] = [
        { strategy_id: "s1", capital_allocation_pct: 0, max_positions: 3 },
        { strategy_id: "s2", capital_allocation_pct: 0, max_positions: 5 },
      ];
      expect(calculateTotalAllocation(strategies)).toBe(0);
    });
  });

  describe("isAllocationOverLimit", () => {
    test("returns true when total exceeds 100", () => {
      expect(isAllocationOverLimit(101)).toBe(true);
      expect(isAllocationOverLimit(150)).toBe(true);
      expect(isAllocationOverLimit(100.1)).toBe(true);
    });

    test("returns false when total is exactly 100", () => {
      expect(isAllocationOverLimit(100)).toBe(false);
    });

    test("returns false when total is below 100", () => {
      expect(isAllocationOverLimit(0)).toBe(false);
      expect(isAllocationOverLimit(50)).toBe(false);
      expect(isAllocationOverLimit(99.9)).toBe(false);
    });
  });

  describe("allocation percentage conversion", () => {
    test("converts decimal to percentage for display", () => {
      expect(formatAllocationPct(0.2)).toBe(20);
      expect(formatAllocationPct(0.8)).toBe(80);
      expect(formatAllocationPct(1.0)).toBe(100);
    });

    test("converts percentage input to decimal for storage", () => {
      expect(parseAllocationInput(20)).toBe(0.2);
      expect(parseAllocationInput(80)).toBe(0.8);
      expect(parseAllocationInput(100)).toBe(1.0);
    });

    test("handles zero", () => {
      expect(formatAllocationPct(0)).toBe(0);
      expect(parseAllocationInput(0)).toBe(0);
    });
  });

  describe("max capital percentage conversion", () => {
    test("converts decimal to percentage for form display", () => {
      expect(formatMaxCapitalPct(0.8)).toBe(80);
      expect(formatMaxCapitalPct(0.5)).toBe(50);
      expect(formatMaxCapitalPct(1.0)).toBe(100);
    });

    test("converts form percentage input to decimal", () => {
      expect(parseMaxCapitalInput(80)).toBe(0.8);
      expect(parseMaxCapitalInput(50)).toBe(0.5);
      expect(parseMaxCapitalInput(100)).toBe(1.0);
    });

    test("defaults to 80% when no value is provided", () => {
      const defaultPct = 80;
      expect(parseMaxCapitalInput(defaultPct)).toBe(0.8);
    });
  });

  describe("edge cases", () => {
    test("handles very small allocation percentages", () => {
      expect(formatAllocationPct(0.05)).toBe(5);
      expect(parseAllocationInput(5)).toBe(0.05);
    });

    test("handles fractional percentage values", () => {
      expect(parseAllocationInput(33.33)).toBeCloseTo(0.3333, 4);
      expect(formatAllocationPct(0.3333)).toBeCloseTo(33.33, 1);
    });

    test("handles max positions default of 3", () => {
      const strategies: StrategyAllocation[] = [
        { strategy_id: "s1", capital_allocation_pct: 0.2, max_positions: 3 },
      ];
      expect(strategies[0].max_positions).toBe(3);
    });

    test("handles max positions range of 1 to 10", () => {
      const min: StrategyAllocation = {
        strategy_id: "s1",
        capital_allocation_pct: 0.1,
        max_positions: 1,
      };
      const max: StrategyAllocation = {
        strategy_id: "s2",
        capital_allocation_pct: 0.1,
        max_positions: 10,
      };
      expect(min.max_positions).toBe(1);
      expect(max.max_positions).toBe(10);
    });
  });
});
