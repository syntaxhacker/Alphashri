// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  changeMatrix,
  groupPulse,
  iqrOutliers,
  monthlyBox,
  monthlyHeatmap,
  pricePercentile,
  realizedVolatility,
  rollingStats,
  seasonality,
  summariseEda,
  supplyDemand,
  type AgriEdaCompareSeries,
  type AgriEdaPoint,
} from "./agriEda";
import * as eda from "./agriEda";

function pt(date: string, modal: number | null, overrides: Partial<AgriEdaPoint> = {}): AgriEdaPoint {
  return { date, modal, min: null, max: null, arrivals_qtl: null, market_count: 1, ...overrides };
}

/** Escaping any non-finite number or undefined would corrupt every downstream chart. */
function expectClean(value: unknown, path = "result"): void {
  expect(value, `${path} must not be undefined`).not.toBeUndefined();
  if (value === null) return;
  if (typeof value === "number") {
    expect(Number.isFinite(value), `${path} must be finite`).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => expectClean(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      expectClean(item, `${path}.${key}`);
    }
  }
}

describe("monthlyBox", () => {
  it("computes linear quartiles from a single month", () => {
    const boxes = monthlyBox([
      pt("2026-01-01", 1),
      pt("2026-01-02", 2),
      pt("2026-01-03", 3),
      pt("2026-01-04", 4),
    ]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ month: "2026-01", label: "Jan 26", count: 4 });
    expect(boxes[0].min).toBe(1);
    expect(boxes[0].q1).toBeCloseTo(1.75, 6);
    expect(boxes[0].median).toBeCloseTo(2.5, 6);
    expect(boxes[0].q3).toBeCloseTo(3.25, 6);
    expect(boxes[0].max).toBe(4);
    expect(boxes[0].mean).toBeCloseTo(2.5, 6);
  });

  it("drops non-finite modals and bad dates, groups by month in order", () => {
    const boxes = monthlyBox([
      pt("2026-01-01", 10),
      pt("2026-01-02", null),
      pt("2026-01-03", NaN),
      pt("2026-02-01", 20),
      pt("2026-02-02", 22),
      pt("not-a-date", 999),
      pt("2026-13-01", 500),
    ]);
    expect(boxes.map((b) => b.month)).toEqual(["2026-01", "2026-02"]);
    expect(boxes[0].count).toBe(1);
    expect(boxes[0].median).toBe(10);
    expect(boxes[1].label).toBe("Feb 26");
    expect(boxes[1].count).toBe(2);
    expect(boxes[1].mean).toBeCloseTo(21, 6);
  });

  it("keeps a single observation and returns [] for empty input", () => {
    expect(monthlyBox([pt("2025-12-25", 42)])[0]).toMatchObject({
      label: "Dec 25",
      min: 42,
      q1: 42,
      median: 42,
      q3: 42,
      max: 42,
      count: 1,
    });
    expect(monthlyBox([])).toEqual([]);
    expect(monthlyBox(null)).toEqual([]);
  });

  it("counts duplicate dates as separate observations", () => {
    const boxes = monthlyBox([pt("2026-01-01", 10), pt("2026-01-01", 14)]);
    expect(boxes[0].count).toBe(2);
    expect(boxes[0].median).toBe(12);
  });
});

