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
    const support = series.filter((s) => s.name === "TLS");
    const resistance = series.filter((s) => s.name === "TLR");
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
    expect(series.find((s) => s.name === "TLS")?.endLabel?.formatter).toBe(
      "TLS · 3 touches",
    );
    expect(series.find((s) => s.name === "TLR")?.endLabel?.formatter).toBe(
      "TLR · 2 touches",
    );
  });

  it("draws only support lines when the view is support", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: LINES,
      trendlinesView: "support",
    });
    const names = seriesOf(option).map((s) => s.name);
    expect(names).toContain("TLS");
    expect(names).not.toContain("TLR");
    expect(seriesOf(option).some((s) => s.type === "candlestick")).toBe(true);
  });

  it("draws only resistance lines when the view is resistance", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: LINES,
      trendlinesView: "resistance",
    });
    const names = seriesOf(option).map((s) => s.name);
    expect(names).toContain("TLR");
    expect(names).not.toContain("TLS");
  });

  it("draws no standalone lines when the view is none", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: LINES,
      trendlinesView: "none",
    });
    const names = seriesOf(option).map((s) => s.name);
    expect(names).not.toContain("TLS");
    expect(names).not.toContain("TLR");
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
    expect(names).toContain("TLS");
    expect(names).toContain("TLR");
  });

  it("draws standalone lines on compact sparklines (cards) without end labels", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: LINES,
      trendlinesView: "both",
      compact: true,
    });
    const names = seriesOf(option).map((s) => s.name);
    expect(names).toContain("TLS");
    expect(names).toContain("TLR");
    expect(
      seriesOf(option).find((s) => s.name === "TLS")?.endLabel,
    ).toBeUndefined();
  });

  it("interpolates (not the stale start price) when a line starts before the window", () => {
    // Resistance 1728 → 1147 from 2026-02-03 to 2026-09-04; the visible window
    // starts 2026-05-04, so index 0 must carry the line's value at 2026-05-04.
    const line = makeLine({
      kind: "resistance",
      start_date: "2026-02-03",
      start_price: 1728,
      end_date: "2026-05-07T09:15:00+05:30",
      end_price: 1147,
      touches: 2,
    });
    const option = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: [line],
      trendlinesView: "both",
    });
    const resistance = seriesOf(option).find((s) => s.name === "TLR");
    expect(resistance).toBeDefined();
    const data = resistance?.data as Array<number | null>;
    expect(data).toHaveLength(CANDLES.length);
    expect(data[0]).not.toBeNull();
    expect(data[0]).not.toBe(1728);
    const t0 = Date.parse("2026-02-03T00:00:00+05:30");
    const t1 = Date.parse("2026-05-07T09:15:00+05:30");
    const wStart = Date.parse("2026-05-04T09:15:00+05:30");
    const expected = 1728 + ((1147 - 1728) / (t1 - t0)) * (wStart - t0);
    expect(data[0]).toBeCloseTo(expected, 6);
  });

  it("omits a standalone line entirely outside the window", () => {
    const before = makeLine({
      kind: "support",
      start_date: "2026-01-01",
      start_price: 90,
      end_date: "2026-01-02",
      end_price: 91,
    });
    const after = makeLine({
      kind: "resistance",
      start_date: "2026-06-01",
      start_price: 110,
      end_date: "2026-06-02",
      end_price: 111,
    });
    const option = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: [before, after],
      trendlinesView: "both",
    });
    const names = seriesOf(option).map((s) => s.name);
    expect(names).not.toContain("TLS");
    expect(names).not.toContain("TLR");
  });
});

