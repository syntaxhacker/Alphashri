import { describe, expect, test, vi } from "vitest";
import {
  getAvailableUnderlyings,
  getExpiryDates,
  formatNumber,
  getMoneyness,
  isWeekly,
  calculateTotalOiChange,
  parseOptionSymbol,
  formatExpiryDisplay,
} from "./options";

describe("getAvailableUnderlyings", () => {
  test("returns an array of underlying instrument names", () => {
    const result = getAvailableUnderlyings();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  test("includes expected instruments", () => {
    const result = getAvailableUnderlyings();
    expect(result).toContain("NIFTY");
    expect(result).toContain("BANKNIFTY");
    expect(result).toContain("FINNIFTY");
    expect(result).toContain("MIDCPNIFTY");
  });

  test("always returns the same list (no side effects)", () => {
    const first = getAvailableUnderlyings();
    const second = getAvailableUnderlyings();
    expect(first).toEqual(second);
  });
});

describe("getExpiryDates", () => {
  test("returns an array of date strings", () => {
    const result = getExpiryDates("NIFTY");
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    for (const dateStr of result) {
      expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test("returns sorted dates", () => {
    const result = getExpiryDates("NIFTY");
    const sorted = [...result].sort();
    expect(result).toEqual(sorted);
  });

  test("has no duplicate dates", () => {
    const result = getExpiryDates("BANKNIFTY");
    const unique = new Set(result);
    expect(unique.size).toBe(result.length);
  });

  test("returns reasonable number of expiries (weekly + monthly)", () => {
    const result = getExpiryDates("NIFTY");
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.length).toBeLessThanOrEqual(7);
  });

  // Same absolute instant must give the same calendar dates in every zone: the
  // serialisation used to go through toISOString() (UTC) and lose a day in IST.
  const expiryCases: Array<[string, string[]]> = [
    ["2026-11-16T12:00:00Z", ["2026-11-19", "2026-11-26", "2026-12-31", "2027-01-28"]],
    ["2026-12-31T12:00:00Z", ["2026-12-31", "2027-01-28", "2027-02-25"]],
    ["2026-03-01T12:00:00Z", ["2026-03-05", "2026-03-26", "2026-04-30", "2026-05-28"]],
  ];

  describe.each(["America/New_York", "Asia/Kolkata", "UTC"])("in %s", (tz) => {
    test.each(expiryCases)("at %s yields the same local expiry days", (instant, expected) => {
      vi.stubEnv("TZ", tz);
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date(instant));
        const result = getExpiryDates("NIFTY");

        expect(result).toEqual(expected);
        // Expiries are Thursdays; a UTC slip shows up as a Wednesday.
        for (const dateStr of result) {
          const [y, m, d] = dateStr.split("-").map(Number);
          expect(new Date(y, m - 1, d).getDay()).toBe(4);
        }
      } finally {
        vi.useRealTimers();
        vi.unstubAllEnvs();
      }
    });
  });

  test("all zones agree on the same instants", () => {
    const instants = expiryCases.map(([instant]) => instant);
    const byZone: string[][] = [];
    for (const tz of ["America/New_York", "Asia/Kolkata", "UTC"]) {
      vi.stubEnv("TZ", tz);
      vi.useFakeTimers();
      byZone.push(
        instants.flatMap((instant) => {
          vi.setSystemTime(new Date(instant));
          return getExpiryDates("NIFTY");
        }),
      );
      vi.useRealTimers();
    }
    vi.unstubAllEnvs();
    expect(byZone[0]).toEqual(byZone[1]);
    expect(byZone[1]).toEqual(byZone[2]);
  });
});

describe("formatNumber", () => {
  test("returns string representation for numbers below 1000", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(5)).toBe("5");
    expect(formatNumber(999)).toBe("999");
  });

  test("formats numbers >= 1000 with k suffix", () => {
    expect(formatNumber(1000)).toBe("1k");
    expect(formatNumber(1500)).toBe("1.5k");
    expect(formatNumber(1050)).toBe("1.1k");
    expect(formatNumber(10000)).toBe("10k");
    expect(formatNumber(999999)).toBe("1000k");
  });

  test("formats numbers >= 1000000 with M suffix", () => {
    expect(formatNumber(1000000)).toBe("1M");
    expect(formatNumber(1500000)).toBe("1.5M");
    expect(formatNumber(10000000)).toBe("10M");
  });

  test("handles negative numbers", () => {
    expect(formatNumber(-500)).toBe("-500");
    expect(formatNumber(-1500)).toBe("-1500");
    expect(formatNumber(-1000000)).toBe("-1000000");
  });

  test("removes trailing .0 from formatted numbers", () => {
    expect(formatNumber(2000)).toBe("2k");
    expect(formatNumber(2000000)).toBe("2M");
    expect(formatNumber(3000)).toBe("3k");
  });
});

