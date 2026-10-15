import { describe, expect, it } from "vitest";
import { formatChartTick, formatChartTimestamp, formatISTCrosshair, formatISTTick } from "./datetime";

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

describe("formatISTTick / formatISTCrosshair (lightweight-charts axis)", () => {
  // 03:50 UTC == 09:20 IST — the chart's raw epoch would otherwise read 03:50.
  const epoch = Date.parse("2026-05-04T03:50:00+00:00") / 1000;

  it("renders every tick granularity in IST", () => {
    expect(formatISTTick(epoch, "time")).toBe("09:20");
    expect(formatISTTick(epoch, "timeSeconds")).toBe("09:20:00");
    expect(formatISTTick(epoch, "day")).toBe("04");
    expect(formatISTTick(epoch, "month")).toBe("May");
    expect(formatISTTick(epoch, "year")).toBe("2026");
  });

  it("renders the crosshair label in IST", () => {
    expect(formatISTCrosshair(epoch)).toBe("04 May, 09:20");
  });

  it("shows a date-only crosshair for a daily candle's IST-midnight instant", () => {
    const daily = Date.parse("2026-05-04T18:30:00+00:00") / 1000; // 00:00 IST next day
    expect(formatISTCrosshair(daily)).toBe("05 May 2026");
  });
});
