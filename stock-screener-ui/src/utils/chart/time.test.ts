import { describe, expect, expectTypeOf, it } from "vitest";
import {
  toEpochSeconds,
  toEpochMs,
  formatChartTimeLabel,
  sessionDateKey,
  TZ_US,
  MARKET_TIME_ZONE,
} from "./time";
import type { ChartMarket } from "./time";

describe("ChartMarket identity", () => {
  it("has exactly one time zone per chart market", () => {
    expectTypeOf<keyof typeof MARKET_TIME_ZONE>().toEqualTypeOf<ChartMarket>();
    expect(Object.keys(MARKET_TIME_ZONE).sort()).toEqual(["india", "usa"]);
  });
});

describe("toEpochSeconds", () => {
  it("parses space-separated naive datetime as IST", () => {
    // 2026-10-12 09:15:00 IST = 2026-10-12 03:45:00 UTC
    const result = toEpochSeconds("2026-10-12 09:15:00");
    expect(result).toBe(Date.UTC(2026, 9, 12, 3, 45, 0) / 1000);
  });

  it("parses T-separated naive datetime as IST", () => {
    const result = toEpochSeconds("2026-10-12T09:15:00");
    expect(result).toBe(Date.UTC(2026, 9, 12, 3, 45, 0) / 1000);
  });

  it("parses datetime with explicit +05:30 offset", () => {
    const result = toEpochSeconds("2026-10-12T09:15:00+05:30");
    expect(result).toBe(Date.UTC(2026, 9, 12, 3, 45, 0) / 1000);
  });

  it("parses datetime with Z offset as UTC", () => {
    const result = toEpochSeconds("2026-10-12T03:45:00Z");
    expect(result).toBe(Date.UTC(2026, 9, 12, 3, 45, 0) / 1000);
  });

  it("parses date-only as midnight IST", () => {
    const result = toEpochSeconds("2026-10-12");
    // Midnight IST = 18:30 UTC previous day
    expect(result).toBe(Date.UTC(2026, 9, 11, 18, 30, 0) / 1000);
  });

  it("returns NaN for empty string", () => {
    expect(toEpochSeconds("")).toBeNaN();
    expect(toEpochSeconds("   ")).toBeNaN();
  });

  it("returns NaN for invalid strings", () => {
    expect(toEpochSeconds("not-a-date")).toBeNaN();
  });

  it("handles milliseconds in input", () => {
    const result = toEpochSeconds("2026-10-12T09:15:00.123");
    expect(result).toBe(Date.UTC(2026, 9, 12, 3, 45, 0, 123) / 1000);
  });

  it("handles HH:MM without seconds", () => {
    const result = toEpochSeconds("2026-10-12 09:15");
    expect(result).toBe(Date.UTC(2026, 9, 12, 3, 45, 0) / 1000);
  });

  it("handles T-separated HH:MM without seconds", () => {
    const result = toEpochSeconds("2026-10-12T09:15");
    expect(result).toBe(Date.UTC(2026, 9, 12, 3, 45, 0) / 1000);
  });
});

describe("toEpochMs", () => {
  const sec = 1791776700; // 2026-10-12 09:15:00 IST in epoch seconds

  it("expands numeric epoch seconds to milliseconds", () => {
    expect(toEpochMs(sec)).toBe(sec * 1000);
  });

  it("passes through numeric epoch milliseconds", () => {
    expect(toEpochMs(sec * 1000)).toBe(sec * 1000);
  });

  it("parses ISO string without offset as IST", () => {
    // 2026-10-12T09:15:00 (no offset) -> IST
    expect(toEpochMs("2026-10-12T09:15:00")).toBe(Date.UTC(2026, 9, 12, 3, 45, 0));
  });

  it("parses ISO string with +05:30 offset", () => {
    expect(toEpochMs("2026-10-12T09:15:00+05:30")).toBe(Date.UTC(2026, 9, 12, 3, 45, 0));
  });

  it("parses ISO string with Z offset as UTC", () => {
    expect(toEpochMs("2026-10-12T03:45:00Z")).toBe(Date.UTC(2026, 9, 12, 3, 45, 0));
  });

  it("parses space-separated datetime as IST", () => {
    expect(toEpochMs("2026-10-12 09:15:00")).toBe(Date.UTC(2026, 9, 12, 3, 45, 0));
  });

  it("returns NaN for empty string", () => {
    expect(toEpochMs("")).toBeNaN();
    expect(toEpochMs("   ")).toBeNaN();
  });

  it("returns NaN for NaT", () => {
    expect(toEpochMs("NaT")).toBeNaN();
    expect(toEpochMs("nat")).toBeNaN();
  });

  it("returns NaN for invalid strings", () => {
    expect(toEpochMs("not-a-date")).toBeNaN();
  });

  it("returns NaN for NaN input", () => {
    expect(toEpochMs(NaN)).toBeNaN();
  });

  it("handles numeric input at boundary (1e12)", () => {
    // 1e12 ms = 1e9 seconds ≈ 2001-09-09
    expect(toEpochMs(1e12)).toBe(1e12); // treated as ms
    expect(toEpochMs(1e12 - 1)).toBe((1e12 - 1) * 1000); // treated as seconds
  });
});

