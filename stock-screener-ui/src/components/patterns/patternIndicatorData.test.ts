import { describe, expect, it } from "vitest";
import type { ChartCandle, ChartIndicators, SRZone } from "@/types/chartPatterns";
import { NEGATIVE, POSITIVE, WARNING } from "@/ui/palette";
import { toEpochSeconds } from "@/utils/chart/time";
import {
  CROSSES_LEGEND_NAME,
  INDICATOR_SERIES_META,
  alignIndicatorCrosses,
  alignIndicatorSeries,
  alignSRZones,
} from "./patternIndicatorData";

function candle(t: string): ChartCandle {
  return { t, o: 100, h: 102, l: 99, c: 101, v: 1000 };
}

const CANDLES: ChartCandle[] = [
  candle("2026-04-01"),
  candle("2026-04-02"),
  candle("2026-04-03"),
  candle("2026-04-04"),
];
const EPOCHS = CANDLES.map((c) => toEpochSeconds(c.t));
const SORTED_EPOCHS = [...EPOCHS].sort((a, b) => a - b);

function bundle(overrides: Partial<ChartIndicators> = {}): ChartIndicators {
  return {
    aligned: "candles",
    timeframe: "1D",
    session: "2026-04-04",
    partial_last: false,
    series: [],
    crosses: [],
    ...overrides,
  };
}

