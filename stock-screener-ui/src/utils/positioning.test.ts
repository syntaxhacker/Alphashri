// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import {
  EM_DASH,
  formatCr,
  formatPct,
  formatShares,
  verdictMeta,
} from "./positioning";

describe("formatCr", () => {
  test("formats negative crore value with Indian grouping", () => {
    expect(formatCr(-87494.0)).toBe("-87,494 Cr");
  });

  test("formats positive value", () => {
    expect(formatCr(1200000)).toBe("12,00,000 Cr");
  });

  test("rounds fractional values", () => {
    expect(formatCr(-32000.5)).toBe("-32,000 Cr");
  });

  test("formats zero without sign", () => {
    expect(formatCr(0)).toBe("0 Cr");
  });

  test("returns em dash for null, undefined, and NaN", () => {
    expect(formatCr(null)).toBe(EM_DASH);
    expect(formatCr(undefined)).toBe(EM_DASH);
    expect(formatCr(NaN)).toBe(EM_DASH);
  });
});

describe("formatShares", () => {
  test("compacts lakhs", () => {
    expect(formatShares(123456)).toBe("1.2L");
  });

  test("compacts thousands", () => {
    expect(formatShares(50000)).toBe("50.0K");
  });

  test("compacts crores", () => {
    expect(formatShares(25000000)).toBe("2.5Cr");
  });

  test("keeps small counts raw", () => {
    expect(formatShares(999)).toBe("999");
  });

  test("returns em dash for null, undefined, and NaN", () => {
    expect(formatShares(null)).toBe(EM_DASH);
    expect(formatShares(undefined)).toBe(EM_DASH);
    expect(formatShares(NaN)).toBe(EM_DASH);
  });
});

describe("formatPct", () => {
  test("adds plus sign for positive values", () => {
    expect(formatPct(97.3)).toBe("+97.3%");
  });

  test("keeps minus sign for negative values", () => {
    expect(formatPct(-92.4)).toBe("-92.4%");
  });

  test("returns em dash for null and undefined", () => {
    expect(formatPct(null)).toBe(EM_DASH);
    expect(formatPct(undefined)).toBe(EM_DASH);
  });
});

describe("verdictMeta", () => {
  test("bearish uses down icon", () => {
    const meta = verdictMeta("bearish");
    expect(meta.icon).toBe("▼");
    expect(meta.label).toBe("Bearish");
    expect(meta.colorToken).toBeTruthy();
    expect(meta.tintToken).toBeTruthy();
  });

  test("bullish uses up icon", () => {
    const meta = verdictMeta("bullish");
    expect(meta.icon).toBe("▲");
    expect(meta.label).toBe("Bullish");
  });

  test("neutral uses square icon", () => {
    const meta = verdictMeta("neutral");
    expect(meta.icon).toBe("■");
    expect(meta.label).toBe("Neutral");
  });
});
