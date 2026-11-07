import { describe, expect, it } from "vitest";
import { formatTimeLabel } from "../chartTimeUtils";

describe("formatTimeLabel", () => {
  it("extracts time from ISO string with T separator", () => {
    expect(formatTimeLabel("2025-01-15T09:30:00")).toBe("09:30");
    expect(formatTimeLabel("2025-01-15T14:45:30")).toBe("14:45");
  });

  it("extracts time from space-separated datetime", () => {
    expect(formatTimeLabel("2025-01-15 09:30:00")).toBe("09:30");
    expect(formatTimeLabel("2025-01-15 14:45:30")).toBe("14:45");
  });

  it("handles time_str format directly", () => {
    expect(formatTimeLabel("09:30")).toBe("09:30");
    expect(formatTimeLabel("23:59")).toBe("23:59");
  });

  it("returns original value if no T separator and not time-like", () => {
    expect(formatTimeLabel("some-random-string")).toBe("some-random-string");
    expect(formatTimeLabel("")).toBe("");
  });

  it("handles empty string", () => {
    expect(formatTimeLabel("")).toBe("");
  });

  it("handles undefined", () => {
    // @ts-expect-error - testing edge case
    expect(formatTimeLabel(undefined)).toBe("");
  });

  it("handles null", () => {
    // @ts-expect-error - testing edge case
    expect(formatTimeLabel(null)).toBe("");
  });

  it("extracts first 5 characters (HH:MM) only", () => {
    expect(formatTimeLabel("2025-01-15T09:30:45.123Z")).toBe("09:30");
    expect(formatTimeLabel("2025-01-15T23:59:59+05:30")).toBe("23:59");
  });

  it("handles date-only format (no time part)", () => {
    expect(formatTimeLabel("2025-01-15")).toBe("2025-01-15");
  });

  it("handles strings shorter than 5 chars", () => {
    expect(formatTimeLabel("09:3")).toBe("09:3");
    expect(formatTimeLabel("9")).toBe("9");
  });

  it("handles epoch milliseconds (formats in local timezone)", () => {
    // 2025-01-15T09:30:00Z = 15:00 IST (UTC+5:30)
    const ms = Date.UTC(2025, 0, 15, 9, 30, 0);
    // In IST timezone this formats as 15:00; in UTC as 09:30
    const result = formatTimeLabel(ms);
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it("handles epoch seconds (formats in local timezone)", () => {
    const sec = Date.UTC(2025, 0, 15, 9, 30, 0) / 1000;
    const result = formatTimeLabel(sec);
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });
});