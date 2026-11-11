import { describe, expect, it } from "vitest";
import type { TrendLine, Trendline } from "@/types/chartPatterns";
import { createAxisIndex } from "./axisIndex";
import { mapTimeSegment, mapTrendlines } from "./trendlineMapping";
import { mapStandaloneLine } from "./standaloneLines";

/**
 * The axis index is a performance rewrite of `trendlineMapping` /
 * `standaloneLines` lookups: output must stay byte-identical, so these tests
 * differential-test the fast paths against the originals across sorted,
 * shuffled, duplicated and partially-unparseable time axes.
 */

const CANDLES_ISO = [
  "2026-05-04T09:15:00+05:30",
  "2026-05-05T09:15:00+05:30",
  "2026-05-06T09:15:00+05:30",
  "2026-05-07T09:15:00+05:30",
  "2026-05-08T09:15:00+05:30",
  "2026-05-11T09:15:00+05:30",
];

// Same axis shuffled: nearest/day lookups must not depend on storage order.
const CANDLES_SHUFFLED = [
  CANDLES_ISO[3]!,
  CANDLES_ISO[0]!,
  CANDLES_ISO[5]!,
  CANDLES_ISO[1]!,
  CANDLES_ISO[4]!,
  CANDLES_ISO[2]!,
];

const CANDLES_WITH_DUPES = [
  CANDLES_ISO[0]!,
  CANDLES_ISO[1]!,
  CANDLES_ISO[1]!, // duplicate string
  CANDLES_ISO[2]!,
  "not-a-timestamp",
  CANDLES_ISO[3]!,
  CANDLES_ISO[2]!, // duplicate again
];

const AXES: Array<[string, string[]]> = [
  ["sorted", CANDLES_ISO],
  ["shuffled", CANDLES_SHUFFLED],
  ["dupes+unparseable", CANDLES_WITH_DUPES],
  ["empty", []],
  ["single", [CANDLES_ISO[0]!]],
  ["date-only", ["2026-05-04", "2026-05-05", "2026-05-06"]],
];

const TRENDLINE_CASES: Array<[string, Trendline[]]> = [
  ["exact ISO endpoints", [[{ t: CANDLES_ISO[0]!, price: 100 }, { t: CANDLES_ISO[5]!, price: 110 }]]],
  ["naive engine timestamps", [[{ t: "2026-05-05 09:15", price: 101 }, { t: "2026-05-08 09:15", price: 108 }]]],
  ["date-only points", [[{ t: "2026-05-06", price: 99 }, { t: "2026-05-07", price: 103 }]]],
  ["out-of-window endpoints", [[{ t: "2020-01-01 09:15", price: 50 }, { t: "2030-01-01 09:15", price: 200 }]]],
  ["unparseable point mixed in", [[{ t: "garbage", price: 1 }, { t: "2026-05-04 09:15", price: 2 }]]],
  [
    "several lines incl. empty result",
    [
      [{ t: "2026-05-04 09:15", price: 100 }],
      [{ t: "garbage", price: 1 }],
      [{ t: "2026-05-11 12:00", price: 105 }, { t: "2026-05-04 09:15", price: 95 }],
    ],
  ],
];

describe("axisIndex.mapTrendlines matches mapTrendlines", () => {
  it.each(AXES)("axis %s", (_name, times) => {
    const axis = createAxisIndex(times);
    for (const [caseName, lines] of TRENDLINE_CASES) {
      expect(axis.mapTrendlines(lines), caseName).toEqual(mapTrendlines(lines, times));
    }
  });

  it("handles undefined/empty trendlines", () => {
    const axis = createAxisIndex(CANDLES_ISO);
    expect(axis.mapTrendlines(undefined)).toEqual(mapTrendlines(undefined, CANDLES_ISO));
    expect(axis.mapTrendlines([])).toEqual(mapTrendlines([], CANDLES_ISO));
  });
});

