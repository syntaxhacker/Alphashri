import { describe, expect, test } from "vitest";
import type { SectorHistorySeasonality, SectorHistorySeries } from "../../../types/sectorHistory";
import {
  buildIndexSeries,
  compoundReturns,
  drawdownSeries,
  monthlyTransitionCount,
  rankAt,
  relativeStrengthSeries,
  seasonalityByMonth,
  seasonalitySampleLabel,
} from "./historyMath";

function expectFiniteOrNull(values: (number | null)[]): void {
  for (const value of values) {
    if (value === null) continue;
    expect(Number.isFinite(value), `${String(value)} must be finite or null`).toBe(true);
  }
}

function makeSeries(
  name: string,
  ranks: (number | null)[],
  benchmark = false,
): SectorHistorySeries {
  return { name, is_benchmark: benchmark, monthly_returns: [], ranks };
}

function makeCell(
  name: string,
  month: number,
  n: number,
  avg: number | null = 1,
  hitRate: number | null = 0.5,
): SectorHistorySeasonality {
  return { name, month, avg_return: avg, hit_rate: hitRate, n };
}

describe("compoundReturns", () => {
  test("compounds zero, one and negative returns from the default base", () => {
    expect(compoundReturns([0])).toEqual([100]);
    expect(compoundReturns([10])[0]).toBeCloseTo(110, 10);
    expect(compoundReturns([-10])[0]).toBeCloseTo(90, 10);
  });

  test("compounds sequentially and honours a custom start", () => {
    const result = compoundReturns([10, -10], 50);

    expect(result[0]).toBeCloseTo(55, 10);
    expect(result[1]).toBeCloseTo(49.5, 10);
  });

  test("preserves null gaps and continues from the prior factor", () => {
    const result = compoundReturns([10, null, -10]);

    expect(result[0]).toBeCloseTo(110, 10);
    expect(result[1]).toBeNull();
    expect(result[2]).toBeCloseTo(99, 10);

    const leading = compoundReturns([null, 10]);
    expect(leading[0]).toBeNull();
    expect(leading[1]).toBeCloseTo(110, 10);
  });

  test("clamps returns at -100 and never emits non-finite values", () => {
    const clamped = compoundReturns([-250, 10]);
    expect(clamped[0]).toBe(0);
    expect(clamped[1]).toBe(0);
    expect(compoundReturns([-100])[0]).toBe(0);

    const gaps = compoundReturns([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]);
    expect(gaps).toEqual([null, null, null]);

    const overflow = compoundReturns([Number.MAX_VALUE, Number.MAX_VALUE]);
    expect(overflow[1]).toBeNull();
    expectFiniteOrNull([...clamped, ...gaps, ...overflow]);
  });
});

describe("buildIndexSeries", () => {
  test("aligns the compounded series to the month axis", () => {
    const result = buildIndexSeries(["2025-01", "2025-02"], [10, -10, 5]);

    expect(result).toHaveLength(2);
    expect(result[0]).toBeCloseTo(110, 10);
    expect(result[1]).toBeCloseTo(99, 10);

    const padded = buildIndexSeries(["2025-01", "2025-02", "2025-03"], [10]);
    expect(padded).toHaveLength(3);
    expect(padded[0]).toBeCloseTo(110, 10);
    expect(padded[1]).toBeNull();
    expect(padded[2]).toBeNull();
  });

  test("keeps the 100 base through leading gaps", () => {
    const result = buildIndexSeries(["2025-01", "2025-02", "2025-03"], [null, 10, -10]);

    expect(result[0]).toBeNull();
    expect(result[1]).toBeCloseTo(110, 10);
    expect(result[2]).toBeCloseTo(99, 10);
  });
});

describe("drawdownSeries", () => {
  test("computes drawdown from the running peak", () => {
    const result = drawdownSeries([100, 110, 99]);

    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
    expect(result[2]).toBeCloseTo(-0.1, 10);
  });

  test("uses the 100 base as the initial peak and preserves gaps", () => {
    const result = drawdownSeries([90, null, 110, 88]);

    expect(result[0]).toBeCloseTo(-0.1, 10);
    expect(result[1]).toBeNull();
    expect(result[2]).toBe(0);
    expect(result[3]).toBeCloseTo(-0.2, 10);
    expectFiniteOrNull(result);
  });

  test("rejects non-finite indices", () => {
    expect(drawdownSeries([Number.NaN, Number.POSITIVE_INFINITY, null])).toEqual([
      null,
      null,
      null,
    ]);
  });
});

