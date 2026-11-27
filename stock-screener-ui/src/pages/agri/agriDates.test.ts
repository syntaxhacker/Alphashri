// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import {
  agriDateDaysAgo,
  agriRangeStart,
  formatAgriSessionDate,
} from "./agriDates";

describe("agriDateDaysAgo", () => {
  // 18:30Z on the 16th is 00:00 IST on the 17th — the UTC date is a day early.
  const istMidnight = Date.parse("2026-11-16T18:30:00Z");

  it("starts from the IST session date, not the UTC date", () => {
    expect(agriDateDaysAgo(0, istMidnight)).toBe("2026-11-17");
    expect(agriDateDaysAgo(7, istMidnight)).toBe("2026-11-10");
  });

  it("keeps the IST session for an intraday instant", () => {
    const intraday = Date.parse("2026-11-17T09:20:00+05:30");
    expect(agriDateDaysAgo(0, intraday)).toBe("2026-11-17");
    expect(agriDateDaysAgo(7, intraday)).toBe("2026-11-10");
  });
});

describe("agriRangeStart", () => {
  it("anchors the window to the latest collected session, not wall-clock today", () => {
    expect(agriRangeStart("2026-11-17", 30)).toBe("2026-10-18");
    expect(agriRangeStart("2026-11-17", 180)).toBe("2026-05-21");
  });

  it("returns as-of unchanged for MAX and for a missing date", () => {
    expect(agriRangeStart("2026-11-17", null)).toBe("2026-11-17");
    expect(agriRangeStart(null, 30)).toBe("");
  });

  it("handles month boundaries without zone drift", () => {
    expect(agriRangeStart("2026-03-01", 1)).toBe("2026-02-28");
    expect(agriRangeStart("2024-03-01", 1)).toBe("2024-02-29");
  });
});

describe("formatAgriSessionDate", () => {
  it("shows the ISO session date without a local-zone shift", () => {
    expect(formatAgriSessionDate("2026-11-17")).toBe("17 Nov 2026");
    expect(formatAgriSessionDate("2026-11-17T23:30:00+05:30")).toBe("17 Nov 2026");
  });

  it("keeps missing dates visibly absent", () => {
    expect(formatAgriSessionDate(null)).toBe("—");
  });
});
