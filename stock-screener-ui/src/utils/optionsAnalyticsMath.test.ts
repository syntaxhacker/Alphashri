// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type {
  AnalyticsExpiry,
  AnalyticsIvPoint,
  OptionsAnalytics,
} from "../api/optionsAnalytics";
import {
  formatVp,
  ivSignature,
  riskReversal,
  smilePoints,
  surfaceGrid,
  termPoints,
  termSlope,
} from "./optionsAnalyticsMath";

function p(strike: number, iv: number | null, delta: number | null): AnalyticsIvPoint {
  return { strike, iv, delta, moneyness: null, oi: null };
}

function expiry(
  date: string,
  dte: number,
  overrides: Partial<AnalyticsExpiry> = {},
): AnalyticsExpiry {
  return {
    date,
    dte,
    atmIv: null,
    rr25: null,
    bf25: null,
    slope: null,
    fitR2: null,
    points: [],
    ...overrides,
  };
}

function analytics(overrides: Partial<OptionsAnalytics> = {}): OptionsAnalytics {
  return {
    symbol: "NIFTY",
    spot: 100,
    asOf: null,
    quotesLive: true,
    expiries: [],
    term: [],
    surface: { strikes: [], expiries: [], iv: [], missing: [] },
    levels: {
      callWall: null,
      putWall: null,
      maxPain: null,
      gex: { support: null, resistance: null, fuelUp: null, fuelDown: null },
    },
    probability: {
      model: null,
      flatPop: null,
      skewPop: null,
      expectedPnl: null,
      sigma: null,
      density: [],
      quantiles: { p05: null, p25: null, p50: null, p75: null, p95: null },
      cone: [],
    },
    warnings: [],
    ...overrides,
  };
}

describe("smilePoints", () => {
  it("keeps OTM legs per side with log-moneyness and preserves a missing delta as null", () => {
    const rows = [
      p(90, 14, -0.2),
      p(95, 13, -0.35),
      p(100, 12.5, null),
      p(105, 12.8, 0.3),
      p(110, 13.5, null),
      p(115, null, 0.1),
      p(120, 0, 0.1),
      p(85, 20, 0.4),
    ];

    const ce = smilePoints(rows, 100, "CE");
    const pe = smilePoints(rows, 100, "PE");

    expect(ce.map((point) => point.strike)).toEqual([100, 105, 110]);
    expect(ce[1].moneyness).toBeCloseTo(Math.log(1.05), 10);
    expect(ce[2].delta).toBeNull();
    expect(pe.map((point) => point.strike)).toEqual([90, 95, 100]);
    expect(pe[0].moneyness).toBeCloseTo(Math.log(0.9), 10);
  });

  it("returns nothing for a non-positive spot and never zero-fills an iv", () => {
    const rows = [p(100, 12, 0.5)];
    expect(smilePoints(rows, 0, "CE")).toEqual([]);
    expect(smilePoints([p(105, Number.NaN, 0.3)], 100, "CE")).toEqual([]);
  });
});

describe("termPoints", () => {
  it("reads ATM IV by DTE from the expiries and sorts by DTE", () => {
    const data = analytics({
      expiries: [
        expiry("2026-11-26", 10, { atmIv: 11.9, rr25: -0.4 }),
        expiry("2026-11-19", 3, { atmIv: 12.4, rr25: 1.1 }),
      ],
    });

    expect(termPoints(data)).toEqual([
      { dte: 3, iv: 12.4 },
      { dte: 10, iv: 11.9 },
    ]);
    expect(termPoints(data, "rr25")).toEqual([
      { dte: 3, iv: 1.1 },
      { dte: 10, iv: -0.4 },
    ]);
  });

  it("falls back to the standalone term series on a partial payload", () => {
    const data = analytics({
      expiries: [expiry("2026-11-19", 3)],
      term: [
        { dte: 3, atmIv: 12.4, rr25: 1.1, bf25: null },
        { dte: 10, atmIv: 11.9, rr25: null, bf25: null },
      ],
    });
    expect(termPoints(data)).toEqual([
      { dte: 3, iv: 12.4 },
      { dte: 10, iv: 11.9 },
    ]);
  });

  it("requires at least two finite points", () => {
    expect(
      termPoints(analytics({ expiries: [expiry("2026-11-19", 3, { atmIv: 12.4 })] })),
    ).toEqual([]);
    expect(
      termPoints(
        analytics({
          expiries: [expiry("2026-11-19", 3, { atmIv: 12.4 })],
          term: [{ dte: 10, atmIv: null, rr25: null, bf25: null }],
        }),
      ),
    ).toEqual([]);
  });
});

