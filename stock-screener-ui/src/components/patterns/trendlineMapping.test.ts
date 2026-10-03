// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mapTrendlines, parseEngineTimestamp, pointsToSeriesData } from "./trendlineMapping";

const TIMES = [
  "2026-05-04T09:15:00+05:30",
  "2026-05-04T09:16:00+05:30",
  "2026-05-04T09:17:00+05:30",
  "2026-05-04T09:18:00+05:30",
];

describe("parseEngineTimestamp", () => {
  it("pins naive engine strings to IST regardless of the browser timezone", () => {
    // 09:15 IST == 03:45 UTC. A naive-local parse on a UTC browser would read
    // 09:15 UTC instead — off by 5.5h.
    expect(parseEngineTimestamp("2026-05-04 09:15")).toBe(Date.parse("2026-05-04T09:15:00+05:30"));
    expect(parseEngineTimestamp("2026-05-04T09:15")).toBe(Date.parse("2026-05-04T03:45:00Z"));
  });

  it("leaves explicit offsets untouched", () => {
    expect(parseEngineTimestamp("2026-05-04T09:15:00+05:30")).toBe(
      Date.parse("2026-05-04T09:15:00+05:30"),
    );
    expect(parseEngineTimestamp("2026-05-04T03:45:00Z")).toBe(Date.parse("2026-05-04T03:45:00Z"));
  });

  it("treats date-only strings as IST midnight", () => {
    expect(parseEngineTimestamp("2026-05-04")).toBe(Date.parse("2026-05-04T00:00:00+05:30"));
  });
});

describe("mapTrendlines IST stability", () => {
  it("maps a naive engine timestamp to the right candle (no UTC shift)", () => {
    // Nearest-candle matching must resolve "09:16" to index 1 even when the
    // browser runs in UTC (naive-local parsing would shift the target).
    const mapped = mapTrendlines([[{ t: "2026-05-04 09:16", price: 101 }]], TIMES);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.[0]?.index).toBe(1);
  });

  it("keeps day-boundary pivots on the right candle", () => {
    const mapped = mapTrendlines([[{ t: "2026-05-04 09:18", price: 102 }]], TIMES);
    expect(mapped[0]?.[0]?.index).toBe(3);
  });
});

describe("pointsToSeriesData", () => {
  it("pads nulls outside the mapped points", () => {
    expect(pointsToSeriesData([{ index: 1, price: 5 }], 3)).toEqual([null, 5, null]);
  });
});
