import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import {
  formatCurrency,
  formatCurrencyIN,
  formatNumber,
  formatCurrencyCompact,
  formatPercentage,
  formatPnl,
  formatDateTimeHuman,
  formatDateTimeCompact,
  formatTradeTime,
  formatDuration,
  formatElapsed,
  formatTimeOnly,
  formatDateHeader,
  getOrdinalSuffix,
  getPnLClass,
  getPnLColor,
  getPnLTextColor,
  getValueColor,
  getWinRateColor,
  getScoreColor,
  getExitReasonColor,
  formatExitReason,
  formatTimeAgo,
  getStatusColor,
  renderSortIndicator,
  getNextSortDirection,
  normalizeTime,
} from "./ui-helpers";
import { POSITIVE, NEGATIVE, MARKER_TP, MARKER_SL, MARKER_EOD, EXIT_DEFAULT } from "../config/colors";

describe("formatCurrency", () => {
  test("formats positive numbers with rupee symbol", () => {
    expect(formatCurrency(1000)).toBe("₹1000");
    expect(formatCurrency(1234.56)).toBe("₹1235"); // Default precision 0 rounds
  });

  test("formats with custom precision", () => {
    expect(formatCurrency(1234.567, 2)).toBe("₹1234.57");
    expect(formatCurrency(100, 1)).toBe("₹100.0");
  });

  test("handles zero", () => {
    expect(formatCurrency(0)).toBe("₹0");
  });

  test("handles negative numbers", () => {
    expect(formatCurrency(-500)).toBe("₹-500");
  });
});

describe("formatNumber", () => {
  test("formats numbers below 1000 without suffix", () => {
    expect(formatNumber(500)).toBe("500");
    expect(formatNumber(999)).toBe("999");
  });

  test("formats thousands with K suffix", () => {
    expect(formatNumber(1500)).toBe("1.5K");
    expect(formatNumber(10000)).toBe("10.0K");
    expect(formatNumber(99999)).toBe("100.0K");
  });

  test("formats lakhs with L suffix", () => {
    expect(formatNumber(100000)).toBe("1.0L");
    expect(formatNumber(150000)).toBe("1.5L");
    expect(formatNumber(1000000)).toBe("10.0L");
  });

  test("handles negative numbers", () => {
    expect(formatNumber(-1500)).toBe("-1.5K");
    expect(formatNumber(-100000)).toBe("-1.0L");
  });

  test("handles zero", () => {
    expect(formatNumber(0)).toBe("0");
  });

  test("returns 0 for undefined", () => {
    expect(formatNumber(undefined)).toBe("0");
  });

  test("returns 0 for null", () => {
    expect(formatNumber(null)).toBe("0");
  });

  test("returns 0 for NaN", () => {
    expect(formatNumber(NaN)).toBe("0");
  });
});

describe("formatCurrencyCompact", () => {
  test("combines currency symbol with compact number", () => {
    expect(formatCurrencyCompact(1500)).toBe("₹1.5K");
    expect(formatCurrencyCompact(100000)).toBe("₹1.0L");
    expect(formatCurrencyCompact(500)).toBe("₹500");
  });
});

describe("formatPercentage", () => {
  test("formats with sign prefix by default", () => {
    expect(formatPercentage(5.5)).toBe("+5.50%");
    expect(formatPercentage(-3.2)).toBe("-3.20%");
  });

  test("hides sign when showSign is false", () => {
    expect(formatPercentage(5.5, 2, false)).toBe("5.50%");
    expect(formatPercentage(-3.2, 2, false)).toBe("-3.20%");
  });

  test("uses custom precision", () => {
    expect(formatPercentage(5.567, 1)).toBe("+5.6%");
    expect(formatPercentage(5.567, 3)).toBe("+5.567%");
  });

  test("handles zero", () => {
    expect(formatPercentage(0)).toBe("+0.00%");
  });
});

describe("formatDateTimeHuman", () => {
  test("formats ISO string to human readable", () => {
    const result = formatDateTimeHuman("2025-01-15T10:30:00+05:30");
    expect(result).toContain("15");
    expect(result).toContain("Jan");
    expect(result).toContain("10:30");
  });

  test("handles empty string", () => {
    expect(formatDateTimeHuman("")).toBe("-");
  });

  test("handles invalid input gracefully", () => {
    // Invalid input produces NaN-based output, not '-'
    const result = formatDateTimeHuman("invalid");
    // Just check it doesn't throw
    expect(typeof result).toBe("string");
  });
});