describe("rollingStats", () => {
  it("preserves length, nulls the warmup, and uses the trailing finite window", () => {
    const series = Array.from({ length: 10 }, (_, i) => pt(`2026-01-${String(i + 1).padStart(2, "0")}`, i + 1));
    const rolled = rollingStats(series, 3);
    expect(rolled).toHaveLength(series.length);
    expect(rolled[0]).toMatchObject({ modal: 1, mean: null, lower: null, upper: null, volatility: null });
    expect(rolled[1].mean).toBeNull();
    expect(rolled[2].modal).toBe(3);
    expect(rolled[2].mean).toBeCloseTo(2, 6);
    expect(rolled[2].volatility).toBeCloseTo(Math.sqrt(2 / 3), 6);
    expect(rolled[2].lower).toBeCloseTo(2 - 1.5 * Math.sqrt(2 / 3), 6);
    expect(rolled[2].upper).toBeCloseTo(2 + 1.5 * Math.sqrt(2 / 3), 6);
    expect(rolled[9].mean).toBeCloseTo(9, 6);
  });

  it("skips null modals so the warmup extends past window-1 rows", () => {
    const rolled = rollingStats(
      [pt("2026-01-01", 1), pt("2026-01-02", null), pt("2026-01-03", 2), pt("2026-01-04", 3), pt("2026-01-05", 4)],
      3,
    );
    expect(rolled.map((r) => r.mean)).toEqual([null, null, null, 2, 3]);
    expect(rolled[1].modal).toBeNull();
  });

  it("handles window=1, clamps window<1, and returns [] for empty input", () => {
    const one = rollingStats([pt("2026-01-01", 5), pt("2026-01-02", NaN), pt("2026-01-03", 7)], 1);
    expect(one[0]).toMatchObject({ mean: 5, lower: 5, upper: 5, volatility: 0 });
    expect(one[1].mean).toBeNull();
    expect(one[2].mean).toBe(7);
    expect(rollingStats([pt("2026-01-01", 5)], 0)[0].mean).toBe(5);
    expect(rollingStats([], 7)).toEqual([]);
  });

  it("includes an observation exactly 7 days later, breaks at 8", () => {
    const boundary = rollingStats([pt("2026-01-01", 10), pt("2026-01-08", 20)], 2);
    expect(boundary[1]).toMatchObject({ mean: 15, n: 2, gapDays: 7, skippedGaps: 0 });

    const gap = rollingStats([pt("2026-01-01", 10), pt("2026-01-09", 20)], 2);
    expect(gap[1]).toMatchObject({ mean: null, n: 1, gapDays: 8, skippedGaps: 1 });
  });

  it("never mixes values across a gap and exposes the skipped hole", () => {
    const rolled = rollingStats(
      [
        pt("2026-01-01", 1),
        pt("2026-01-02", 2),
        pt("2026-01-12", 10),
        pt("2026-01-13", 11),
        pt("2026-01-14", 12),
      ],
      3,
    );
    expect(rolled[2]).toMatchObject({ mean: null, n: 1, gapDays: 10, skippedGaps: 1 });
    expect(rolled[3]).toMatchObject({ mean: null, n: 2, gapDays: 1, skippedGaps: 1 });
    expect(rolled[4]).toMatchObject({ mean: 11, n: 3, gapDays: 1, skippedGaps: 0 });
    expect(rolled[4].lower).toBeCloseTo(11 - 1.5 * Math.sqrt(2 / 3), 6);
  });
});

describe("realizedVolatility", () => {
  it("uses population std of log returns", () => {
    const result = realizedVolatility([
      pt("2026-01-01", 100),
      pt("2026-01-02", 110),
      pt("2026-01-03", 99),
    ]);
    const first = Math.log(110 / 100);
    const second = Math.log(99 / 110);
    const mean = (first + second) / 2;
    const expected = Math.sqrt(((first - mean) ** 2 + (second - mean) ** 2) / 2);
    expect(result).toMatchObject({ n: 2, skippedGaps: 0 });
    expect(result.value).toBeCloseTo(expected, 12);
  });

  it("skips a return across a gap longer than maxGapDays", () => {
    const result = realizedVolatility([
      pt("2026-01-01", 100),
      pt("2026-01-02", 110),
      pt("2026-01-10", 200),
      pt("2026-01-11", 220),
    ]);
    expect(result.n).toBe(2);
    expect(result.skippedGaps).toBe(1);
    expect(result.value).toBeCloseTo(0, 12);
  });

  it("keeps an exactly-7-day return at the boundary", () => {
    const result = realizedVolatility([
      pt("2026-01-01", 100),
      pt("2026-01-08", 110),
      pt("2026-01-09", 121),
    ]);
    expect(result).toMatchObject({ n: 2, skippedGaps: 0 });
    expect(result.value).not.toBeNull();
  });

  it("returns null below two usable returns and ignores non-positive prices", () => {
    expect(realizedVolatility([pt("2026-01-01", 100), pt("2026-01-02", 110)])).toEqual({
      value: null,
      n: 1,
      skippedGaps: 0,
    });
    expect(realizedVolatility([pt("2026-01-01", 0), pt("2026-01-02", 110)])).toEqual({
      value: null,
      n: 0,
      skippedGaps: 0,
    });
    expect(realizedVolatility([])).toEqual({ value: null, n: 0, skippedGaps: 0 });
    expect(realizedVolatility(null)).toEqual({ value: null, n: 0, skippedGaps: 0 });
  });
});

