import { describe, expect, test } from "vitest";
import { formatCurrency } from "./PaperPortfolioCard";

describe("PaperPortfolioCard formatCurrency", () => {
  test("formats regular numbers with en-IN locale", () => {
    const result = formatCurrency(12345.67);
    expect(result).toContain("12,345");
  });

  test("formats zero", () => {
    expect(formatCurrency(0)).toBe("0");
  });

  test("returns 0 for undefined", () => {
    expect(formatCurrency(undefined)).toBe("0");
  });

  test("returns 0 for null", () => {
    expect(formatCurrency(null)).toBe("0");
  });

  test("returns 0 for NaN", () => {
    expect(formatCurrency(NaN)).toBe("0");
  });

  test("handles negative numbers", () => {
    const result = formatCurrency(-5000);
    expect(result).toContain("5,000");
  });

  test("handles large numbers", () => {
    const result = formatCurrency(1000000.99);
    expect(result).toContain("10,00,000");
  });
});
