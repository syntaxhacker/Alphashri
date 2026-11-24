// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import type {
  SectorHistorySeasonality,
  SectorHistorySeries,
} from "../../../../types/sectorHistory";
import {
  CHART_CURRENT,
  CHART_LINE,
  CHART_MUTED,
  CHART_NEGATIVE,
  CHART_POSITIVE,
} from "./chartPalette";
import {
  UnderwaterDrawdown,
  buildDrawdownAxis,
  buildIndexSeries,
  buildUnderwaterModel,
  buildUnderwaterOption,
  formatUnderwaterTooltip,
} from "./UnderwaterDrawdown";
import {
  SeasonalityRadial,
  buildSeasonalityRadialModel,
  buildSeasonalityRadialOption,
} from "./SeasonalityRadial";
import {
  RelativeStrength,
  buildCumulativeIndex,
  buildRelativeStrengthModel,
  buildRelativeStrengthOption,
} from "./RelativeStrength";
import {
  RelativeStrengthTrail,
  buildRelativeStrengthTrailOption,
  buildRsTrailModel,
} from "./RelativeStrengthTrail";
import { signedPct } from "./shared";

const chartCapture = vi.hoisted(() => ({
  options: [] as Array<Record<string, any>>,
  styles: [] as Array<Record<string, any>>,
}));

vi.mock("../../../common/EChart", () => ({
  EChart: (props: {
    option: Record<string, any>;
    style?: Record<string, any>;
    "data-testid"?: string;
  }) => {
    chartCapture.options.push(props.option);
    chartCapture.styles.push(props.style ?? {});
    const el = document.createElement("div");
    el.setAttribute("data-testid", props["data-testid"] ?? "");
    return el;
  },
}));

const MONTHS = Array.from({ length: 18 }, (_, index) => {
  const year = 2024 + Math.floor(index / 12);
  const month = String((index % 12) + 1).padStart(2, "0");
  return `${year}-${month}`;
});

const LONG_MONTHS = Array.from({ length: 24 }, (_, index) => {
  const year = 2023 + Math.floor(index / 12);
  const month = String((index % 12) + 1).padStart(2, "0");
  return `${year}-${month}`;
});

const DRAWDOWN_RETURNS: (number | null)[] = [
  2, -3, -4, 5, 2, -1, 6, -2, 1, -5, 3, 4, -2, 1, 2, -3, 4, 2,
];

function makeSeries(
  name: string,
  returns: (number | null)[],
  benchmark = false,
): SectorHistorySeries {
  return {
    name,
    is_benchmark: benchmark,
    monthly_returns: returns,
    ranks: returns.map(() => null),
  };
}

function steadySeries(name: string, months: string[], benchmark = false): SectorHistorySeries {
  return makeSeries(
    name,
    months.map(() => (benchmark ? 0 : 1)),
    benchmark,
  );
}

const BENCHMARK = steadySeries("NIFTY 50", MONTHS, true);
const SECTOR = steadySeries("NIFTY IT", MONTHS);

const RADIAL_CELLS: SectorHistorySeasonality[] = Array.from(
  { length: 12 },
  (_, index) => index + 1,
).flatMap((month) => [
  {
    name: "NIFTY IT",
    month,
    avg_return: month % 2 === 0 ? 2.1 : -1.4,
    hit_rate: 0.6,
    n: 5,
  },
  {
    name: "PSU BANK",
    month,
    avg_return: 1,
    hit_rate: 0.5,
    n: 3,
  },
]);

function expectNoNaN(value: unknown, path = "option"): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value), `${path} must be finite`).toBe(true);
    return;
  }
  if (typeof value === "string") {
    expect(value, `${path} must not contain NaN`).not.toContain("NaN");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => expectNoNaN(item, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      expectNoNaN(item, `${path}.${key}`);
    }
  }
}

function optionSeries(option: Record<string, any>): any[] {
  return option.series as any[];
}

