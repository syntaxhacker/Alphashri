import { describe, expect, it } from "vitest";
import type { ChartCandle, PatternHitDTO, Trendline } from "@/types/chartPatterns";
import { NEGATIVE, POSITIVE } from "@/ui/palette";
import { PATTERN_SERIES_COLORS } from "@/config/patterns";
import { buildPatternChartOption, type SiblingOverlay } from "./patternChartOption";

const CANDLES: ChartCandle[] = [
  { t: "2026-05-04T09:15:00+05:30", o: 100, h: 104, l: 99, c: 103, v: 1000 },
  { t: "2026-05-05T09:15:00+05:30", o: 103, h: 106, l: 102, c: 105, v: 1100 },
  { t: "2026-05-06T09:15:00+05:30", o: 105, h: 107, l: 101, c: 102, v: 900 },
  { t: "2026-05-07T09:15:00+05:30", o: 102, h: 108, l: 100, c: 107, v: 1200 },
];

const HIT = {
  symbol: "IRCON",
  pattern_id: "falling_wedge",
  pattern_name: "Falling Wedge",
  start_date: "2026-05-04",
  breakout_level: 107,
  target: 119,
  stop: 99,
  pivots: [
    { t: "2026-05-04T09:15:00+05:30", price: 104, kind: "high" },
    { t: "2026-05-06T09:15:00+05:30", price: 101, kind: "low" },
  ],
} as unknown as PatternHitDTO;

function boundary(price: number, endPrice?: number): Trendline {
  return [
    { t: CANDLES[0].t, price },
    { t: CANDLES[CANDLES.length - 1].t, price: endPrice ?? price + 3 },
  ];
}

function overlay(
  patternId: string,
  patternName: string,
  extra: Partial<SiblingOverlay> = {},
): SiblingOverlay {
  return {
    pattern_id: patternId,
    pattern_name: patternName,
    trendlines: [boundary(101)],
    ...extra,
  };
}

interface SeriesLike {
  type?: string;
  name?: string;
  data?: unknown[];
  showSymbol?: boolean;
  symbol?: string;
  symbolSize?: number;
  symbolRotate?: number;
  silent?: boolean;
  itemStyle?: { color?: string };
  lineStyle?: { color?: string; type?: string; width?: number; opacity?: number };
  endLabel?: { formatter?: string; fontSize?: number };
  labelLayout?: { hideOverlap?: boolean };
  markLine?: { data?: Array<{ label?: { formatter?: string } }> };
  z?: number;
}

function seriesOf(option: Record<string, unknown>): SeriesLike[] {
  return option.series as unknown as SeriesLike[];
}

function legendOf(option: Record<string, unknown>): string[] {
  return ((option.legend as { data?: string[] } | undefined)?.data ?? []) as string[];
}

describe("buildPatternChartOption candles are always present", () => {
  it("emits the candlestick series alongside overlay groups", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      trendlines: [boundary(104)],
      overlays: [overlay("rising_wedge", "Rising Wedge", { start_date: "2026-05-06" })],
    });
    const candles = seriesOf(option).filter((s) => s.type === "candlestick");
    expect(candles).toHaveLength(1);
    expect(candles[0].data).toHaveLength(CANDLES.length);
  });

  it("emits only the candlestick series when trendlines/overlays are undefined", () => {
    const option = buildPatternChartOption({ candles: CANDLES, hit: HIT });
    expect(seriesOf(option).filter((s) => s.type === "candlestick")).toHaveLength(1);
    expect(seriesOf(option)).toHaveLength(3); // candles + 2 pivot scatters
  });

  it("emits only the candlestick series for empty candles without crashing", () => {
    const option = buildPatternChartOption({
      candles: [],
      hit: HIT,
      trendlines: [boundary(104)],
      overlays: [overlay("rising_wedge", "Rising Wedge")],
    });
    const series = seriesOf(option);
    expect(series.filter((s) => s.type === "candlestick")).toHaveLength(1);
    expect(series[0].data).toEqual([]);
    // No window → groups map to nothing, pivots need a window too.
    expect(series.every((s) => s.type === "candlestick")).toBe(true);
  });
});