describe("buildPatternChartOption candles are always present", () => {
  it("draws the candlestick series even with no trendlines at all", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: [],
      trendlinesView: "both",
    });
    const series = seriesOf(option);
    const candles = series.filter((s) => s.type === "candlestick");
    expect(candles).toHaveLength(1);
    expect(candles[0].data).toHaveLength(CANDLES.length);
  });

  it("draws the candlestick series when standalone lines are undefined and the hit carries none", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: undefined,
      hit: { symbol: "IRCON", pattern_id: "falling_wedge" } as never,
      trendlinesView: "both",
    });
    const series = seriesOf(option);
    expect(series.filter((s) => s.type === "candlestick")).toHaveLength(1);
    expect(series.map((s) => s.name)).not.toContain("TLS");
    expect(series.map((s) => s.name)).not.toContain("TLR");
  });

  it("names the candle series after the hit symbol, defaulting to Price", () => {
    const named = seriesOf(
      buildPatternChartOption({
        candles: CANDLES,
        hit: { symbol: "IRCON", pattern_id: "falling_wedge" } as never,
      }),
    ).find((s) => s.type === "candlestick");
    expect(named?.name).toBe("IRCON");
    const fallback = seriesOf(
      buildPatternChartOption({ candles: CANDLES }),
    ).find((s) => s.type === "candlestick");
    expect(fallback?.name).toBe("Price");
  });

  it("keeps candle data aligned to input order as [o, c, l, h]", () => {
    const option = buildPatternChartOption({ candles: CANDLES });
    const candles = seriesOf(option).find((s) => s.type === "candlestick");
    expect(candles?.data).toEqual(CANDLES.map((c) => [c.o, c.c, c.l, c.h]));
  });

  it("still emits the candlestick series for empty candles without crashing", () => {
    const option = buildPatternChartOption({
      candles: [],
      standaloneTrendLines: LINES,
      trendlinesView: "both",
    });
    const series = seriesOf(option);
    const candles = series.filter((s) => s.type === "candlestick");
    expect(candles).toHaveLength(1);
    expect(candles[0].data).toEqual([]);
    // No window → no standalone line can map.
    expect(series.map((s) => s.name)).not.toContain("TLS");
    expect(series.map((s) => s.name)).not.toContain("TLR");
  });
});

describe("buildPatternChartOption compact vs large chrome", () => {
  it("hides legend, tooltip, axes and zoom on compact sparklines", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: LINES,
      trendlinesView: "both",
      compact: true,
    });
    expect(option.legend).toBeUndefined();
    expect(option.tooltip).toMatchObject({ show: false });
    expect(option.dataZoom).toBeUndefined();
    expect((option.xAxis as { show?: boolean }).show).toBe(false);
    expect((option.yAxis as { show?: boolean }).show).toBe(false);
    expect(option.grid).toMatchObject({ left: 2, right: 2, top: 6, bottom: 2 });
  });

  it("shows dataZoom only when showZoom is set", () => {
    const without = buildPatternChartOption({ candles: CANDLES });
    expect(without.dataZoom).toBeUndefined();
    const withZoom = buildPatternChartOption({ candles: CANDLES, showZoom: true });
    const zoom = withZoom.dataZoom as Array<{ type?: string }>;
    expect(zoom).toHaveLength(2);
    expect(zoom.map((z) => z.type)).toEqual(["inside", "slider"]);
  });

  it("uses larger fonts, widths and margins when large is set", () => {
    const base = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: LINES,
      trendlinesView: "both",
    });
    const big = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: LINES,
      trendlinesView: "both",
      large: true,
    });
    const baseTls = seriesOf(base).find((s) => s.name === "TLS");
    const bigTls = seriesOf(big).find((s) => s.name === "TLS");
    expect(baseTls?.lineStyle?.width).toBe(1.5);
    expect(bigTls?.lineStyle?.width).toBe(2);
    expect(baseTls?.endLabel?.formatter).toBe("TLS · 3 touches");
    expect(bigTls?.endLabel?.formatter).toBe("TLS · 3 touches");
    expect((base.grid as { left?: number }).left).toBe(54);
    expect((big.grid as { left?: number }).left).toBe(64);
    expect((base.legend as { textStyle?: { fontSize?: number } }).textStyle?.fontSize).toBe(10);
    expect((big.legend as { textStyle?: { fontSize?: number } }).textStyle?.fontSize).toBe(12);
  });

  it("lists TLS/TLR in the legend on full charts but not on compact ones", () => {
    const full = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: LINES,
      trendlinesView: "both",
    });
    expect((full.legend as { data?: string[] }).data).toContain("TLS");
    expect((full.legend as { data?: string[] }).data).toContain("TLR");
    const compact = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: LINES,
      trendlinesView: "both",
      compact: true,
    });
    expect(compact.legend).toBeUndefined();
  });

  it("colours TLS green and TLR red with solid lines above the candles", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: LINES,
      trendlinesView: "both",
    });
    const series = seriesOf(option);
    const tls = series.find((s) => s.name === "TLS");
    const tlr = series.find((s) => s.name === "TLR");
    expect(tls?.lineStyle?.color).toBe(POSITIVE);
    expect(tlr?.lineStyle?.color).toBe(NEGATIVE);
    expect(tls?.lineStyle?.type).toBe("solid");
    expect(tlr?.lineStyle?.type).toBe("solid");
    expect(tls?.z).toBeGreaterThan(1);
  });
});

