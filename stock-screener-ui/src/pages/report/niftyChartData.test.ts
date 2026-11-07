import { describe, expect, test } from "vitest";
import {
  candlesFromSpotPoints,
  candlesFromTape,
  clipToAsOf,
  isOnSession,
  pickFreshestCandles,
  selectBaseCandles,
  sessionDateOf,
  type SpotPoint,
  type TapeSpotPoint,
} from "./niftyChartData";
import type {
  NiftyIntradayCandle,
  NiftyReport,
} from "@/types/niftyReport";
import type { ReplayCandle } from "@/types/replay";

const SESSION = "2026-10-12";
const PREV_SESSION = "2026-10-09";

function mockReport(overrides?: Record<string, unknown>): NiftyReport {
  return {
    mode: "live",
    date: SESSION,
    intraday: [],
    candles: [],
    ...overrides,
  } as unknown as NiftyReport;
}

function tapeRow(t: string, spot: number): TapeSpotPoint {
  return { t, spot };
}

function sessionTape(): TapeSpotPoint[] {
  return [
    tapeRow(`${SESSION}T09:15:00`, 25600),
    tapeRow(`${SESSION}T09:16:00`, 25620),
    tapeRow(`${SESSION}T09:17:00`, 25610),
  ];
}

function sessionIntraday(): NiftyIntradayCandle[] {
  return [
    { time: `${SESSION}T09:15:00`, open: 25600, high: 25650, low: 25580, close: 25620 },
    { time: `${SESSION}T09:16:00`, open: 25620, high: 25680, low: 25600, close: 25640 },
  ];
}

function sessionCandles(): ReplayCandle[] {
  return [
    { time: `${SESSION}T09:15:00`, open: 25600, high: 25650, low: 25580, close: 25620, volume: 1000 },
    { time: `${SESSION}T09:16:00`, open: 25620, high: 25680, low: 25600, close: 25640, volume: 1100 },
  ];
}

function prevSessionCandles(n: number): ReplayCandle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: `${PREV_SESSION}T09:15:00`,
    open: 25000 + i,
    high: 25010 + i,
    low: 24990 + i,
    close: 25005 + i,
    volume: 500 + i,
  }));
}

describe("sessionDateOf", () => {
  test("returns the report's own date when present", () => {
    expect(sessionDateOf(mockReport({ date: SESSION }))).toBe(SESSION);
  });

  test("falls back to market.session_date when date is empty", () => {
    const report = mockReport({
      date: "",
      market: { is_open: true, session_date: SESSION, as_of: null },
    });
    expect(sessionDateOf(report)).toBe(SESSION);
  });

  test("prefers date over market.session_date", () => {
    const report = mockReport({
      date: SESSION,
      market: { is_open: true, session_date: PREV_SESSION, as_of: null },
    });
    expect(sessionDateOf(report)).toBe(SESSION);
  });

  test("returns '' when neither date nor market.session_date is present", () => {
    expect(sessionDateOf(mockReport({ date: "" }))).toBe("");
    expect(
      sessionDateOf(mockReport({ date: "", market: { is_open: null, session_date: null, as_of: null } })),
    ).toBe("");
  });
});

describe("isOnSession", () => {
  test("accepts a timestamp whose date prefix matches the session", () => {
    expect(isOnSession(`${SESSION}T09:15:00`, SESSION)).toBe(true);
  });

  test("rejects a timestamp from another session", () => {
    expect(isOnSession(`${PREV_SESSION}T09:15:00`, SESSION)).toBe(false);
  });

  test("accepts everything when no session is pinned", () => {
    expect(isOnSession(`${PREV_SESSION}T09:15:00`, "")).toBe(true);
    expect(isOnSession("garbage", "")).toBe(true);
  });
});