describe("buildPatternChartOption overlay grouping and legend naming", () => {
  it("draws the selected pattern solid and siblings dashed with distinct colours", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      trendlines: [boundary(104)],
      overlays: [overlay("rising_wedge", "Rising Wedge", { start_date: "2026-05-06" })],
      selectedPatternId: "falling_wedge",
    });
    const selected = seriesOf(option).filter((s) => s.name === "Falling Wedge");
    const sibling = seriesOf(option).filter((s) => s.name === "Rising Wedge");
    expect(selected.length).toBeGreaterThan(0);
    expect(sibling.length).toBeGreaterThan(0);
    expect(selected[0].lineStyle?.type).toBe("solid");
    expect(sibling[0].lineStyle?.type).toBe("dashed");
    expect(selected[0].lineStyle?.color).toBe(PATTERN_SERIES_COLORS[0]);
    expect(sibling[0].lineStyle?.color).toBe(PATTERN_SERIES_COLORS[1]);
    expect(selected[0].silent).toBe(true);
  });

  it("labels only the first boundary line of a group and hides overlaps", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      trendlines: [boundary(104), boundary(100)],
      overlays: [],
    });
    const group = seriesOf(option).filter((s) => s.name === "Falling Wedge");
    expect(group).toHaveLength(2);
    expect(group[0].endLabel?.formatter).toBe("Falling Wedge");
    expect(group[1].endLabel).toBeUndefined();
    expect(group[0].labelLayout).toMatchObject({ hideOverlap: true });
  });

  it("registers every group name in the legend", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      trendlines: [boundary(104)],
      overlays: [overlay("rising_wedge", "Rising Wedge", { start_date: "2026-05-06" })],
      selectedPatternId: "falling_wedge",
    });
    expect(legendOf(option)).toContain("Falling Wedge");
    expect(legendOf(option)).toContain("Rising Wedge");
  });

  it("suffixes repeated pattern names so no two series share a legend name", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      trendlines: [boundary(104)],
      overlays: [
        overlay("rising_wedge", "Rising Wedge", { start_date: "2026-05-04" }),
        overlay("rising_wedge", "Rising Wedge", { start_date: "2026-05-06" }),
      ],
      selectedPatternId: "other_pattern",
    });
    const names = seriesOf(option).map((s) => s.name);
    expect(names).toContain("Rising Wedge");
    expect(names).toContain("Rising Wedge (2)");
    const legend = legendOf(option);
    expect(new Set(legend).size).toBe(legend.length);
  });

  it("falls back to pattern_id (then Pattern) when the overlay has no display name", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      overlays: [{ pattern_id: "mystery_id", trendlines: [boundary(101)] }],
      selectedPatternId: "other_pattern",
    });
    expect(seriesOf(option).map((s) => s.name)).toContain("mystery_id");
    expect(legendOf(option)).toContain("mystery_id");
  });

  it("skips overlays with no trendlines and draws nothing extra", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      trendlines: [boundary(104)],
      overlays: [{ pattern_id: "empty", pattern_name: "Empty", trendlines: [] }],
      selectedPatternId: "falling_wedge",
    });
    expect(seriesOf(option).map((s) => s.name)).not.toContain("Empty");
  });

  it("omits sibling overlays on compact sparklines but keeps the selected trendlines", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      trendlines: [boundary(104)],
      overlays: [overlay("rising_wedge", "Rising Wedge", { start_date: "2026-05-06" })],
      selectedPatternId: "falling_wedge",
      compact: true,
    });
    const names = seriesOf(option).map((s) => s.name);
    expect(names).toContain("Falling Wedge");
    expect(names).not.toContain("Rising Wedge");
    expect(option.legend).toBeUndefined();
  });

  it("uses thicker solid lines and larger end labels when large is set", () => {
    const base = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      trendlines: [boundary(104)],
      overlays: [overlay("rising_wedge", "Rising Wedge", { start_date: "2026-05-06" })],
      selectedPatternId: "falling_wedge",
    });
    const big = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      trendlines: [boundary(104)],
      overlays: [overlay("rising_wedge", "Rising Wedge", { start_date: "2026-05-06" })],
      selectedPatternId: "falling_wedge",
      large: true,
    });
    const baseSel = seriesOf(base).find((s) => s.name === "Falling Wedge");
    const bigSel = seriesOf(big).find((s) => s.name === "Falling Wedge");
    const baseSib = seriesOf(base).find((s) => s.name === "Rising Wedge");
    const bigSib = seriesOf(big).find((s) => s.name === "Rising Wedge");
    expect(baseSel?.lineStyle?.width).toBe(2.5);
    expect(bigSel?.lineStyle?.width).toBe(3);
    expect(baseSib?.lineStyle?.width).toBe(1.5);
    expect(bigSib?.lineStyle?.width).toBe(2);
    expect(baseSel?.endLabel?.fontSize).toBe(10);
    expect(bigSel?.endLabel?.fontSize).toBe(12);
  });
});

