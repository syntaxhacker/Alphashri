import { describe, expect, it } from "vitest";
import {
  toEpochSeconds,
  toEpochMs,
  formatChartTimeLabel,
} from "./time";

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