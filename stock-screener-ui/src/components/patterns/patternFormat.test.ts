import { describe, expect, test } from "vitest";
import {
  formatMatrixPct,
  formatMatrixPrice,
  formatOneDecimal,
  formatRangePos,
  formatScore,
  formatSignedPct1,
  hitChangePct,
  hitLastPrice,
} from "./patternFormat";
import type { PatternHitDTO } from "@/types/chartPatterns";

describe("formatScore", () => {
  test("renders one decimal for finite scores", () => {
    expect(formatScore(80)).toBe("80.0");
    expect(formatScore(72.25)).toBe("72.3");
    expect(formatScore(0)).toBe("0.0");
    expect(formatScore(-3.25)).toBe("-3.3");
  });

  test("renders an em dash for missing or non-finite scores", () => {
    expect(formatScore(null)).toBe("—");
    expect(formatScore(undefined)).toBe("—");
    expect(formatScore(Number.NaN)).toBe("—");
    expect(formatScore(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatScore(Number.NEGATIVE_INFINITY)).toBe("—");
  });
});

describe("formatRangePos", () => {
  test("rounds to a whole percentage", () => {
    expect(formatRangePos(66.4)).toBe("66%");
    expect(formatRangePos(66.5)).toBe("67%");
    expect(formatRangePos(0)).toBe("0%");
    expect(formatRangePos(100)).toBe("100%");
  });

  test("renders an em dash for missing or non-finite values", () => {
    expect(formatRangePos(null)).toBe("—");
    expect(formatRangePos(undefined)).toBe("—");
    expect(formatRangePos(Number.NaN)).toBe("—");
    expect(formatRangePos(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatOneDecimal", () => {
  test("drops a trailing .0", () => {
    expect(formatOneDecimal(13)).toBe("13");
    expect(formatOneDecimal(0)).toBe("0");
    expect(formatOneDecimal(-4)).toBe("-4");
  });

  test("keeps one decimal for fractional values", () => {
    expect(formatOneDecimal(13.25)).toBe("13.3");
    expect(formatOneDecimal(13.24)).toBe("13.2");
    expect(formatOneDecimal(0.5)).toBe("0.5");
    expect(formatOneDecimal(-2.25)).toBe("-2.3");
  });

  // A streamed hit can arrive before `to_52w_high` is populated; formatting
  // NaN used to print "52W: -NaN%" on the card.
  test("renders an em dash for missing or non-finite values", () => {
    expect(formatOneDecimal(null)).toBe("—");
    expect(formatOneDecimal(undefined)).toBe("—");
    expect(formatOneDecimal(Number.NaN)).toBe("—");
    expect(formatOneDecimal(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatSignedPct1", () => {
  test("prefixes positives with + and negatives with a true minus sign", () => {
    expect(formatSignedPct1(4.72)).toBe("+4.7%");
    expect(formatSignedPct1(0)).toBe("+0.0%");
    expect(formatSignedPct1(-0.84)).toBe("−0.8%");
    expect(formatSignedPct1(100)).toBe("+100.0%");
  });

  test("renders an em dash for missing or non-finite values", () => {
    expect(formatSignedPct1(null)).toBe("—");
    expect(formatSignedPct1(undefined)).toBe("—");
    expect(formatSignedPct1(Number.NaN)).toBe("—");
    expect(formatSignedPct1(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("hitLastPrice", () => {
  test("prefers the live close over the pattern end price", () => {
    expect(hitLastPrice({ last_close: 101, end_price: 110 })).toBe(101);
  });

  test("falls back to the pattern end price", () => {
    expect(hitLastPrice({ last_close: null, end_price: 110 })).toBe(110);
    expect(hitLastPrice({ last_close: undefined, end_price: 110 })).toBe(110);
  });
});

describe("hitChangePct", () => {
  const hit = (overrides: Partial<PatternHitDTO>) =>
    ({
      day_change_pct: null,
      start_price: 100,
      end_price: 110,
      ...overrides,
    }) as PatternHitDTO;

  test("uses the reported day change when present, including zero", () => {
    expect(hitChangePct(hit({ day_change_pct: 2.5 }))).toBe(2.5);
    expect(hitChangePct(hit({ day_change_pct: 0 }))).toBe(0);
    expect(hitChangePct(hit({ day_change_pct: -1.5 }))).toBe(-1.5);
  });

  test("falls back to the pattern-window move", () => {
    expect(hitChangePct(hit({ day_change_pct: null }))).toBeCloseTo(10);
    expect(hitChangePct(hit({ day_change_pct: undefined, end_price: 95 }))).toBeCloseTo(-5);
  });

  test("returns 0 when the start price is zero to avoid dividing by zero", () => {
    expect(hitChangePct(hit({ start_price: 0, end_price: 110, day_change_pct: null }))).toBe(0);
  });
});

describe("formatMatrixPrice", () => {
  test("renders rupees with two decimals and thousands separators", () => {
    expect(formatMatrixPrice(1234.5)).toBe("₹1,234.50");
    expect(formatMatrixPrice(1234567.891)).toBe("₹1,234,567.89");
    expect(formatMatrixPrice(0)).toBe("₹0.00");
    expect(formatMatrixPrice(-12.3)).toBe("₹-12.30");
    expect(formatMatrixPrice(99)).toBe("₹99.00");
  });

  test("renders an em dash when the value is missing or not finite", () => {
    expect(formatMatrixPrice(null)).toBe("—");
    expect(formatMatrixPrice(undefined)).toBe("—");
    expect(formatMatrixPrice(Number.NaN)).toBe("—");
    expect(formatMatrixPrice(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatMatrixPct", () => {
  test("renders a signed two-decimal percentage", () => {
    expect(formatMatrixPct(2.5)).toBe("+2.50%");
    expect(formatMatrixPct(-1.234)).toBe("-1.23%");
    expect(formatMatrixPct(0)).toBe("+0.00%");
    expect(formatMatrixPct(12)).toBe("+12.00%");
  });

  test("renders an em dash when the value is missing or not finite", () => {
    expect(formatMatrixPct(null)).toBe("—");
    expect(formatMatrixPct(undefined)).toBe("—");
    expect(formatMatrixPct(Number.NaN)).toBe("—");
    expect(formatMatrixPct(Number.NEGATIVE_INFINITY)).toBe("—");
  });
});
