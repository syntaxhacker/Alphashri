import { describe, expect, it } from "vitest";
import { MARKER_SL, MARKER_TP, NEGATIVE, POSITIVE, PRIMARY } from "@/ui/palette";
import type { ChartCandle, PatternHitDTO, TrendLine } from "@/types/chartPatterns";
import { buildPatternTVData, PATTERN_TV_COLORS, toTVTime } from "./patternTVData";

function candle(t: string, o: number, c: number, v = 1000): ChartCandle {
  return { t, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v };
}

const CANDLES: ChartCandle[] = [
  candle("2026-04-01", 100, 102),
  candle("2026-04-02", 102, 101),
  candle("2026-04-03", 101, 105),
  candle("2026-04-04", 105, 104),
  candle("2026-04-05", 104, 108),
];

function makeHit(overrides: Partial<PatternHitDTO> = {}): PatternHitDTO {
  return {
    id: 1,
    symbol: "IRCON",
    name: "IRCON International Ltd.",
    timeframe: "1D",
    pattern_id: "falling_wedge",
    pattern_name: "Falling Wedge",
    family: "reversal",
    direction: "bullish",
    status: "confirmed",
    quality: "strong",
    confidence: 78.4,
    start_date: "2026-04-01",
    end_date: "2026-04-05",
    start_price: 100,
    end_price: 108,
    breakout_level: 109,
    target: 120,
    stop: 99,
    rr: 1.7,
    bars_ago: 2,
    volume_confirmed: true,
    trendlines: [
      [
        { t: "2026-04-01", price: 103 },
        { t: "2026-04-05", price: 109 },
      ],
      [
        { t: "2026-04-01", price: 99 },
        { t: "2026-04-05", price: 103 },
      ],
    ],
    trend_lines: [
      {
        kind: "support",
        start_date: "2026-04-01",
        start_price: 99,
        end_date: "2026-04-05",
        end_price: 103,
        slope: 1,
        touches: 3,
        span_bars: 5,
        violations: 0,
      },
      {
        kind: "resistance",
        start_date: "2026-04-01",
        start_price: 103,
        end_date: "2026-04-05",
        end_price: 107,
        slope: 1,
        touches: 2,
        span_bars: 5,
        violations: 0,
      },
    ],
    pivots: [
      { t: "2026-04-02", price: 103, kind: "high" },
      { t: "2026-04-03", price: 100, kind: "low" },
    ],
    notes: "",
    ...overrides,
  };
}

