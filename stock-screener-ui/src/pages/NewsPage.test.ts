import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatTimeAgo } from "./NewsPage";

describe("formatTimeAgo", () => {
  const now = new Date("2025-06-15T12:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for a date less than 1 minute ago', () => {
    const date = new Date(now.getTime() - 30_000).toISOString();
    expect(formatTimeAgo(date)).toBe("just now");
  });

  it('returns "just now" for the current moment', () => {
    const date = now.toISOString();
    expect(formatTimeAgo(date)).toBe("just now");
  });

  it("returns minutes ago for a date within the last hour", () => {
    const date = new Date(now.getTime() - 5 * 60_000).toISOString();
    expect(formatTimeAgo(date)).toBe("5m ago");
  });

  it('returns "1m ago" for exactly 1 minute ago', () => {
    const date = new Date(now.getTime() - 60_000).toISOString();
    expect(formatTimeAgo(date)).toBe("1m ago");
  });

  it('returns "59m ago" for 59 minutes ago', () => {
    const date = new Date(now.getTime() - 59 * 60_000).toISOString();
    expect(formatTimeAgo(date)).toBe("59m ago");
  });

  it("returns hours ago for a date within the last 24 hours", () => {
    const date = new Date(now.getTime() - 3 * 3600_000).toISOString();
    expect(formatTimeAgo(date)).toBe("3h ago");
  });

  it('returns "1h ago" for exactly 1 hour ago', () => {
    const date = new Date(now.getTime() - 3600_000).toISOString();
    expect(formatTimeAgo(date)).toBe("1h ago");
  });

  it('returns "23h ago" for 23 hours ago', () => {
    const date = new Date(now.getTime() - 23 * 3600_000).toISOString();
    expect(formatTimeAgo(date)).toBe("23h ago");
  });

  it("returns days ago for a date within the last 7 days", () => {
    const date = new Date(now.getTime() - 3 * 86400_000).toISOString();
    expect(formatTimeAgo(date)).toBe("3d ago");
  });

  it('returns "1d ago" for exactly 1 day ago', () => {
    const date = new Date(now.getTime() - 86400_000).toISOString();
    expect(formatTimeAgo(date)).toBe("1d ago");
  });

  it('returns "6d ago" for 6 days ago', () => {
    const date = new Date(now.getTime() - 6 * 86400_000).toISOString();
    expect(formatTimeAgo(date)).toBe("6d ago");
  });

  it("returns a localized date string for dates older than 7 days", () => {
    const date = new Date(now.getTime() - 10 * 86400_000).toISOString();
    const result = formatTimeAgo(date);
    expect(result).toBe(new Date(date).toLocaleDateString());
  });

  it("returns a localized date string for very old dates", () => {
    const date = new Date("2020-01-01T00:00:00Z").toISOString();
    const result = formatTimeAgo(date);
    expect(result).toBe(new Date(date).toLocaleDateString());
  });

  it("returns 'Invalid Date' for an invalid date string (Date doesn't throw)", () => {
    expect(formatTimeAgo("not-a-date")).toBe("Invalid Date");
  });

  it("returns 'Invalid Date' for an empty string", () => {
    expect(formatTimeAgo("")).toBe("Invalid Date");
  });

  it("handles a future date (negative diff)", () => {
    const date = new Date(now.getTime() + 60_000).toISOString();
    expect(formatTimeAgo(date)).toBe("just now");
  });
});
