import { describe, expect, it } from "vitest";
import { formatChartTick, formatChartTimestamp } from "./datetime";

describe("formatChartTimestamp", () => {
  it("converts an Upstox daily candle (18:30 UTC) to the IST trading date", () => {
    // 2026-05-04T18:30:00+00:00 == 2026-05-05T00:00 IST
    expect(formatChartTimestamp("2026-05-04T18:30:00+00:00")).toBe("05 May 2026");
  });

  it("formats a date-only string as the calendar date", () => {
    expect(formatChartTimestamp("2026-05-04")).toBe("04 May 2026");
  });

  it("formats an intraday timestamp with time", () => {
    expect(formatChartTimestamp("2026-05-04T09:20:00+05:30")).toBe("04 May, 09:20");
    // Same instant expressed in UTC.
    expect(formatChartTimestamp("2026-05-04T03:50:00+00:00")).toBe("04 May, 09:20");
  });

  it("falls back to the raw string when unparseable", () => {
    expect(formatChartTimestamp("not-a-date")).toBe("not-a-date");
    expect(formatChartTimestamp("")).toBe("");
  });
});

describe("formatChartTick", () => {
  it("formats a daily candle as day + month", () => {
    expect(formatChartTick("2026-05-04T18:30:00+00:00")).toBe("05 May");
    expect(formatChartTick("2026-05-04")).toBe("04 May");
  });

  it("formats an intraday tick as day + month + time", () => {
    expect(formatChartTick("2026-05-04T09:20:00+05:30")).toBe("04 May 09:20");
  });

  it("falls back to the raw string when unparseable", () => {
    expect(formatChartTick("garbage")).toBe("garbage");
  });
});