describe("relativeStrengthSeries", () => {
  test("normalizes the first common month to 100", () => {
    const result = relativeStrengthSeries(["2025-01", "2025-02", "2025-03"], [1, 1, 1], [0, 0, 0]);

    expect(result[0]).toBeCloseTo(100, 10);
    expect(result[1]).toBeCloseTo(101, 10);
    expect(result[2]).toBeCloseTo(102.01, 10);
  });

  test("keeps leading gaps and starts at the first common month", () => {
    const result = relativeStrengthSeries(
      ["2025-01", "2025-02", "2025-03"],
      [null, 10, 0],
      [5, 0, 0],
    );

    expect(result[0]).toBeNull();
    expect(result[1]).toBeCloseTo(100, 10);
    expect(result[2]).toBeCloseTo(100, 10);
  });

  test("preserves gaps after the base while keeping the normalization", () => {
    const result = relativeStrengthSeries(
      ["2025-01", "2025-02", "2025-03"],
      [10, null, 10],
      [0, 0, 0],
    );

    expect(result[0]).toBeCloseTo(100, 10);
    expect(result[1]).toBeNull();
    expect(result[2]).toBeCloseTo(110, 10);
  });

  test("keeps identical legs flat at 100", () => {
    const result = relativeStrengthSeries(
      ["2025-01", "2025-02", "2025-03"],
      [10, -10, 5],
      [10, -10, 5],
    );

    expect(result).toEqual([100, 100, 100]);
  });

  test("returns null throughout without a positive common ratio", () => {
    const missing = relativeStrengthSeries(["2025-01", "2025-02"], [10, 10], [null, null]);
    expect(missing).toEqual([null, null]);

    const wipedOut = relativeStrengthSeries(["2025-01", "2025-02"], [10, 10], [-100, 0]);
    expect(wipedOut).toEqual([null, null]);
    expectFiniteOrNull([...missing, ...wipedOut]);
  });
});

describe("seasonalityByMonth", () => {
  const cells: SectorHistorySeasonality[] = [
    makeCell("NIFTY IT", 1, 5, 1.5, 0.6),
    makeCell("NIFTY IT", 2, 4, -0.5, 1),
    makeCell("NIFTY IT", 12, 5, 2, 0.5),
    makeCell("PSU BANK", 3, 9, 9, 0.9),
  ];

  test("returns twelve labelled rows for the selected sector", () => {
    const rows = seasonalityByMonth(cells, "NIFTY IT");

    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ month: 0, label: "Jan", n: 5 });
    expect(rows[0].avg).toBeCloseTo(1.5, 10);
    expect(rows[0].hitRate).toBeCloseTo(60, 10);

    expect(rows[1]).toMatchObject({ month: 1, label: "Feb", n: 4 });
    expect(rows[1].avg).toBeCloseTo(-0.5, 10);
    expect(rows[1].hitRate).toBeCloseTo(100, 10);

    expect(rows[2]).toMatchObject({ month: 2, label: "Mar", avg: null, hitRate: null, n: 0 });
    expect(rows[11]).toMatchObject({ month: 11, label: "Dec", n: 5 });
    expect(rows[11].avg).toBeCloseTo(2, 10);
    expect(rows[11].hitRate).toBeCloseTo(50, 10);
  });

  test("accepts zero-based months", () => {
    const rows = seasonalityByMonth(
      [makeCell("NIFTY IT", 0, 4, 1.2, 0.5), makeCell("NIFTY IT", 11, 2, -0.8, 1)],
      "NIFTY IT",
    );

    expect(rows[0].avg).toBeCloseTo(1.2, 10);
    expect(rows[0].hitRate).toBeCloseTo(50, 10);
    expect(rows[11].avg).toBeCloseTo(-0.8, 10);
    expect(rows[11].hitRate).toBeCloseTo(100, 10);
  });

  test("clamps hit rates and sanitizes sample sizes", () => {
    const rows = seasonalityByMonth(
      [
        makeCell("NIFTY IT", 1, 4.6, Number.NaN, 150),
        makeCell("NIFTY IT", 2, -3, 0, -0.2),
        makeCell("NIFTY IT", 3, Number.NaN, 2, Number.NaN),
      ],
      "NIFTY IT",
    );

    expect(rows[0].avg).toBeNull();
    expect(rows[0].hitRate).toBeCloseTo(100, 10);
    expect(rows[0].n).toBe(5);
    expect(rows[1].avg).toBe(0);
    expect(rows[1].hitRate).toBe(0);
    expect(rows[1].n).toBe(0);
    expect(rows[2].avg).toBe(2);
    expect(rows[2].hitRate).toBeNull();
    expect(rows[2].n).toBe(0);
  });
});

