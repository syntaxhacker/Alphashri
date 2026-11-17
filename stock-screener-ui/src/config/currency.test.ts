import { describe, expect, test } from "vitest";
import { CURRENCIES, currencyFor } from "./currency";

describe("currency descriptors", () => {
  test("INR carries the rupee symbol, en-IN grouping and crore mcap unit", () => {
    const inr = CURRENCIES.INR;
    expect(inr.code).toBe("INR");
    expect(inr.symbol).toBe("₹");
    expect(inr.grouping).toBe("en-IN");
    expect(inr.mcapScale).toBe(1e7);
    expect(inr.mcapSuffix).toBe("Cr");
  });

  test("USD carries the dollar symbol, en-US grouping and billion mcap unit", () => {
    const usd = CURRENCIES.USD;
    expect(usd.code).toBe("USD");
    expect(usd.symbol).toBe("$");
    expect(usd.grouping).toBe("en-US");
    expect(usd.mcapScale).toBe(1e9);
    expect(usd.mcapSuffix).toBe("B");
  });

  test("compact ladders are descriptor data, not fmt-local magic numbers", () => {
    expect(CURRENCIES.INR.compactUnits).toEqual([
      { min: 1e7, suffix: "Cr" },
      { min: 1e5, suffix: "L" },
      { min: 1e3, suffix: "K" },
    ]);
    expect(CURRENCIES.USD.compactUnits).toEqual([
      { min: 1e9, suffix: "B" },
      { min: 1e6, suffix: "M" },
      { min: 1e3, suffix: "K" },
    ]);
  });

  test("INR compact uses the lakh/crore ladder without a symbol", () => {
    const compact = CURRENCIES.INR.compact;
    expect(compact(1e7)).toBe("1.0Cr");
    expect(compact(1.5e5)).toBe("1.5L");
    expect(compact(1e3)).toBe("1.0K");
    expect(compact(999)).toBe("999");
    expect(compact(0)).toBe("0");
    expect(compact(-1e7)).toBe("-1.0Cr");
    expect(compact(Number.NaN)).toBe("0");
  });

  test("USD compact uses the million/billion ladder without a symbol", () => {
    const compact = CURRENCIES.USD.compact;
    expect(compact(1e9)).toBe("1.0B");
    expect(compact(1.2e6)).toBe("1.2M");
    expect(compact(1e3)).toBe("1.0K");
    expect(compact(999)).toBe("999");
    expect(compact(0)).toBe("0");
    expect(compact(-1e9)).toBe("-1.0B");
    expect(compact(Number.NaN)).toBe("0");
  });

  test("INR market-cap cell keeps lowercase k, no Cr rung and a rounded tail", () => {
    const mcap = CURRENCIES.INR.formatMcapCompact;
    expect(mcap(1e7)).toBe("100.0L"); // stops at lakh — compact() gives 1.0Cr
    expect(mcap(1.812819e6)).toBe("18.1L");
    expect(mcap(1500)).toBe("1.5k"); // compact() gives 1.5K
    expect(mcap(999)).toBe("999");
    expect(mcap(0)).toBe("0");
    expect(mcap(-1500)).toBe("-1500"); // signed scaling: negatives never reach a rung
    expect(mcap(Number.NaN)).toBe("NaN");
  });

  test("USD market-cap cell keeps symbol, grouping and no forced decimal", () => {
    const mcap = CURRENCIES.USD.formatMcapCompact;
    expect(mcap(12)).toBe("$12B"); // compact() gives "12"
    expect(mcap(12.3)).toBe("$12.3B");
    expect(mcap(12345.67)).toBe("$12,345.7B");
    expect(mcap(0)).toBe("$0B");
    expect(mcap(-12.3)).toBe("$-12.3B");
  });

  test("compact and market-cap cell differ intentionally at shared thresholds", () => {
    expect(CURRENCIES.INR.compact(1e7)).toBe("1.0Cr");
    expect(CURRENCIES.INR.formatMcapCompact(1e7)).toBe("100.0L");
    expect(CURRENCIES.INR.compact(1e3)).toBe("1.0K");
    expect(CURRENCIES.INR.formatMcapCompact(1e3)).toBe("1.0k");
    expect(CURRENCIES.USD.compact(1e9)).toBe("1.0B");
    expect(CURRENCIES.USD.formatMcapCompact(12)).toBe("$12B");
  });

  test("INR formatFixed keeps the legacy ungrouped output byte-identical", () => {
    expect(CURRENCIES.INR.formatFixed(1234.567, 2)).toBe("1234.57");
    expect(CURRENCIES.INR.formatFixed(1234567.891, 1)).toBe("1234567.9");
  });

  test("USD formatFixed groups thousands and preserves the requested precision", () => {
    expect(CURRENCIES.USD.formatFixed(1234.5, 2)).toBe("1,234.50");
    expect(CURRENCIES.USD.formatFixed(1234567.891, 1)).toBe("1,234,567.9");
  });

  test("formatGrouped applies each currency's locale grouping (INR lakh/crore)", () => {
    expect(CURRENCIES.INR.formatGrouped(1234567.891, 2)).toBe("12,34,567.89");
    expect(CURRENCIES.INR.formatGrouped(0, 2)).toBe("0.00");
    expect(CURRENCIES.USD.formatGrouped(1234.5, 2)).toBe("1,234.50");
    expect(CURRENCIES.USD.formatGrouped(0, 2)).toBe("0.00");
  });

  test("currencyFor resolves USD spellings case-insensitively", () => {
    expect(currencyFor("USD")).toBe(CURRENCIES.USD);
    expect(currencyFor("usd")).toBe(CURRENCIES.USD);
    expect(currencyFor(" usd ")).toBe(CURRENCIES.USD);
    expect(currencyFor("$")).toBe(CURRENCIES.USD);
  });

  test("currencyFor defaults unknown and empty values to INR", () => {
    expect(currencyFor("INR")).toBe(CURRENCIES.INR);
    expect(currencyFor("inr")).toBe(CURRENCIES.INR);
    expect(currencyFor("EUR")).toBe(CURRENCIES.INR);
    expect(currencyFor("")).toBe(CURRENCIES.INR);
    expect(currencyFor(null)).toBe(CURRENCIES.INR);
    expect(currencyFor(undefined)).toBe(CURRENCIES.INR);
  });
});