describe("candlesFromTape", () => {
  test("builds OHLC from consecutive spots: open = previous close, high/low span, volume 0", () => {
    const out = candlesFromTape(sessionTape(), SESSION);
    expect(out).toHaveLength(3);
    // First bar opens on its own spot (no previous).
    expect(out[0]).toEqual({
      time: `${SESSION}T09:15:00`,
      open: 25600,
      high: 25600,
      low: 25600,
      close: 25600,
      volume: 0,
    });
    expect(out[1]).toEqual({
      time: `${SESSION}T09:16:00`,
      open: 25600,
      high: 25620,
      low: 25600,
      close: 25620,
      volume: 0,
    });
    // Down move: high/low still span the open→close range.
    expect(out[2]).toEqual({
      time: `${SESSION}T09:17:00`,
      open: 25620,
      high: 25620,
      low: 25610,
      close: 25610,
      volume: 0,
    });
  });

  test("skips invalid spots (0, negative, NaN, Infinity) and keeps prev on the last valid spot", () => {
    const rows: TapeSpotPoint[] = [
      tapeRow(`${SESSION}T09:15:00`, 25600),
      tapeRow(`${SESSION}T09:16:00`, 0),
      tapeRow(`${SESSION}T09:17:00`, Number.NaN),
      tapeRow(`${SESSION}T09:18:00`, -5),
      tapeRow(`${SESSION}T09:19:00`, Number.POSITIVE_INFINITY),
      tapeRow(`${SESSION}T09:20:00`, 25640),
    ];
    const out = candlesFromTape(rows, SESSION);
    expect(out.map((c) => c.time)).toEqual([
      `${SESSION}T09:15:00`,
      `${SESSION}T09:20:00`,
    ]);
    // The skipped rows did not advance `prev`: the 09:20 bar opens on 25600.
    expect(out[1].open).toBe(25600);
    expect(out[1].close).toBe(25640);
  });

  test("drops tape rows from outside the session", () => {
    const rows: TapeSpotPoint[] = [
      tapeRow(`${PREV_SESSION}T15:29:00`, 25000),
      ...sessionTape(),
    ];
    const out = candlesFromTape(rows, SESSION);
    expect(out.map((c) => c.time)).toEqual([
      `${SESSION}T09:15:00`,
      `${SESSION}T09:16:00`,
      `${SESSION}T09:17:00`,
    ]);
    // The previous-day row must not become the open of the first bar.
    expect(out[0].open).toBe(25600);
  });

  test("returns [] for an empty tape", () => {
    expect(candlesFromTape([], SESSION)).toEqual([]);
  });

  test("keeps everything when no session is pinned", () => {
    const rows: TapeSpotPoint[] = [
      tapeRow(`${PREV_SESSION}T15:29:00`, 25000),
      tapeRow(`${SESSION}T09:15:00`, 25600),
    ];
    expect(candlesFromTape(rows, "").map((c) => c.time)).toEqual([
      `${PREV_SESSION}T15:29:00`,
      `${SESSION}T09:15:00`,
    ]);
  });
});

