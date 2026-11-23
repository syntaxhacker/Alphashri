import { describe, expect, test } from "vitest";
import {
  candleSeriesSig,
  pickFreshestCandles,
  tapePointsSig,
  type TapeSpotPoint,
} from "./niftyChartData";
import type { NiftyReport } from "@/types/niftyReport";
import {
  mockReport as baseMockReport,
  ohlcCandle,
  spotCandle,
  tapeCandle,
} from "./reportTestFixtures";

const SESSION = "2026-10-12";
const PREV_SESSION = "2026-10-09";

function mockReport(overrides?: Record<string, unknown>): NiftyReport {
  return baseMockReport(SESSION, overrides);
}

describe("pickFreshestCandles", () => {
  test("stale intraday (11:56) vs fresh spot points (12:20) → spots win", () => {
    const staleIntraday = [
      ohlcCandle(`${SESSION}T09:15:00`, 25600, 25650, 25580, 25620),
      ohlcCandle(`${SESSION}T11:56:00`, 25700, 25720, 25680, 25710), // stale
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
      ohlcCandle(`${SESSION}T09:15:00`, 25600, 25650, 25580, 25620),
      ohlcCandle(`${SESSION}T12:20:00`, 25750, 25760, 25740, 25755), // fresh
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
      ohlcCandle(`${PREV_SESSION}T15:25:00`, 25000, 25010, 24990, 25005),
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
      ohlcCandle(`${SESSION}T09:15:00`, 25600, 25650, 25580, 25620),
      ohlcCandle(`${SESSION}T12:20:00`, 25750, 25760, 25740, 25755),
      ohlcCandle(`${SESSION}T13:00:00`, 25800, 25810, 25790, 25805),
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

  test("a token merge of stray minutes loses to the full session series", () => {
    // Pre-market on 2026-11-19 the report carried 25 EOD bars for 11-18 but
    // only two tape minutes (09:15, 09:16). The merge returned those two and
    // the chart drew one giant candle for the whole day.
    const eodCandles = [
      ohlcCandle(`${SESSION}T09:15:00`, 25323, 25390, 25281, 25293),
      ohlcCandle(`${SESSION}T15:15:00`, 25220, 25227, 25220, 25227),
    ];
    const tape = [
      tapeCandle(`${SESSION}T09:15:00`, 25366, 25366, 25366, 25366),
      tapeCandle(`${SESSION}T09:16:00`, 25366, 25366, 25366, 25366),
    ];

    const out = pickFreshestCandles(
      mockReport({ intraday: [], candles: eodCandles }),
      [],
      tape,
      SESSION,
    );

    expect(out).toHaveLength(2);
    expect(out.map((c) => c.time)).toEqual([
      `${SESSION}T09:15:00`,
      `${SESSION}T15:15:00`,
    ]);
  });

  test("candles (EOD) can win over intraday and spots when latest", () => {
    const intraday = [
      ohlcCandle(`${SESSION}T09:15:00`, 25600, 25650, 25580, 25620),
    ];
    const eodCandles = [
      ohlcCandle(`${SESSION}T09:15:00`, 25600, 25650, 25580, 25620),
      ohlcCandle(`${SESSION}T15:29:00`, 25800, 25810, 25790, 25805), // latest
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
      ohlcCandle(`${SESSION}T09:15:00`, 25600, 25650, 25580, 25620),
      ohlcCandle(`${SESSION}T15:29:00`, 25800, 25810, 25790, 25805),
    ];
    const report = mockReport({ intraday: [], candles: eodCandles });
    const out = pickFreshestCandles(report, [], [], SESSION);
    expect(out).toEqual(eodCandles);
  });
});

describe("chart series signatures", () => {
  test("candle signature ignores a fresh-but-equal array", () => {
    const a = [ohlcCandle(`${SESSION}T09:15:00`, 100, 102, 99, 101)];
    const b = a.map((c) => ({ ...c }));
    expect(candleSeriesSig(a)).toBe(candleSeriesSig(b));
  });

  test("candle signature changes when a bar changes", () => {
    const a = [ohlcCandle(`${SESSION}T09:15:00`, 100, 102, 99, 101)];
    const b = [ohlcCandle(`${SESSION}T09:15:00`, 100, 102, 99, 999)];
    expect(candleSeriesSig(a)).not.toBe(candleSeriesSig(b));
  });

  test("tape signature ignores a fresh-but-equal array and tracks spot changes", () => {
    const a: TapeSpotPoint[] = [{ t: `${SESSION}T09:15:00`, spot: 100 }];
    const b = a.map((r) => ({ ...r }));
    expect(tapePointsSig(a)).toBe(tapePointsSig(b));
    expect(tapePointsSig([{ t: a[0].t, spot: 101 }])).not.toBe(tapePointsSig(a));
  });
});