beforeEach(() => {
  chartCapture.options.length = 0;
  chartCapture.styles.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("UnderwaterDrawdown", () => {
  test("compounds monthly returns from 100 and breaks on missing closes", () => {
    const index = buildIndexSeries([10, -10]);
    expect(index[0]).toBeCloseTo(110, 6);
    expect(index[1]).toBeCloseTo(99, 6);

    const gap = buildIndexSeries([10, null, -10]);
    expect(gap[0]).toBeCloseTo(110, 6);
    expect(gap[1]).toBeNull();
    expect(gap[2]).toBeCloseTo(99, 6);
  });

  test("computes drawdown from the running peak and marks the deepest month", () => {
    const model = buildUnderwaterModel(["2025-01", "2025-02", "2025-03"], [10, -10, 5]);
    expect(model.hasData).toBe(true);
    expect(model.drawdowns[0]).toBeCloseTo(0, 6);
    expect(model.drawdowns[1]).toBeCloseTo(-0.1, 6);
    expect(model.drawdowns[2]).toBeCloseTo(-0.055, 6);
    expect(model.maxDrawdown).toBeCloseTo(-0.1, 6);
    expect(model.maxDrawdownMonth).toBe("2025-02");
  });

  test("builds a negative-fill line with a zero baseline and max marker", () => {
    const model = buildUnderwaterModel(MONTHS.slice(0, 4), [10, -10, null, 5]);
    const option = buildUnderwaterOption(model);
    const series = optionSeries(option)[0];

    expect(series.type).toBe("line");
    expect(series.markLine.data[0].yAxis).toBe(0);
    expect(series.markPoint.data[0].coord[0]).toBe("2024-02");
    expect(series.markPoint.data[0].value).toBeCloseTo(-10, 6);
    expect(series.markPoint.label.show).toBe(false);
    expect(series.data[0]).toBeCloseTo(0, 6);
    expect(series.data[1]).toBeCloseTo(-10, 6);
    expect(series.data[2]).toBeNull();
    expect(option.aria.enabled).toBe(true);
    expect((option.xAxis as { axisLabel: { color: string } }).axisLabel.color).toBe(CHART_MUTED);
    expect((option.yAxis as { axisLabel: { color: string } }).axisLabel.color).toBe(CHART_MUTED);
    expectNoNaN(option);
  });

  test("uses a y-axis step of at least 0.1pp and unique one-decimal tick labels", () => {
    expect(buildDrawdownAxis([0, -0.31, -1.2])).toMatchObject({ max: 0 });
    expect(buildDrawdownAxis([0, -0.31, -1.2]).interval).toBeGreaterThanOrEqual(0.1);

    const model = buildUnderwaterModel(
      ["2025-01", "2025-02", "2025-03", "2025-04"],
      [1, -0.2, 0.1, -0.1],
    );
    const option = buildUnderwaterOption(model);
    const yAxis = option.yAxis as {
      min: number;
      max: number;
      interval: number;
      axisLabel: { formatter: (value: number) => string };
    };
    const labels: string[] = [];
    for (let value = yAxis.max; value >= yAxis.min - 1e-9; value -= yAxis.interval) {
      labels.push(yAxis.axisLabel.formatter(Number(value.toFixed(2))));
    }

    expect(yAxis.max).toBe(0);
    expect(yAxis.interval).toBeGreaterThanOrEqual(0.1);
    expect(labels.length).toBeGreaterThan(1);
    expect(labels).toContain("0.0%");
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) {
      expect(label).toMatch(/^-?\d+\.\d%$/);
    }
  });

  test("formats the tooltip as month and signed percent", () => {
    expect(formatUnderwaterTooltip({ axisValue: "2025-02", value: -4.2 })).toBe("2025-02 · -4.2%");
    expect(formatUnderwaterTooltip([{ axisValue: "2025-03", value: null }])).toBe(
      "2025-03 · no data",
    );
  });

  test("renders the chart, title, method note and max-drawdown caption", () => {
    render(() => (
      <UnderwaterDrawdown
        months={MONTHS}
        series={[BENCHMARK, makeSeries("NIFTY IT", DRAWDOWN_RETURNS)]}
        sector="NIFTY IT"
      />
    ));

    const model = buildUnderwaterModel(MONTHS, DRAWDOWN_RETURNS);
    const expectedCaption = `Max drawdown ${signedPct((model.maxDrawdown ?? 0) * 100)} · ${model.maxDrawdownMonth}`;

    expect(screen.getByText("Monthly drawdown · NIFTY IT")).toBeInTheDocument();
    expect(screen.getByText("monthly closes; risk table uses daily closes")).toBeInTheDocument();
    expect(screen.getByTestId("history-underwater-chart")).toBeInTheDocument();
    expect(screen.getByTestId("history-underwater-caption")).toHaveTextContent(expectedCaption);
    expect(chartCapture.styles.at(-1)).toMatchObject({ height: "250px" });
    expect(chartCapture.options.at(-1)!.aria.enabled).toBe(true);
    expectNoNaN(chartCapture.options.at(-1));
  });

  test("hides the internal title and method note when showHeader is false", () => {
    render(() => (
      <UnderwaterDrawdown
        months={MONTHS}
        series={[BENCHMARK, makeSeries("NIFTY IT", DRAWDOWN_RETURNS)]}
        sector="NIFTY IT"
        showHeader={false}
      />
    ));

    expect(screen.queryByTestId("history-underwater-header")).not.toBeInTheDocument();
    expect(screen.queryByText("Monthly drawdown · NIFTY IT")).not.toBeInTheDocument();
    expect(
      screen.queryByText("monthly closes; risk table uses daily closes"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("history-underwater-chart")).toBeInTheDocument();
    expect(screen.getByTestId("history-underwater-caption")).toBeInTheDocument();
  });

  test("renders compact empty states for a missing sector and missing history", () => {
    render(() => <UnderwaterDrawdown months={MONTHS} series={[BENCHMARK]} sector="NIFTY IT" />);
    expect(screen.getByTestId("history-underwater-empty")).toHaveTextContent(
      "No history for NIFTY IT",
    );
    expect(screen.queryByTestId("history-underwater-chart")).not.toBeInTheDocument();

    cleanup();
    render(() => (
      <UnderwaterDrawdown
        months={MONTHS}
        series={[
          makeSeries(
            "NIFTY IT",
            MONTHS.map(() => null),
          ),
        ]}
        sector="NIFTY IT"
      />
    ));
    expect(screen.getByTestId("history-underwater-empty")).toHaveTextContent(
      "No drawdown history for NIFTY IT",
    );
  });
});

describe("SeasonalityRadial", () => {
  test("maps months to twelve entries with signed tones and hit rates", () => {
    const model = buildSeasonalityRadialModel(RADIAL_CELLS, "NIFTY IT");
    expect(model.hasData).toBe(true);
    expect(model.entries).toHaveLength(12);
    expect(model.entries[0].avg).toBeCloseTo(-1.4, 6);
    expect(model.entries[0].color).toBe(CHART_NEGATIVE);
    expect(model.entries[5].avg).toBeCloseTo(2.1, 6);
    expect(model.entries[5].color).toBe(CHART_POSITIVE);
    expect(model.entries[5].hitPct).toBeCloseTo(60, 6);
    expect(model.entries[5].n).toBe(5);
    expect(model.sampleLabel).toBe("n=5 per month");
  });

  test("accepts zero-based months and leaves unknown months empty", () => {
    const cells: SectorHistorySeasonality[] = [
      { name: "NIFTY IT", month: 0, avg_return: 1.2, hit_rate: 0.5, n: 4 },
      { name: "NIFTY IT", month: 11, avg_return: -0.8, hit_rate: 1, n: 2 },
    ];
    const model = buildSeasonalityRadialModel(cells, "NIFTY IT");
    expect(model.entries[0].avg).toBeCloseTo(1.2, 6);
    expect(model.entries[11].avg).toBeCloseTo(-0.8, 6);
    expect(model.entries[11].hitPct).toBe(100);
    expect(model.entries[5].avg).toBeNull();
  });

  test("builds a polar bar with 12 values and a tooltip carrying avg, hit and n", () => {
    const option = buildSeasonalityRadialOption(RADIAL_CELLS, "NIFTY IT");
    const series = optionSeries(option)[0];
    const tooltip = option.tooltip.formatter({ dataIndex: 5 });

    expect(option.polar).toBeTruthy();
    expect(option.angleAxis.data).toHaveLength(12);
    expect(series.type).toBe("bar");
    expect(series.coordinateSystem).toBe("polar");
    expect(series.data).toHaveLength(12);
    expect(series.data[5].value).toBeCloseTo(2.1, 6);
    expect(series.data[0].value).toBeCloseTo(-1.4, 6);
    expect(tooltip).toContain("avg");
    expect(tooltip).toContain("hit rate 60%");
    expect(tooltip).toContain("n=5");
    expect(option.aria.enabled).toBe(true);
    const description = option.aria.label.description as string;
    expect(description).toContain("Orange bars");
    expect(description).toContain("blue bars");
    expect(description).not.toContain("Green bars");
    expect(description).not.toContain("red bars");
    expectNoNaN(option);
  });

  test("renders the chart and the history footer", () => {
    render(() => <SeasonalityRadial cells={RADIAL_CELLS} sector="NIFTY IT" />);
    expect(screen.getByText("Seasonality · NIFTY IT")).toBeInTheDocument();
    expect(screen.getByTestId("history-seasonality-radial-chart")).toBeInTheDocument();
    expect(screen.getByTestId("history-seasonality-radial-key")).toHaveTextContent(
      "orange positive · blue negative",
    );
    expect(screen.getByTestId("history-seasonality-radial-note")).toHaveTextContent(
      "avg return by month · hit rate in tooltip · n=5 per month · history, not a forecast",
    );
    expect(chartCapture.styles.at(-1)).toMatchObject({ height: "300px" });
    expectNoNaN(chartCapture.options.at(-1));
  });

  test("hides only the title when showHeader is false and keeps the history note", () => {
    render(() => <SeasonalityRadial cells={RADIAL_CELLS} sector="NIFTY IT" showHeader={false} />);

    expect(screen.queryByTestId("history-seasonality-radial-header")).not.toBeInTheDocument();
    expect(screen.queryByText("Seasonality · NIFTY IT")).not.toBeInTheDocument();
    expect(screen.getByTestId("history-seasonality-radial-chart")).toBeInTheDocument();
    expect(screen.getByTestId("history-seasonality-radial-key")).toHaveTextContent(
      "orange positive · blue negative",
    );
    expect(screen.getByTestId("history-seasonality-radial-note")).toHaveTextContent(
      "avg return by month · hit rate in tooltip · n=5 per month · history, not a forecast",
    );
  });

  test("renders a compact empty state when the sector has no rows", () => {
    render(() => <SeasonalityRadial cells={RADIAL_CELLS} sector="PHARMA" />);
    expect(screen.getByTestId("history-seasonality-radial-empty")).toHaveTextContent(
      "No seasonality history for PHARMA",
    );
    expect(screen.getByTestId("history-seasonality-radial-key")).toHaveTextContent(
      "orange positive · blue negative",
    );
    expect(screen.queryByTestId("history-seasonality-radial-chart")).not.toBeInTheDocument();
    expect(screen.queryByTestId("history-seasonality-radial-note")).not.toBeInTheDocument();
  });
});

describe("RelativeStrength", () => {
  test("indexes both legs and normalizes the ratio at the first common month", () => {
    const model = buildRelativeStrengthModel({
      months: MONTHS.slice(0, 3),
      series: [BENCHMARK, SECTOR],
      sector: "NIFTY IT",
    });

    expect(buildCumulativeIndex([1, 1])[1]).toBeCloseTo(102.01, 6);
    expect(model.hasData).toBe(true);
    expect(model.hasBenchmark).toBe(true);
    expect(model.hasSector).toBe(true);
    expect(model.firstCommonIndex).toBe(0);
    expect(model.ratios[0]).toBeCloseTo(100, 6);
    expect(model.ratios[1]).toBeCloseTo(101, 6);
    expect(model.ratios[2]).toBeCloseTo(102.01, 6);
    expect(model.points).toHaveLength(3);
  });

  test("starts at the first overlapping month when one leg is missing earlier", () => {
    const model = buildRelativeStrengthModel({
      months: ["2025-01", "2025-02"],
      series: [makeSeries("NIFTY 50", [1, 1], true), makeSeries("NIFTY IT", [null, 10])],
      sector: "NIFTY IT",
    });

    expect(model.firstCommonIndex).toBe(1);
    expect(model.points).toHaveLength(1);
    expect(model.hasData).toBe(false);
    expect(model.ratios[1]).toBeCloseTo(100, 6);
    expect(model.points[0].ratio).toBeCloseTo(100, 6);
  });

  test("builds a sky line with a gray 100 baseline", () => {
    const model = buildRelativeStrengthModel({
      months: MONTHS.slice(0, 5),
      series: [BENCHMARK, SECTOR],
      sector: "NIFTY IT",
    });
    const option = buildRelativeStrengthOption(model);
    const series = optionSeries(option)[0];

    expect(series.type).toBe("line");
    expect(series.lineStyle.color).toBe(CHART_LINE);
    expect(series.markLine.data[0].yAxis).toBe(100);
    expect(series.markLine.lineStyle.color).not.toBe(CHART_LINE);
    expect(option.yAxis.min).toBeLessThanOrEqual(100);
    expect(option.yAxis.max).toBeGreaterThanOrEqual(100);
    expect(series.data[0]).toBeCloseTo(100, 6);
    expect(option.aria.enabled).toBe(true);
    expectNoNaN(option);
  });

  test("renders the title, note and chart", () => {
    render(() => (
      <RelativeStrength months={MONTHS} series={[BENCHMARK, SECTOR]} sector="NIFTY IT" />
    ));
    expect(screen.getByText("Relative strength vs NIFTY 50")).toBeInTheDocument();
    expect(screen.getByText("monthly, indexed to 100")).toBeInTheDocument();
    expect(screen.getByTestId("history-relative-strength-chart")).toBeInTheDocument();
    expect(screen.getByTestId("history-relative-strength-key")).toHaveTextContent(
      "above 100 = outperform · below 100 = lag",
    );
    expect(chartCapture.styles.at(-1)).toMatchObject({ height: "240px" });
    expectNoNaN(chartCapture.options.at(-1));
  });

  test("hides the internal title and indexed note when showHeader is false", () => {
    render(() => (
      <RelativeStrength
        months={MONTHS}
        series={[BENCHMARK, SECTOR]}
        sector="NIFTY IT"
        showHeader={false}
      />
    ));

    expect(screen.queryByTestId("history-relative-strength-header")).not.toBeInTheDocument();
    expect(screen.queryByText("Relative strength vs NIFTY 50")).not.toBeInTheDocument();
    expect(screen.queryByText("monthly, indexed to 100")).not.toBeInTheDocument();
    expect(screen.getByTestId("history-relative-strength-chart")).toBeInTheDocument();
  });

  test("renders compact empty states for a missing benchmark, sector or overlap", () => {
    render(() => <RelativeStrength months={MONTHS} series={[SECTOR]} sector="NIFTY IT" />);
    expect(screen.getByTestId("history-relative-strength-empty")).toHaveTextContent(
      "No benchmark series",
    );

    cleanup();
    render(() => <RelativeStrength months={MONTHS} series={[BENCHMARK]} sector="NIFTY IT" />);
    expect(screen.getByTestId("history-relative-strength-empty")).toHaveTextContent(
      "No history for NIFTY IT",
    );

    cleanup();
    render(() => (
      <RelativeStrength
        months={["2025-01", "2025-02"]}
        series={[makeSeries("NIFTY 50", [1, null], true), makeSeries("NIFTY IT", [null, 1])]}
        sector="NIFTY IT"
      />
    ));
    expect(screen.getByTestId("history-relative-strength-empty")).toHaveTextContent(
      "Not enough overlapping months for NIFTY IT",
    );
  });
});

describe("RelativeStrengthTrail", () => {
  test("computes six-month momentum from the normalized ratio and keeps 12 points", () => {
    const base = buildRelativeStrengthModel({
      months: MONTHS,
      series: [BENCHMARK, SECTOR],
      sector: "NIFTY IT",
    });
    const trail = buildRsTrailModel(base);

    expect(trail.hasData).toBe(true);
    expect(trail.enoughHistory).toBe(true);
    expect(trail.points).toHaveLength(12);
    expect(trail.points[0].month).toBe(MONTHS[6]);
    expect(trail.points[0].rs).toBeCloseTo(100 * 1.01 ** 6, 6);
    expect(trail.points[0].momentum).toBeCloseTo(1.01 ** 6 - 1, 6);
    expect(trail.current?.month).toBe(MONTHS[17]);
    expect(trail.current?.momentum).toBeCloseTo(1.01 ** 6 - 1, 6);
  });

  test("caps the trail at the last 12 momentum observations", () => {
    const longBenchmark = steadySeries("NIFTY 50", LONG_MONTHS, true);
    const longSector = steadySeries("NIFTY IT", LONG_MONTHS);
    const base = buildRelativeStrengthModel({
      months: LONG_MONTHS,
      series: [longBenchmark, longSector],
      sector: "NIFTY IT",
    });
    const trail = buildRsTrailModel(base);

    expect(trail.points).toHaveLength(12);
    expect(trail.points[0].month).toBe(LONG_MONTHS[LONG_MONTHS.length - 12]);
    expect(trail.points[trail.points.length - 1].month).toBe(LONG_MONTHS[LONG_MONTHS.length - 1]);
  });

  test("needs at least seven overlapping ratio points", () => {
    const base = buildRelativeStrengthModel({
      months: MONTHS.slice(0, 6),
      series: [BENCHMARK, SECTOR],
      sector: "NIFTY IT",
    });
    const trail = buildRsTrailModel(base);

    expect(trail.hasData).toBe(false);
    expect(trail.enoughHistory).toBe(false);
    expect(trail.points).toHaveLength(0);
    expect(trail.current).toBeNull();
  });

  test("builds a line plus scatter trail with quadrants and a highlighted current point", () => {
    const base = buildRelativeStrengthModel({
      months: MONTHS,
      series: [BENCHMARK, SECTOR],
      sector: "NIFTY IT",
    });
    const trail = buildRsTrailModel(base);
    const option = buildRelativeStrengthTrailOption(trail);
    const series = optionSeries(option);
    const firstMonthLabel = series[1].label.formatter({
      dataIndex: 0,
      data: { month: MONTHS[6] },
    });
    const currentMonthLabel = series[2].label.formatter({
      data: { month: MONTHS[17] },
    });

    expect(series).toHaveLength(3);
    expect(series[0].type).toBe("line");
    expect(series[1].type).toBe("scatter");
    expect(series[2].type).toBe("scatter");
    expect(series[0].markLine.data).toEqual([{ xAxis: 100 }, { yAxis: 0 }]);
    expect(series[2].itemStyle.color).toBe(CHART_CURRENT);
    expect(series[2].label.color).toBe(CHART_CURRENT);
    expect(series[2].data).toHaveLength(1);
    expect(firstMonthLabel).toBe(MONTHS[6]);
    expect(currentMonthLabel).toBe(MONTHS[17]);
    expect(option.aria.enabled).toBe(true);
    expectNoNaN(option);
  });

  test("renders the title, note and chart", () => {
    render(() => (
      <RelativeStrengthTrail months={MONTHS} series={[BENCHMARK, SECTOR]} sector="NIFTY IT" />
    ));
    expect(screen.getByText("RS momentum trail · last 12 months")).toBeInTheDocument();
    expect(screen.getByTestId("history-rs-trail-chart")).toBeInTheDocument();
    expect(screen.getByTestId("history-rs-trail-quadrants")).toHaveTextContent(
      "RS > 100 = outperform · momentum > 0 = improving",
    );
    expect(screen.getByTestId("history-rs-trail-quadrants")).toHaveTextContent(
      "descriptive, not JdK RRG",
    );
    expect(chartCapture.styles.at(-1)).toMatchObject({ height: "280px" });
    expectNoNaN(chartCapture.options.at(-1));
  });

  test("hides the internal title when showHeader is false and keeps the RRG note", () => {
    render(() => (
      <RelativeStrengthTrail
        months={MONTHS}
        series={[BENCHMARK, SECTOR]}
        sector="NIFTY IT"
        showHeader={false}
      />
    ));

    expect(screen.queryByTestId("history-rs-trail-header")).not.toBeInTheDocument();
    expect(screen.queryByText("RS momentum trail · last 12 months")).not.toBeInTheDocument();
    expect(screen.getByTestId("history-rs-trail-chart")).toBeInTheDocument();
    expect(screen.getByTestId("history-rs-trail-quadrants")).toHaveTextContent(
      "descriptive, not JdK RRG",
    );
  });

  test("renders compact empty states for missing legs and short history", () => {
    render(() => <RelativeStrengthTrail months={MONTHS} series={[SECTOR]} sector="NIFTY IT" />);
    expect(screen.getByTestId("history-rs-trail-empty")).toHaveTextContent("No benchmark series");

    cleanup();
    render(() => (
      <RelativeStrengthTrail
        months={MONTHS.slice(0, 3)}
        series={[BENCHMARK, SECTOR]}
        sector="NIFTY IT"
      />
    ));
    expect(screen.getByTestId("history-rs-trail-empty")).toHaveTextContent(
      "Not enough relative history for a 6M trail",
    );
  });
});
