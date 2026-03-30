import { describe, expect, test } from "vitest";
import { formatNumber, formatExitReason } from "../../utils/ui-helpers";

describe("formatExitReason", () => {
  test("maps target to Target", () => {
    expect(formatExitReason("target")).toBe("Target");
  });

  test("maps stop_loss to Stop Loss", () => {
    expect(formatExitReason("stop_loss")).toBe("Stop Loss");
  });

  test("maps signal to Signal", () => {
    expect(formatExitReason("signal")).toBe("Signal");
  });

  test("maps manual to Manual", () => {
    expect(formatExitReason("manual")).toBe("Manual");
  });

  test("maps timeout to Timeout", () => {
    expect(formatExitReason("timeout")).toBe("Timeout");
  });

  test("returns original string for unknown reason", () => {
    expect(formatExitReason("unknown_reason")).toBe("unknown_reason");
    expect(formatExitReason("SQUARE_OFF")).toBe("SQUARE_OFF");
    expect(formatExitReason("")).toBe("");
  });

  test("returns original for partial match that is not exact", () => {
    expect(formatExitReason("targets")).toBe("targets");
    expect(formatExitReason("stop_loss_partial")).toBe("stop_loss_partial");
  });
});

describe("formatNumber", () => {
  test("formats numbers below 1000 without suffix", () => {
    expect(formatNumber(500)).toBe("500");
    expect(formatNumber(999)).toBe("999");
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(1)).toBe("1");
    expect(formatNumber(0.5)).toBe("1");
  });

  test("formats thousands with K suffix", () => {
    expect(formatNumber(1000)).toBe("1.0K");
    expect(formatNumber(1500)).toBe("1.5K");
    expect(formatNumber(10000)).toBe("10.0K");
    expect(formatNumber(99999)).toBe("100.0K");
  });

  test("formats lakhs with L suffix", () => {
    expect(formatNumber(100000)).toBe("1.0L");
    expect(formatNumber(150000)).toBe("1.5L");
    expect(formatNumber(1000000)).toBe("10.0L");
    expect(formatNumber(500000)).toBe("5.0L");
  });

  test("handles negative numbers with K suffix", () => {
    expect(formatNumber(-1500)).toBe("-1.5K");
    expect(formatNumber(-10000)).toBe("-10.0K");
    expect(formatNumber(-999)).toBe("-999");
  });

  test("handles negative numbers with L suffix", () => {
    expect(formatNumber(-100000)).toBe("-1.0L");
    expect(formatNumber(-250000)).toBe("-2.5L");
  });

  test("handles zero", () => {
    expect(formatNumber(0)).toBe("0");
  });

  test("handles boundary at exactly 1000", () => {
    expect(formatNumber(1000)).toBe("1.0K");
  });

  test("handles boundary at exactly 100000", () => {
    expect(formatNumber(100000)).toBe("1.0L");
  });

  test("handles numbers just below thresholds", () => {
    expect(formatNumber(999)).toBe("999");
    expect(formatNumber(99999)).toBe("100.0K");
  });
});