describe("buildPatternChartOption breakout/target/stop markLines", () => {
  const HIT = {
    symbol: "IRCON",
    pattern_id: "falling_wedge",
    breakout_level: 107,
    target: 119,
    stop: 99,
  } as never;

  interface CandleLike extends SeriesLike {
    markLine?: { data?: Array<{ label?: { formatter?: string; fontSize?: number } }> };
    barMaxWidth?: number;
  }

  function candleOf(option: Record<string, unknown>): CandleLike {
    return (option.series as unknown as CandleLike[]).find((s) => s.type === "candlestick") as CandleLike;
  }

  it("draws Breakout/Target/Stop guides on full charts", () => {
    const option = buildPatternChartOption({ candles: CANDLES, hit: HIT });
    const labels = candleOf(option).markLine?.data?.map((d) => d.label?.formatter);
    expect(labels).toEqual(["Breakout", "Target", "Stop"]);
  });

  it("suppresses all markLines on compact sparklines", () => {
    const option = buildPatternChartOption({ candles: CANDLES, hit: HIT, compact: true });
    expect(candleOf(option).markLine).toBeUndefined();
  });

  it("draws no markLine without a hit or without levels", () => {
    expect(candleOf(buildPatternChartOption({ candles: CANDLES })).markLine).toBeUndefined();
    expect(
      candleOf(
        buildPatternChartOption({
          candles: CANDLES,
          hit: { symbol: "IRCON", pattern_id: "falling_wedge" } as never,
        }),
      ).markLine,
    ).toBeUndefined();
  });

  it("uses larger markLine labels when large is set", () => {
    const base = candleOf(buildPatternChartOption({ candles: CANDLES, hit: HIT }));
    const big = candleOf(buildPatternChartOption({ candles: CANDLES, hit: HIT, large: true }));
    expect(base.markLine?.data?.[0].label?.fontSize).toBe(10);
    expect(big.markLine?.data?.[0].label?.fontSize).toBe(12);
  });
});

describe("buildPatternChartOption degenerate standalone lines", () => {
  it("dot-marks a zero-span (single-point) line instead of drawing nothing", () => {
    const dot = makeLine({
      kind: "support",
      start_date: CANDLES[1].t,
      start_price: 102,
      end_date: CANDLES[1].t,
      end_price: 102,
      touches: 1,
    });
    const option = buildPatternChartOption({
      candles: CANDLES,
      standaloneTrendLines: [dot],
      trendlinesView: "both",
    });
    const tls = seriesOf(option).find((s) => s.name === "TLS") as SeriesLike & {
      showSymbol?: boolean;
      symbol?: string;
      symbolSize?: number;
    };
    expect(tls).toBeDefined();
    expect(tls.showSymbol).toBe(true);
    expect(tls.symbol).toBe("circle");
    expect(tls.symbolSize).toBe(6);
    expect(tls.lineStyle?.type).toBe("solid");
    expect((tls.data as Array<number | null>).filter((v) => v !== null)).toHaveLength(1);
  });
});
