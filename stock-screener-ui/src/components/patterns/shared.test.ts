import { describe, expect, test } from "vitest";
import { FAMILY_LABELS, formatPrice } from "./shared";

describe("formatPrice", () => {
  test("null and undefined render the em dash", () => {
    expect(formatPrice(null)).toBe("—");
    expect(formatPrice(undefined)).toBe("—");
  });

  test("zero formats as ₹0.00", () => {
    expect(formatPrice(0)).toBe("₹0.00");
    expect(formatPrice(-0)).toBe("₹0.00");
  });

  test("positive prices render with rupee prefix and 2 decimals", () => {
    expect(formatPrice(100)).toBe("₹100.00");
    expect(formatPrice(123.456)).toBe("₹123.46");
    expect(formatPrice(0.1)).toBe("₹0.10");
  });

  test("negative prices keep the sign", () => {
    expect(formatPrice(-42.5)).toBe("₹-42.50");
    expect(formatPrice(-1000)).toBe("₹-1000.00");
  });

  test("large numbers render without grouping separators", () => {
    expect(formatPrice(1e6)).toBe("₹1000000.00");
    expect(formatPrice(1234567.89)).toBe("₹1234567.89");
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