describe("pricePercentile", () => {
  it("ranks the current modal against its trailing window", () => {
    const series = [10, 20, 40, 50, 30].map((modal, i) => pt(`2026-01-0${i + 1}`, modal));
    expect(pricePercentile(series, 5)).toBe(60);
    expect(pricePercentile(series.slice(0, 3), 3)).toBe(100);
  });

  it("uses only the last `window` observations", () => {
    const series = [1, 2, 100, 200, 150].map((modal, i) => pt(`2026-01-0${i + 1}`, modal));
    expect(pricePercentile(series, 3)).toBeCloseTo((2 / 3) * 100, 12);
    expect(pricePercentile(series, 5)).toBe(80);
  });

  it("is null until the full window exists and ignores missing modals", () => {
    expect(pricePercentile([10, 20, 30, 40].map((modal, i) => pt(`2026-01-0${i + 1}`, modal)), 5)).toBeNull();
    expect(pricePercentile([], 5)).toBeNull();
    expect(pricePercentile(null, 5)).toBeNull();
    expect(pricePercentile([pt("2026-01-01", 10), pt("2026-01-02", null), pt("2026-01-03", 20), pt("2026-01-04", NaN), pt("2026-01-05", 30)], 3)).toBe(100);
  });
});

describe("changeMatrix", () => {
  it("computes 1W/1M/3M/6M from exact anchors", () => {
    const result = changeMatrix([
      pt("2025-10-01", 100),
      pt("2025-12-31", 100),
      pt("2026-03-02", 100),
      pt("2026-03-25", 100),
      pt("2026-04-01", 120),
    ]);
    expect(result).toMatchObject({ asOf: "2026-04-01", modal: 120, n: 5 });
    expect(result.changes).toEqual({ "1W": 20, "1M": 20, "3M": 20, "6M": 20 });
    for (const key of ["1W", "1M", "3M", "6M"] as const) {
      expect(result.anchors[key]).toMatchObject({
        withinTolerance: true,
        daysFromTarget: 0,
        changePct: 20,
      });
    }
    expect(result.anchors["1W"].targetDate).toBe("2026-03-25");
    expect(result.anchors["1M"].targetDate).toBe("2026-03-02");
    expect(result.anchors["3M"].targetDate).toBe("2025-12-31");
    expect(result.anchors["6M"].targetDate).toBe("2025-10-01");
  });

  it("accepts each tolerance boundary and nulls one day beyond it", () => {
    const cases = [
      { window: "1W", target: "2026-03-25", at: "2026-03-22", beyond: "2026-03-21" },
      { window: "1M", target: "2026-03-02", at: "2026-02-23", beyond: "2026-02-22" },
      { window: "3M", target: "2025-12-31", at: "2025-12-17", beyond: "2025-12-16" },
      { window: "6M", target: "2025-10-01", at: "2025-09-10", beyond: "2025-09-09" },
    ] as const;

    for (const entry of cases) {
      const at = changeMatrix([pt(entry.at, 100), pt("2026-04-01", 120)]);
      expect(at.changes[entry.window], `${entry.window} boundary`).toBe(20);
      expect(at.anchors[entry.window]).toMatchObject({ targetDate: entry.target, withinTolerance: true });

      const beyond = changeMatrix([pt(entry.beyond, 100), pt("2026-04-01", 120)]);
      expect(beyond.changes[entry.window], `${entry.window} beyond`).toBeNull();
      expect(beyond.anchors[entry.window]).toMatchObject({
        targetDate: entry.target,
        withinTolerance: false,
        changePct: null,
      });
    }
  });

  it("returns null cells across a collection hole instead of a multi-month move", () => {
    const result = changeMatrix([pt("2025-09-01", 100), pt("2026-04-01", 200)]);
    expect(result.asOf).toBe("2026-04-01");
    expect(result.changes).toEqual({ "1W": null, "1M": null, "3M": null, "6M": null });
    expect(result.anchors["1W"]).toMatchObject({
      date: "2025-09-01",
      withinTolerance: false,
      changePct: null,
    });
    // 6M sees a pre-target observation, but 30 days out is a gap, not the window.
    expect(result.anchors["6M"]).toMatchObject({
      date: "2025-09-01",
      withinTolerance: false,
      changePct: null,
    });
  });

  it("keeps the last finite duplicate and returns nulls for empty input", () => {
    const result = changeMatrix([
      pt("2026-03-25", 50),
      pt("2026-03-25", 100),
      pt("2026-04-01", 120),
    ]);
    expect(result.changes["1W"]).toBe(20);
    expect(result.n).toBe(2);

    expect(changeMatrix([])).toMatchObject({
      key: "",
      label: "",
      asOf: null,
      modal: null,
      n: 0,
      changes: { "1W": null, "1M": null, "3M": null, "6M": null },
    });
    expect(changeMatrix(null, { key: "onion", label: "Onion" })).toMatchObject({ key: "onion", label: "Onion" });
  });
});

