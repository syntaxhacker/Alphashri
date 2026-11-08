import { describe, expect, it } from "vitest";
import type { PatternOverlay } from "@/types/chartPatterns";
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
