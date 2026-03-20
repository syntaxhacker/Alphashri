import { describe, expect, test } from "vitest";
import { getPnlColor, getWinRateColor, formatPnl } from "./BacktestResultsTable";

describe("getPnlColor", () => {
  test("returns green for positive values", () => {
    expect(getPnlColor(100)).toBe("green");
    expect(getPnlColor(0.01)).toBe("green");
  });

  test("returns green for zero", () => {
    expect(getPnlColor(0)).toBe("green");
  });

  test("returns red for negative values", () => {
    expect(getPnlColor(-100)).toBe("red");
    expect(getPnlColor(-0.01)).toBe("red");
  });
});

describe("getWinRateColor", () => {
  test("returns green for win rate >= 50", () => {
    expect(getWinRateColor(50)).toBe("green");
    expect(getWinRateColor(75)).toBe("green");
    expect(getWinRateColor(100)).toBe("green");
  });

  test("returns dimmed for win rate between 40 and 50", () => {
    expect(getWinRateColor(40)).toBe("dimmed");
    expect(getWinRateColor(45)).toBe("dimmed");
    expect(getWinRateColor(49.9)).toBe("dimmed");
  });

  test("returns red for win rate < 40", () => {
    expect(getWinRateColor(0)).toBe("red");
    expect(getWinRateColor(20)).toBe("red");
    expect(getWinRateColor(39.9)).toBe("red");
  });
});

describe("formatPnl", () => {
  test("formats positive PnL with + sign and K suffix", () => {
    expect(formatPnl(50000)).toBe("+₹50.0K");
    expect(formatPnl(100000)).toBe("+₹100.0K");
  });

  test("formats zero PnL with + sign", () => {
    expect(formatPnl(0)).toBe("+₹0.0K");
  });

  test("formats negative PnL without + prefix", () => {
    expect(formatPnl(-15000)).toBe("₹-15.0K");
    expect(formatPnl(-50000)).toBe("₹-50.0K");
  });

  test("handles sub-thousand values", () => {
    expect(formatPnl(500)).toBe("+₹0.5K");
    expect(formatPnl(-100)).toBe("₹-0.1K");
  });

  test("handles fractional thousands", () => {
    expect(formatPnl(1500)).toBe("+₹1.5K");
    expect(formatPnl(-2500)).toBe("₹-2.5K");
  });

  test("handles large values", () => {
    expect(formatPnl(500000)).toBe("+₹500.0K");
    expect(formatPnl(1234567)).toBe("+₹1234.6K");
  });
});