describe("groupPulse", () => {
  it("builds one gap-guarded row per comparison series", () => {
    const source: AgriEdaCompareSeries[] = [
      {
        key: "wheat",
        label: "Wheat",
        points: [pt("2026-03-25", 100), pt("2026-04-01", 120)],
      },
      {
        key: "onion",
        label: "Onion",
        points: [pt("2026-03-25", 200), pt("2026-04-01", 220)],
      },
    ];
    const rows = groupPulse(source);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: "wheat", label: "Wheat" });
    expect(rows[0].changes["1W"]).toBe(20);
    expect(rows[1].changes["1W"]).toBeCloseTo(10, 12);
    expect(rows[0].changes["6M"]).toBeNull();
  });

  it("skips malformed entries and returns [] for empty input", () => {
    expect(groupPulse([])).toEqual([]);
    expect(groupPulse(null)).toEqual([]);
    const rows = groupPulse([
      { key: "ok", label: "Ok", points: [pt("2026-04-01", 10)] },
      { key: "bad", label: "Bad", points: [pt("2026-04-01", 10)] },
    ]);
    expect(rows.map((row) => row.key)).toEqual(["ok", "bad"]);
    expect(groupPulse([{ key: 1, label: "x", points: [] } as unknown as AgriEdaCompareSeries])).toEqual([]);
  });
});

describe("seasonality", () => {
  it("groups by calendar month across years and is not weak with >=2 years", () => {
    const result = seasonality([
      pt("2025-01-10", 100),
      pt("2025-01-11", 110),
      pt("2025-02-10", 200),
      pt("2026-01-10", 120),
      pt("2026-02-10", 220),
      pt("2026-02-11", null),
      pt("2026-02-12", NaN),
    ]);
    expect(result.weak).toBe(false);
    expect(result.months.map((m) => m.month)).toEqual([1, 2]);
    expect(result.months[0]).toMatchObject({ month: 1, years: 2, count: 3, min: 100, max: 120 });
    expect(result.months[0].avg).toBeCloseTo(110, 6);
    expect(result.months[0].median).toBeCloseTo(110, 6);
    expect(result.months[1]).toMatchObject({ month: 2, years: 2, count: 2, avg: 210 });
  });

  it("marks a single-year series weak and includes only observed months", () => {
    const result = seasonality([pt("2026-03-01", 5), pt("2026-03-02", 7), pt("2026-03-03", null)]);
    expect(result.weak).toBe(true);
    expect(result.months).toHaveLength(1);
    expect(result.months[0]).toMatchObject({ month: 3, years: 1, count: 2, avg: 6, median: 6 });
  });

  it("returns an empty, weak result for no data", () => {
    expect(seasonality([])).toEqual({ months: [], weak: true });
  });
});

