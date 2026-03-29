import { describe, expect, test } from "vitest";
import { formatCurrencyIN } from "../../utils/ui-helpers";
import { formatChange } from "./PaperWatchlistScan";

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

describe("PaperWatchlistScan formatChange", () => {
  test("formats positive change with plus sign", () => {
    expect(formatChange(3.5)).toBe("+3.50%");
  });

  test("formats negative change with minus sign", () => {
    expect(formatChange(-2.1)).toBe("-2.10%");
  });

  test("formats zero change with plus sign", () => {
    expect(formatChange(0)).toBe("+0.00%");
  });

  test("returns dash for undefined", () => {
    expect(formatChange(undefined)).toBe("-");
  });

  test("returns dash for null", () => {
    expect(formatChange(null)).toBe("-");
  });

  test("returns dash for NaN", () => {
    expect(formatChange(NaN)).toBe("-");
  });

  test("handles decimal precision", () => {
    expect(formatChange(1.234)).toBe("+1.23%");
  });
});
