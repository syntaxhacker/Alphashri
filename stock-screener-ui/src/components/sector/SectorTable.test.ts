import { describe, expect, test } from "vitest";
import { getMovementBarValue, getStrengthInfo } from "./SectorTable";

describe("getMovementBarValue", () => {
  test("returns 50% for zero change (midpoint)", () => {
    const result = getMovementBarValue(0);
    expect(result.capped).toBe(50);
    expect(result.color).toBe("green");
  });

  test("returns green color for positive change", () => {
    expect(getMovementBarValue(1).color).toBe("green");
    expect(getMovementBarValue(2.5).color).toBe("green");
  });

  test("returns red color for negative change", () => {
    expect(getMovementBarValue(-1).color).toBe("red");
    expect(getMovementBarValue(-2.5).color).toBe("red");
  });

  test("caps at 100% for large positive change", () => {
    expect(getMovementBarValue(5)).toEqual({ capped: 100, color: "green" });
    expect(getMovementBarValue(10)).toEqual({ capped: 100, color: "green" });
  });

  test("caps at 0% for large negative change", () => {
    expect(getMovementBarValue(-5)).toEqual({ capped: 0, color: "red" });
    expect(getMovementBarValue(-10)).toEqual({ capped: 0, color: "red" });
  });

  test("handles -3% change as minimum boundary", () => {
    const result = getMovementBarValue(-3);
    expect(result.capped).toBe(0);
  });

  test("handles +3% change as maximum boundary", () => {
    const result = getMovementBarValue(3);
    expect(result.capped).toBe(100);
  });

  test("handles fractional changes", () => {
    const result = getMovementBarValue(0.5);
    expect(result.capped).toBeCloseTo(58.33, 1);
    expect(result.color).toBe("green");
  });
});

describe("getStrengthInfo", () => {
  test("returns Strong for ADX > 25", () => {
    expect(getStrengthInfo(26)).toEqual({ label: "Strong", color: "green" });
    expect(getStrengthInfo(50)).toEqual({ label: "Strong", color: "green" });
  });

  test("returns Weak for ADX < 15", () => {
    expect(getStrengthInfo(14)).toEqual({ label: "Weak", color: "red" });
    expect(getStrengthInfo(0)).toEqual({ label: "Weak", color: "red" });
  });

  test("returns Neutral for ADX between 15 and 25", () => {
    expect(getStrengthInfo(15)).toEqual({ label: "Neutral", color: "gray" });
    expect(getStrengthInfo(20)).toEqual({ label: "Neutral", color: "gray" });
    expect(getStrengthInfo(25)).toEqual({ label: "Neutral", color: "gray" });
  });

  test("handles boundary values exactly", () => {
    expect(getStrengthInfo(15.01)).toEqual({ label: "Neutral", color: "gray" });
    expect(getStrengthInfo(24.99)).toEqual({ label: "Neutral", color: "gray" });
    expect(getStrengthInfo(25.01)).toEqual({ label: "Strong", color: "green" });
    expect(getStrengthInfo(14.99)).toEqual({ label: "Weak", color: "red" });
  });

  test("handles negative ADX edge case", () => {
    expect(getStrengthInfo(-5)).toEqual({ label: "Weak", color: "red" });
  });
});