describe("supplyDemand", () => {
  it("fits a perfect positive relationship", () => {
    const series = [1, 2, 3, 4, 5].map((v, i) =>
      pt(`2026-01-0${i + 1}`, v * 10, { arrivals_qtl: v }),
    );
    const result = supplyDemand(series);
    expect(result.n).toBe(5);
    expect(result.pearson).toBeCloseTo(1, 6);
    expect(result.slope).toBeCloseTo(10, 6);
    expect(result.intercept).toBeCloseTo(0, 6);
    expect(result.r2).toBeCloseTo(1, 6);
    expect(result.points[0]).toMatchObject({ arrivals_qtl: 1, modal: 10, laggedModal: 10 });
  });

  it("fits a negative relationship and reports r2 = pearson^2", () => {
    const series = [1, 2, 3, 4, 5].map((v, i) =>
      pt(`2026-01-0${i + 1}`, 60 - v * 10, { arrivals_qtl: v }),
    );
    const result = supplyDemand(series);
    expect(result.pearson).toBeCloseTo(-1, 6);
    expect(result.slope).toBeCloseTo(-10, 6);
    expect(result.r2).toBeCloseTo(1, 6);
    expect(result.r2).toBeCloseTo((result.pearson as number) ** 2, 6);
  });

  it("reports ~zero correlation for a symmetric non-monotonic pattern", () => {
    const modals = [1, 3, 5, 3, 1];
    const series = modals.map((modal, i) => pt(`2026-01-0${i + 1}`, modal, { arrivals_qtl: i + 1 }));
    const result = supplyDemand(series);
    expect(result.pearson).toBeCloseTo(0, 6);
    expect(result.slope).toBeCloseTo(0, 6);
    expect(result.intercept).toBeCloseTo(2.6, 6);
    expect(result.r2).toBeCloseTo(0, 6);
  });

  it("aligns arrivals with the modal lagDays later (0 = same day)", () => {
    const series = [
      pt("2026-01-01", 999, { arrivals_qtl: 10 }),
      pt("2026-01-02", 100, { arrivals_qtl: 20 }),
      pt("2026-01-03", 200, { arrivals_qtl: 30 }),
      pt("2026-01-04", 300),
    ];
    const lagged = supplyDemand(series, 1);
    expect(lagged.points[0].laggedModal).toBe(100);
    expect(lagged.points[0].modal).toBe(999);
    expect(lagged.n).toBe(3);
    expect(lagged.pearson).toBeCloseTo(1, 6);
    expect(lagged.slope).toBeCloseTo(10, 6);
    expect(supplyDemand(series, 0).points[0].laggedModal).toBe(999);
  });

  it("uses the last finite modal for a duplicate target date", () => {
    const result = supplyDemand(
      [
        pt("2026-01-01", 0, { arrivals_qtl: 1 }),
        pt("2026-01-02", 100),
        pt("2026-01-02", 200),
      ],
      1,
    );
    expect(result.points[0].laggedModal).toBe(200);
  });

  it("returns null statistics for constant x and for <2 finite pairs", () => {
    const constant = supplyDemand(
      [1, 2, 3].map((i) => pt(`2026-01-0${i}`, i * 10, { arrivals_qtl: 5 })),
    );
    expect(constant.n).toBe(3);
    expect(constant.pearson).toBeNull();
    expect(constant.slope).toBeNull();
    expect(constant.intercept).toBeNull();
    expect(constant.r2).toBeNull();
    expect(supplyDemand([pt("2026-01-01", 10, { arrivals_qtl: 1 })])).toMatchObject({
      n: 1,
      pearson: null,
      slope: null,
      intercept: null,
      r2: null,
    });
    expect(supplyDemand([])).toMatchObject({ n: 0, points: [], pearson: null });
  });
});

describe("monthlyHeatmap", () => {
  it("averages finite modals per month per comparison series", () => {
    const source: AgriEdaCompareSeries[] = [
      {
        key: "wheat",
        label: "Wheat",
        points: [
          { date: "2026-01-01", modal: 100 },
          { date: "2026-01-02", modal: 120 },
          { date: "2026-02-01", modal: null },
          { date: "2026-02-02", modal: 200 },
          { date: "2026-02-03", modal: NaN },
          { date: "bad", modal: 999 },
        ],
      },
      {
        key: "onion",
        label: "Onion",
        points: [
          { date: "2026-01-01", modal: 50 },
          { date: "2026-03-01", modal: 70 },
        ],
      },
    ];
    const rows = monthlyHeatmap(source);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: "wheat", label: "Wheat" });
    expect(rows[0].months).toEqual([
      { month: "2026-01", modal: 110 },
      { month: "2026-02", modal: 200 },
    ]);
    expect(rows[1].months).toEqual([
      { month: "2026-01", modal: 50 },
      { month: "2026-03", modal: 70 },
    ]);
  });

  it("returns [] for empty input and an empty months list for a series with no data", () => {
    expect(monthlyHeatmap([])).toEqual([]);
    expect(monthlyHeatmap([{ key: "empty", label: "Empty", points: [] }])).toEqual([
      { key: "empty", label: "Empty", months: [] },
    ]);
  });
});

describe("iqrOutliers", () => {
  it("flags low and high Tukey-fence outliers in series order", () => {
    const values = [0, 10, 11, 12, 12, 13, 13, 14, 100];
    const series = values.map((modal, i) => pt(`2026-01-${String(i + 1).padStart(2, "0")}`, modal));
    const outliers = iqrOutliers(series);
    expect(outliers).toHaveLength(2);
    expect(outliers[0]).toMatchObject({ modal: 0, side: "low" });
    expect(outliers[1]).toMatchObject({ modal: 100, side: "high" });
    expect(outliers[0].lowFence).toBeCloseTo(8, 6);
    expect(outliers[0].highFence).toBeCloseTo(16, 6);
  });

  it("returns [] when nothing is outlying and for empty input", () => {
    expect(iqrOutliers([10, 11, 12, 13, 14].map((v, i) => pt(`2026-01-0${i + 1}`, v)))).toEqual([]);
    expect(iqrOutliers([])).toEqual([]);
  });

  it("ignores null/NaN but preserves duplicate outlier dates", () => {
    const outliers = iqrOutliers([
      ...[10, 11, 12, 12, 13, 13, 14].map((v, i) => pt(`2026-01-${String(i + 1).padStart(2, "0")}`, v)),
      pt("2026-01-08", NaN),
      pt("2026-01-09", null),
      pt("2026-02-01", 100),
      pt("2026-02-01", 100),
    ]);
    expect(outliers.map((o) => o.date)).toEqual(["2026-02-01", "2026-02-01"]);
    expect(outliers.every((o) => o.side === "high")).toBe(true);
  });
});

