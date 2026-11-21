// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import {
  expiryLabel,
  liquidityStats,
  maxPainStrike,
  oiByStrike,
  payoutCurve,
  pcrByStrike,
  smileSeries,
  spreadCells,
  wallMarks,
} from "./dataRead";
import { fullFixture } from "./fixtures";

describe("dashboard data readers", () => {
  test("expiryLabel is locale-free and safe on a bad date", () => {
    expect(expiryLabel("2026-11-26", 9)).toBe("26 NOV · 9d");
    expect(expiryLabel("2026-12-31", null)).toBe("31 DEC");
    expect(expiryLabel(undefined, null)).toBe("—");
  });

  test("oiByStrike splits legs by delta sign and accumulates same-side OI", () => {
    const data = fullFixture();
    const rows = oiByStrike(data, "2026-11-26");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({ strike: 1380, ce: 20_000, pe: 18_000 });
    expect(rows.every((row) => row.ce != null && row.pe != null)).toBe(true);

    const noDelta = {
      ...data,
      expiries: [{ ...data.expiries[0], points: [{ strike: 1420, moneyness: null, iv: 20, delta: null, oi: 100 }] }],
    };
    expect(oiByStrike(noDelta, null)).toEqual([{ strike: 1420, ce: 100, pe: null }]);
  });

  test("payout curve minimum is returned as the max-pain strike", () => {
    const oi = oiByStrike(fullFixture(), "2026-11-26");
    const curve = payoutCurve(oi);
    expect(curve).toHaveLength(5);
    const min = Math.min(...curve.map((row) => row.value ?? 0));
    expect(curve.find((row) => row.strike === maxPainStrike(curve))?.value).toBe(min);
    expect(maxPainStrike([])).toBeNull();
  });

  test("PCR is cumulative and skips it when call OI is zero", () => {
    expect(pcrByStrike([{ strike: 1, ce: 100, pe: 50 }, { strike: 2, ce: 100, pe: 100 }])).toEqual([
      { strike: 1, value: 0.5 },
      { strike: 2, value: 0.75 },
    ]);
    expect(pcrByStrike([{ strike: 1, ce: 0, pe: 50 }])[0].value).toBeNull();
  });

  test("smileSeries drops null IVs and keeps the side split", () => {
    const data = fullFixture();
    data.expiries[0].points[2].iv = null;
    const smile = smileSeries(data, "2026-11-26");
    expect(smile.ce.length).toBe(4);
    expect(smile.pe.length).toBe(5);
    expect(smile.ce.map((point) => point[0])).not.toContain(1400);
    expect(smile.pe.map((point) => point[0])).toContain(1400);
  });

  test("liquidityStats computes the median and counts unquoted cells", () => {
    const data = fullFixture();
    const stats = liquidityStats(spreadCells(data));
    expect(stats).toEqual({ median: 0.3, unquoted: 1, total: 10 });
    expect(liquidityStats([])).toEqual({ median: null, unquoted: 0, total: 0 });
  });

  test("wallMarks drops null levels and keeps the shared labels", () => {
    const marks = wallMarks(fullFixture().levels);
    expect(marks.map((mark) => mark.label)).toEqual(["CW", "PW", "MP", "SUP", "RES"]);
    expect(wallMarks(null)).toEqual([]);
  });

  test("readers tolerate a null payload", () => {
    expect(oiByStrike(null, null)).toEqual([]);
    expect(payoutCurve([])).toEqual([]);
    expect(smileSeries(undefined, null)).toEqual({ ce: [], pe: [] });
    expect(spreadCells(null)).toEqual([]);
    expect(liquidityStats([]).median).toBeNull();
  });
});