describe("axisIndex.mapTimeSegment matches mapTimeSegment", () => {
  const SEGMENTS: Array<[string, string, number, string, number]> = [
    ["inside window", "2026-05-05", 100, "2026-05-06", 110],
    ["spans window", "2026-05-01", 90, "2026-05-20", 130],
    ["before window", "2026-04-01", 90, "2026-04-10", 100],
    ["after window", "2026-06-01", 90, "2026-06-10", 100],
    ["degenerate", "2026-05-06", 105, "2026-05-06", 105],
    ["reversed", "2026-05-06", 110, "2026-05-05", 100],
    ["unparseable endpoints", "garbage", 100, "2026-05-06", 110],
  ];
  it.each(AXES)("axis %s", (_name, times) => {
    const axis = createAxisIndex(times);
    for (const [caseName, startT, startP, endT, endP] of SEGMENTS) {
      expect(axis.mapTimeSegment(startT, startP, endT, endP), caseName).toEqual(
        mapTimeSegment(startT, startP, endT, endP, times),
      );
    }
  });
});

function trendLine(overrides: Partial<TrendLine> = {}): TrendLine {
  return {
    kind: "support",
    start_date: "2026-05-04",
    start_price: 100,
    end_date: "2026-05-08",
    end_price: 110,
    slope: 1,
    touches: 3,
    span_bars: 5,
    violations: 0,
    ...overrides,
  };
}

describe("axisIndex.mapStandaloneLine matches mapStandaloneLine", () => {
  it.each(AXES)("axis %s", (_name, times) => {
    const axis = createAxisIndex(times);
    const lines: TrendLine[] = [
      trendLine(),
      trendLine({ kind: "resistance", start_price: 120, end_price: 130 }),
      trendLine({ start_date: "2025-01-01", end_date: "2025-01-10" }),
      trendLine({ start_date: "2026-05-06", start_price: 105, end_date: "2026-05-06", end_price: 105 }),
    ];
    for (const line of lines) {
      expect(axis.mapStandaloneLine(line)).toEqual(mapStandaloneLine(line, times));
    }
  });
});

describe("axisIndex.nearestIndex ties resolve to the earliest candle", () => {
  it("equidistant neighbours keep the earlier index", () => {
    // Target 2026-05-04 10:15 is exactly between the two candles.
    const times = ["2026-05-04T09:15:00+05:30", "2026-05-04T11:15:00+05:30"];
    expect(createAxisIndex(times).nearestIndex(Date.parse("2026-05-04T10:15:00+05:30"))).toBe(0);
    // Same axis, reversed storage order: the earliest axis index is now the later candle.
    expect(createAxisIndex([...times].reverse()).nearestIndex(Date.parse("2026-05-04T10:15:00+05:30"))).toBe(0);
  });

  it("duplicate timestamps resolve to the earliest duplicate", () => {
    const t = "2026-05-04T09:15:00+05:30";
    const axis = createAxisIndex(["2026-05-01T09:15:00+05:30", t, "2026-05-11T09:15:00+05:30", t]);
    expect(axis.nearestIndex(Date.parse(t))).toBe(1);
  });

  it("ignores unparseable axis entries", () => {
    const axis = createAxisIndex(["garbage", "2026-05-04T09:15:00+05:30"]);
    expect(axis.nearestIndex(Date.parse("2026-05-04T09:15:00+05:30"))).toBe(1);
  });

  it("returns undefined for NaN targets and empty axes", () => {
    expect(createAxisIndex(CANDLES_ISO).nearestIndex(Number.NaN)).toBeUndefined();
    expect(createAxisIndex([]).nearestIndex(0)).toBeUndefined();
  });
});

describe("axisIndex.resolveIndex precedence", () => {
  it("exact beats day beats nearest", () => {
    const axis = createAxisIndex(CANDLES_ISO);
    expect(axis.resolveIndex(CANDLES_ISO[2]!)).toBe(2);
    // Date-only string maps to the first candle of that day, not the nearest.
    expect(axis.resolveIndex("2026-05-06")).toBe(2);
    expect(axis.resolveIndex("garbage")).toBeUndefined();
  });

  it("a timed string never collapses onto the first candle of the day", () => {
    // Two candles on one day: a 12:00 query is nearer the 14:00 candle, so a
    // day-level collapse would wrongly land on index 0.
    const axis = createAxisIndex([
      "2026-05-06T09:15:00+05:30",
      "2026-05-06T14:00:00+05:30",
      "2026-05-07T09:15:00+05:30",
    ]);
    expect(axis.resolveIndex("2026-05-06 12:00")).toBe(1);
  });
});