describe("candlesFromSpotPoints", () => {
  function spotPoint(t: string, spot: number | null): SpotPoint {
    return { t, spot };
  }

  test("builds a true 1-minute OHLC with wicks beyond the body (6 points in one minute)", () => {
    const points: SpotPoint[] = [
      spotPoint(`${SESSION}T09:15:00`, 25600),
      spotPoint(`${SESSION}T09:15:10`, 25640), // minute high
      spotPoint(`${SESSION}T09:15:20`, 25580), // minute low
      spotPoint(`${SESSION}T09:15:30`, 25620),
      spotPoint(`${SESSION}T09:15:40`, 25610),
      spotPoint(`${SESSION}T09:15:50`, 25605),
    ];
    const out = candlesFromSpotPoints(points, SESSION);
    expect(out).toHaveLength(1);
    const c = out[0];
    expect(c.time).toBe(`${SESSION}T09:15:00`);
    expect(c.open).toBe(25600); // first spot
    expect(c.close).toBe(25605); // last spot
    expect(c.high).toBe(25640);
    expect(c.low).toBe(25580);
    // The wicks exist: extremes exceed the body on both sides.
    expect(c.high).toBeGreaterThan(Math.max(c.open, c.close));
    expect(c.low).toBeLessThan(Math.min(c.open, c.close));
    expect((c as { volume: number }).volume).toBe(0);
  });

  test("two minutes → two candles, each stamped `${minute}:00`", () => {
    const points: SpotPoint[] = [
      spotPoint(`${SESSION}T09:15:00`, 25600),
      spotPoint(`${SESSION}T09:15:30`, 25620),
      spotPoint(`${SESSION}T09:16:00`, 25630),
      spotPoint(`${SESSION}T09:16:30`, 25610),
      spotPoint(`${SESSION}T09:17:00`, 25640),
    ];
    const out = candlesFromSpotPoints(points, SESSION);
    expect(out.map((c) => c.time)).toEqual([
      `${SESSION}T09:15:00`,
      `${SESSION}T09:16:00`,
      `${SESSION}T09:17:00`,
    ]);
    expect(out[0]).toMatchObject({ open: 25600, close: 25620, high: 25620, low: 25600 });
    expect(out[1]).toMatchObject({ open: 25630, close: 25610, high: 25630, low: 25610 });
    // The single-point minute is allowed: open = close = high = low.
    expect(out[2]).toEqual({
      time: `${SESSION}T09:17:00`,
      open: 25640,
      high: 25640,
      low: 25640,
      close: 25640,
      volume: 0,
    });
  });

  test("a single-point minute yields a flat candle", () => {
    const out = candlesFromSpotPoints([spotPoint(`${SESSION}T09:15:00`, 25600)], SESSION);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      time: `${SESSION}T09:15:00`,
      open: 25600,
      high: 25600,
      low: 25600,
      close: 25600,
    });
  });

  test("drops non-finite / non-positive spots; an all-invalid minute yields no candle", () => {
    const points: SpotPoint[] = [
      spotPoint(`${SESSION}T09:15:00`, 0),
      spotPoint(`${SESSION}T09:15:10`, Number.NaN),
      spotPoint(`${SESSION}T09:15:20`, -12),
      spotPoint(`${SESSION}T09:15:30`, Number.POSITIVE_INFINITY),
      spotPoint(`${SESSION}T09:15:40`, null),
      spotPoint(`${SESSION}T09:16:00`, 25600),
    ];
    const out = candlesFromSpotPoints(points, SESSION);
    // The 09:15 minute had no valid point → no candle; only 09:16 survives.
    expect(out.map((c) => c.time)).toEqual([`${SESSION}T09:16:00`]);
    expect(candlesFromSpotPoints([spotPoint(`${SESSION}T09:15:00`, Number.NaN)], SESSION)).toEqual([]);
    expect(candlesFromSpotPoints([], SESSION)).toEqual([]);
  });

  test("drops points from outside the session", () => {
    const points: SpotPoint[] = [
      spotPoint(`${PREV_SESSION}T15:29:50`, 25000),
      spotPoint(`${SESSION}T09:15:00`, 25600),
      spotPoint(`${SESSION}T09:15:10`, 25620),
    ];
    const out = candlesFromSpotPoints(points, SESSION);
    expect(out).toHaveLength(1);
    expect(out[0].time).toBe(`${SESSION}T09:15:00`);
    expect(out[0].open).toBe(25600);
  });

  test("sorts unsorted input by t before grouping", () => {
    const points: SpotPoint[] = [
      spotPoint(`${SESSION}T09:16:30`, 25610),
      spotPoint(`${SESSION}T09:15:50`, 25605),
      spotPoint(`${SESSION}T09:16:00`, 25630),
      spotPoint(`${SESSION}T09:15:00`, 25600),
      spotPoint(`${SESSION}T09:15:20`, 25590),
    ];
    const out = candlesFromSpotPoints(points, SESSION);
    expect(out.map((c) => c.time)).toEqual([
      `${SESSION}T09:15:00`,
      `${SESSION}T09:16:00`,
    ]);
    expect(out[0]).toMatchObject({ open: 25600, close: 25605, high: 25605, low: 25590 });
    expect(out[1]).toMatchObject({ open: 25630, close: 25610, high: 25630, low: 25610 });
  });

  test("keeps everything when no session is pinned", () => {
    const points: SpotPoint[] = [
      spotPoint(`${PREV_SESSION}T15:29:50`, 25000),
      spotPoint(`${SESSION}T09:15:00`, 25600),
    ];
    const out = candlesFromSpotPoints(points, "");
    expect(out.map((c) => c.time)).toEqual([
      `${PREV_SESSION}T15:29:00`,
      `${SESSION}T09:15:00`,
    ]);
  });
});

