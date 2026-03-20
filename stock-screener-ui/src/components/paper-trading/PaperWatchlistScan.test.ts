import { describe, expect, test } from "vitest";
import { formatCurrency, formatChange } from "./PaperWatchlistScan";

describe("PaperWatchlistScan formatCurrency", () => {
  test("formats regular numbers with en-IN locale", () => {
    const result = formatCurrency(12345.67);
    expect(result).toContain("12,345");
  });

  test("returns dash for undefined", () => {
    expect(formatCurrency(undefined)).toBe("-");
  });

  test("returns dash for null", () => {
    expect(formatCurrency(null)).toBe("-");
  });

  test("returns dash for NaN", () => {
    expect(formatCurrency(NaN)).toBe("-");
  });

  test("handles zero", () => {
    const result = formatCurrency(0);
    expect(result).toBe("0");
  });

  test("handles negative numbers", () => {
    const result = formatCurrency(-5000);
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