describe("patternIndicatorData", () => {
  it("joins index-aligned values by candle epoch, not by source order", () => {
    const shuffled = [CANDLES[2]!, CANDLES[0]!, CANDLES[3]!, CANDLES[1]!];
    const sourceEpochs = shuffled.map((c) => toEpochSeconds(c.t));
    const sorted = [...sourceEpochs].sort((a, b) => a - b);
    const series = alignIndicatorSeries(
      bundle({ series: [{ id: "sma20", values: [30, 10, 40, 20] }] }),
      sourceEpochs,
      sorted,
    );

    expect(series).toHaveLength(1);
    expect(series[0]!.points).toEqual([
      { time: toEpochSeconds("2026-04-01"), value: 10 },
      { time: toEpochSeconds("2026-04-02"), value: 20 },
      { time: toEpochSeconds("2026-04-03"), value: 30 },
      { time: toEpochSeconds("2026-04-04"), value: 40 },
    ]);
  });

  it("skips null and non-finite values as gaps and drops an all-gap series", () => {
    const series = alignIndicatorSeries(
      bundle({
        series: [
          { id: "sma20", values: [10, null, Number.NaN, Infinity] },
          { id: "sma50", values: [null, null, null, null] },
        ],
      }),
      EPOCHS,
      SORTED_EPOCHS,
    );

    expect(series.map((s) => s.id)).toEqual(["sma20"]);
    expect(series[0]!.points).toEqual([{ time: toEpochSeconds("2026-04-01"), value: 10 }]);
  });

  it("resolves duplicate candle epochs to the last candle and its value", () => {
    const source = [CANDLES[0]!, CANDLES[1]!, CANDLES[0]!];
    const sourceEpochs = source.map((c) => toEpochSeconds(c.t));
    const sorted = [...new Set(sourceEpochs)].sort((a, b) => a - b);
    const series = alignIndicatorSeries(
      bundle({ series: [{ id: "sma20", values: [10, 20, 30] }] }),
      sourceEpochs,
      sorted,
    );

    expect(series[0]!.points).toEqual([
      { time: toEpochSeconds("2026-04-01"), value: 30 },
      { time: toEpochSeconds("2026-04-02"), value: 20 },
    ]);
  });

  it("drops a series whose value count does not match the candle count", () => {
    const series = alignIndicatorSeries(
      bundle({
        series: [
          { id: "sma20", values: [1, 2, 3] },
          { id: "sma50", values: [1, 2, 3, 4] },
        ],
      }),
      EPOCHS,
      SORTED_EPOCHS,
    );

    expect(series.map((s) => s.id)).toEqual(["sma50"]);
  });

  it("keeps only canonical ids in draw order and groups the BB band under one legend name", () => {
    const values = [1, 2, 3, 4];
    const series = alignIndicatorSeries(
      bundle({
        series: [
          { id: "vwap", values },
          { id: "bbLower", values },
          { id: "sma20", values },
          { id: "bbUpper", values },
          { id: "bbMiddle", values },
        ],
      }),
      EPOCHS,
      SORTED_EPOCHS,
    );

    expect(series.map((s) => s.id)).toEqual(["sma20", "bbUpper", "bbMiddle", "bbLower", "vwap"]);
    const band = series.filter((s) => s.id.startsWith("bb"));
    expect(band.map((s) => s.legendName)).toEqual(["BB", "BB", "BB"]);
    expect(band.every((s) => s.lineStyle === "dashed")).toBe(true);
    expect(series.find((s) => s.id === "vwap")?.lineStyle).toBe("dotted");
    expect(series.find((s) => s.id === "sma20")?.lineStyle).toBe("solid");
    expect(INDICATOR_SERIES_META.bbUpper.color).toBe(INDICATOR_SERIES_META.bbLower.color);
  });

  it("aligns crosses to exact candle epochs and drops foreign epochs and duplicates", () => {
    const crosses = alignIndicatorCrosses(
      bundle({
        crosses: [
          { t: "2026-04-02", kind: "golden" },
          { t: "2026-04-02T09:15:00", kind: "golden" },
          { t: "2026-04-02", kind: "golden" },
          { t: "2025-01-01", kind: "death" },
          { t: "2026-04-04", kind: "death" },
        ],
      }),
      SORTED_EPOCHS,
    );

    expect(crosses).toEqual([
      { time: toEpochSeconds("2026-04-02"), kind: "golden" },
      { time: toEpochSeconds("2026-04-04"), kind: "death" },
    ]);
  });

  it("skips a cross on the still-forming final bar only", () => {
    const base = bundle({
      crosses: [
        { t: "2026-04-03", kind: "golden" },
        { t: "2026-04-04", kind: "death" },
      ],
    });
    const provisional = alignIndicatorCrosses({ ...base, partial_last: true }, SORTED_EPOCHS);
    expect(provisional.map((c) => c.kind)).toEqual(["golden"]);

    const completed = alignIndicatorCrosses(base, SORTED_EPOCHS);
    expect(completed.map((c) => c.kind)).toEqual(["golden", "death"]);
  });

  it("clamps zones to the candle window and drops non-overlapping or inverted bands", () => {
    const zones: SRZone[] = [
      {
        kind: "support",
        top: 105,
        bottom: 100,
        start_date: "2026-03-25",
        end_date: "2026-04-02",
        touches: 3,
        score: 0.72,
      },
      {
        kind: "resistance",
        top: 110,
        bottom: 108,
        start_date: "2026-04-04",
        end_date: "2026-05-01",
        touches: 2,
        score: 0.55,
      },
      {
        kind: "sr",
        top: 120,
        bottom: 118,
        start_date: "2025-01-01",
        end_date: "2025-02-01",
        touches: 4,
        score: 0.9,
      },
      {
        kind: "support",
        top: 100,
        bottom: 100,
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        touches: 1,
        score: 0.1,
      },
    ];

    const aligned = alignSRZones(zones, SORTED_EPOCHS);

    expect(aligned).toEqual([
      {
        kind: "support",
        top: 105,
        bottom: 100,
        start: toEpochSeconds("2026-04-01"),
        end: toEpochSeconds("2026-04-02"),
        touches: 3,
        score: 0.72,
        color: POSITIVE,
        legendName: "Support",
      },
      {
        kind: "resistance",
        top: 110,
        bottom: 108,
        start: toEpochSeconds("2026-04-04"),
        end: toEpochSeconds("2026-04-04"),
        touches: 2,
        score: 0.55,
        color: NEGATIVE,
        legendName: "Resistance",
      },
    ]);
  });

  it("exposes the shared legend names for crosses and mixed zones", () => {
    const mixed = alignSRZones(
      [
        {
          kind: "sr",
          top: 105,
          bottom: 100,
          start_date: "2026-04-01",
          end_date: "2026-04-03",
          touches: 1,
          score: 0.3,
        },
      ],
      SORTED_EPOCHS,
    );

    expect(CROSSES_LEGEND_NAME).toBe("Crosses");
    expect(mixed[0]).toMatchObject({ color: WARNING, legendName: "S/R" });
  });

  it("returns nothing for a missing bundle or an unexpected alignment", () => {
    expect(alignIndicatorSeries(null, EPOCHS, SORTED_EPOCHS)).toEqual([]);
    expect(alignIndicatorCrosses(undefined, SORTED_EPOCHS)).toEqual([]);
    expect(alignSRZones(undefined, SORTED_EPOCHS)).toEqual([]);
    expect(
      alignIndicatorSeries({ ...bundle(), aligned: "time" as never }, EPOCHS, SORTED_EPOCHS),
    ).toEqual([]);
  });
});