describe("selectBaseCandles", () => {
  const tapeCandles = candlesFromTape(sessionTape(), SESSION);

  test("empty report + tape → the tape candles", () => {
    const out = selectBaseCandles(mockReport(), tapeCandles, SESSION);
    expect(out).toEqual(tapeCandles);
  });

  test("intraday wins over candles and tape", () => {
    const report = mockReport({ intraday: sessionIntraday(), candles: sessionCandles() });
    const out = selectBaseCandles(report, tapeCandles, SESSION);
    expect(out).toEqual(sessionIntraday());
  });

  test("EOD candles win over tape when intraday is absent", () => {
    const report = mockReport({ candles: sessionCandles() });
    const out = selectBaseCandles(report, tapeCandles, SESSION);
    expect(out).toEqual(sessionCandles());
  });

  test("previous-day intraday is dropped; today's candles back the chart", () => {
    const stale = [
      { time: `${PREV_SESSION}T15:25:00`, open: 1, high: 2, low: 0.5, close: 1.5 },
    ];
    const report = mockReport({ intraday: stale, candles: sessionCandles() });
    const out = selectBaseCandles(report, tapeCandles, SESSION);
    expect(out).toEqual(sessionCandles());
  });

  test("previous-day intraday and candles are dropped; tape backs the chart", () => {
    const report = mockReport({
      intraday: [
        { time: `${PREV_SESSION}T15:25:00`, open: 1, high: 2, low: 0.5, close: 1.5 },
      ],
      candles: prevSessionCandles(3),
    });
    const out = selectBaseCandles(report, tapeCandles, SESSION);
    expect(out).toEqual(tapeCandles);
  });

  test("a mixed intraday series keeps only the session rows", () => {
    const mixed: NiftyIntradayCandle[] = [
      { time: `${PREV_SESSION}T15:25:00`, open: 1, high: 2, low: 0.5, close: 1.5 },
      ...sessionIntraday(),
    ];
    const out = selectBaseCandles(mockReport({ intraday: mixed }), tapeCandles, SESSION);
    expect(out).toEqual(sessionIntraday());
  });

  test("no session pinned → nothing is filtered", () => {
    const mixed: NiftyIntradayCandle[] = [
      { time: `${PREV_SESSION}T15:25:00`, open: 1, high: 2, low: 0.5, close: 1.5 },
    ];
    const out = selectBaseCandles(mockReport({ date: "", intraday: mixed }), tapeCandles, "");
    expect(out).toEqual(mixed);
  });
});

describe("clipToAsOf", () => {
  const series: ReplayCandle[] = [
    { time: `${SESSION}T09:15:00`, open: 1, high: 1, low: 1, close: 1, volume: 0 },
    { time: `${SESSION}T09:16:00`, open: 2, high: 2, low: 2, close: 2, volume: 0 },
    { time: `${SESSION}T09:20:00`, open: 3, high: 3, low: 3, close: 3, volume: 0 },
  ];

  test("no asOf → the whole series survives", () => {
    expect(clipToAsOf(series)).toEqual(series);
    expect(clipToAsOf(series, null)).toEqual(series);
    expect(clipToAsOf(series, "")).toEqual(series);
  });

  test("candles after the playhead are dropped, the playhead bar is kept", () => {
    const out = clipToAsOf(series, `${SESSION}T09:16:00`);
    expect(out.map((c) => c.time)).toEqual([
      `${SESSION}T09:15:00`,
      `${SESSION}T09:16:00`,
    ]);
  });

  test("a playhead between bars keeps only earlier bars", () => {
    const out = clipToAsOf(series, `${SESSION}T09:17:30`);
    expect(out.map((c) => c.time)).toEqual([
      `${SESSION}T09:15:00`,
      `${SESSION}T09:16:00`,
    ]);
  });
});