describe("formatChartTimeLabel", () => {
  it("formats epoch milliseconds to HH:MM", () => {
    const ms = Date.UTC(2026, 9, 12, 3, 45, 0); // 09:15 IST
    expect(formatChartTimeLabel(ms)).toBe("09:15");
  });

  it("formats epoch seconds to HH:MM (auto-detects and scales)", () => {
    const sec = Date.UTC(2026, 9, 12, 3, 45, 0) / 1000;
    expect(formatChartTimeLabel(sec)).toBe("09:15");
  });

  it("extracts HH:MM from ISO string with T separator", () => {
    expect(formatChartTimeLabel("2025-01-15T09:30:00")).toBe("09:30");
    expect(formatChartTimeLabel("2025-01-15T14:45:30")).toBe("14:45");
    expect(formatChartTimeLabel("2025-01-15T23:59:59+05:30")).toBe("23:59");
  });

  it("extracts HH:MM from space-separated datetime", () => {
    expect(formatChartTimeLabel("2025-01-15 09:30:00")).toBe("09:30");
    expect(formatChartTimeLabel("2025-01-15 14:45:30")).toBe("14:45");
  });

  it("handles time_str format directly (HH:MM)", () => {
    expect(formatChartTimeLabel("09:30")).toBe("09:30");
    expect(formatChartTimeLabel("23:59")).toBe("23:59");
  });

  it("handles HH:MM:SS format", () => {
    expect(formatChartTimeLabel("09:30:45")).toBe("09:30");
    expect(formatChartTimeLabel("23:59:59")).toBe("23:59");
  });

  it("returns original value if no recognizable time format", () => {
    expect(formatChartTimeLabel("some-random-string")).toBe("some-random-string");
    expect(formatChartTimeLabel("")).toBe("");
  });

  it("handles undefined-like input", () => {
    expect(formatChartTimeLabel("")).toBe("");
  });

  it("handles date-only format (no time part)", () => {
    expect(formatChartTimeLabel("2025-01-15")).toBe("2025-01-15");
  });

  it("handles strings shorter than 5 chars", () => {
    expect(formatChartTimeLabel("09:3")).toBe("09:3");
    expect(formatChartTimeLabel("9")).toBe("9");
  });

  it("returns empty string for NaN number", () => {
    expect(formatChartTimeLabel(NaN)).toBe("");
  });

  it("returns empty string for non-finite number", () => {
    expect(formatChartTimeLabel(Infinity)).toBe("");
    expect(formatChartTimeLabel(-Infinity)).toBe("");
  });

  describe("kind parameter", () => {
    it("returns HH:MM for kind=HM (default)", () => {
      const ms = Date.UTC(2026, 9, 12, 3, 45, 0);
      expect(formatChartTimeLabel(ms, "HM")).toBe("09:15");
    });

    it("returns full datetime for kind=FULL", () => {
      const ms = Date.UTC(2026, 9, 12, 3, 45, 0);
      expect(formatChartTimeLabel(ms, "FULL")).toBe("2026-10-12 09:15");
    });
  });
});

