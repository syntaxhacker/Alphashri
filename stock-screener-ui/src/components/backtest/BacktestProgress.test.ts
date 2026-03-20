import { describe, expect, test } from "vitest";
import { calcProgressPercent } from "./BacktestProgress";

describe("calcProgressPercent", () => {
  test("calculates correct percentage for normal values", () => {
    expect(calcProgressPercent(50, 100)).toBe(50);
    expect(calcProgressPercent(25, 100)).toBe(25);
    expect(calcProgressPercent(75, 100)).toBe(75);
  });

  test("returns 100 for complete progress", () => {
    expect(calcProgressPercent(100, 100)).toBe(100);
  });

  test("returns 0 for zero current", () => {
    expect(calcProgressPercent(0, 100)).toBe(0);
  });

  test("returns 0 when total is zero", () => {
    expect(calcProgressPercent(0, 0)).toBe(0);
    expect(calcProgressPercent(50, 0)).toBe(0);
  });

  test("handles fractional progress", () => {
    expect(calcProgressPercent(1, 3)).toBeCloseTo(33.33, 1);
    expect(calcProgressPercent(1, 7)).toBeCloseTo(14.29, 1);
  });

  test("handles progress exceeding 100%", () => {
    expect(calcProgressPercent(150, 100)).toBe(150);
  });

  test("handles negative current", () => {
    expect(calcProgressPercent(-10, 100)).toBe(-10);
  });

  test("handles negative total", () => {
    expect(calcProgressPercent(50, -100)).toBe(0);
  });
});
