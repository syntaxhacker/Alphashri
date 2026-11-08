// Test-only shared fixtures for the pattern component tests.
import { expect } from "vitest";
import type { ChartCandle, PatternHitDTO } from "@/types/chartPatterns";
import { buildPatternChartOption } from "./patternChartOption";

export const IST_CANDLES: ChartCandle[] = [
  { t: "2026-05-04T09:15:00+05:30", o: 100, h: 104, l: 99, c: 103, v: 1000 },
  { t: "2026-05-05T09:15:00+05:30", o: 103, h: 106, l: 102, c: 105, v: 1100 },
  { t: "2026-05-06T09:15:00+05:30", o: 105, h: 107, l: 101, c: 102, v: 900 },
  { t: "2026-05-07T09:15:00+05:30", o: 102, h: 108, l: 100, c: 107, v: 1200 },
];

export const UTC_CANDLES: ChartCandle[] = [
  { t: "2026-05-04T18:30:00+00:00", o: 100, h: 104, l: 99, c: 103, v: 1000 },
  { t: "2026-05-05T18:30:00+00:00", o: 103, h: 106, l: 102, c: 105, v: 1100 },
  { t: "2026-05-06T18:30:00+00:00", o: 105, h: 107, l: 101, c: 102, v: 900 },
  { t: "2026-05-07T18:30:00+00:00", o: 102, h: 108, l: 100, c: 107, v: 1200 },
];

export type PatternPivot = NonNullable<PatternHitDTO["pivots"]>[number];

export function makePivot(t: string, price: number, kind: "high" | "low"): PatternPivot {
  return { t, price, kind };
}

export function makePatternHit(overrides: Partial<PatternHitDTO> = {}): PatternHitDTO {
  return {
    id: 1,
    symbol: "TEST",
    name: null,
    timeframe: "1D",
    pattern_id: "falling_wedge",
    pattern_name: "Falling Wedge",
    family: "reversal",
    direction: "bullish",
    status: "confirmed",
    quality: "strong",
    confidence: 80,
    start_date: "2026-01-01",
    end_date: "2026-02-01",
    start_price: 100,
    end_price: 110,
    breakout_level: 110,
    target: 120,
    stop: 95,
    rr: 2,
    bars_ago: 1,
    volume_confirmed: true,
    trendlines: [],
    notes: "",
    pivots: [],
    ...overrides,
  };
}

const CHART_HIT = {
  symbol: "IRCON",
  name: "IRCON International Ltd.",
  confidence: 78.4,
  start_date: "2026-05-04",
  end_date: "2026-05-07",
  end_price: 107,
  breakout_level: 107,
  target: 119,
  stop: 99,
  rr: 1.7,
} as const;

export const IST_HIT: PatternHitDTO = makePatternHit({
  ...CHART_HIT,
  pivots: [
    makePivot("2026-05-04T09:15:00+05:30", 104, "high"),
    makePivot("2026-05-06T09:15:00+05:30", 101, "low"),
  ],
});

export const UTC_HIT: PatternHitDTO = makePatternHit({
  ...CHART_HIT,
  pivots: [
    makePivot("2026-05-04T18:30:00+00:00", 104, "high"),
    makePivot("2026-05-06T18:30:00+00:00", 101, "low"),
  ],
});

export function seriesOf<T>(option: Record<string, unknown>): T[] {
  return option.series as unknown as T[];
}

export function expectCompactPivotMarkersOmitted(candles: ChartCandle[], hit: PatternHitDTO): void {
  const names = seriesOf<{ name?: string }>(
    buildPatternChartOption({ candles, hit, compact: true }),
  ).map((s) => s.name);
  expect(names).not.toContain("Pivot High");
  expect(names).not.toContain("Pivot Low");
}
