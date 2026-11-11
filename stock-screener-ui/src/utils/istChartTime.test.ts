import { describe, expect, it } from "vitest";
import { formatChartTick, formatChartTimestamp, formatISTCrosshair, formatISTTick } from "./istChartTime";
import { IST_TICK_EPOCH, registerISTAxisTests } from "./istChartTime.testFixtures";

describe("istChartTime (shared lightweight-charts IST formatters)", () => {
  const epoch = IST_TICK_EPOCH;

  it("renders intraday ticks in IST", () => {
    expect(formatISTTick(epoch, "time")).toBe("09:20");
  });

  registerISTAxisTests({ formatISTTick, formatISTCrosshair });
});

describe("formatChartTimestamp / formatChartTick (ISO inputs)", () => {
  it("converts an Upstox daily candle (18:30 UTC) to the IST trading date", () => {
    // 2026-05-04T18:30:00+00:00 == 2026-05-05T00:00 IST
    expect(formatChartTimestamp("2026-05-04T18:30:00+00:00")).toBe("05 May 2026");
    expect(formatChartTick("2026-05-04T18:30:00+00:00")).toBe("05 May");
  });

  it("formats a date-only string as the calendar date", () => {
    expect(formatChartTimestamp("2026-05-04")).toBe("04 May 2026");
    expect(formatChartTick("2026-05-04")).toBe("04 May");
  });

  it("formats an intraday timestamp with time", () => {
    expect(formatChartTimestamp("2026-05-04T09:20:00+05:30")).toBe("04 May, 09:20");
    expect(formatChartTick("2026-05-04T09:20:00+05:30")).toBe("04 May 09:20");
  });

  it("falls back to the raw string when unparseable", () => {
    expect(formatChartTimestamp("not-a-date")).toBe("not-a-date");
    expect(formatChartTimestamp("")).toBe("");
    expect(formatChartTick("garbage")).toBe("garbage");
  });
});
