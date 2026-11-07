import { describe, expect, test } from "vitest";
import type { NiftyIntradayCandle } from "@/types/niftyReport";
import { MAX_FILL_GAP_MINUTES, fillCandleGaps } from "./niftyCandles";

function candle(
  time: string,
  close: number,
  overrides: Partial<NiftyIntradayCandle> = {},
): NiftyIntradayCandle {
  return {
    time,
    open: close,
    high: close + 5,
    low: close - 5,
    close,
    ...overrides,
  };
}

function at(
  hhmm: string,
  close: number,
  overrides: Partial<NiftyIntradayCandle> = {},
): NiftyIntradayCandle {
  return candle(`2026-11-03T${hhmm}:00+05:30`, close, overrides);
}

describe("fillCandleGaps", () => {
  test("drops a poisoned bar and fills the missing minutes from the tape", () => {
    // 09:15 valid, 09:16 poisoned (close 0), 09:20 valid — a five-minute hole
    // with the tape carrying the middle minutes.
    const candles = [
      at("09:15", 23_700),
      at("09:16", 0, { open: 23_720, high: 23_725, low: 0 }),
      at("09:20", 23_705),
    ];
    const tape = [
      { t: "09:16", spot: 23_695 },
      { t: "09:17", spot: 23_698 },
      { t: "09:18", spot: 23_700 },
      { t: "09:19", spot: 23_702 },
    ];

    const out = fillCandleGaps(candles, { tape });

    expect(out.map((c) => c.time)).toEqual([
      "2026-11-03T09:15:00+05:30",
      "2026-11-03T09:16:00+05:30",
      "2026-11-03T09:17:00+05:30",
      "2026-11-03T09:18:00+05:30",
      "2026-11-03T09:19:00+05:30",
      "2026-11-03T09:20:00+05:30",
    ]);
    // filled bars are flat and volume-less
    expect(out[1]).toMatchObject({
      open: 23_695,
      high: 23_695,
      low: 23_695,
      close: 23_695,
      volume: 0,
    });
    // the poisoned bar never reaches the chart
    expect(out.some((c) => c.close === 0)).toBe(false);
    // no giant range: the whole session stays inside a sane band
    const low = Math.min(...out.map((c) => c.low));
    const high = Math.max(...out.map((c) => c.high));
    expect(high - low).toBeLessThan(50);
  });

  test("leaves the hole alone when the tape has no spot for it", () => {
    const out = fillCandleGaps([at("09:15", 23_700), at("09:20", 23_705)], {
      tape: [{ t: "09:17", spot: 0 }],
    });
    expect(out.map((c) => c.time)).toEqual([
      "2026-11-03T09:15:00+05:30",
      "2026-11-03T09:20:00+05:30",
    ]);
  });

  test("never bridges a day/context change", () => {
    const out = fillCandleGaps(
      [
        candle("2026-11-02T15:28:00+05:30", 23_900),
        candle("2026-11-03T09:15:00+05:30", 23_700),
      ],
      { tape: [{ t: "15:29", spot: 23_901 }] },
    );
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.time)).toEqual([
      "2026-11-02T15:28:00+05:30",
      "2026-11-03T09:15:00+05:30",
    ]);
  });

  test("a gap wider than one session is a context break, not a hole", () => {
    const out = fillCandleGaps([at("09:15", 23_700), at("15:30", 23_705)], {
      tape: [{ t: "09:16", spot: 23_701 }],
      maxGapMinutes: MAX_FILL_GAP_MINUTES,
    });
    // The 375-minute session gap is treated as a hole, so the tape-backed
    // 09:16 minute is inserted (09:15 → 09:16 → 15:30). Only minutes the tape
    // can price are filled — the rest stays a hole.
    expect(out.map((c) => c.time)).toEqual([
      "2026-11-03T09:15:00+05:30",
      "2026-11-03T09:16:00+05:30",
      "2026-11-03T15:30:00+05:30",
    ]);
    const far = fillCandleGaps([at("09:15", 23_700), at("15:30", 23_705)], {
      tape: [{ t: "09:16", spot: 23_701 }],
      maxGapMinutes: 100,
    });
    // Beyond the cap the same gap is a context break: nothing is inserted.
    expect(far).toHaveLength(2);
  });

  test("repairs non-finite OHLC from the close and keeps a valid volume", () => {
    const out = fillCandleGaps([
      candle("2026-11-03T09:15:00+05:30", 23_700, {
        open: Number.NaN,
        high: Number.NaN,
        low: 0,
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      open: 23_700,
      high: 23_700,
      low: 23_700,
      close: 23_700,
      volume: 0,
    });
  });

  test("keeps the last write for a duplicated minute", () => {
    const out = fillCandleGaps([
      at("09:15", 23_700),
      at("09:15", 23_710),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].close).toBe(23_710);
  });
});
