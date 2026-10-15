import { describe, expect, it } from "vitest";
import { formatISTCrosshair, formatISTTick } from "./istChartTime";

describe("istChartTime (shared lightweight-charts IST formatters)", () => {
  // 03:50 UTC == 09:20 IST — the chart's raw epoch would otherwise read 03:50.
  const epoch = Date.parse("2026-05-04T03:50:00+00:00") / 1000;

  it("renders intraday ticks in IST", () => {
    expect(formatISTTick(epoch, "time")).toBe("09:20");
  });

  it("renders every tick granularity in IST", () => {
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
