import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { FAMILY_LABELS } from "./shared";
import { formatChartPrice } from "./chartFormat";

const sourceOf = (file: string): string =>
  readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

describe("price cells use formatChartPrice", () => {
  test("null and undefined render the em dash", () => {
    expect(formatChartPrice(null)).toBe("—");
    expect(formatChartPrice(undefined)).toBe("—");
  });

  test("zero formats as ₹0.00", () => {
    expect(formatChartPrice(0)).toBe("₹0.00");
    expect(formatChartPrice(-0)).toBe("₹0.00");
  });

  test("positive prices render with rupee prefix and 2 decimals", () => {
    expect(formatChartPrice(100)).toBe("₹100.00");
    expect(formatChartPrice(123.456)).toBe("₹123.46");
    expect(formatChartPrice(0.1)).toBe("₹0.10");
  });

  test("negative prices keep the sign", () => {
    expect(formatChartPrice(-42.5)).toBe("₹-42.50");
    expect(formatChartPrice(-1000)).toBe("₹-1000.00");
  });

  test("large numbers render without grouping separators", () => {
    expect(formatChartPrice(1e6)).toBe("₹1000000.00");
    expect(formatChartPrice(1234567.89)).toBe("₹1234567.89");
  });

  test("india is byte-identical to the omitted default", () => {
    expect(formatChartPrice(1234567.5, "india")).toBe(formatChartPrice(1234567.5));
  });

  test("usa prices use $ with en-US grouping and never ₹", () => {
    const price = formatChartPrice(1234567.5, "usa");
    expect(price).toBe("$1,234,567.50");
    expect(price).not.toContain("₹");
    expect(formatChartPrice(352.25, "usa")).toBe("$352.25");
  });
});

describe("currency threading at the source", () => {
  test("price and tooltip formatters delegate to chartFormat, not a hardcoded INR formatter", () => {
    for (const file of [
      "./PatternCard.tsx",
      "./PatternListView.tsx",
      "./PatternPivotList.tsx",
      "./patternChartOption.ts",
    ]) {
      const source = sourceOf(file);
      expect(source, file).toContain('from "./chartFormat"');
      expect(source, file).not.toMatch(/formatCurrency\s*\(/);
    }
  });

  test("the pivot list forwards its market to formatChartPrice", () => {
    expect(sourceOf("./PatternPivotList.tsx")).toContain("formatChartPrice(pivot.price, props.market)");
  });
});

describe("FAMILY_LABELS", () => {
  test("maps each family id to its display label", () => {
    expect(FAMILY_LABELS.reversal).toBe("Reversal");
    expect(FAMILY_LABELS.continuation).toBe("Continuation");
    expect(FAMILY_LABELS.curve_cup).toBe("Curve & Cup");
  });

  test("contains exactly the three known families", () => {
    expect(Object.keys(FAMILY_LABELS).sort()).toEqual([
      "continuation",
      "curve_cup",
      "reversal",
    ]);
  });
});
