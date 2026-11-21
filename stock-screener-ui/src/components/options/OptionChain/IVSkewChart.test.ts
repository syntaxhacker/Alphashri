import { describe, expect, test } from "vitest";
import { buildSmileSeries } from "./IVSkewChart";

function row(strike: number, ceIv: number | null, peIv: number | null) {
  return {
    strike,
    ce: { option_greeks: { iv: ceIv, delta: 0.5 }, market_data: { oi: 100 } },
    pe: { option_greeks: { iv: peIv, delta: -0.5 }, market_data: { oi: 100 } },
  };
}

describe("buildSmileSeries", () => {
  test("keeps CE and PE as separate OTM series with no shared values", () => {
    // CE at 24000 is ITM and PE at 25000 is ITM; only the OTM leg survives.
    const series = buildSmileSeries([row(24000, 22, 14), row(25000, 16, 25)], 24500);

    expect(series.strikes).toEqual([24000, 25000]);
    expect(series.ce).toEqual([null, 16]);
    expect(series.pe).toEqual([14, null]);
  });

  test("never zero-fills a missing iv", () => {
    const series = buildSmileSeries(
      [row(25000, null, 25), row(24000, 22, null), row(25500, 17, null), row(23500, null, 12)],
      24500,
    );
    // Strikes with no OTM quote on either side are absent, not plotted as 0.
    expect(series.strikes).toEqual([23500, 25500]);
    expect(series.ce).toEqual([null, 17]);
    expect(series.pe).toEqual([12, null]);
    expect([...series.ce, ...series.pe].every((v) => v == null || v > 0)).toBe(true);
    expect([...series.ce, ...series.pe]).not.toContain(0);
  });

  test("a missing quote stays null instead of borrowing the other side's iv", () => {
    const onlyCall = buildSmileSeries([row(25000, 18, null)], 24500);
    expect(onlyCall.ce).toEqual([18]);
    expect(onlyCall.pe).toEqual([null]);

    const onlyPut = buildSmileSeries([row(24000, null, 13)], 24500);
    expect(onlyPut.ce).toEqual([null]);
    expect(onlyPut.pe).toEqual([13]);
  });

  test("returns no points when spot is unknown", () => {
    const series = buildSmileSeries([row(25000, 18, 13)], null);
    expect(series).toEqual({ strikes: [], ce: [], pe: [] });
  });

  test("drops non-finite and non-positive ivs but keeps valid OTM quotes", () => {
    const series = buildSmileSeries(
      [row(25000, Number.NaN, 12), row(24000, 20, Number.NaN), row(26000, 18, 10)],
      24500,
    );
    expect(series.strikes).toEqual([26000]);
    expect(series.ce).toEqual([18]);
    expect(series.pe).toEqual([null]);
  });
});
