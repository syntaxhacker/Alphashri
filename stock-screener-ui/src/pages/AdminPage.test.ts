import { describe, it, expect } from "vitest";
import {
  formatCost,
  formatResponseTime,
  formatDateTime,
  truncateUrl,
  getStatusColor,
} from "./AdminPage";

describe("formatCost", () => {
  it("formats a positive cost with 4 decimal places", () => {
    expect(formatCost(0.0012)).toBe("$0.0012");
  });

  it("formats zero cost", () => {
    expect(formatCost(0)).toBe("$0.0000");
  });

  it("formats a larger cost", () => {
    expect(formatCost(1.5)).toBe("$1.5000");
  });

  it("formats a very small cost", () => {
    expect(formatCost(0.00001)).toBe("$0.0000");
  });

  it("formats negative cost", () => {
    expect(formatCost(-0.5)).toBe("$-0.5000");
  });

  it("formats a round number", () => {
    expect(formatCost(10)).toBe("$10.0000");
  });
});

describe("formatResponseTime", () => {
  it("formats whole milliseconds", () => {
    expect(formatResponseTime(150)).toBe("150ms");
  });

  it("formats zero", () => {
    expect(formatResponseTime(0)).toBe("0ms");
  });

  it("rounds fractional milliseconds down", () => {
    expect(formatResponseTime(123.4)).toBe("123ms");
  });

  it("rounds fractional milliseconds up (banker's rounding)", () => {
    expect(formatResponseTime(123.5)).toBe("124ms");
  });

  it("formats negative value", () => {
    expect(formatResponseTime(-50)).toBe("-50ms");
  });

  it("formats very large values", () => {
    expect(formatResponseTime(99999.9)).toBe("100000ms");
  });
});

describe("formatDateTime", () => {
  it("formats a valid ISO string", () => {
    const result = formatDateTime("2025-01-15T10:30:00Z");
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns a string for an invalid date string (Date doesn't throw, returns Invalid Date)", () => {
    const result = formatDateTime("not-a-date");
    expect(result).toBe("Invalid Date");
  });

  it("handles an empty string", () => {
    const result = formatDateTime("");
    expect(typeof result).toBe("string");
  });

  it("handles a date-only string", () => {
    const result = formatDateTime("2025-06-01");
    expect(result).toBeTruthy();
  });
});

describe("truncateUrl", () => {
  it("returns short URL unchanged", () => {
    expect(truncateUrl("https://example.com")).toBe("https://example.com");
  });

  it("truncates a URL longer than default maxLength", () => {
    const longUrl = "https://example.com/very/long/path/that/exceeds/default/length/of/fifty/characters";
    const result = truncateUrl(longUrl);
    expect(result.length).toBe(53);
    expect(result).toBe(longUrl.substring(0, 50) + "...");
  });

  it("does not truncate a URL exactly at maxLength", () => {
    const url = "a".repeat(50);
    expect(truncateUrl(url)).toBe(url);
  });

  it("does not truncate a URL shorter than maxLength", () => {
    const url = "short";
    expect(truncateUrl(url)).toBe("short");
  });

  it("truncates with custom maxLength", () => {
    const url = "https://example.com";
    expect(truncateUrl(url, 10)).toBe("https://ex...");
  });

  it("truncates with maxLength of 0", () => {
    const url = "https://example.com";
    expect(truncateUrl(url, 0)).toBe("...");
  });

  it("handles empty string", () => {
    expect(truncateUrl("")).toBe("");
  });

  it("handles single character", () => {
    expect(truncateUrl("a")).toBe("a");
  });

  it("handles very long string", () => {
    const url = "x".repeat(1000);
    const result = truncateUrl(url);
    expect(result.length).toBe(53);
  });
});

describe("getStatusColor", () => {
  it("returns green for success", () => {
    expect(getStatusColor("success")).toBe("green");
  });

  it("returns green for SUCCESS (case insensitive)", () => {
    expect(getStatusColor("SUCCESS")).toBe("green");
  });

  it("returns green for Success (mixed case)", () => {
    expect(getStatusColor("Success")).toBe("green");
  });

  it("returns red for error", () => {
    expect(getStatusColor("error")).toBe("red");
  });

  it("returns red for ERROR", () => {
    expect(getStatusColor("ERROR")).toBe("red");
  });

  it("returns yellow for pending", () => {
    expect(getStatusColor("pending")).toBe("yellow");
  });

  it("returns yellow for PENDING", () => {
    expect(getStatusColor("PENDING")).toBe("yellow");
  });

  it("returns gray for unknown status", () => {
    expect(getStatusColor("unknown")).toBe("gray");
  });

  it("returns gray for empty string", () => {
    expect(getStatusColor("")).toBe("gray");
  });

  it("returns gray for random string", () => {
    expect(getStatusColor("foobar")).toBe("gray");
  });
});
