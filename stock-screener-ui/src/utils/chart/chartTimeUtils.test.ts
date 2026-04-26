import { describe, expect, it } from "vitest";
import { formatTimeLabel } from "../chartTimeUtils";

describe("formatTimeLabel", () => {
  it("extracts time from ISO string with T separator", () => {
    expect(formatTimeLabel("2025-01-15T09:30:00")).toBe("09:30");
    expect(formatTimeLabel("2025-01-15T14:45:30")).toBe("14:45");
  });

  it("returns original value for space-separated datetime (not supported)", () => {
    expect(formatTimeLabel("2025-01-15 09:30:00")).toBe("2025-01-15 09:30:00");
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
    expect(formatTimeLabel(undefined)).toBe(undefined);
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
});
