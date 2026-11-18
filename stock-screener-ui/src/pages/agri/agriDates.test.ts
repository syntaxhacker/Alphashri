// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { agriDateDaysAgo } from "./agriDates";

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