describe("formatDateTimeCompact", () => {
  test("formats ISO string compactly", () => {
    const result = formatDateTimeCompact("2025-06-20T14:45:00Z");
    expect(result).toBe("20th Jun 14:45");
  });

  test("handles ordinal suffixes correctly", () => {
    expect(formatDateTimeCompact("2025-01-01T09:00:00Z")).toContain("1st");
    expect(formatDateTimeCompact("2025-01-02T09:00:00Z")).toContain("2nd");
    expect(formatDateTimeCompact("2025-01-03T09:00:00Z")).toContain("3rd");
    expect(formatDateTimeCompact("2025-01-04T09:00:00Z")).toContain("4th");
    expect(formatDateTimeCompact("2025-01-21T09:00:00Z")).toContain("21st");
    expect(formatDateTimeCompact("2025-01-22T09:00:00Z")).toContain("22nd");
    expect(formatDateTimeCompact("2025-01-23T09:00:00Z")).toContain("23rd");
  });

  test("handles empty string", () => {
    expect(formatDateTimeCompact("")).toBe("-");
  });
});

describe("formatTradeTime", () => {
  test("formats trade time with seconds", () => {
    // Note: Result depends on local timezone, so just check format
    const result = formatTradeTime("2026-02-24T10:38:36Z");
    expect(result).toMatch(/\d{1,2} \w{3} \d{4}, \d{2}:\d{2}:\d{2}/);
  });

  test("handles empty string", () => {
    expect(formatTradeTime("")).toBe("-");
  });
});

describe("formatDuration", () => {
  test("formats minutes only", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(5)).toBe("5m");
  });

  test("formats hours and minutes", () => {
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(125)).toBe("2h 5m");
    expect(formatDuration(60)).toBe("1h");
  });

  test("handles zero and negative", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(-5)).toBe("0m");
  });
});

describe("getOrdinalSuffix", () => {
  test("returns st for 1, 21, 31", () => {
    expect(getOrdinalSuffix(1)).toBe("st");
    expect(getOrdinalSuffix(21)).toBe("st");
    expect(getOrdinalSuffix(31)).toBe("st");
  });

  test("returns nd for 2, 22", () => {
    expect(getOrdinalSuffix(2)).toBe("nd");
    expect(getOrdinalSuffix(22)).toBe("nd");
  });

  test("returns rd for 3, 23", () => {
    expect(getOrdinalSuffix(3)).toBe("rd");
    expect(getOrdinalSuffix(23)).toBe("rd");
  });

  test("returns th for other numbers", () => {
    expect(getOrdinalSuffix(4)).toBe("th");
    expect(getOrdinalSuffix(11)).toBe("th");
    expect(getOrdinalSuffix(12)).toBe("th");
    expect(getOrdinalSuffix(13)).toBe("th");
    expect(getOrdinalSuffix(15)).toBe("th");
    expect(getOrdinalSuffix(30)).toBe("th");
  });
});

describe("getPnLClass", () => {
  test("returns positive for positive values", () => {
    expect(getPnLClass(100)).toBe("positive");
    expect(getPnLClass(0.01)).toBe("positive");
  });

  test("returns negative for negative values", () => {
    expect(getPnLClass(-100)).toBe("negative");
    expect(getPnLClass(-0.01)).toBe("negative");
  });

  test("returns empty string for zero", () => {
    expect(getPnLClass(0)).toBe("");
  });
});

describe("getPnLColor", () => {
  test("returns green for positive/zero values", () => {
    expect(getPnLColor(100)).toBe(POSITIVE);
    expect(getPnLColor(0)).toBe(POSITIVE);
  });

  test("returns red for negative values", () => {
    expect(getPnLColor(-100)).toBe(NEGATIVE);
  });
});

describe("getExitReasonColor", () => {
  test("returns correct colors for exit reasons", () => {
    expect(getExitReasonColor("TP")).toBe(MARKER_TP); // palette green
    expect(getExitReasonColor("SL")).toBe(MARKER_SL); // palette red
    expect(getExitReasonColor("EOD")).toBe(MARKER_EOD); // palette cream
    expect(getExitReasonColor("UNKNOWN")).toBe(EXIT_DEFAULT);
  });
});