describe("termSlope / formatVp", () => {
  it("fits vol points per expiry by least squares", () => {
    expect(termSlope([{ dte: 3, iv: 12 }, { dte: 10, iv: 14 }, { dte: 17, iv: 16 }])).toBeCloseTo(2, 10);
    expect(termSlope([{ dte: 3, iv: 14 }, { dte: 10, iv: 12 }, { dte: 17, iv: 10 }])).toBeCloseTo(-2, 10);
  });

  it("has no slope from fewer than two points or a degenerate x", () => {
    expect(termSlope([])).toBeNull();
    expect(termSlope([{ dte: 3, iv: 12 }])).toBeNull();
  });

  it("formats a signed vol point string and a dash for missing values", () => {
    expect(formatVp(-0.84)).toBe("-0.8 vp");
    expect(formatVp(1.25)).toBe("+1.3 vp");
    expect(formatVp(null)).toBe("—");
    expect(formatVp(Number.NaN)).toBe("—");
  });
});

describe("surfaceGrid", () => {
  const front = expiry("2026-11-19", 3, {
    points: [p(100, 12, 0.5), p(105, 12.5, 0.4), p(110, 13, 0.3), p(115, 13.5, 0.2)],
  });
  const back = expiry("2026-11-26", 10, {
    points: [p(99, 11, 0.5), p(105, 11.5, null), p(110, 12, 0.3), p(120, 12.5, 0.2)],
  });

  it("builds the strike lattice from the front expiry and fills a nearest strike within one tick", () => {
    const grid = surfaceGrid(analytics({ expiries: [front, back] }));

    expect(grid.strikes).toEqual([100, 105, 110, 115]);
    expect(grid.expiries).toEqual(["2026-11-19", "2026-11-26"]);
    expect(grid.tick).toBe(5);
    expect(grid.coverage).toBe(8);
    expect(grid.total).toBe(8);
    const backAt100 = grid.cells.find((cell) => cell.expiry === "2026-11-26" && cell.strike === 100);
    expect(backAt100).toMatchObject({ iv: 11, matchedStrike: 99 });
    const exact = grid.cells.find((cell) => cell.expiry === "2026-11-26" && cell.strike === 105);
    expect(exact).toMatchObject({ iv: 11.5, delta: null, matchedStrike: 105 });
  });

  it("omits unfillable intersections instead of writing a zero", () => {
    const thin = expiry("2026-12-03", 17, { points: [p(130, 10, null)] });
    const grid = surfaceGrid(analytics({ expiries: [front, thin] }));

    expect(grid.coverage).toBe(4);
    expect(grid.total).toBe(8);
    expect(grid.cells.filter((cell) => cell.expiry === "2026-12-03")).toHaveLength(0);
    expect(grid.cells.every((cell) => cell.iv > 0)).toBe(true);
  });

  it("samples the lattice to maxCols and handles an empty payload", () => {
    expect(surfaceGrid(analytics({ expiries: [front] }), 2).strikes).toEqual([100, 115]);
    const empty = surfaceGrid(analytics());
    expect(empty.cells).toEqual([]);
    expect(empty.coverage).toBe(0);
    expect(empty.total).toBe(0);
    expect(empty.tick).toBeNull();
  });
});

describe("riskReversal", () => {
  it("is 25-delta call IV minus put IV (positive = calls rich)", () => {
    expect(riskReversal([p(105, 14, 0.25), p(95, 11, -0.25)])).toBe(3);
    expect(riskReversal([p(105, 11, 0.25), p(95, 14, -0.25)])).toBe(-3);
  });

  it("is null when either wing or its delta is missing", () => {
    expect(riskReversal([p(105, 11, 0.25)])).toBeNull();
    expect(riskReversal([p(105, 11, 0.05), p(95, 14, -0.05)])).toBeNull();
    expect(riskReversal([p(105, 11, 0.25), p(95, null, -0.25)])).toBeNull();
  });
});

describe("ivSignature", () => {
  it("is a stable strike|IV string regardless of row order", () => {
    const rows = [p(105, 12.34, 0.3), p(100, 12.31, 0.5), p(110, null, 0.2)];
    const signature = ivSignature(rows);
    expect(signature).toBe("100|12.3;105|12.3");
    expect(ivSignature([...rows].reverse())).toBe(signature);
  });

  it("quantizes spot to a tick or 0.05% so sub-tick drift does not repaint", () => {
    const rows = [p(105, 12.34, 0.3)];
    expect(ivSignature(rows, 100.001)).toBe("100.00|105|12.3");
    expect(ivSignature(rows, 100.04, 0.05)).toBe("100.05|105|12.3");
    expect(ivSignature(rows, 100)).toBe("100.00|105|12.3");
  });
});