describe("buildPatternTVData", () => {
  it("maps candles to epoch seconds sorted ascending with unique times", () => {
    const shuffled: ChartCandle[] = [
      candle("2026-04-03", 105, 101),
      candle("2026-04-01", 100, 102),
      candle("2026-04-02", 102, 101),
      // Duplicate time: last bar wins.
      candle("2026-04-02", 102, 104),
    ];
    const out = buildPatternTVData({ candles: shuffled, hit: null });
    expect(out.candles.map((c) => c.time)).toEqual([
      toTVTime("2026-04-01"),
      toTVTime("2026-04-02"),
      toTVTime("2026-04-03"),
    ]);
    const dup = out.candles.find((c) => c.time === toTVTime("2026-04-02"));
    expect(dup).toMatchObject({ open: 102, close: 104 });
    // Volume follows the same times, coloured by candle direction.
    expect(out.volume.map((v) => v.time)).toEqual(out.candles.map((c) => c.time));
    const up = out.volume.find((v) => v.time === toTVTime("2026-04-01"));
    const down = out.volume.find((v) => v.time === toTVTime("2026-04-03"));
    expect(down).toBeDefined();
    expect(up?.color).not.toBe(down?.color);
  });

  it("emits breakout/target/stop levels with the ECharts colours", () => {
    const out = buildPatternTVData({ candles: CANDLES, hit: makeHit() });
    expect(out.levels).toEqual([
      { price: 99, color: MARKER_SL, title: "Stop", lineStyle: "dashed", width: 1 },
      { price: 109, color: PRIMARY, title: "Breakout", lineStyle: "dashed", width: 1 },
      { price: 120, color: MARKER_TP, title: "Target", lineStyle: "dashed", width: 1 },
    ]);
  });

  it("suppresses zeroed levels (fullscreen re-plan suppression)", () => {
    const out = buildPatternTVData({
      candles: CANDLES,
      hit: makeHit({ breakout_level: 0, target: 0, stop: 0 }),
    });
    expect(out.levels).toEqual([]);
  });

  it("draws the selected pattern solid and siblings dashed", () => {
    const out = buildPatternTVData({
      candles: CANDLES,
      hit: makeHit(),
      overlays: [
        {
          pattern_id: "ascending_channel",
          pattern_name: "Ascending Channel",
          trendlines: [[{ t: "2026-04-02", price: 101 }, { t: "2026-04-04", price: 105 }]],
        },
      ],
      trendLines: [],
    });
    const selected = out.lines.filter((l) => l.name === "Falling Wedge");
    const sibling = out.lines.filter((l) => l.name === "Ascending Channel");
    expect(selected).toHaveLength(2);
    expect(selected.every((l) => !l.dashed && l.width === 2)).toBe(true);
    expect(selected.every((l) => l.color === PATTERN_TV_COLORS[0])).toBe(true);
    expect(sibling).toHaveLength(1);
    expect(sibling[0]).toMatchObject({ dashed: true, width: 1, color: PATTERN_TV_COLORS[1] });
  });

  it("labels only a pattern's first boundary line, and TLS/TLR with touch counts", () => {
    const out = buildPatternTVData({ candles: CANDLES, hit: makeHit() });
    const selected = out.lines.filter((l) => l.name === "Falling Wedge");
    // Both boundaries are drawn, but only one carries the inline end label.
    expect(selected).toHaveLength(2);
    expect(selected.filter((l) => l.labelEligible)).toHaveLength(1);
    expect(selected.find((l) => l.labelEligible)?.label).toBe("Falling Wedge");
    expect(selected.find((l) => !l.labelEligible)?.label).toBeUndefined();

    const tls = out.lines.find((l) => l.name === "TLS");
    expect(tls?.labelEligible).toBe(true);
    expect(tls?.label).toMatch(/^TLS · \d+ touches$/);
  });

  it("skips the overlay that matches the selected pattern instance", () => {
    const out = buildPatternTVData({
      candles: CANDLES,
      hit: makeHit(),
      overlays: [
        {
          pattern_id: "falling_wedge",
          pattern_name: "Falling Wedge",
          start_date: "2026-04-01",
          trendlines: [[{ t: "2026-04-01", price: 103 }, { t: "2026-04-05", price: 109 }]],
        },
      ],
      trendLines: [],
    });
    expect(out.lines.filter((l) => l.dashed)).toHaveLength(0);
  });

  it("gates TLS/TLR standalone lines by trendlinesView", () => {
    const both = buildPatternTVData({ candles: CANDLES, hit: makeHit({ trendlines: [] }) });
    expect(both.lines.map((l) => l.name).sort()).toEqual(["TLR", "TLS"]);

    const support = buildPatternTVData({
      candles: CANDLES,
      hit: makeHit({ trendlines: [] }),
      trendlinesView: "support",
    });
    expect(support.lines.map((l) => l.name)).toEqual(["TLS"]);

    const resistance = buildPatternTVData({
      candles: CANDLES,
      hit: makeHit({ trendlines: [] }),
      trendlinesView: "resistance",
    });
    expect(resistance.lines.map((l) => l.name)).toEqual(["TLR"]);

    const none = buildPatternTVData({
      candles: CANDLES,
      hit: makeHit({ trendlines: [] }),
      trendlinesView: "none",
    });
    expect(none.lines).toEqual([]);
  });

  it("snaps TLS/TLR endpoints to existing candle times as 2-point segments", () => {
    const out = buildPatternTVData({ candles: CANDLES, hit: makeHit({ trendlines: [] }) });
    const candleTimes = new Set(CANDLES.map((c) => toTVTime(c.t)));
    for (const line of out.lines) {
      expect(line.points.length).toBe(2);
      for (const p of line.points) {
        expect(candleTimes.has(p.time)).toBe(true);
        expect(Number.isFinite(p.value)).toBe(true);
      }
    }
    const tls = out.lines.find((l) => l.name === "TLS");
    const tlr = out.lines.find((l) => l.name === "TLR");
    expect(tls?.color).toBe(POSITIVE);
    expect(tlr?.color).toBe(NEGATIVE);
    // Boundary trendline points also snap onto candle times.
    const full = buildPatternTVData({ candles: CANDLES, hit: makeHit(), trendLines: [] });
    for (const line of full.lines) {
      for (const p of line.points) expect(candleTimes.has(p.time)).toBe(true);
    }
  });

  it("drops standalone lines outside the candle window", () => {
    const outside: TrendLine = {
      kind: "support",
      start_date: "2025-01-01",
      start_price: 50,
      end_date: "2025-01-05",
      end_price: 55,
      slope: 1,
      touches: 2,
      span_bars: 5,
      violations: 0,
    };
    const out = buildPatternTVData({
      candles: CANDLES,
      hit: makeHit({ trendlines: [], trend_lines: [outside] }),
    });
    expect(out.lines).toEqual([]);
  });

  it("dedupes a trendline whose endpoints clamp onto the same candle", () => {
    // Both endpoints sit far before the candle window, so both clamp to the
    // nearest (first) candle — lightweight-charts rejects duplicate times.
    const out = buildPatternTVData({
      candles: CANDLES,
      hit: makeHit({
        trendlines: [
          [
            { t: "2020-01-01", price: 100 },
            { t: "2020-01-02", price: 110 },
          ],
        ],
      }),
      trendLines: [],
    });
    expect(out.lines).toHaveLength(1);
    const times = out.lines[0]?.points.map((p) => p.time) ?? [];
    expect(times).toHaveLength(1);
    expect(new Set(times).size).toBe(times.length);
  });

  it("maps pivots to markers: high red arrowDown above, low green arrowUp below", () => {
    const out = buildPatternTVData({ candles: CANDLES, hit: makeHit(), trendLines: [] });
    expect(out.markers).toEqual([
      {
        time: toTVTime("2026-04-02"),
        position: "aboveBar",
        shape: "arrowDown",
        color: NEGATIVE,
        text: "H",
      },
      {
        time: toTVTime("2026-04-03"),
        position: "belowBar",
        shape: "arrowUp",
        color: POSITIVE,
        text: "L",
      },
    ]);
  });

  it("returns empty arrays for empty inputs", () => {
    expect(buildPatternTVData({ candles: [], hit: null })).toEqual({
      candles: [],
      volume: [],
      levels: [],
      lines: [],
      markers: [],
    });
    const noHit = buildPatternTVData({ candles: CANDLES, hit: null });
    expect(noHit.levels).toEqual([]);
    expect(noHit.lines).toEqual([]);
    expect(noHit.markers).toEqual([]);
    expect(noHit.candles).toHaveLength(CANDLES.length);
  });
});
