import { describe, expect, test } from "vitest";
import {
  buildPatternOverlay,
  buildPatternScanAnnotation,
  epochSeconds,
  patternNoHitLabel,
  type PatternHitLike,
} from "./niftyPatternOverlay";
import * as palette from "@/ui/palette";

/** 5 one-minute candles, 10:46 → 10:50 IST. */
const CANDLES = [
  { time: "2026-10-26T10:46:00+05:30" },
  { time: "2026-10-26T10:47:00+05:30" },
  { time: "2026-10-26T10:48:00+05:30" },
  { time: "2026-10-26T10:49:00+05:30" },
  { time: "2026-10-26T10:50:00+05:30" },
];

/** The same instants as the detector emits them (UTC). */
const HIT: PatternHitLike = {
  pattern_id: "descending_channel",
  pattern_name: "Descending Channel",
  direction: "bearish",
  status: "confirmed",
  breakout_level: 22579.49,
  target: 22526.28,
  stop: 22601.21,
  trendlines: [
    [
      { t: "2026-10-26T05:16:00+00:00", price: 22640 },
      { t: "2026-10-26T05:18:00+00:00", price: 22620 },
      { t: "2026-10-26T05:20:00+00:00", price: 22600 },
    ],
    [
      { t: "2026-10-26T05:16:00+00:00", price: 22590 },
      { t: "2026-10-26T05:20:00+00:00", price: 22580 },
    ],
  ],
};

describe("epochSeconds", () => {
  test("treats a timestamp without an offset as IST", () => {
    expect(epochSeconds("2026-10-26T10:46:00+05:30")).toBe(epochSeconds("2026-10-26 10:46:00"));
    expect(epochSeconds("2026-10-26T05:16:00+00:00")).toBe(epochSeconds("2026-10-26T10:46:00+05:30"));
  });
});

describe("buildPatternOverlay", () => {
  test("draws both trendlines across the pattern window only", () => {
    const out = buildPatternOverlay(HIT, CANDLES);
    expect(out.lines).toHaveLength(2);
    expect(out.lines[0].data).toEqual([22640, 22630, 22620, 22610, 22600]);
    expect(out.lines[1].data).toEqual([22590, 22587.5, 22585, 22582.5, 22580]);
    expect(out.lines[0].color).toBe(palette.NEGATIVE);
  });

  test("leaves candles outside the pattern null", () => {
    const hit: PatternHitLike = {
      ...HIT,
      trendlines: [[
        { t: "2026-10-26T05:17:00+00:00", price: 22635 },
        { t: "2026-10-26T05:19:00+00:00", price: 22615 },
      ]],
    };
    const out = buildPatternOverlay(hit, CANDLES);
    expect(out.lines[0].data).toEqual([null, 22635, 22625, 22615, null]);
  });

  test("draws breakout, target and stop for a confirmed pattern", () => {
    const out = buildPatternOverlay(HIT, CANDLES);
    expect(out.markLines.map((l) => l.yAxis)).toEqual([22579.49, 22526.28, 22601.21]);
    expect(out.markLines[0].label.formatter).toBe("P▸BRK 22,579");
    expect(out.markLines[1].lineStyle.type).toBe("dashed");
    expect(out.markLines[2].lineStyle.color).toBe(palette.POSITIVE);
    expect(out.markLines[0].includeInScale).toBe(true);
    expect(out.markLines[1].includeInScale).toBe(false);
    expect(out.markLines[2].includeInScale).toBe(true);
  });

  test("a failed pattern keeps the rails but drops target/stop", () => {
    const out = buildPatternOverlay({ ...HIT, status: "failed" }, CANDLES);
    expect(out.lines).toHaveLength(2);
    expect(out.markLines.map((l) => l.yAxis)).toEqual([22579.49]);
  });

  test("skips a rail whose timestamps do not land on the chart", () => {
    const hit: PatternHitLike = {
      ...HIT,
      trendlines: [[
        { t: "2026-10-26T05:56:00+00:00", price: 22640 }, // 10:56 IST, 6 min past the last bar
        { t: "2026-10-26T06:00:00+00:00", price: 22600 },
      ]],
    };
    expect(buildPatternOverlay(hit, CANDLES).lines).toEqual([]);
  });

  test("returns nothing without candles", () => {
    expect(buildPatternOverlay(HIT, [])).toEqual({ lines: [], markLines: [] });
  });
});

describe("buildPatternScanAnnotation", () => {
  const bars = [
    { time: "2026-10-26T10:48:00+05:30", close: 22580 },
    { time: "2026-10-26T10:49:00+05:30", close: 22585 },
    { time: "2026-10-26T10:50:00+05:30", close: 22590 },
  ];
  const args = { candles: bars, timeframe: "1m", lookbackBars: 150, markerColor: palette.TEXT_MUTED };

  test("a no-result scan annotates the last chart bar without inventing a level", () => {
    const out = buildPatternScanAnnotation({ ...args, hitCount: 0 });
    expect(out).not.toBeNull();
    expect(out!.marker).toMatchObject({
      time: bars[bars.length - 1].time,
      value: 22590,
      shape: "circle",
      color: palette.TEXT_MUTED,
      text: "",
    });
    expect(out!.label).toBe(patternNoHitLabel("1m", 150));
    expect(out!.label).toMatch(/no pattern/i);
    expect(out!.label).toMatch(/150/);
  });

  test("a hit gets no scan annotation — the real pattern overlay owns the marks", () => {
    expect(buildPatternScanAnnotation({ ...args, hitCount: 1 })).toBeNull();
  });

  test("no chart bars means no annotation", () => {
    expect(buildPatternScanAnnotation({ ...args, candles: [], hitCount: 0 })).toBeNull();
  });
});
