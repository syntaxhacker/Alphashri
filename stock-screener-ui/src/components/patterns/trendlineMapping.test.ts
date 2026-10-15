// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mapTimeSegment, mapTrendlines, parseEngineTimestamp, pointsToSeriesData } from "./trendlineMapping";

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

  it("parses Z timestamps as the same instant", () => {
    expect(parseEngineTimestamp("2026-05-04T03:45:00Z")).toBe(
      Date.parse("2026-05-04T09:15:00+05:30"),
    );
  });

  it("parses naive space-separated datetimes as IST", () => {
    expect(parseEngineTimestamp("2026-05-04 09:15")).toBe(
      Date.parse("2026-05-04T09:15:00+05:30"),
    );
    expect(parseEngineTimestamp("2026-05-04 09:15:00")).toBe(
      Date.parse("2026-05-04T09:15:00+05:30"),
    );
  });

  it("returns NaN for unparseable strings", () => {
    expect(parseEngineTimestamp("not-a-date")).toBeNaN();
    expect(parseEngineTimestamp("garbage")).toBeNaN();
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

  it("prefers exact string matches", () => {
    const mapped = mapTrendlines([[{ t: TIMES[2] as string, price: 42 }]], TIMES);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toEqual([{ index: 2, price: 42 }]);
  });

  it("falls back to the first candle of the day for date-only strings", () => {
    const mapped = mapTrendlines([[{ t: "2026-05-04", price: 7 }]], TIMES);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.[0]?.index).toBe(0);
  });

  it("does not collapse timed strings onto the first candle of the day", () => {
    // 09:17:30 is equidistant between candles 2 and 3; nearest wins (index 2
    // via first-best tie-break), never the day-bucket index 0.
    const mapped = mapTrendlines([[{ t: "2026-05-04 09:17:30", price: 9 }]], TIMES);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.[0]?.index).toBe(2);
  });

  it("falls back to the nearest candle for out-of-window timed strings", () => {
    const before = mapTrendlines([[{ t: "2026-05-04 09:10", price: 1 }]], TIMES);
    expect(before[0]?.[0]?.index).toBe(0);
    const after = mapTrendlines([[{ t: "2026-05-04 09:30", price: 2 }]], TIMES);
    expect(after[0]?.[0]?.index).toBe(3);
  });

  it("returns [] for empty inputs and skips unparseable points", () => {
    expect(mapTrendlines([], TIMES)).toEqual([]);
    expect(mapTrendlines(undefined, TIMES)).toEqual([]);
    expect(mapTrendlines([[{ t: TIMES[0] as string, price: 1 }]], [])).toEqual([]);
    expect(mapTrendlines([[{ t: "garbage", price: 1 }]], TIMES)).toEqual([]);
  });
});

describe("pointsToSeriesData", () => {
  it("pads nulls outside the mapped points", () => {
    expect(pointsToSeriesData([{ index: 1, price: 5 }], 3)).toEqual([null, 5, null]);
  });

  it("ignores out-of-range indices", () => {
    expect(
      pointsToSeriesData(
        [
          { index: -1, price: 1 },
          { index: 1, price: 5 },
          { index: 3, price: 9 },
        ],
        3,
      ),
    ).toEqual([null, 5, null]);
  });

  it("returns all nulls for empty points", () => {
    expect(pointsToSeriesData([], 3)).toEqual([null, null, null]);
  });
});

describe("mapTimeSegment", () => {
  it("maps a segment fully inside the window to two points at the right indices/prices", () => {
    const points = mapTimeSegment(
      "2026-05-04T09:16:00+05:30",
      101,
      "2026-05-04T09:18:00+05:30",
      103,
      TIMES,
    );
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({ index: 1, price: 101 });
    expect(points[1]).toEqual({ index: 3, price: 103 });
  });

  it("interpolates the price at the window edge when the segment starts before the window", () => {
    // Line 100 → 104 across 09:14–09:18; window starts at 09:15 so the value
    // at the first visible bar is 101, not the original start price 100.
    const points = mapTimeSegment("2026-05-04 09:14", 100, "2026-05-04 09:18", 104, TIMES);
    expect(points).toHaveLength(2);
    expect(points[0]?.index).toBe(0);
    expect(points[0]?.price).toBeCloseTo(101, 10);
    expect(points[0]?.price).not.toBe(100);
    expect(points[1]).toEqual({ index: 3, price: 104 });
  });

  it("interpolates the price at the window edge when the segment ends after the window", () => {
    // Line 102 → 106 across 09:17–09:20; window ends at 09:18 so the value at
    // the last visible bar is 102 + 4/3 ≈ 103.333, not the end price 106.
    const points = mapTimeSegment("2026-05-04 09:17", 102, "2026-05-04 09:20", 106, TIMES);
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({ index: 2, price: 102 });
    expect(points[1]?.index).toBe(3);
    expect(points[1]?.price).toBeCloseTo(102 + 4 / 3, 10);
    expect(points[1]?.price).not.toBe(106);
  });

  it("clamps both edges when the segment spans the whole window", () => {
    // Line 100 → 106 across 09:14–09:20; visible slice 09:15–09:18 maps to
    // 101 → 104 with a slope of 1/min.
    const points = mapTimeSegment("2026-05-04 09:14", 100, "2026-05-04 09:20", 106, TIMES);
    expect(points).toHaveLength(2);
    expect(points[0]?.index).toBe(0);
    expect(points[0]?.price).toBeCloseTo(101, 10);
    expect(points[1]?.index).toBe(3);
    expect(points[1]?.price).toBeCloseTo(104, 10);
  });
  it("returns [] for segments entirely before or after the window", () => {
    expect(mapTimeSegment("2026-05-04 09:10", 100, "2026-05-04 09:12", 102, TIMES)).toEqual([]);
    expect(mapTimeSegment("2026-05-04 09:20", 100, "2026-05-04 09:22", 102, TIMES)).toEqual([]);
  });

  it("returns [] for unparseable timestamps", () => {
    expect(mapTimeSegment("not-a-date", 100, "2026-05-04 09:18", 104, TIMES)).toEqual([]);
    expect(mapTimeSegment("2026-05-04 09:14", 100, "garbage", 104, TIMES)).toEqual([]);
  });

  it("returns [] for empty windows and reversed spans", () => {
    expect(mapTimeSegment("2026-05-04 09:14", 100, "2026-05-04 09:18", 104, [])).toEqual([]);
    expect(
      mapTimeSegment("2026-05-04 09:18", 104, "2026-05-04 09:14", 100, TIMES),
    ).toEqual([]);
  });

  it("dot-marks a zero-span segment inside the window as a single point", () => {
    expect(
      mapTimeSegment("2026-05-04T09:16:00+05:30", 101, "2026-05-04T09:16:00+05:30", 101, TIMES),
    ).toEqual([{ index: 1, price: 101 }]);
    expect(
      mapTimeSegment("2026-05-04 09:10", 100, "2026-05-04 09:10", 100, TIMES),
    ).toEqual([]);
  });
});
