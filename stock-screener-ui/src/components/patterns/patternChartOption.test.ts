import { describe, expect, it } from "vitest";
import type { ChartCandle, PatternOverlay } from "@/types/chartPatterns";
import { buildPatternChartOption } from "./patternChartOption";
import { IST_CANDLES, UTC_CANDLES as CANDLES, UTC_HIT as HIT, expectCompactPivotMarkersOmitted, seriesOf } from "./patternTestFixtures";

interface SeriesLike {
  type?: string;
  name?: string;
  data?: unknown[];
  itemStyle?: { color?: string };
  symbolRotate?: number;
}

describe("buildPatternChartOption pivot markers", () => {
  it("adds high/low scatter series mapped onto the category axis (full charts)", () => {
    const option = buildPatternChartOption({ candles: CANDLES, hit: HIT, compact: false });
    const series = seriesOf<SeriesLike>(option);

    const highs = series.find((s) => s.name === "Pivot High");
    const lows = series.find((s) => s.name === "Pivot Low");
    expect(highs?.type).toBe("scatter");
    expect(lows?.type).toBe("scatter");
    expect(highs?.symbolRotate).toBe(180);
    expect(lows?.symbolRotate).toBe(0);
    expect(highs?.data).toEqual([[0, 104]]);
    expect(lows?.data).toEqual([[2, 101]]);

    const legend = option.legend as { data?: string[] } | undefined;
    expect(legend?.data).toContain("Pivot High");
    expect(legend?.data).toContain("Pivot Low");
  });

  it("omits pivot markers on compact sparklines", () => {
    expectCompactPivotMarkersOmitted(CANDLES, HIT);
  });

  it("formats the pivot tooltip as price at the readable datetime", () => {
    const option = buildPatternChartOption({ candles: CANDLES, hit: HIT, compact: false });
    const formatter = (option.tooltip as { formatter: (p: unknown) => string }).formatter;
    const html = formatter([
      {
        axisValue: "2026-05-04T18:30:00+00:00",
        seriesType: "scatter",
        seriesName: "Pivot High",
        marker: "",
        value: [0, 104],
      },
    ]);
    expect(html).toContain("05 May 2026");
    expect(html).toContain("Pivot High: ₹104.00");
  });
});

describe("buildPatternChartOption sibling overlays", () => {
  const OVERLAYS: PatternOverlay[] = [
    {
      pattern_id: "falling_wedge",
      pattern_name: "Falling Wedge",
      trendlines: [
        [
          { t: "2026-05-04T18:30:00+00:00", price: 104 },
          { t: "2026-05-07T18:30:00+00:00", price: 107 },
        ],
      ],
    },
    {
      pattern_id: "rising_wedge",
      pattern_name: "Rising Wedge",
      trendlines: [
        [
          { t: "2026-05-04T18:30:00+00:00", price: 101 },
          { t: "2026-05-07T18:30:00+00:00", price: 110 },
        ],
      ],
    },
  ];

  it("draws sibling patterns and names every group by pattern", () => {
    const selectedTrendline = [
      { t: "2026-05-04T18:30:00+00:00", price: 104 },
      { t: "2026-05-07T18:30:00+00:00", price: 107 },
    ];
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      trendlines: [selectedTrendline],
      overlays: OVERLAYS,
      selectedPatternId: "falling_wedge",
      compact: false,
    });
    const series = seriesOf<SeriesLike>(option);
    const names = series.map((s) => s.name);
    // Selected pattern is named (not "Upper/Lower boundary") and drawn solid;
    // sibling is drawn under its own name.
    expect(names).toContain("Falling Wedge");
    expect(names).toContain("Rising Wedge");
    expect(names).not.toContain("Upper boundary");
    expect(names).not.toContain("Lower boundary");

    const selected = series.filter((s) => s.name === "Falling Wedge");
    const sibling = series.filter((s) => s.name === "Rising Wedge");
    expect(selected.length).toBeGreaterThan(0);
    expect(sibling.length).toBeGreaterThan(0);
    expect((selected[0] as { lineStyle?: { type?: string } }).lineStyle?.type).toBe("solid");
    expect((sibling[0] as { lineStyle?: { type?: string } }).lineStyle?.type).toBe("dashed");

    const legend = option.legend as { data?: string[] } | undefined;
    expect(legend?.data).toContain("Falling Wedge");
    expect(legend?.data).toContain("Rising Wedge");
  });

  it("omits sibling overlays on compact sparklines", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      overlays: OVERLAYS,
      selectedPatternId: "falling_wedge",
      compact: true,
    });
    const names = seriesOf<SeriesLike>(option).map((s) => s.name);
    expect(names).not.toContain("Rising Wedge");
  });
});

