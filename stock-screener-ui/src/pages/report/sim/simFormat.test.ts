import { describe, expect, test } from "vitest";
import {
  equityAt,
  fmtInr,
  fmtPct,
  fmtPoints,
  fmtSignedInr,
  fmtTime,
  sliceEquityAt,
  sumByTime,
  toneFor,
} from "./simFormat";

const EQUITY = [
  { t: "2026-11-09T09:15:00+05:30", pnl: 0 },
  { t: "2026-11-09T09:16:00+05:30", pnl: 10 },
  { t: "2026-11-09T09:17:00+05:30", pnl: 5 },
];

describe("fmtInr", () => {
  test("groups in the Indian locale and rounds", () => {
    expect(fmtInr(1234567)).toBe("₹12,34,567");
    expect(fmtInr(-123456.7)).toBe("-₹1,23,457");
    expect(fmtInr(0)).toBe("₹0");
  });

  test("supports decimals and an explicit plus", () => {
    expect(fmtInr(1234.567, { decimals: 2 })).toBe("₹1,234.57");
    expect(fmtInr(1000, { signed: true })).toBe("+₹1,000");
  });

  test("NaN and missing values render as a dash", () => {
    expect(fmtInr(NaN)).toBe("—");
    expect(fmtInr(undefined)).toBe("—");
    expect(fmtInr(Infinity)).toBe("—");
  });
});

describe("fmtSignedInr", () => {
  test("signs non-zero values and leaves zero unsigned", () => {
    expect(fmtSignedInr(1000)).toBe("+₹1,000");
    expect(fmtSignedInr(-500)).toBe("-₹500");
    expect(fmtSignedInr(0)).toBe("₹0");
    expect(fmtSignedInr(NaN)).toBe("—");
  });
});

describe("fmtPoints", () => {
  test("formats premium points with a sign", () => {
    expect(fmtPoints(12.5)).toBe("+12.50 pts");
    expect(fmtPoints(-3.25)).toBe("-3.25 pts");
    expect(fmtPoints(0)).toBe("0.00 pts");
    expect(fmtPoints(NaN)).toBe("—");
  });
});

describe("fmtPct", () => {
  test("formats percentages with a sign for non-zero values", () => {
    expect(fmtPct(12.34)).toBe("+12.34%");
    expect(fmtPct(-5)).toBe("-5.00%");
    expect(fmtPct(0)).toBe("0.00%");
    expect(fmtPct(NaN)).toBe("—");
  });
});

describe("toneFor", () => {
  test("maps sign to a palette token name", () => {
    expect(toneFor(1)).toBe("positive");
    expect(toneFor(-1)).toBe("negative");
    expect(toneFor(0)).toBe("muted");
    expect(toneFor(NaN)).toBe("muted");
  });
});

describe("fmtTime", () => {
  test("extracts HH:MM from an ISO timestamp", () => {
    expect(fmtTime("2026-11-09T09:35:00+05:30")).toBe("09:35");
    expect(fmtTime("09:35")).toBe("09:35");
    expect(fmtTime("9:35")).toBe("09:35");
  });

  test("is safe on missing or garbage input", () => {
    expect(fmtTime(null)).toBe("-");
    expect(fmtTime("")).toBe("-");
    expect(fmtTime("not-a-time")).toBe("-");
  });
});

describe("sliceEquityAt", () => {
  test("cuts at an ISO playhead", () => {
    expect(sliceEquityAt(EQUITY, "2026-11-09T09:16:30+05:30")).toEqual(
      EQUITY.slice(0, 2),
    );
  });

  test("cuts at a bare HH:MM playhead", () => {
    expect(sliceEquityAt(EQUITY, "09:16")).toEqual(EQUITY.slice(0, 2));
    expect(sliceEquityAt(EQUITY, "09:00")).toEqual([]);
  });

  test("returns the whole array when there is no playhead", () => {
    expect(sliceEquityAt(EQUITY, null)).toBe(EQUITY);
    expect(sliceEquityAt(EQUITY, undefined)).toBe(EQUITY);
  });
});

describe("equityAt", () => {
  test("returns the last point at or before the playhead", () => {
    expect(equityAt(EQUITY, "09:16:30")).toEqual(EQUITY[1]);
    expect(equityAt(EQUITY, "2026-11-09T09:17:00+05:30")).toEqual(EQUITY[2]);
    expect(equityAt(EQUITY, "09:00")).toBeNull();
  });
});

describe("sumByTime", () => {
  test("unions timestamps and sums P&L per timestamp", () => {
    const a = [
      { t: "2026-11-09T09:15:00+05:30", pnl: 10 },
      { t: "2026-11-09T09:17:00+05:30", pnl: 5 },
    ];
    const b = [
      { t: "2026-11-09T09:16:00+05:30", pnl: -2 },
      { t: "2026-11-09T09:17:00+05:30", pnl: 1 },
    ];
    expect(sumByTime([a, b])).toEqual([
      { t: "2026-11-09T09:15:00+05:30", pnl: 10 },
      { t: "2026-11-09T09:16:00+05:30", pnl: -2 },
      { t: "2026-11-09T09:17:00+05:30", pnl: 6 },
    ]);
  });

  test("handles no series", () => {
    expect(sumByTime([])).toEqual([]);
    expect(sumByTime([[]])).toEqual([]);
  });
});