describe("seasonalitySampleLabel", () => {
  test("reports an exact count when every month has the same sample", () => {
    expect(
      seasonalitySampleLabel([makeCell("NIFTY IT", 1, 5), makeCell("NIFTY IT", 2, 5)], "NIFTY IT"),
    ).toBe("n=5 per month");
  });

  test("reports the min–max range with an en dash", () => {
    expect(
      seasonalitySampleLabel([makeCell("NIFTY IT", 1, 3), makeCell("NIFTY IT", 2, 5)], "NIFTY IT"),
    ).toBe("n=3–5 per month");
  });

  test("ignores empty, negative, duplicate and other-sector samples", () => {
    const cells = [
      makeCell("NIFTY IT", 1, 4),
      makeCell("NIFTY IT", 1, 2),
      makeCell("NIFTY IT", 2, 0),
      makeCell("NIFTY IT", 3, -1),
      makeCell("NIFTY IT", 4, Number.NaN),
      makeCell("PSU BANK", 5, 9),
    ];

    expect(seasonalitySampleLabel(cells, "NIFTY IT")).toBe("n=2 per month");
  });

  test("handles zero-based months and returns the fallback without samples", () => {
    expect(
      seasonalitySampleLabel([makeCell("NIFTY IT", 0, 2), makeCell("NIFTY IT", 11, 3)], "NIFTY IT"),
    ).toBe("n=2–3 per month");
    expect(seasonalitySampleLabel([], "NIFTY IT")).toBe("");
    expect(seasonalitySampleLabel([makeCell("PSU BANK", 1, 5)], "NIFTY IT", "n unavailable")).toBe(
      "n unavailable",
    );
  });
});

describe("monthlyTransitionCount", () => {
  test("counts every observed adjacent rank pair", () => {
    const series = [
      makeSeries("A", [1, 2, 3, 4]),
      makeSeries("B", [4, 3, 2, 1]),
      makeSeries("C", [2, 2, 2, 2]),
    ];

    expect(monthlyTransitionCount(series)).toBe(9);
  });

  test("skips pairs with a missing or non-finite rank", () => {
    const series = [
      makeSeries("A", [1, null, 2, 1]),
      makeSeries("B", [8, null, 8, null]),
      makeSeries("C", [1, Number.NaN, 2, Number.POSITIVE_INFINITY]),
    ];

    expect(monthlyTransitionCount(series)).toBe(1);
  });

  test("excludes benchmarks", () => {
    const series = [
      makeSeries("NIFTY 50", [1, 2, 3, 4], true),
      makeSeries("NIFTY IT", [1, 2, 3, 4]),
    ];

    expect(monthlyTransitionCount(series)).toBe(3);
  });

  test("is zero for empty or single-observation series", () => {
    expect(monthlyTransitionCount([])).toBe(0);
    expect(monthlyTransitionCount([makeSeries("A", [])])).toBe(0);
    expect(monthlyTransitionCount([makeSeries("A", [1])])).toBe(0);
  });
});

describe("rankAt", () => {
  const series = makeSeries("A", [1, null, Number.NaN, Number.POSITIVE_INFINITY, 0, -2]);

  test("reads finite ranks, including zero and negative values", () => {
    expect(rankAt(series, 0)).toBe(1);
    expect(rankAt(series, 4)).toBe(0);
    expect(rankAt(series, 5)).toBe(-2);
  });

  test("returns null for null, non-finite and out-of-bounds indices", () => {
    expect(rankAt(series, 1)).toBeNull();
    expect(rankAt(series, 2)).toBeNull();
    expect(rankAt(series, 3)).toBeNull();
    expect(rankAt(series, -1)).toBeNull();
    expect(rankAt(series, 6)).toBeNull();
    expect(rankAt(series, 99)).toBeNull();
  });
});
