import { describe, expect, test } from "vitest";
import {
  DATA_STALE_AFTER_MS,
  dataFreshness,
  formatFreshnessAge,
  parseIstTimestampMs,
} from "./niftyDataFreshness";

const NOW = Date.parse("2026-11-03T11:55:42+05:30");

describe("parseIstTimestampMs", () => {
  test("reads full ISO with an offset", () => {
    expect(parseIstTimestampMs("2026-11-03T11:54:00+05:30")).toBe(
      Date.parse("2026-11-03T11:54:00+05:30"),
    );
  });

  test("treats an offset-less ISO stamp as IST", () => {
    expect(parseIstTimestampMs("2026-11-03T11:54:00")).toBe(
      Date.parse("2026-11-03T11:54:00+05:30"),
    );
  });

  test("dates a bare HH:MM tape clock from the session date", () => {
    expect(parseIstTimestampMs("11:54", "2026-11-03")).toBe(
      Date.parse("2026-11-03T11:54:00+05:30"),
    );
    expect(parseIstTimestampMs("11:54:30", "2026-11-03")).toBe(
      Date.parse("2026-11-03T11:54:30+05:30"),
    );
  });

  test("refuses a bare clock with no session date", () => {
    expect(parseIstTimestampMs("11:54")).toBeNull();
    expect(parseIstTimestampMs("")).toBeNull();
    expect(parseIstTimestampMs(null)).toBeNull();
  });
});

describe("formatFreshnessAge", () => {
  test("seconds, minutes, hours", () => {
    expect(formatFreshnessAge(42_000)).toBe("42s");
    expect(formatFreshnessAge(3 * 60_000)).toBe("3m");
    expect(formatFreshnessAge(64 * 60_000)).toBe("1h 4m");
    expect(formatFreshnessAge(null)).toBe("—");
  });
});

describe("dataFreshness", () => {
  test("fresh tape: DATA 42s, not stale", () => {
    const out = dataFreshness({
      nowMs: NOW,
      marketOpen: true,
      report: { fetchedAt: "2026-11-03T11:55:40+05:30", market: { session_date: "2026-11-03" } },
      tape: { date: "2026-11-03", rows: [{ t: "11:55" }] },
    });
    expect(out.tapeAgeMs).toBe(42_000);
    expect(out.stale).toBe(false);
    expect(out.label).toBe("DATA 42s");
  });

  test("tape older than 2 minutes during market hours: STALE", () => {
    const out = dataFreshness({
      nowMs: NOW,
      marketOpen: true,
      report: { fetchedAt: "2026-11-03T11:55:40+05:30", market: { session_date: "2026-11-03" } },
      tape: { date: "2026-11-03", rows: [{ t: "11:52" }] },
    });
    expect(out.tapeAgeMs).toBeGreaterThan(DATA_STALE_AFTER_MS);
    expect(out.stale).toBe(true);
    expect(out.label).toBe("STALE");
  });

  test("a fresh report never hides a stale tape", () => {
    const out = dataFreshness({
      nowMs: NOW,
      marketOpen: true,
      report: { fetchedAt: "2026-11-03T11:55:41+05:30", market: { session_date: "2026-11-03" } },
      tape: { date: "2026-11-03", rows: [{ t: "11:48" }] },
    });
    expect(out.ageMs).toBe(1_000); // newest of report/tape
    expect(out.tapeAgeMs).toBe(7 * 60_000 + 42_000);
    expect(out.stale).toBe(true);
  });

  test("a closed market is never stale", () => {
    const out = dataFreshness({
      nowMs: NOW,
      marketOpen: false,
      tape: { date: "2026-11-03", rows: [{ t: "11:40" }] },
    });
    expect(out.stale).toBe(false);
  });

  test("uses the newest burst when neither report nor tape is stamped", () => {
    const out = dataFreshness({
      nowMs: NOW,
      marketOpen: true,
      sessionDate: "2026-11-03",
      bursts: [{ t: "11:55" }],
    });
    expect(out.ageMs).toBe(42_000);
    expect(out.label).toBe("DATA 42s");
  });

  test("no readable timestamp: DATA —", () => {
    const out = dataFreshness({ nowMs: NOW, marketOpen: true });
    expect(out.ageMs).toBeNull();
    expect(out.label).toBe("DATA —");
    expect(out.stale).toBe(false);
  });
});