describe("summariseEda", () => {
  it("summarises trend, volatility, best/worst month, correlation and outliers", () => {
    const values = [100, 110, 200, 220, 120, 240];
    const dates = ["2025-01-01", "2025-01-02", "2025-02-01", "2025-02-02", "2026-01-01", "2026-02-01"];
    const series = values.map((modal, i) => pt(dates[i], modal, { arrivals_qtl: modal / 10 }));
    const summary = summariseEda(series);
    expect(summary.trendPct).toBeCloseTo(140, 6);
    expect(summary.volatilityPct).toBeGreaterThan(0);
    expect(summary.volatilityPct).toBeCloseTo((Math.sqrt(19150 / 6) / 165) * 100, 6);
    expect(summary.bestMonth).toBe(2);
    expect(summary.worstMonth).toBe(1);
    expect(summary.arrivalsCorrelation).toBeCloseTo(1, 6);
    expect(summary.outlierCount).toBe(0);
  });

  it("reports outlierCount from the fences", () => {
    const values = [0, 10, 11, 12, 12, 13, 13, 14, 100];
    expect(summariseEda(values.map((modal, i) => pt(`2026-01-${String(i + 1).padStart(2, "0")}`, modal))).outlierCount).toBe(2);
  });

  it("returns nulls and zero outliers for empty data, and guards zero first/mean", () => {
    expect(summariseEda([])).toEqual({
      trendPct: null,
      volatilityPct: null,
      bestMonth: null,
      worstMonth: null,
      arrivalsCorrelation: null,
      outlierCount: 0,
    });
    expect(summariseEda([pt("2026-01-01", 0)])).toMatchObject({ trendPct: null, volatilityPct: null });
  });
});

describe("no NaN / undefined leaks", () => {
  it("every helper stays finite on dirty input", () => {
    const dirty: AgriEdaPoint[] = [
      pt("2026-01-01", NaN, { arrivals_qtl: NaN }),
      pt("2026-01-02", Infinity, { arrivals_qtl: Infinity }),
      pt("bad-date", 10, { arrivals_qtl: 1 }),
      pt("2026-02-01", null, { arrivals_qtl: null }),
      pt("2026-02-02", 20, { arrivals_qtl: 2 }),
      pt("2026-02-03", 30, { arrivals_qtl: 3 }),
      pt("2026-02-04", 40, { arrivals_qtl: 4 }),
      pt("2026-02-05", 50, { arrivals_qtl: 5 }),
    ];
    expectClean(monthlyBox(dirty));
    expectClean(rollingStats(dirty, 3));
    expectClean(realizedVolatility(dirty));
    expectClean(pricePercentile(dirty, 3));
    expectClean(changeMatrix(dirty));
    expectClean(
      groupPulse([
        { key: "dirty", label: "Dirty", points: dirty.map((p) => ({ date: p.date, modal: p.modal })) },
      ]),
    );
    expectClean(seasonality(dirty));
    expectClean(supplyDemand(dirty, 1));
    expectClean(
      monthlyHeatmap([
        { key: "x", label: "X", points: dirty.map((p) => ({ date: p.date, modal: p.modal })) },
      ]),
    );
    expectClean(iqrOutliers(dirty));
    expectClean(summariseEda(dirty));
  });
});

describe("public import surface", () => {
  it("barrel re-exports every runtime symbol", () => {
    expect(Object.keys(eda).sort()).toEqual(
      [
        "CHANGE_WINDOWS",
        "changeMatrix",
        "groupPulse",
        "iqrOutliers",
        "monthlyBox",
        "monthlyHeatmap",
        "pricePercentile",
        "realizedVolatility",
        "rollingStats",
        "seasonality",
        "summariseEda",
        "supplyDemand",
      ].sort(),
    );
  });
});