describe("buildPatternChartOption isSelectedOverlay", () => {
  const selected = [boundary(104)];

  it("skips the overlay whose pattern id and start date match the selection", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: { ...HIT, pattern_id: "rising_wedge", pattern_name: "Rising Wedge" },
      trendlines: selected,
      overlays: [
        overlay("rising_wedge", "Rising Wedge", { start_date: "2026-05-04" }),
        overlay("rising_wedge", "Rising Wedge", { start_date: "2026-05-06" }),
      ],
      selectedPatternId: "rising_wedge",
      selectedStartDate: "2026-05-04",
    });
    const names = seriesOf(option).map((s) => s.name);
    // Selected group + one surviving sibling (suffixed as the second instance).
    expect(names).toContain("Rising Wedge");
    expect(names).toContain("Rising Wedge (2)");
    expect(names.filter((n) => n === "Rising Wedge (3)")).toHaveLength(0);
  });

  it("keeps a legacy overlay without a start date even when the selection has one", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      trendlines: selected,
      overlays: [{ pattern_id: "falling_wedge", pattern_name: "Falling Wedge", trendlines: [boundary(101)] }],
      selectedPatternId: "falling_wedge",
      selectedStartDate: "2026-05-04",
    });
    const names = seriesOf(option).map((s) => s.name);
    expect(names).toContain("Falling Wedge");
    expect(names).toContain("Falling Wedge (2)");
  });

  it("skips a start-less overlay when the selection also has no identity", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: null,
      trendlines: [boundary(104)],
      overlays: [{ pattern_id: "rising_wedge", pattern_name: "Rising Wedge", trendlines: [boundary(101)] }],
      selectedPatternId: "rising_wedge",
    });
    // Selected group is named after the hit fallback ("Pattern"); the matching
    // sibling is skipped, so "Rising Wedge" never appears.
    expect(seriesOf(option).map((s) => s.name)).not.toContain("Rising Wedge");
  });

  it("never skips an overlay with a different pattern id", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      trendlines: selected,
      overlays: [overlay("rising_wedge", "Rising Wedge", { start_date: "2026-05-04" })],
      selectedPatternId: "falling_wedge",
      selectedStartDate: "2026-05-04",
    });
    expect(seriesOf(option).map((s) => s.name)).toContain("Rising Wedge");
  });

  it("prefers the opaque instance key when the backend supplies one", () => {
    const matching = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      overlays: [
        overlay("rising_wedge", "Rising Wedge", { start_date: "2026-05-04", instanceKey: "k1" }),
      ],
      selectedPatternId: "rising_wedge",
      selectedInstanceKey: "k1",
    });
    expect(seriesOf(matching).map((s) => s.name)).not.toContain("Rising Wedge");

    const other = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      overlays: [
        overlay("rising_wedge", "Rising Wedge", { start_date: "2026-05-04", instanceKey: "k2" }),
      ],
      selectedPatternId: "rising_wedge",
      selectedInstanceKey: "k1",
    });
    expect(seriesOf(other).map((s) => s.name)).toContain("Rising Wedge");
  });

  it("defaults the selection identity to the hit pattern id and start date", () => {
    // No explicit selectedPatternId/selectedStartDate: the hit itself supplies
    // both, so the overlay duplicating the hit instance is skipped.
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      trendlines: selected,
      overlays: [overlay("falling_wedge", "Falling Wedge", { start_date: "2026-05-04" })],
    });
    expect(seriesOf(option).filter((s) => s.name === "Falling Wedge")).toHaveLength(1);
  });
});