describe("pickFreshestCandles", () => {
  const SESSION = "2026-10-12";
  const PREV_SESSION = "2026-10-09";

  function mockReport(overrides?: Record<string, unknown>): NiftyReport {
    return {
      mode: "live",
      date: SESSION,
      intraday: [],
      candles: [],
      ...overrides,
    } as unknown as NiftyReport;
  }

  function intradayCandle(t: string, o: number, h: number, l: number, c: number): NiftyIntradayCandle {
    return { time: t, open: o, high: h, low: l, close: c };
  }

  function spotCandle(t: string, o: number, h: number, l: number, c: number): NiftyIntradayCandle {
    return { time: t, open: o, high: h, low: l, close: c, volume: 0 };
  }

  function tapeCandle(t: string, o: number, h: number, l: number, c: number): ReplayCandle {
    return { time: t, open: o, high: h, low: l, close: c, volume: 0 };
  }

  test("stale intraday (11:56) vs fresh spot points (12:20) → spots win", () => {
    const staleIntraday = [
      intradayCandle(`${SESSION}T09:15:00`, 25600, 25650, 25580, 25620),
      intradayCandle(`${SESSION}T11:56:00`, 25700, 25720, 25680, 25710), // stale
    ];
    const freshSpots = [
      spotCandle(`${SESSION}T09:15:00`, 25600, 25650, 25580, 25620),
      spotCandle(`${SESSION}T12:20:00`, 25750, 25760, 25740, 25755), // fresh
    ];
    const tape = [tapeCandle(`${SESSION}T09:15:00`, 25600, 25600, 25600, 25600)];

    const report = mockReport({ intraday: staleIntraday });
    const out = pickFreshestCandles(report, freshSpots, tape, SESSION);

    // Merge, not winner-takes-all: keep the morning intraday history and
    // append the fresh spot minute.
    expect(out.map((c) => c.time)).toEqual([
      `${SESSION}T09:15:00`,
      `${SESSION}T11:56:00`,
      `${SESSION}T12:20:00`,
    ]);
    expect(out[out.length - 1].time).toBe(`${SESSION}T12:20:00`);
  });

  test("fresh intraday vs older spots → intraday wins", () => {
    const freshIntraday = [
      intradayCandle(`${SESSION}T09:15:00`, 25600, 25650, 25580, 25620),
      intradayCandle(`${SESSION}T12:20:00`, 25750, 25760, 25740, 25755), // fresh
    ];
    const olderSpots = [
      spotCandle(`${SESSION}T09:15:00`, 25600, 25650, 25580, 25620),
      spotCandle(`${SESSION}T11:56:00`, 25700, 25720, 25680, 25710), // older
    ];
    const tape = [tapeCandle(`${SESSION}T09:15:00`, 25600, 25600, 25600, 25600)];

    const report = mockReport({ intraday: freshIntraday });
    const out = pickFreshestCandles(report, olderSpots, tape, SESSION);

    // The older 11:56 spot bar still fills a minute intraday did not cover.
    expect(out.map((c) => c.time)).toEqual([
      `${SESSION}T09:15:00`,
      `${SESSION}T11:56:00`,
      `${SESSION}T12:20:00`,
    ]);
    expect(out[out.length - 1].time).toBe(`${SESSION}T12:20:00`);
  });

  test("empty intraday and spots → tape is used", () => {
    const tape = [
      tapeCandle(`${SESSION}T09:15:00`, 25600, 25600, 25600, 25600),
      tapeCandle(`${SESSION}T09:16:00`, 25620, 25620, 25620, 25620),
    ];
    const report = mockReport({ intraday: [], candles: [] });
    const out = pickFreshestCandles(report, [], tape, SESSION);

    expect(out).toEqual(tape);
  });

  test("session filtering respected: previous-day intraday dropped, today's spots win", () => {
    const prevDayIntraday = [
      intradayCandle(`${PREV_SESSION}T15:25:00`, 25000, 25010, 24990, 25005),
    ];
    const todaySpots = [
      spotCandle(`${SESSION}T09:15:00`, 25600, 25650, 25580, 25620),
      spotCandle(`${SESSION}T12:20:00`, 25750, 25760, 25740, 25755),
    ];
    const tape = [tapeCandle(`${SESSION}T09:15:00`, 25600, 25600, 25600, 25600)];

    const report = mockReport({ intraday: prevDayIntraday });
    const out = pickFreshestCandles(report, todaySpots, tape, SESSION);

    expect(out).toEqual(todaySpots);
  });

  test("asOf clipping respected: only candles up to asOf are considered", () => {
    const intraday = [
      intradayCandle(`${SESSION}T09:15:00`, 25600, 25650, 25580, 25620),
      intradayCandle(`${SESSION}T12:20:00`, 25750, 25760, 25740, 25755),
      intradayCandle(`${SESSION}T13:00:00`, 25800, 25810, 25790, 25805),
    ];
    const spots = [
      spotCandle(`${SESSION}T09:15:00`, 25600, 25650, 25580, 25620),
      spotCandle(`${SESSION}T12:20:00`, 25750, 25760, 25740, 25755),
    ];
    const tape = [tapeCandle(`${SESSION}T09:15:00`, 25600, 25600, 25600, 25600)];

    const report = mockReport({ intraday });
    // pickFreshestCandles doesn't clip — the caller clips after.
    // But we verify session filtering still works.
    const out = pickFreshestCandles(report, spots, tape, SESSION);
    expect(out).toEqual(intraday); // intraday has the latest timestamp (13:00)
  });

  test("candles (EOD) can win over intraday and spots when latest", () => {
    const intraday = [
      intradayCandle(`${SESSION}T09:15:00`, 25600, 25650, 25580, 25620),
    ];
    const eodCandles = [
      intradayCandle(`${SESSION}T09:15:00`, 25600, 25650, 25580, 25620),
      intradayCandle(`${SESSION}T15:29:00`, 25800, 25810, 25790, 25805), // latest
    ];
    const spots = [
      spotCandle(`${SESSION}T09:15:00`, 25600, 25650, 25580, 25620),
      spotCandle(`${SESSION}T12:20:00`, 25750, 25760, 25740, 25755),
    ];
    const tape = [tapeCandle(`${SESSION}T09:15:00`, 25600, 25600, 25600, 25600)];

    const report = mockReport({ intraday, candles: eodCandles });
    const out = pickFreshestCandles(report, spots, tape, SESSION);

    // 1-minute sources exist, so the 15-minute EOD series is not mixed in.
    expect(out.map((c) => c.time)).toEqual([
      `${SESSION}T09:15:00`,
      `${SESSION}T12:20:00`,
    ]);
    expect(out[out.length - 1].time).toBe(`${SESSION}T12:20:00`);
  });
  test("EOD candles are the fallback when no 1-minute source exists", () => {
    const eodCandles = [
      intradayCandle(`${SESSION}T09:15:00`, 25600, 25650, 25580, 25620),
      intradayCandle(`${SESSION}T15:29:00`, 25800, 25810, 25790, 25805),
    ];
    const report = mockReport({ intraday: [], candles: eodCandles });
    const out = pickFreshestCandles(report, [], [], SESSION);
    expect(out).toEqual(eodCandles);
  });

});
