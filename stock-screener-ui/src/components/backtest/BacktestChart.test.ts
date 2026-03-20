import { describe, expect, test } from "vitest";
import { normalizeTime } from "./BacktestChart";

describe("normalizeTime", () => {
  test("strips +00:00 suffix", () => {
    expect(normalizeTime("2026-01-28T09:45:00+00:00")).toBe("2026-01-28T09:45");
  });

  test("strips Z suffix", () => {
    expect(normalizeTime("2026-01-28T09:45:00Z")).toBe("2026-01-28T09:45");
  });

  test("strips +05:30 suffix", () => {
    expect(normalizeTime("2026-01-28T15:15:00+05:30")).toBe("2026-01-28T15:15");
  });

  test("handles empty string", () => {
    expect(normalizeTime("")).toBe("");
  });

  test("handles time without timezone suffix", () => {
    expect(normalizeTime("2026-01-28T09:45:00")).toBe("2026-01-28T09:45");
  });

  test("handles date-only format for daily candles", () => {
    expect(normalizeTime("2026-01-28")).toBe("2026-01-28");
  });

  test("truncates seconds and milliseconds", () => {
    expect(normalizeTime("2026-01-28T09:45:30+00:00")).toBe("2026-01-28T09:45");
    expect(normalizeTime("2026-01-28T09:45:30.123Z")).toBe("2026-01-28T09:45");
  });

  test("handles various date formats", () => {
    expect(normalizeTime("2025-12-31T23:59:00Z")).toBe("2025-12-31T23:59");
    expect(normalizeTime("2024-02-29T00:00:00+00:00")).toBe("2024-02-29T00:00");
  });
});