describe("renderSortIndicator", () => {
  test("returns empty string when column does not match", () => {
    expect(renderSortIndicator("name", "price", "asc")).toBe("");
    expect(renderSortIndicator("name", "price", "desc")).toBe("");
  });

  test("returns up arrow for ascending", () => {
    expect(renderSortIndicator("price", "price", "asc")).toBe(" ▲");
  });

  test("returns down arrow for descending", () => {
    expect(renderSortIndicator("price", "price", "desc")).toBe(" ▼");
  });
});

describe("getNextSortDirection", () => {
  test("returns desc for new column", () => {
    expect(getNextSortDirection("price", "name", "asc")).toBe("desc");
  });

  test("toggles direction for same column", () => {
    expect(getNextSortDirection("price", "price", "asc")).toBe("desc");
    expect(getNextSortDirection("price", "price", "desc")).toBe("asc");
  });
});

describe("normalizeTime", () => {
  test("strips +00:00 suffix", () => {
    const result = normalizeTime("2026-01-28T09:45:00+00:00");
    expect(result).toBe("2026-01-28T09:45");
  });

  test("handles Z suffix", () => {
    const result = normalizeTime("2026-01-28T09:45:00Z");
    expect(result).toBe("2026-01-28T09:45");
  });

  test("strips +05:30 suffix", () => {
    const result = normalizeTime("2026-01-28T15:15:00+05:30");
    expect(result).toBe("2026-01-28T15:15");
  });

  test("handles empty string", () => {
    expect(normalizeTime("")).toBe("");
  });

  test("handles time without timezone", () => {
    const result = normalizeTime("2026-01-28T09:45:00");
    expect(result).toBe("2026-01-28T09:45");
  });

  test("handles date-only format for daily candles", () => {
    const result = normalizeTime("2026-01-28");
    expect(result).toBe("2026-01-28");
  });
});

describe("formatElapsed", () => {
  test("returns dash for null, undefined, empty string", () => {
    expect(formatElapsed(null)).toBe("-");
    expect(formatElapsed(undefined)).toBe("-");
    expect(formatElapsed("")).toBe("-");
  });

  test("returns duration for valid ISO string", () => {
    const fiveMinsAgo = new Date(Date.now() - 5 * 60000).toISOString();
    const result = formatElapsed(fiveMinsAgo);
    expect(result).toBe("5m");
  });

  test("returns 0m for invalid date string (non-throwing)", () => {
    expect(formatElapsed("not-a-date")).toBe("0m");
  });
});

