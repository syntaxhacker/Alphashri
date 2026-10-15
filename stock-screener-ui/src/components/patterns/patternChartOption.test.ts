import { describe, expect, it } from "vitest";
import type { ChartCandle, PatternHitDTO, PatternOverlay } from "@/types/chartPatterns";
import { buildPatternChartOption } from "./patternChartOption";

const CANDLES: ChartCandle[] = [
  { t: "2026-05-04T18:30:00+00:00", o: 100, h: 104, l: 99, c: 103, v: 1000 },
  { t: "2026-05-05T18:30:00+00:00", o: 103, h: 106, l: 102, c: 105, v: 1100 },
  { t: "2026-05-06T18:30:00+00:00", o: 105, h: 107, l: 101, c: 102, v: 900 },
  { t: "2026-05-07T18:30:00+00:00", o: 102, h: 108, l: 100, c: 107, v: 1200 },
];

const HIT: PatternHitDTO = {
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
  start_date: "2026-05-04",
  end_date: "2026-05-07",
  start_price: 100,
  end_price: 107,
  breakout_level: 107,
  target: 119,
  stop: 99,
  rr: 1.7,
  bars_ago: 1,
  volume_confirmed: true,
  trendlines: [],
  notes: "",
  pivots: [
    { t: "2026-05-04T18:30:00+00:00", price: 104, kind: "high" },
    { t: "2026-05-06T18:30:00+00:00", price: 101, kind: "low" },
  ],
};

interface SeriesLike {
  type?: string;
  name?: string;
  data?: unknown[];
  itemStyle?: { color?: string };
  symbolRotate?: number;
}

function seriesOf(option: Record<string, unknown>): SeriesLike[] {
  return option.series as unknown as SeriesLike[];
}

describe("buildPatternChartOption pivot markers", () => {
  it("adds high/low scatter series mapped onto the category axis (full charts)", () => {
    const option = buildPatternChartOption({ candles: CANDLES, hit: HIT, compact: false });
    const series = seriesOf(option);

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
    const option = buildPatternChartOption({ candles: CANDLES, hit: HIT, compact: true });
    const names = seriesOf(option).map((s) => s.name);
    expect(names).not.toContain("Pivot High");
    expect(names).not.toContain("Pivot Low");
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
    const series = seriesOf(option);
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
    const names = seriesOf(option).map((s) => s.name);
    expect(names).not.toContain("Rising Wedge");
  });
});

describe("buildPatternChartOption instance identity", () => {
  const CANDLES_IST = [
    { t: "2026-05-04T09:15:00+05:30", o: 100, h: 104, l: 99, c: 103, v: 1000 },
    { t: "2026-05-05T09:15:00+05:30", o: 103, h: 106, l: 102, c: 105, v: 1100 },
    { t: "2026-05-06T09:15:00+05:30", o: 105, h: 107, l: 101, c: 102, v: 900 },
    { t: "2026-05-07T09:15:00+05:30", o: 102, h: 108, l: 100, c: 107, v: 1200 },
  ];

  const line = (t: string, price: number) => [
    { t: "2026-05-04T09:15:00+05:30", price },
    { t, price: price + 1 },
  ];

  it("keeps other instances of the same pattern visible", () => {
    const option = buildPatternChartOption({
      candles: CANDLES_IST,
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
    const names = seriesOf(option).map((s) => s.name);
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
    const series = seriesOf(option);
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
    const line = seriesOf(option).find((s) => s.type === "line");
    expect(line).toMatchObject({ showSymbol: true, symbol: "circle" });
  });

  it("hides overlapping end labels and clears the top legend", () => {
    const option = buildPatternChartOption({
      candles: CANDLES,
      hit: HIT,
      trendlines: [[{ t: "2026-05-04T18:30:00+00:00", price: 104 }]],
      compact: false,
    });
    const withLabel = (seriesOf(option) as Array<Record<string, unknown>>).find((s) => s.endLabel);
    expect(withLabel?.labelLayout).toMatchObject({ hideOverlap: true });
    expect((option.grid as { top?: number }).top).toBeGreaterThanOrEqual(32);
  });
});
