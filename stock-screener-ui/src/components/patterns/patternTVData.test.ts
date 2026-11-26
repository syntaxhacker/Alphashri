import { describe, expect, it } from "vitest";
import { NEGATIVE, POSITIVE, WARNING } from "@/ui/palette";
import type {
  ChartCandle,
  ChartIndicators,
  PatternHitDTO,
  SRZone,
  TrendLine,
} from "@/types/chartPatterns";
import { buildPatternTVData, PATTERN_TV_COLORS, srZoneLabel, toTVTime } from "./patternTVData";
import { TZ_US, toEpochSeconds } from "@/utils/chart/time";
import { INDICATOR_SERIES_META } from "./patternIndicatorData";
import { makeIRCONHit, makeTrendLine } from "./patternTestFixtures";

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
  return makeIRCONHit({
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
      makeTrendLine(),
      makeTrendLine({ kind: "resistance", start_price: 103, end_price: 107, touches: 2 }),
    ],
    pivots: [
      { t: "2026-04-02", price: 103, kind: "high" },
      { t: "2026-04-03", price: 100, kind: "low" },
    ],
    ...overrides,
  });
}

describe("buildPatternTVData", () => {
  it("maps candles to epoch seconds sorted ascending with unique times", () => {
    const shuffled: ChartCandle[] = [
      candle("2026-04-03", 105, 101),
      candle("2026-04-01", 100, 102),
      candle("2026-04-02", 102, 101),
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
    expect(out.volume.map((v) => v.time)).toEqual(out.candles.map((c) => c.time));
    const up = out.volume.find((v) => v.time === toTVTime("2026-04-01"));
    const down = out.volume.find((v) => v.time === toTVTime("2026-04-03"));
    expect(down).toBeDefined();
    expect(up?.color).not.toBe(down?.color);
  });

  it("emits no risk levels (stop/target/breakout are the trader's job)", () => {
    const out = buildPatternTVData({ candles: CANDLES, hit: makeHit() });
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

  it("emits no pattern markers when there are no indicator crosses", () => {
    const out = buildPatternTVData({ candles: CANDLES, hit: makeHit(), trendLines: [] });
    expect(out.markers).toEqual([]);
  });

  it("returns empty arrays for empty inputs", () => {
    expect(buildPatternTVData({ candles: [], hit: null })).toEqual({
      candles: [],
      volume: [],
      levels: [],
      lines: [],
      indicatorLines: [],
      markers: [],
      zones: [],
    });
    const noHit = buildPatternTVData({ candles: CANDLES, hit: null });
    expect(noHit.levels).toEqual([]);
    expect(noHit.lines).toEqual([]);
    expect(noHit.indicatorLines).toEqual([]);
    expect(noHit.markers).toEqual([]);
    expect(noHit.zones).toEqual([]);
    expect(noHit.candles).toHaveLength(CANDLES.length);
  });

  it("pins naive candle times to the supplied market zone, not IST", () => {
    const naive: ChartCandle[] = [
      { t: "2026-11-16T14:49:00", o: 100, h: 101, l: 99, c: 100, v: 1 },
      { t: "2026-11-16T14:50:00", o: 100, h: 101, l: 99, c: 101, v: 1 },
    ];
    const withUs = buildPatternTVData({ candles: naive, hit: null, timeZone: TZ_US });
    expect(withUs.candles.map((c) => c.time)).toEqual([
      Date.UTC(2026, 10, 16, 19, 49, 0) / 1000,
      Date.UTC(2026, 10, 16, 19, 50, 0) / 1000,
    ]);
    // Default remains the IST wall clock — India is byte-identical.
    expect(buildPatternTVData({ candles: naive, hit: null }).candles[0]?.time).toBe(
      toTVTime("2026-11-16T14:49:00"),
    );
  });

  it("honours an explicit US offset regardless of the timeZone prop", () => {
    const offset: ChartCandle[] = [
      { t: "2026-11-16T14:49:00-05:00", o: 100, h: 101, l: 99, c: 100, v: 1 },
    ];
    const expected = Date.UTC(2026, 10, 16, 19, 49, 0) / 1000;
    expect(buildPatternTVData({ candles: offset, hit: null }).candles[0]?.time).toBe(expected);
    expect(buildPatternTVData({ candles: offset, hit: null, timeZone: TZ_US }).candles[0]?.time).toBe(expected);
  });

  it("flags only a partial last candle; completed candles carry no flag", () => {
    const completed = buildPatternTVData({ candles: CANDLES, hit: null });
    expect(completed.candles.every((c) => c.isPartial == null)).toBe(true);

    const last = CANDLES[CANDLES.length - 1]!;
    const withPartial: ChartCandle[] = [
      ...CANDLES.slice(0, -1),
      { ...last, is_partial: true },
    ];
    const out = buildPatternTVData({ candles: withPartial, hit: null });
    expect(out.candles[out.candles.length - 1]?.isPartial).toBe(true);
    expect(out.candles.slice(0, -1).every((c) => c.isPartial == null)).toBe(true);
  });

  it("ignores a stale partial flag on a bar that is no longer the last", () => {
    const stale: ChartCandle[] = [{ ...CANDLES[0]!, is_partial: true }, ...CANDLES.slice(1)];
    const out = buildPatternTVData({ candles: stale, hit: null });
    expect(out.candles.every((c) => c.isPartial == null)).toBe(true);
  });
});

const INDICATORS: ChartIndicators = {
  aligned: "candles",
  timeframe: "1D",
  session: "2026-04-05",
  partial_last: false,
  series: [
    { id: "sma20", values: [100, null, 101, 102, 103] },
    { id: "bbLower", values: [95, 96, 97, 98, 99] },
    { id: "bbUpper", values: [110, 111, 112, 113, 114] },
    { id: "bbMiddle", values: [105, 106, 107, 108, 109] },
  ],
  crosses: [
    { t: "2026-04-03", kind: "golden" },
    { t: "2026-04-04", kind: "death" },
    { t: "2026-04-06", kind: "golden" },
  ],
};

const SR_ZONES: SRZone[] = [
  {
    kind: "support",
    top: 101,
    bottom: 99,
    start_date: "2026-04-02",
    end_date: "2026-04-04",
    touches: 3,
    score: 0.72,
  },
  {
    kind: "resistance",
    top: 120,
    bottom: 110,
    start_date: "2026-04-01",
    end_date: "2026-04-03",
    touches: 2,
    score: 0.55,
  },
];

describe("buildPatternTVData indicator overlays", () => {
  it("maps SMA/BB lines, crosses and zones to exact TV arrays", () => {
    const out = buildPatternTVData({
      candles: CANDLES,
      hit: null,
      indicators: INDICATORS,
      srZones: SR_ZONES,
      timeframe: "1D",
    });

    expect(out.indicatorLines).toEqual([
      {
        points: [
          { time: toTVTime("2026-04-01"), value: 100 },
          { time: toTVTime("2026-04-03"), value: 101 },
          { time: toTVTime("2026-04-04"), value: 102 },
          { time: toTVTime("2026-04-05"), value: 103 },
        ],
        color: INDICATOR_SERIES_META.sma20.color,
        dashed: false,
        lineStyle: "solid",
        width: 1,
        name: "SMA20",
        id: "sma20",
        legendName: "SMA20",
        label: "SMA20",
        labelEligible: true,
      },
      {
        points: [
          { time: toTVTime("2026-04-01"), value: 110 },
          { time: toTVTime("2026-04-02"), value: 111 },
          { time: toTVTime("2026-04-03"), value: 112 },
          { time: toTVTime("2026-04-04"), value: 113 },
          { time: toTVTime("2026-04-05"), value: 114 },
        ],
        color: INDICATOR_SERIES_META.bbUpper.color,
        dashed: true,
        lineStyle: "dashed",
        width: 1,
        name: "BB",
        id: "bbUpper",
        legendName: "BB",
        labelEligible: false,
      },
      {
        points: [
          { time: toTVTime("2026-04-01"), value: 105 },
          { time: toTVTime("2026-04-02"), value: 106 },
          { time: toTVTime("2026-04-03"), value: 107 },
          { time: toTVTime("2026-04-04"), value: 108 },
          { time: toTVTime("2026-04-05"), value: 109 },
        ],
        color: INDICATOR_SERIES_META.bbMiddle.color,
        dashed: true,
        lineStyle: "dashed",
        width: 1,
        name: "BB",
        id: "bbMiddle",
        legendName: "BB",
        label: "BB",
        labelEligible: true,
      },
      {
        points: [
          { time: toTVTime("2026-04-01"), value: 95 },
          { time: toTVTime("2026-04-02"), value: 96 },
          { time: toTVTime("2026-04-03"), value: 97 },
          { time: toTVTime("2026-04-04"), value: 98 },
          { time: toTVTime("2026-04-05"), value: 99 },
        ],
        color: INDICATOR_SERIES_META.bbLower.color,
        dashed: true,
        lineStyle: "dashed",
        width: 1,
        name: "BB",
        id: "bbLower",
        legendName: "BB",
        labelEligible: false,
      },
    ]);

    expect(out.markers).toEqual([
      {
        time: toTVTime("2026-04-03"),
        position: "belowBar",
        shape: "square",
        color: POSITIVE,
        text: "GC",
        group: "crosses",
        legendName: "Crosses",
      },
      {
        time: toTVTime("2026-04-04"),
        position: "aboveBar",
        shape: "square",
        color: NEGATIVE,
        text: "DC",
        group: "crosses",
        legendName: "Crosses",
      },
    ]);

    expect(out.zones).toEqual([
      {
        kind: "support",
        top: 101,
        bottom: 99,
        start: toTVTime("2026-04-02"),
        end: toTVTime("2026-04-05"),
        touches: 3,
        score: 0.72,
        color: POSITIVE,
        legendName: "Support",
      },
      {
        kind: "resistance",
        top: 120,
        bottom: 110,
        start: toTVTime("2026-04-01"),
        end: toTVTime("2026-04-05"),
        touches: 2,
        score: 0.55,
        color: NEGATIVE,
        legendName: "Resistance",
      },
    ]);

    expect(out.levels).toEqual([]);
  });

  it("draws the BB band as three lines sharing one legend name", () => {
    const out = buildPatternTVData({
      candles: CANDLES,
      hit: null,
      indicators: INDICATORS,
      timeframe: "1D",
    });

    const band = out.indicatorLines.filter((line) => line.legendName === "BB");
    expect(band.map((line) => line.id)).toEqual(["bbUpper", "bbMiddle", "bbLower"]);
    expect(band.every((line) => line.name === "BB" && line.lineStyle === "dashed")).toBe(true);
    expect(band.map((line) => line.labelEligible)).toEqual([false, true, false]);
    expect(band.filter((line) => line.labelEligible).map((line) => line.label)).toEqual(["BB"]);
  });

  it("leaves the base result untouched for an empty indicator bundle", () => {
    const base = buildPatternTVData({ candles: CANDLES, hit: makeHit() });
    const empty = buildPatternTVData({
      candles: CANDLES,
      hit: makeHit(),
      indicators: {
        aligned: "candles",
        timeframe: "1D",
        session: "2026-04-05",
        partial_last: false,
        series: [],
        crosses: [],
      },
      srZones: [],
      timeframe: "1D",
    });

    expect(empty).toEqual(base);
  });

  it("drops an indicator bundle built for a different timeframe", () => {
    const out = buildPatternTVData({
      candles: CANDLES,
      hit: null,
      indicators: INDICATORS,
      timeframe: "5m",
    });

    expect(out.indicatorLines).toEqual([]);
    expect(out.markers).toEqual([]);
  });

  it("accepts a bundle on its own minute timeframe", () => {
    const out = buildPatternTVData({
      candles: CANDLES,
      hit: null,
      indicators: { ...INDICATORS, timeframe: "1m" },
      timeframe: "1m",
    });

    expect(out.indicatorLines.length).toBeGreaterThan(0);
  });

  it("rejects a monthly bundle on a minute chart", () => {
    const out = buildPatternTVData({
      candles: CANDLES,
      hit: null,
      indicators: { ...INDICATORS, timeframe: "1M" },
      timeframe: "1m",
    });

    expect(out.indicatorLines).toEqual([]);
  });

  it("trims padded timeframe labels before comparing", () => {
    const out = buildPatternTVData({
      candles: CANDLES,
      hit: null,
      indicators: { ...INDICATORS, timeframe: " 1M " },
      timeframe: "1M",
    });

    expect(out.indicatorLines.length).toBeGreaterThan(0);
  });

  it("rejects a minute bundle on a monthly chart", () => {
    const out = buildPatternTVData({
      candles: CANDLES,
      hit: null,
      indicators: { ...INDICATORS, timeframe: "1m" },
      timeframe: "1M",
    });

    expect(out.indicatorLines).toEqual([]);
  });

  it("formats the compact S/R band labels drawn on the overlay canvas", () => {
    expect(srZoneLabel({ kind: "support", touches: 3 }, "2,480")).toBe("S 2,480 ×3");
    expect(srZoneLabel({ kind: "resistance", touches: 2 }, "2,560")).toBe("R 2,560 ×2");
    expect(srZoneLabel({ kind: "sr", touches: 4 }, "2,500")).toBe("S/R testing");
  });

  it("drops only the touch count from narrow-chart zone labels", () => {
    expect(srZoneLabel({ kind: "support", touches: 12 }, "264.3", true)).toBe("S 264.3");
    expect(srZoneLabel({ kind: "resistance", touches: 2 }, "297.3", true)).toBe("R 297.3");
    expect(srZoneLabel({ kind: "sr", touches: 4 }, "2,500", true)).toBe("S/R testing");
  });

  it("skips a cross on the partial last bar", () => {
    const last = CANDLES[CANDLES.length - 1]!;
    const out = buildPatternTVData({
      candles: [...CANDLES.slice(0, -1), { ...last, is_partial: true }],
      hit: null,
      indicators: {
        ...INDICATORS,
        crosses: [
          { t: "2026-04-04", kind: "golden" },
          { t: "2026-04-05", kind: "death" },
        ],
      },
      timeframe: "1D",
    });

    expect(out.markers.map((marker) => marker.time)).toEqual([toTVTime("2026-04-04")]);
  });
});

const LAST_CANDLE_TIME = toTVTime("2026-04-05");

function srZone(overrides: Partial<SRZone> = {}): SRZone {
  return {
    kind: "support",
    top: 102,
    bottom: 99,
    start_date: "2026-04-02",
    end_date: "2026-04-04",
    touches: 3,
    score: 0.5,
    ...overrides,
  };
}

describe("buildPatternTVData zone display selection", () => {
  it("keeps one support and one resistance, picks the higher score, and ends both at the last candle", () => {
    // Zones arrive score-descending per side; a lower-ranked same-kind zone must not draw.
    const out = buildPatternTVData({
      candles: CANDLES,
      hit: null,
      srZones: [
        srZone({
          kind: "resistance",
          top: 130,
          bottom: 128,
          start_date: "2026-04-01",
          end_date: "2026-04-02",
          touches: 4,
          score: 0.9,
        }),
        srZone({ score: 0.8 }),
        srZone({
          top: 98,
          bottom: 95,
          start_date: "2026-04-03",
          end_date: "2026-04-04",
          touches: 2,
          score: 0.4,
        }),
        srZone({
          kind: "resistance",
          top: 140,
          bottom: 138,
          start_date: "2026-04-03",
          end_date: "2026-04-04",
          touches: 1,
          score: 0.3,
        }),
      ],
    });

    expect(out.zones).toEqual([
      {
        kind: "support",
        top: 102,
        bottom: 99,
        start: toTVTime("2026-04-02"),
        end: LAST_CANDLE_TIME,
        touches: 3,
        score: 0.8,
        color: POSITIVE,
        legendName: "Support",
      },
      {
        kind: "resistance",
        top: 130,
        bottom: 128,
        start: toTVTime("2026-04-01"),
        end: LAST_CANDLE_TIME,
        touches: 4,
        score: 0.9,
        color: NEGATIVE,
        legendName: "Resistance",
      },
    ]);
  });

  it("falls back to the top sr zone when no sided zone survives alignment", () => {
    const out = buildPatternTVData({
      candles: CANDLES,
      hit: null,
      srZones: [
        srZone({
          kind: "sr",
          top: 106,
          bottom: 104,
          start_date: "2026-04-01",
          end_date: "2026-04-02",
          touches: 4,
          score: 0.6,
        }),
      ],
    });

    expect(out.zones).toEqual([
      {
        kind: "sr",
        top: 106,
        bottom: 104,
        start: toTVTime("2026-04-01"),
        end: LAST_CANDLE_TIME,
        touches: 4,
        score: 0.6,
        color: WARNING,
        legendName: "S/R",
      },
    ]);
  });

  it("does not add an sr band when a support is already shown", () => {
    const out = buildPatternTVData({
      candles: CANDLES,
      hit: null,
      srZones: [
        srZone({ score: 0.8 }),
        srZone({
          kind: "sr",
          top: 106,
          bottom: 104,
          start_date: "2026-04-01",
          end_date: "2026-04-03",
          touches: 5,
          score: 0.95,
        }),
      ],
    });

    expect(out.zones.map((zone) => zone.kind)).toEqual(["support"]);
    expect(out.zones).toHaveLength(1);
  });

  it("ends the band on a partial last candle while keeping its first-touch start", () => {
    const last = CANDLES[CANDLES.length - 1]!;
    const out = buildPatternTVData({
      candles: [...CANDLES.slice(0, -1), { ...last, is_partial: true }],
      hit: null,
      srZones: [srZone({ start_date: "2026-04-02", end_date: "2026-04-03" })],
    });

    expect(out.zones).toHaveLength(1);
    expect(out.zones[0]?.start).toBe(toTVTime("2026-04-02"));
    expect(out.zones[0]?.end).toBe(toEpochSeconds(last.t));
  });
});
