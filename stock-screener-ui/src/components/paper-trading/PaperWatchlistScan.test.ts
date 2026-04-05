import { describe, expect, test } from "vitest";
import { formatCurrencyIN } from "../../utils/ui-helpers";

describe("formatCurrencyIN", () => {
  test("formats regular numbers with en-IN locale", () => {
    const result = formatCurrencyIN(12345.67);
    expect(result).toContain("12,345");
  });

  test("returns 0 for undefined", () => {
    expect(formatCurrencyIN(undefined)).toBe("0");
  });

  test("returns 0 for null", () => {
    expect(formatCurrencyIN(null)).toBe("0");
  });

  test("returns 0 for NaN", () => {
    expect(formatCurrencyIN(NaN)).toBe("0");
  });

  test("handles zero", () => {
    const result = formatCurrencyIN(0);
    expect(result).toBe("0");
  });

  test("handles negative numbers", () => {
    const result = formatCurrencyIN(-5000);
    expect(result).toContain("5,000");
  });
});