describe("getMoneyness", () => {
  test("returns ATM when strike equals spot", () => {
    expect(getMoneyness(100, 100, "CE")).toBe("ATM");
    expect(getMoneyness(100, 100, "PE")).toBe("ATM");
  });

  test("returns ATM when strike is within 0.1% of spot", () => {
    expect(getMoneyness(100.05, 100, "CE")).toBe("ATM");
    expect(getMoneyness(99.95, 100, "CE")).toBe("ATM");
    expect(getMoneyness(100.05, 100, "PE")).toBe("ATM");
    expect(getMoneyness(99.95, 100, "PE")).toBe("ATM");
  });

  test("returns ITM and OTM for CE options", () => {
    expect(getMoneyness(90, 100, "CE")).toBe("ITM");
    expect(getMoneyness(80, 100, "CE")).toBe("ITM");
    expect(getMoneyness(110, 100, "CE")).toBe("OTM");
    expect(getMoneyness(120, 100, "CE")).toBe("OTM");
  });

  test("returns ITM and OTM for PE options", () => {
    expect(getMoneyness(110, 100, "PE")).toBe("ITM");
    expect(getMoneyness(120, 100, "PE")).toBe("ITM");
    expect(getMoneyness(90, 100, "PE")).toBe("OTM");
    expect(getMoneyness(80, 100, "PE")).toBe("OTM");
  });

  test("handles boundary at 0.1% threshold for CE", () => {
    const spot = 10000;
    const justInside = spot * 0.001;
    expect(getMoneyness(spot + justInside, spot, "CE")).toBe("ATM");
    expect(getMoneyness(spot - justInside, spot, "CE")).toBe("ATM");
    expect(getMoneyness(spot + justInside + 0.01, spot, "CE")).toBe("OTM");
    expect(getMoneyness(spot - justInside - 0.01, spot, "CE")).toBe("ITM");
  });

  test("handles boundary at 0.1% threshold for PE", () => {
    const spot = 10000;
    const justInside = spot * 0.001;
    expect(getMoneyness(spot + justInside, spot, "PE")).toBe("ATM");
    expect(getMoneyness(spot - justInside, spot, "PE")).toBe("ATM");
    expect(getMoneyness(spot + justInside + 0.01, spot, "PE")).toBe("ITM");
    expect(getMoneyness(spot - justInside - 0.01, spot, "PE")).toBe("OTM");
  });
});

describe("isWeekly", () => {
  test("returns true when weekly flag is true", () => {
    expect(isWeekly({ expiry: "2025-01-16", weekly: true })).toBe(true);
  });

  test("returns false when weekly flag is false", () => {
    expect(isWeekly({ expiry: "2025-01-30", weekly: false })).toBe(false);
  });

  test("expiry value does not affect the result", () => {
    expect(isWeekly({ expiry: "", weekly: true })).toBe(true);
    expect(isWeekly({ expiry: "any-date", weekly: false })).toBe(false);
  });
});

describe("calculateTotalOiChange", () => {
  test("sums CE and PE OI changes", () => {
    expect(calculateTotalOiChange(100, 200)).toBe(300);
    expect(calculateTotalOiChange(50, 50)).toBe(100);
  });

  test("handles zeros", () => {
    expect(calculateTotalOiChange(0, 0)).toBe(0);
    expect(calculateTotalOiChange(100, 0)).toBe(100);
    expect(calculateTotalOiChange(0, 200)).toBe(200);
  });

  test("handles negative values", () => {
    expect(calculateTotalOiChange(-50, -30)).toBe(-80);
    expect(calculateTotalOiChange(100, -50)).toBe(50);
    expect(calculateTotalOiChange(-100, 50)).toBe(-50);
  });
});

describe("parseOptionSymbol", () => {
  test("parses a valid CE option symbol", () => {
    const result = parseOptionSymbol("NIFTY15JAN2524000CE");
    expect(result).not.toBeNull();
    expect(result!.underlying).toBe("NIFTY");
    expect(result!.expiry).toBe("15JAN25");
    expect(result!.strike).toBe(24000);
    expect(result!.type).toBe("CE");
  });

  test("parses a valid PE option symbol", () => {
    const result = parseOptionSymbol("BANKNIFTY20FEB2650000PE");
    expect(result).not.toBeNull();
    expect(result!.underlying).toBe("BANKNIFTY");
    expect(result!.expiry).toBe("20FEB26");
    expect(result!.strike).toBe(50000);
    expect(result!.type).toBe("PE");
  });

  test("returns null for invalid symbols", () => {
    expect(parseOptionSymbol("")).toBeNull();
    expect(parseOptionSymbol("INVALID")).toBeNull();
    expect(parseOptionSymbol("NIFTY")).toBeNull();
    expect(parseOptionSymbol("nifty15Jan202524000CE")).toBeNull();
  });

  test("returns null for symbol without type suffix", () => {
    expect(parseOptionSymbol("NIFTY15Jan202524000")).toBeNull();
  });

  test("returns null for symbol with invalid type", () => {
    expect(parseOptionSymbol("NIFTY15Jan202524000XX")).toBeNull();
  });

  test("handles multi-word underlyings", () => {
    const result = parseOptionSymbol("FINNIFTY10MAR2623000PE");
    expect(result).not.toBeNull();
    expect(result!.underlying).toBe("FINNIFTY");
    expect(result!.type).toBe("PE");
    expect(result!.strike).toBe(23000);
  });
});

describe("formatExpiryDisplay", () => {
  test("formats a date string to readable format", () => {
    const result = formatExpiryDisplay("2025-01-15");
    expect(result).toContain("Jan");
    expect(result).toContain("15");
    expect(result).toContain("2025");
  });

  test("formats various months correctly", () => {
    expect(formatExpiryDisplay("2025-03-20")).toContain("Mar");
    expect(formatExpiryDisplay("2025-12-25")).toContain("Dec");
    expect(formatExpiryDisplay("2025-07-04")).toContain("Jul");
  });

  test("handles start of year", () => {
    const result = formatExpiryDisplay("2025-01-01");
    expect(result).toContain("Jan");
    expect(result).toContain("2025");
  });

  test("handles end of year", () => {
    const result = formatExpiryDisplay("2025-12-31");
    expect(result).toContain("Dec");
    expect(result).toContain("2025");
  });
});
