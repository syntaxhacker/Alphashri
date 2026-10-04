import { describe, expect, it } from "vitest";
import type { ChartCandle, TrendLine } from "@/types/chartPatterns";
import { NEGATIVE, POSITIVE } from "@/ui/palette";
import { buildPatternChartOption } from "./patternChartOption";

const CANDLES: ChartCandle[] = [
  { t: "2026-05-04T09:15:00+05:30", o: 100, h: 104, l: 99, c: 103, v: 1000 },
  { t: "2026-05-05T09:15:00+05:30", o: 103, h: 106, l: 102, c: 105, v: 1100 },
  { t: "2026-05-06T09:15:00+05:30", o: 105, h: 107, l: 101, c: 102, v: 900 },
  { t: "2026-05-07T09:15:00+05:30", o: 102, h: 108, l: 100, c: 107, v: 1200 },
];

function makeLine(overrides: Partial<TrendLine> = {}): TrendLine {
  return {
    kind: "support",
    start_date: "2026-05-04T09:15:00+05:30",
    start_price: 99,
    end_date: "2026-05-07T09:15:00+05:30",
    end_price: 100,
    slope: 0.01,
    touches: 3,
    span_bars: 4,
    violations: 0,
    ...overrides,
  };
}

const LINES: TrendLine[] = [
  makeLine({ kind: "support", touches: 3 }),
  makeLine({ kind: "resistance", start_price: 108, end_price: 109, touches: 2 }),
];

interface SeriesLike {
  type?: string;
  name?: string;
  data?: unknown[];
  silent?: boolean;
  lineStyle?: { color?: string; type?: string; width?: number };
  endLabel?: { formatter?: string };
  z?: number;
}

function seriesOf(option: Record<string, unknown>): SeriesLike[] {
  return option.series as unknown as SeriesLike[];
}

describe("buildPatternChartOption standalone trendlines", () => {
  it("draws support + resistance series when the view is both", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: LINES,
      trendlinesView: "both",
    });
    const series = seriesOf(option);
    const support = series.filter((s) => s.name === "Support");
    const resistance = series.filter((s) => s.name === "Resistance");
    expect(support).toHaveLength(1);
    expect(resistance).toHaveLength(1);
    expect(support[0].lineStyle?.color).toBe(POSITIVE);
    expect(resistance[0].lineStyle?.color).toBe(NEGATIVE);
    expect(support[0].lineStyle?.type).toBe("solid");
    expect(support[0].silent).toBe(true);
    expect(support[0].z).toBeGreaterThan(1);
    // Candles are always present.
    expect(series.some((s) => s.type === "candlestick")).toBe(true);
  });

  it("labels each line with its touch count", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: LINES,
      trendlinesView: "both",
    });
    const series = seriesOf(option);
    expect(series.find((s) => s.name === "Support")?.endLabel?.formatter).toBe(
      "Support · 3 touches",
    );
    expect(series.find((s) => s.name === "Resistance")?.endLabel?.formatter).toBe(
      "Resistance · 2 touches",
    );
  });

  it("draws only support lines when the view is support", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: LINES,
      trendlinesView: "support",
    });
    const names = seriesOf(option).map((s) => s.name);
    expect(names).toContain("Support");
    expect(names).not.toContain("Resistance");
    expect(seriesOf(option).some((s) => s.type === "candlestick")).toBe(true);
  });

  it("draws only resistance lines when the view is resistance", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: LINES,
      trendlinesView: "resistance",
    });
    const names = seriesOf(option).map((s) => s.name);
    expect(names).toContain("Resistance");
    expect(names).not.toContain("Support");
  });

  it("draws no standalone lines when the view is none", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: LINES,
      trendlinesView: "none",
    });
    const names = seriesOf(option).map((s) => s.name);
    expect(names).not.toContain("Support");
    expect(names).not.toContain("Resistance");
    // …but the candles are still drawn.
    expect(seriesOf(option).some((s) => s.type === "candlestick")).toBe(true);
  });

  it("reads the hit's trend_lines when no explicit lines are passed", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: {
        symbol: "IRCON",
        pattern_id: "falling_wedge",
        trend_lines: LINES,
      } as never,
      trendlinesView: "both",
    });
    const names = seriesOf(option).map((s) => s.name);
    expect(names).toContain("Support");
    expect(names).toContain("Resistance");
  });

  it("draws standalone lines on compact sparklines (cards) without end labels", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: LINES,
      trendlinesView: "both",
      compact: true,
    });
    const names = seriesOf(option).map((s) => s.name);
    expect(names).toContain("Support");
    expect(names).toContain("Resistance");
    expect(
      seriesOf(option).find((s) => s.name === "Support")?.endLabel,
    ).toBeUndefined();
  });
});