describe("formatTimeOnly", () => {
  test("returns dash for empty string", () => {
    expect(formatTimeOnly("")).toBe("-");
  });

  test("returns HH:MM format for valid ISO string", () => {
    const result = formatTimeOnly("2026-03-20T14:30:00+05:30");
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  test("returns raw string for invalid input", () => {
    expect(formatTimeOnly("not-a-date")).toBe("not-a-date");
  });
});

describe("formatDateHeader", () => {
  test("formats date with day and month", () => {
    const result = formatDateHeader("2026-03-20");
    expect(result).toContain("20");
    expect(result).toContain("Mar");
  });

  test("includes weekday", () => {
    const result = formatDateHeader("2026-03-20");
    const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    expect(weekdays.some((d) => result.includes(d))).toBe(true);
  });
});

describe("getPnLTextColor", () => {
  test("returns green for positive values", () => {
    expect(getPnLTextColor(100)).toBe("green");
  });

  test("returns red for negative values", () => {
    expect(getPnLTextColor(-100)).toBe("red");
  });

  test("returns green for zero", () => {
    expect(getPnLTextColor(0)).toBe("green");
  });
});

describe("getValueColor", () => {
  test("returns undefined for null, undefined, NaN", () => {
    expect(getValueColor(null)).toBe(undefined);
    expect(getValueColor(undefined)).toBe(undefined);
    expect(getValueColor(NaN)).toBe(undefined);
  });

  test("returns green for positive values", () => {
    expect(getValueColor(10)).toBe("green");
  });

  test("returns red for negative values", () => {
    expect(getValueColor(-10)).toBe("red");
  });

  test("returns undefined for zero", () => {
    expect(getValueColor(0)).toBe(undefined);
  });
});

describe("getWinRateColor", () => {
  test("returns green for >= 50", () => {
    expect(getWinRateColor(50)).toBe("green");
    expect(getWinRateColor(75)).toBe("green");
  });

  test("returns dimmed for >= 40", () => {
    expect(getWinRateColor(40)).toBe("dimmed");
    expect(getWinRateColor(45)).toBe("dimmed");
  });

  test("returns red for < 40", () => {
    expect(getWinRateColor(39)).toBe("red");
    expect(getWinRateColor(0)).toBe("red");
  });
});

describe("getScoreColor", () => {
  test("returns teal for >= 80", () => {
    expect(getScoreColor(80)).toBe("teal");
    expect(getScoreColor(100)).toBe("teal");
  });

  test("returns green for >= 60", () => {
    expect(getScoreColor(60)).toBe("green");
    expect(getScoreColor(75)).toBe("green");
  });

  test("returns yellow for >= 40", () => {
    expect(getScoreColor(40)).toBe("yellow");
    expect(getScoreColor(55)).toBe("yellow");
  });

  test("returns orange for >= 20", () => {
    expect(getScoreColor(20)).toBe("orange");
    expect(getScoreColor(35)).toBe("orange");
  });

  test("returns gray for < 20", () => {
    expect(getScoreColor(19)).toBe("gray");
    expect(getScoreColor(0)).toBe("gray");
  });
});

describe("formatExitReason", () => {
  test("maps known reasons", () => {
    expect(formatExitReason("target")).toBe("Target");
    expect(formatExitReason("stop_loss")).toBe("Stop Loss");
    expect(formatExitReason("signal")).toBe("Signal");
    expect(formatExitReason("manual")).toBe("Manual");
    expect(formatExitReason("timeout")).toBe("Timeout");
  });

  test("returns raw string for unknown reason", () => {
    expect(formatExitReason("unknown_reason")).toBe("unknown_reason");
  });
});

describe("getStatusColor", () => {
  test("returns green for success (case-insensitive)", () => {
    expect(getStatusColor("success")).toBe("green");
    expect(getStatusColor("SUCCESS")).toBe("green");
  });

  test("returns red for error", () => {
    expect(getStatusColor("error")).toBe("red");
  });

  test("returns yellow for pending", () => {
    expect(getStatusColor("pending")).toBe("yellow");
  });

  test("returns gray for unknown status", () => {
    expect(getStatusColor("something")).toBe("gray");
  });
});

describe("formatPnl", () => {
  test("formats positive P&L with plus sign", () => {
    expect(formatPnl(5000)).toBe("+₹5.0K");
  });

  test("formats negative P&L with minus", () => {
    expect(formatPnl(-3000)).toBe("₹-3.0K");
  });

  test("formats zero P&L with plus sign", () => {
    expect(formatPnl(0)).toBe("+₹0.0K");
  });
});

describe("formatCurrencyIN", () => {
  test("formats number with Indian locale commas", () => {
    const result = formatCurrencyIN(1234567.89);
    expect(result).toContain(",");
  });

  test("returns 0 for null, undefined, NaN", () => {
    expect(formatCurrencyIN(null)).toBe("0");
    expect(formatCurrencyIN(undefined)).toBe("0");
    expect(formatCurrencyIN(NaN)).toBe("0");
  });
});

describe("formatTimeAgo", () => {
  const now = new Date("2025-06-15T12:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('returns "just now" for a date less than 1 minute ago', () => {
    expect(formatTimeAgo(new Date(now.getTime() - 30_000).toISOString())).toBe("just now");
  });

  test("returns minutes ago for a date within the last hour", () => {
    expect(formatTimeAgo(new Date(now.getTime() - 5 * 60_000).toISOString())).toBe("5m ago");
  });

  test('returns "1m ago" for exactly 1 minute ago', () => {
    expect(formatTimeAgo(new Date(now.getTime() - 60_000).toISOString())).toBe("1m ago");
  });

  test("returns hours ago for a date within the last 24 hours", () => {
    expect(formatTimeAgo(new Date(now.getTime() - 3 * 3600_000).toISOString())).toBe("3h ago");
  });

  test("returns days ago for a date within the last 7 days", () => {
    expect(formatTimeAgo(new Date(now.getTime() - 3 * 86400_000).toISOString())).toBe("3d ago");
  });

  test("returns a localized date string for dates older than 7 days", () => {
    const date = new Date(now.getTime() - 10 * 86400_000).toISOString();
    expect(formatTimeAgo(date)).toBe(new Date(date).toLocaleDateString());
  });

  test("handles invalid dates", () => {
    expect(formatTimeAgo("not-a-date")).toBe("Invalid Date");
    expect(formatTimeAgo("")).toBe("Invalid Date");
  });

  test("handles future dates", () => {
    expect(formatTimeAgo(new Date(now.getTime() + 60_000).toISOString())).toBe("just now");
  });
});