describe("timezone-aware parsing", () => {
  it("honours -05:00 / +00:00 / Z offsets regardless of the requested zone", () => {
    const et = Date.UTC(2026, 10, 16, 19, 49, 0) / 1000; // 14:49 EST
    expect(toEpochSeconds("2026-11-16T14:49:00-05:00")).toBe(et);
    expect(toEpochSeconds("2026-11-16T14:49:00-05:00", TZ_US)).toBe(et);
    expect(toEpochSeconds("2026-11-16T19:49:00Z", TZ_US)).toBe(et);
    expect(toEpochSeconds("2026-11-16T19:49:00+00:00", TZ_US)).toBe(et);
    expect(toEpochMs("2026-11-16T14:49:00-05:00")).toBe(et * 1000);
  });

  it("still pins naive strings to IST by default", () => {
    const ist = Date.UTC(2026, 10, 16, 9, 19, 0) / 1000; // 14:49 IST
    expect(toEpochSeconds("2026-11-16T14:49:00")).toBe(ist);
    expect(toEpochMs("2026-11-16T14:49:00")).toBe(ist * 1000);
    expect(MARKET_TIME_ZONE.india).toBe("Asia/Kolkata");
  });

  it("pins naive US strings to New York only when the US zone is supplied", () => {
    const winter = Date.UTC(2026, 10, 16, 19, 49, 0) / 1000; // EST, UTC-5
    expect(toEpochSeconds("2026-11-16T14:49:00", TZ_US)).toBe(winter);
    // No zone → the same string stays an IST wall clock, ~9.5h away.
    expect(toEpochSeconds("2026-11-16T14:49:00")).not.toBe(winter);
    expect(toEpochMs("2026-11-16 14:49:00", TZ_US)).toBe(winter * 1000);
  });

  it("uses the DST-correct offset for naive US strings (EST vs EDT)", () => {
    expect(toEpochSeconds("2026-03-07T14:49:00", TZ_US)).toBe(
      Date.UTC(2026, 2, 7, 19, 49, 0) / 1000,
    ); // EST
    expect(toEpochSeconds("2026-03-09T14:49:00", TZ_US)).toBe(
      Date.UTC(2026, 2, 9, 18, 49, 0) / 1000,
    ); // EDT
    expect(toEpochSeconds("2026-07-15T14:49:00", TZ_US)).toBe(
      Date.UTC(2026, 6, 15, 18, 49, 0) / 1000,
    ); // EDT
  });

  it("resolves both sides of the DST boundary without crashing", () => {
    // Spring forward (2026-03-08 02:00 EST -> 03:00 EDT) and fall back
    // (2026-11-01 02:00 EDT -> 01:00 EST) must produce finite epochs.
    for (const naive of ["2026-03-08T01:30:00", "2026-03-08T02:30:00", "2026-03-08T03:30:00",
      "2026-11-01T00:30:00", "2026-11-01T01:30:00", "2026-11-01T02:30:00"]) {
      const epoch = toEpochSeconds(naive, TZ_US);
      expect(Number.isFinite(epoch)).toBe(true);
      // Every resolved instant still lands on the intended calendar date.
      expect(sessionDateKey(`${naive}-05:00`, TZ_US)).toBe(naive.slice(0, 10));
    }
  });

  it("formats epoch labels in the requested zone (14:49 ET, never 01:19 IST)", () => {
    const nov = Date.UTC(2026, 10, 16, 19, 49, 0); // 14:49 EST
    const jul = Date.UTC(2026, 6, 15, 18, 49, 0); // 14:49 EDT
    expect(formatChartTimeLabel(nov, "HM", TZ_US)).toBe("14:49");
    expect(formatChartTimeLabel(jul, "HM", TZ_US)).toBe("14:49");
    expect(formatChartTimeLabel(nov)).toBe("01:19"); // unchanged IST default
    expect(formatChartTimeLabel(nov, "FULL", TZ_US)).toBe("2026-11-16 14:49");
    expect(formatChartTimeLabel("2026-11-16T14:49:00-05:00", "HM", TZ_US)).toBe("14:49");
  });
});

describe("sessionDateKey", () => {
  it("keys a US offset timestamp to its ET session date, not the IST date", () => {
    const stamp = "2026-11-16T14:49:00-05:00"; // 19:49Z -> 01:19 IST next day
    expect(sessionDateKey(stamp)).toBe("2026-11-17");
    expect(sessionDateKey(stamp, TZ_US)).toBe("2026-11-16");
  });

  it("keys a naive US string in the supplied zone and a bare date as-is", () => {
    expect(sessionDateKey("2026-11-16T14:49:00", TZ_US)).toBe("2026-11-16");
    expect(sessionDateKey("2026-07-15 09:30:00", TZ_US)).toBe("2026-07-15");
    expect(sessionDateKey("2026-11-16")).toBe("2026-11-16");
  });

  it("honours DST when deriving the ET session date", () => {
    // 23:30 EDT on 8 Mar -> 03:30Z on 9 Mar: ET keeps the 8th, IST rolls over.
    const stamp = "2026-03-08T23:30:00-04:00";
    expect(sessionDateKey(stamp, TZ_US)).toBe("2026-03-08");
    expect(sessionDateKey(stamp)).toBe("2026-03-09");
  });

  it("returns null for empty/invalid values", () => {
    expect(sessionDateKey(null)).toBeNull();
    expect(sessionDateKey("")).toBeNull();
    expect(sessionDateKey("   ")).toBeNull();
    expect(sessionDateKey("not-a-date")).toBeNull();
  });
});