describe("buildPatternChartOption pivot markers", () => {
  it("draws high markers red/down and low markers green/up at mapped indices", () => {
    const option = buildPatternChartOption({ candles: CANDLES, hit: HIT });
    const highs = seriesOf(option).find((s) => s.name === "Pivot High");
    const lows = seriesOf(option).find((s) => s.name === "Pivot Low");
    expect(highs?.type).toBe("scatter");
    expect(lows?.type).toBe("scatter");
    expect(highs?.symbol).toBe("triangle");
    expect(highs?.symbolRotate).toBe(180);
    expect(lows?.symbolRotate).toBe(0);
    expect(highs?.itemStyle?.color).toBe(NEGATIVE);
    expect(lows?.itemStyle?.color).toBe(POSITIVE);
    expect(highs?.data).toEqual([[0, 104]]);
    expect(lows?.data).toEqual([[2, 101]]);
    expect(legendOf(option)).toContain("Pivot High");
    expect(legendOf(option)).toContain("Pivot Low");
  });

  it("omits pivot markers on compact sparklines", () => {
    const option = buildPatternChartOption({ candles: CANDLES, hit: HIT, compact: true });
    const names = seriesOf(option).map((s) => s.name);
    expect(names).not.toContain("Pivot High");
    expect(names).not.toContain("Pivot Low");
  });

  it("skips pivots with missing or unparseable timestamps", () => {
    const bad = {
      ...HIT,
      pivots: [
        { t: "", price: 104, kind: "high" },
        { t: "not-a-date", price: 101, kind: "low" },
      ],
    } as unknown as PatternHitDTO;
    const option = buildPatternChartOption({ candles: CANDLES, hit: bad });
    expect(seriesOf(option).map((s) => s.name)).not.toContain("Pivot High");
    expect(seriesOf(option).map((s) => s.name)).not.toContain("Pivot Low");
  });

  it("uses larger pivot markers when large is set", () => {
    const base = seriesOf(buildPatternChartOption({ candles: CANDLES, hit: HIT })).find(
      (s) => s.name === "Pivot High",
    );
    const big = seriesOf(
      buildPatternChartOption({ candles: CANDLES, hit: HIT, large: true }),
    ).find((s) => s.name === "Pivot High");
    expect(base?.symbolSize).toBe(9);
    expect(big?.symbolSize).toBe(12);
  });
});

describe("buildPatternChartOption breakout/target/stop guides", () => {
  it("draws all three guides on full charts only", () => {
    const full = buildPatternChartOption({ candles: CANDLES, hit: HIT });
    const candle = seriesOf(full).find((s) => s.type === "candlestick");
    expect(candle?.markLine?.data?.map((d) => d.label?.formatter)).toEqual([
      "Breakout",
      "Target",
      "Stop",
    ]);
    const compact = buildPatternChartOption({ candles: CANDLES, hit: HIT, compact: true });
    expect(seriesOf(compact).find((s) => s.type === "candlestick")?.markLine).toBeUndefined();
  });
});

describe("buildPatternChartOption degenerate single-point overlay line", () => {
  it("dot-marks a single-point boundary instead of drawing nothing", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      trendlines: [[{ t: CANDLES[0].t, price: 104 }]],
    });
    const line = seriesOf(option).find((s) => s.type === "line");
    expect(line?.showSymbol).toBe(true);
    expect(line?.symbol).toBe("circle");
    expect(line?.symbolSize).toBe(6);
    expect(line?.lineStyle?.opacity).toBe(0);
    expect(line?.silent).toBe(true);
  });
});
