import { describe, expect, it } from "vitest";
import { TZ_US } from "@/utils/chart/time";
import { formatChartTick, formatChartTimestamp, formatISTCrosshair, formatISTTick } from "./istChartTime";
import {
  IST_DAILY_EPOCH,
  IST_TICK_EPOCH,
  registerISTAxisTests,
} from "./istChartTime.testFixtures";

describe("istChartTime (shared lightweight-charts IST formatters)", () => {
  const epoch = IST_TICK_EPOCH;

  it("renders intraday ticks in IST", () => {
    expect(formatISTTick(epoch, "time")).toBe("09:20");
  });

  registerISTAxisTests({ formatISTTick, formatISTCrosshair });
});

describe("zone-aware axis formatters (timeZone param)", () => {
  const epoch = (iso: string) => Date.parse(iso) / 1000;

  it("keeps India output byte-identical when no zone is supplied", () => {
    expect(formatISTTick(IST_TICK_EPOCH, "time")).toBe("09:20");
    expect(formatISTTick(IST_TICK_EPOCH, "timeSeconds")).toBe("09:20:00");
    expect(formatISTTick(IST_TICK_EPOCH, "day")).toBe("04");
    expect(formatISTCrosshair(IST_TICK_EPOCH)).toBe("04 May, 09:20");
    expect(formatISTCrosshair(IST_DAILY_EPOCH)).toBe("05 May 2026");
  });

  it("renders 2026-11-16T14:49:00-05:00 as 14:49 in New York and 01:19 in default IST", () => {
    const e = epoch("2026-11-16T14:49:00-05:00"); // 19:49Z
    expect(formatISTTick(e, "time", TZ_US)).toBe("14:49");
    expect(formatISTCrosshair(e, TZ_US)).toBe("16 Nov, 14:49");
    expect(formatISTTick(e, "day", TZ_US)).toBe("16");
    expect(formatISTTick(e, "time")).toBe("01:19");
    expect(formatISTCrosshair(e)).toBe("17 Nov, 01:19");
    expect(formatISTTick(e, "day")).toBe("17");
  });

  it("is DST-aware on both sides of spring-forward and fall-back", () => {
    // Spring-forward: 02:00 EST -> 03:00 EDT on 8 Mar 2026.
    expect(formatISTTick(epoch("2026-03-08T01:30:00-05:00"), "time", TZ_US)).toBe("01:30");
    expect(formatISTTick(epoch("2026-03-08T03:30:00-04:00"), "time", TZ_US)).toBe("03:30");
    expect(formatISTTick(epoch("2026-03-08T03:30:00-04:00"), "time")).toBe("13:00");

    // Fall-back: 02:00 EDT -> 01:00 EST on 1 Nov 2026 — two distinct 01:30s.
    const edt = epoch("2026-11-01T01:30:00-04:00"); // 05:30Z
    const est = epoch("2026-11-01T01:30:00-05:00"); // 06:30Z
    expect(formatISTTick(edt, "time", TZ_US)).toBe("01:30");
    expect(formatISTTick(est, "time", TZ_US)).toBe("01:30");
    expect(formatISTTick(edt, "time")).toBe("11:00");
    expect(formatISTTick(est, "time")).toBe("12:00");
  });

  it("resolves the daily-midnight boundary in the requested zone", () => {
    // 18:30Z is 00:00 IST next day, but 14:30 EDT the same day.
    const e = epoch("2026-05-04T18:30:00+00:00");
    expect(formatISTCrosshair(e)).toBe("05 May 2026");
    expect(formatISTCrosshair(e, TZ_US)).toBe("04 May, 14:30");
  });
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