describe("buildPatternChartOption instance identity", () => {
  const line = (t: string, price: number) => [
    { t: "2026-05-04T09:15:00+05:30", price },
    { t, price: price + 1 },
  ];

  it("keeps other instances of the same pattern visible", () => {
    const option = buildPatternChartOption({
      candles: IST_CANDLES,
      hit: { ...HIT, pattern_id: "rising_wedge", pattern_name: "Rising Wedge", start_date: "2026-05-04" },
      trendlines: [line("2026-05-07T09:15:00+05:30", 101)],
      overlays: [
        {
          pattern_id: "rising_wedge",
          pattern_name: "Rising Wedge",
          start_date: "2026-05-04",
          trendlines: [line("2026-05-07T09:15:00+05:30", 101)],
        },
        {
          pattern_id: "rising_wedge",
          pattern_name: "Rising Wedge",
          start_date: "2026-05-06",
          trendlines: [line("2026-05-07T09:15:00+05:30", 103)],
        },
      ],
      selectedPatternId: "rising_wedge",
      selectedStartDate: "2026-05-04",
      compact: false,
    });
    const names = seriesOf<SeriesLike>(option).map((s) => s.name);
    // Selected instance (exact start_date match) is skipped as a sibling, the
    // other instance stays — disambiguated with a suffix.
    expect(names).toContain("Rising Wedge");
    expect(names).toContain("Rising Wedge (2)");
  });

  it("deduplicates repeated pattern names across sibling instances", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      trendlines: [[{ t: "2026-05-04T18:30:00+00:00", price: 104 }]],
      overlays: [
        {
          pattern_id: "rising_wedge",
          pattern_name: "Rising Wedge",
          start_date: "2026-05-04",
          trendlines: [[{ t: "2026-05-04T18:30:00+00:00", price: 101 }]],
        },
        {
          pattern_id: "rising_wedge",
          pattern_name: "Rising Wedge",
          start_date: "2026-05-05",
          trendlines: [[{ t: "2026-05-05T18:30:00+00:00", price: 102 }]],
        },
      ],
      selectedPatternId: "other_pattern",
      compact: false,
    });
    const series = seriesOf<SeriesLike>(option);
    const uniqueNames = new Set(series.map((s) => s.name));
    // No two series share a legend name.
    expect(uniqueNames.size).toBe(series.length);
    const legend = option.legend as { data?: string[] } | undefined;
    expect(new Set(legend?.data).size).toBe(legend?.data?.length);
  });

  it("dot-marks degenerate single-point trendlines instead of drawing nothing", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      trendlines: [[{ t: "2026-05-04T18:30:00+00:00", price: 104 }]],
      compact: false,
    });
    const line = seriesOf<SeriesLike>(option).find((s) => s.type === "line");
    expect(line).toMatchObject({ showSymbol: true, symbol: "circle" });
  });

  it("hides overlapping end labels and clears the top legend", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      trendlines: [[{ t: "2026-05-04T18:30:00+00:00", price: 104 }]],
      compact: false,
    });
    const withLabel = seriesOf<Record<string, unknown>>(option).find((s) => s.endLabel);
    expect(withLabel?.labelLayout).toMatchObject({ hideOverlap: true });
    expect((option.grid as { top?: number }).top).toBeGreaterThanOrEqual(32);
  });
});

describe("buildPatternChartOption performance", () => {
  it("builds the full option for 714 daily candles in under 20ms (median of 20)", () => {
    // Realistic fullscreen dock chart: 714 daily candles, naive engine
    // timestamps (which never exact-match the ISO candle axis, so every point
    // exercises the nearest lookup), 15 sibling overlays, 24 pivots, 6
    // standalone TLS/TLR lines.
    const candles: ChartCandle[] = [];
    const start = new Date("2023-01-02T09:15:00+05:30").getTime();
    let price = 100;
    for (let i = 0; i < 714; i++) {
      const t = new Date(start + i * 86400000).toISOString();
      const o = price + (i % 7) - 3;
      const c = o + ((i % 5) - 2);
      price = c;
      candles.push({ t, o, h: Math.max(o, c) + 1.5, l: Math.min(o, c) - 1.5, c, v: 1000 + i });
    }
    const naiveAt = (i: number) => candles[i]!.t.replace("T", " ").slice(0, 16);
    const hit = {
      ...HIT,
      pivots: Array.from({ length: 24 }, (_, k) => ({
        t: naiveAt(20 + k * 28),
        price: 100 + k,
        kind: (k % 2 === 0 ? "high" : "low") as "high" | "low",
      })),
      trend_lines: Array.from({ length: 6 }, (_, k) => ({
        kind: (k % 2 === 0 ? "support" : "resistance") as "support" | "resistance",
        start_date: candles[k * 10]!.t.slice(0, 10),
        start_price: 90 + k * 2,
        end_date: candles[600 + k * 5]!.t.slice(0, 10),
        end_price: 110 + k * 2,
        slope: 0.1,
        touches: 3,
        span_bars: 100,
        violations: 0,
      })),
    };
    const overlays = Array.from({ length: 15 }, (_, k) => ({
      pattern_id: `pat_${k % 5}`,
      pattern_name: `Pattern ${k % 5}`,
      start_date: candles[50 + k * 30]!.t.slice(0, 10),
      trendlines: [
        [
          { t: naiveAt(50 + k * 30), price: 98 + k },
          { t: naiveAt(240 + k * 30), price: 112 + k },
        ],
        [
          { t: naiveAt(50 + k * 30), price: 92 + k },
          { t: naiveAt(240 + k * 30), price: 104 + k },
        ],
      ],
    }));
    const input = {
      candles,
      hit,
      trendlines: [
        [
          { t: naiveAt(10), price: 100 },
          { t: naiveAt(190), price: 115 },
        ],
        [
          { t: naiveAt(10), price: 95 },
          { t: naiveAt(190), price: 105 },
        ],
      ],
      overlays,
      compact: false,
    };
    // Warm up, then take the median of 20 single builds.
    for (let i = 0; i < 5; i++) buildPatternChartOption(input);
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      buildPatternChartOption(input);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;
    expect(median).toBeLessThan(20);
  });
});
