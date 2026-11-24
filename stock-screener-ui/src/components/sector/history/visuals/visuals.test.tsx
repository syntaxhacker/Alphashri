// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { alpha } from "@/ui/palette";
import { CHART_CURRENT, CHART_LINE, CHART_TOP3 } from "./chartPalette";
import {
  MiniSparkline,
  PersistenceMatrix,
  RotationTimeline,
  SeasonalityHeatmap,
  SectorRankHeatmap,
} from "./index";
import {
  buildRotationModel,
  buildRotationOption,
  formatRotationTooltip,
  ROTATION_AXIS_HEIGHT,
  ROTATION_CHART_TOP,
  ROTATION_ROW_GAP,
  ROTATION_ROW_HEIGHT,
  ROTATION_TOP_BAND_BORDER,
  ROTATION_TOP_BAND_FILL,
} from "./RotationTimeline";
import type {
  SectorHistorySeasonality,
  SectorHistorySeries,
} from "../../../../types/sectorHistory";

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

const MONTHS = [
  "2025-01",
  "2025-02",
  "2025-03",
  "2025-04",
  "2025-05",
  "2025-06",
  "2025-07",
  "2025-08",
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
];

const IT_RANKS: (number | null)[] = [1, 2, 3, null, 2, 1, 4, 3, 2, null, 1, 2];
const PSU_RANKS: (number | null)[] = [2, 1, 2, 3, 1, 2, 3, 1, 3, 2, 2, 1];
const FMCG_RANKS: (number | null)[] = [3, 3, 1, 2, 3, 4, 1, 2, 4, 3, 3, 3];

const SERIES: SectorHistorySeries[] = [
  {
    name: "NIFTY 50",
    is_benchmark: true,
    monthly_returns: [1.1, -0.5, 0.8, 0.2, 1.4, 0.7, -0.3, 0.9, 1.2, 0.4, -0.6, 1.0],
    ranks: MONTHS.map(() => null),
  },
  {
    name: "NIFTY IT",
    is_benchmark: false,
    monthly_returns: [2.1, -1.2, 0.8, null, 1.4, -0.6, 3.2, 1.1, -0.4, null, 2.0, 0.5],
    ranks: IT_RANKS,
  },
  {
    name: "PSU BANK",
    is_benchmark: false,
    monthly_returns: [1.2, 2.4, -0.5, 1.1, 0.3, 1.9, -1.0, 0.6, 2.2, 0.4, -0.8, 1.6],
    ranks: PSU_RANKS,
  },
  {
    name: "FMCG",
    is_benchmark: false,
    monthly_returns: [-0.6, 0.9, 1.7, -1.2, 0.4, 2.5, 0.1, -0.3, 1.0, 1.3, 0.2, -0.9],
    ranks: FMCG_RANKS,
  },
];

const SEASONALITY_NAMES = ["NIFTY IT", "PSU BANK", "FMCG"];

const SEASONALITY: SectorHistorySeasonality[] = SEASONALITY_NAMES.flatMap((name, nameIndex) =>
  MONTHS.map((_, monthIndex) => ({
    name,
    month: monthIndex + 1,
    avg_return:
      monthIndex === 5 && nameIndex === 0
        ? 2.1
        : Number((((monthIndex * 7 + nameIndex * 3) % 11) - 5) / 2),
    hit_rate:
      monthIndex === 5 && nameIndex === 0 ? 0.6 : 0.4 + ((monthIndex + nameIndex) % 4) * 0.1,
    n: 5,
  })),
).filter((cell) => !(cell.name === "PSU BANK" && cell.month === 7));

const PERSISTENCE_NAMES = ["NIFTY IT", "PSU BANK", "FMCG"];
const PERSISTENCE_MATRIX: (number | null)[][] = [
  [0.5, 0.2, 0.05],
  [0.15, 0.45, 0.1],
  [0.05, 0.1, 0.4],
];

const SPARK_VALUES: (number | null)[] = [
  -3.2,
  -1.0,
  2.1,
  null,
  3.4,
  -0.5,
  1.8,
  2.2,
  -0.9,
  0.4,
  1.1,
  0.7,
];

function expectNoNaN(svg: Element) {
  for (const path of Array.from(svg.querySelectorAll("path"))) {
    expect(path.getAttribute("d") ?? "").not.toContain("NaN");
  }
}

function expectAccessibleLabels(svg: Element) {
  const labelledBy = svg.getAttribute("aria-labelledby");
  expect(labelledBy).toBeTruthy();
  const ids = (labelledBy ?? "").split(" ").filter(Boolean);
  expect(ids).toHaveLength(2);
  for (const id of ids) {
    expect(svg.querySelector(`#${id}`)).not.toBeNull();
  }
}

afterEach(() => {
  cleanup();
});

describe("SectorRankHeatmap", () => {
  test("renders one cell per non-benchmark sector per month", () => {
    render(() => <SectorRankHeatmap months={MONTHS} series={SERIES} />);
    const svg = screen.getByTestId("history-rank-heatmap");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("role", "img");
    expect(svg.querySelectorAll("[data-cell]")).toHaveLength(MONTHS.length * 3);
    expect(svg.querySelectorAll("[data-cell] > title")).toHaveLength(36);
    const cells = Array.from(svg.querySelectorAll("[data-cell]"));
    expect(cells.filter((cell) => cell.getAttribute("tabindex") === "0")).toHaveLength(1);
    for (const cell of cells) {
      expect(["0", "-1"]).toContain(cell.getAttribute("tabindex"));
      expect(cell).toHaveAttribute("role", "img");
    }
    expect(svg.querySelector("title")).not.toBeNull();
    expect(svg.querySelector("desc")).not.toBeNull();
    expect(screen.getByTestId("history-rank-heatmap-legend")).toHaveTextContent("1 best → 3 worst");
    expectAccessibleLabels(svg);
    expectNoNaN(svg);
  });

  test("labels cells with month, sector and rank, and does not render the benchmark", () => {
    render(() => <SectorRankHeatmap months={MONTHS} series={SERIES} />);
    expect(screen.getByLabelText("2025-06 · NIFTY IT · rank 1")).toBeInTheDocument();
    expect(screen.getByLabelText("2025-04 · NIFTY IT · no rank")).toBeInTheDocument();
    expect(screen.queryByText("NIFTY 50")).not.toBeInTheDocument();
  });

  test("renders an empty state without months or sectors", () => {
    render(() => <SectorRankHeatmap months={[]} series={[]} />);
    expect(screen.getByTestId("history-rank-heatmap")).toBeInTheDocument();
    expect(screen.getByTestId("history-rank-heatmap-empty")).toBeInTheDocument();
  });

  test("keeps the grid stable when rank arrays are shorter than the month axis", () => {
    const truncated = SERIES.map((item) => ({ ...item, ranks: item.ranks.slice(0, 3) }));
    render(() => <SectorRankHeatmap months={MONTHS} series={truncated} />);
    const svg = screen.getByTestId("history-rank-heatmap");
    expect(svg.querySelectorAll("[data-cell]")).toHaveLength(36);
    expect(screen.getByLabelText("2025-12 · NIFTY IT · no rank")).toBeInTheDocument();
    expectNoNaN(svg);
  });

  test("re-renders the grid when the month axis changes", () => {
    const [months, setMonths] = createSignal(MONTHS);
    render(() => <SectorRankHeatmap months={months()} series={SERIES} />);
    const svg = screen.getByTestId("history-rank-heatmap");
    expect(svg.querySelectorAll("[data-cell]")).toHaveLength(36);
    setMonths(MONTHS.slice(0, 3));
    expect(svg.querySelectorAll("[data-cell]")).toHaveLength(9);
    expect(screen.getByTestId("history-rank-heatmap-legend")).toHaveTextContent("1 best → 3 worst");
  });
});

const MATRIX_SERIES: SectorHistorySeries[] = [
  {
    name: "ALPHA",
    is_benchmark: false,
    monthly_returns: [],
    ranks: [1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3],
  },
  {
    name: "BETA",
    is_benchmark: false,
    monthly_returns: [],
    ranks: [2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1],
  },
  {
    name: "GAMMA",
    is_benchmark: false,
    monthly_returns: [],
    ranks: [3, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2],
  },
  {
    name: "NIFTY 50",
    is_benchmark: true,
    monthly_returns: [],
    ranks: MONTHS.map(() => null),
  },
];

const NULL_MONTHS = ["2025-01", "2025-02", "2025-03"];
const NULL_MONTH_SERIES: SectorHistorySeries[] = [
  { name: "A", is_benchmark: false, monthly_returns: [], ranks: [1, null, 3] },
  { name: "B", is_benchmark: false, monthly_returns: [], ranks: [2, null, 1] },
  { name: "C", is_benchmark: false, monthly_returns: [], ranks: [3, null, 2] },
];

const TEN_SERIES: SectorHistorySeries[] = Array.from({ length: 10 }, (_, index) => ({
  name: `SECTOR ${index + 1}`,
  is_benchmark: false,
  monthly_returns: [],
  ranks: MONTHS.map((_, month) => ((index + month) % 10) + 1),
}));

type ChartOption = Record<string, any>;

function rotationOption(series: SectorHistorySeries[]): ChartOption {
  return buildRotationOption({ months: MONTHS, series });
}

function optionSeries(option: ChartOption): ChartOption[] {
  return option.series as ChartOption[];
}

describe("RotationTimeline", () => {
  beforeEach(() => {
    chartCapture.options.length = 0;
    chartCapture.styles.length = 0;
  });

  test("builds one row per non-benchmark sector with its current rank", () => {
    const model = buildRotationModel({ months: MONTHS, series: SERIES });
    expect(model.rows.map((row) => row.name)).toEqual(["NIFTY IT", "PSU BANK", "FMCG"]);
    expect(model.rows.map((row) => row.currentRank)).toEqual([2, 1, 3]);
    expect(model.rankMax).toBe(4);
    expect(model.latestMonth).toBe("2025-12");
    expect(model.hasData).toBe(true);
  });

  test("renders one line strip per sector with gridIndex-aligned axes", () => {
    const option = rotationOption(SERIES);
    const grids = option.grid as ChartOption[];
    const xAxes = option.xAxis as ChartOption[];
    const yAxes = option.yAxis as ChartOption[];
    const series = optionSeries(option);

    expect(option.visualMap).toBeUndefined();
    expect(option.legend).toBeUndefined();
    expect(grids).toHaveLength(3);
    expect(xAxes).toHaveLength(3);
    expect(yAxes).toHaveLength(3);
    expect(series).toHaveLength(3);
    expect(series.every((item) => item.type === "line")).toBe(true);
    expect(series.some((item) => item.type === "heatmap")).toBe(false);
    expect(series.map((item) => item.gridIndex)).toEqual([0, 1, 2]);
    expect(series.map((item) => item.name)).toEqual(["NIFTY IT", "PSU BANK", "FMCG"]);
    expect(series.some((item) => item.name === "NIFTY 50")).toBe(false);
    expect(grids.every((grid) => grid.height >= 22 && grid.height <= 26)).toBe(true);
    expect(grids[1].top).toBe(ROTATION_CHART_TOP + ROTATION_ROW_HEIGHT + ROTATION_ROW_GAP);
  });

  test("inverts each rank axis and shades the top-3 band in every strip", () => {
    const option = rotationOption(TEN_SERIES);
    const yAxes = option.yAxis as ChartOption[];
    expect(yAxes).toHaveLength(10);
    for (const axis of yAxes) {
      expect(axis.inverse).toBe(true);
      expect(axis.min).toBe(1);
      expect(axis.max).toBe(10);
      expect(axis.interval).toBe(1);
    }
    for (const item of optionSeries(option)) {
      expect(item.markArea.data[0][0]).toEqual({ yAxis: 0.5 });
      expect(item.markArea.data[0][1]).toEqual({ yAxis: 3.5 });
      expect(item.markArea.itemStyle).toMatchObject({
        color: alpha(CHART_TOP3, 0.18),
        borderColor: alpha(CHART_TOP3, 0.35),
      });
    }
  });

  test("shows a top-3 band key whose swatch matches the markArea fill", () => {
    render(() => <RotationTimeline months={MONTHS} series={MATRIX_SERIES} />);
    expect(ROTATION_TOP_BAND_FILL).toBe(alpha(CHART_TOP3, 0.18));
    const key = screen.getByTestId("history-rotation-band-key");
    expect(key).toHaveTextContent("top 3");
    expect(screen.getByTestId("history-rotation-band-swatch")).toHaveStyle({
      "background-color": ROTATION_TOP_BAND_FILL,
      "border-color": ROTATION_TOP_BAND_BORDER,
    });
    for (const item of optionSeries(chartCapture.options.at(-1)!)) {
      expect(item.markArea.itemStyle.color).toBe(ROTATION_TOP_BAND_FILL);
    }
  });

  test("highlights top-3 points and leaves null ranks as gaps", () => {
    const series = optionSeries(rotationOption(SERIES));
    const it = series.find((item) => item.name === "NIFTY IT")!;
    expect(it.connectNulls).toBe(false);
    expect(it.data[3].value).toBeNull();
    expect(it.data[0].symbolSize).toBeGreaterThan(it.data[6].symbolSize);
    expect(it.data[0].itemStyle.opacity).toBe(1);
    expect(it.data[0].itemStyle.color).toBe(CHART_TOP3);
    expect(it.lineStyle.color).toBe(CHART_LINE);
    expect(it.data[6].itemStyle.opacity).toBeLessThan(1);
  });

  test("shares one bottom year axis and draws January separators in every strip", () => {
    const option = rotationOption(SERIES);
    const xAxes = option.xAxis as ChartOption[];
    expect(xAxes[0].axisLabel.show).toBe(false);
    expect(xAxes[2].axisLabel.show).toBe(true);
    expect(xAxes[2].axisLabel.hideOverlap).toBe(true);
    expect(xAxes[2].axisLabel.interval).toBe(0);
    expect(xAxes[2].axisLabel.formatter("2025-01")).toBe("2025");
    expect(xAxes[2].axisLabel.formatter("2025-07")).toBe("Jul");
    expect(xAxes[2].axisLabel.formatter("2025-02")).toBe("");
    for (const axis of xAxes) {
      expect(axis.data).toEqual(MONTHS);
      expect(axis.splitLine.interval(0, "2025-01")).toBe(true);
      expect(axis.splitLine.interval(1, "2025-02")).toBe(false);
    }
  });

  test("tooltip reads YYYY-MM · Sector · rank N", () => {
    const option = rotationOption(SERIES);
    expect(option.tooltip.trigger).toBe("item");
    expect(
      option.tooltip.formatter({ axisValue: "2025-06", seriesName: "NIFTY IT", value: 1 }),
    ).toBe("2025-06 · NIFTY IT · rank 1");
    expect(formatRotationTooltip({ axisValue: "2025-06", seriesName: "A&B", value: 4 })).toBe(
      "2025-06 · A&amp;B · rank 4",
    );
    expect(formatRotationTooltip([{ value: null }])).toBe("");
  });

  test("renders direct row labels, current rank badges and a text-only summary", () => {
    render(() => <RotationTimeline months={MONTHS} series={MATRIX_SERIES} />);
    expect(screen.getByTestId("history-rotation-timeline")).toBeInTheDocument();
    expect(screen.getByText("Rank history by sector")).toBeInTheDocument();
    expect(
      screen.getByText("Each row is a sector · higher is stronger · shaded band = top 3"),
    ).toBeInTheDocument();

    const rail = screen.getByTestId("history-rotation-rail");
    for (const name of ["ALPHA", "BETA", "GAMMA"]) {
      expect(within(rail).getByText(name)).toBeInTheDocument();
    }
    expect(within(rail).queryByText("NIFTY 50")).not.toBeInTheDocument();

    expect(screen.getByTestId("history-rotation-badge-0")).toHaveTextContent("#3");
    expect(screen.getByTestId("history-rotation-badge-1")).toHaveTextContent("#1");
    expect(screen.getByTestId("history-rotation-badge-2")).toHaveTextContent("#2");
    expect(screen.getByTestId("history-rotation-badge-1")).toHaveAttribute("data-top3", "true");
    expect(screen.getByTestId("history-rotation-badge-1")).toHaveStyle({
      color: CHART_CURRENT,
    });
    expect(screen.getByTestId("history-rotation-current-badge")).toHaveStyle({
      color: CHART_CURRENT,
    });

    const current = screen.getByTestId("history-rotation-current");
    expect(current.textContent).toContain("2025-12");
    expect(current.textContent).toContain("#1 BETA");
    expect(current.textContent).toContain("#2 GAMMA");
    expect(current.textContent).toContain("#3 ALPHA");
    expect(screen.queryByTestId("history-rotation-legend")).not.toBeInTheDocument();
  });

  test("renders ten compact strips and sizes the chart to the shared grid stack", () => {
    render(() => <RotationTimeline months={MONTHS} series={TEN_SERIES} />);
    const option = chartCapture.options.at(-1)!;
    expect(option.grid).toHaveLength(10);
    expect(option.series).toHaveLength(10);
    const expectedHeight =
      ROTATION_CHART_TOP +
      10 * (ROTATION_ROW_HEIGHT + ROTATION_ROW_GAP) -
      ROTATION_ROW_GAP +
      ROTATION_AXIS_HEIGHT;
    expect(chartCapture.styles.at(-1)).toMatchObject({ height: `${expectedHeight}px` });
  });

  test("keeps a sticky label rail, scroll hint and 900px scroll canvas", () => {
    render(() => <RotationTimeline months={MONTHS} series={TEN_SERIES} />);
    expect(screen.getByTestId("history-rotation-rail")).toHaveClass("sticky");
    const hint = screen.getByTestId("history-rotation-scroll-hint");
    expect(hint).toHaveTextContent("Scroll →");
    expect(hint).toHaveClass("sm:hidden");
    const scroll = screen.getByTestId("history-rotation-scroll");
    expect(scroll).toHaveClass("overflow-x-auto");
    expect(scroll.firstElementChild).toHaveStyle({ "min-width": "900px" });
    expect(screen.getByTestId("history-rotation-badges")).toBeInTheDocument();
  });

  test("month inspector defaults to the latest month", () => {
    render(() => <RotationTimeline months={MONTHS} series={MATRIX_SERIES} />);
    const select = screen.getByTestId("history-rotation-month") as HTMLSelectElement;
    expect(screen.getByLabelText("Inspect rotation month")).toBe(select);
    expect(select.tagName).toBe("SELECT");
    expect(select.value).toBe("2025-12");

    const inspector = screen.getByTestId("history-rotation-inspector");
    expect(within(inspector).getByLabelText("#1 BETA")).toBeInTheDocument();
    expect(within(inspector).getByLabelText("#2 GAMMA")).toBeInTheDocument();
    expect(within(inspector).getByLabelText("#3 ALPHA")).toBeInTheDocument();
  });

  test("month inspector keyboard selection lists every month's top three", () => {
    render(() => <RotationTimeline months={MONTHS} series={MATRIX_SERIES} />);
    const select = screen.getByTestId("history-rotation-month") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "2025-01" } });
    expect(select.value).toBe("2025-01");
    expect(screen.getByLabelText("#1 ALPHA")).toBeInTheDocument();
    expect(screen.getByLabelText("#2 BETA")).toBeInTheDocument();
    expect(screen.getByLabelText("#3 GAMMA")).toBeInTheDocument();

    // The latest-month summary stays pinned while inspecting an older month.
    expect(screen.getByTestId("history-rotation-current").textContent).toContain("BETA");
  });

  test("month inspector shows no-rank rows for a gap month", () => {
    render(() => <RotationTimeline months={NULL_MONTHS} series={NULL_MONTH_SERIES} />);
    const select = screen.getByTestId("history-rotation-month") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "2025-02" } });
    expect(screen.getByLabelText("#1 no rank")).toBeInTheDocument();
    expect(screen.getByLabelText("#2 no rank")).toBeInTheDocument();
    expect(screen.getByLabelText("#3 no rank")).toBeInTheDocument();
  });

  test("renders an empty state with no history", () => {
    render(() => <RotationTimeline months={[]} series={[]} />);
    expect(screen.getByTestId("history-rotation-timeline")).toBeInTheDocument();
    expect(screen.getByTestId("history-rotation-timeline-empty")).toBeInTheDocument();
    expect(chartCapture.options).toHaveLength(0);
  });

  test("renders an empty state when every rank is null", () => {
    const noRanks = SERIES.map((item) => ({ ...item, ranks: MONTHS.map(() => null) }));
    render(() => <RotationTimeline months={MONTHS} series={noRanks} />);
    expect(screen.getByTestId("history-rotation-timeline-empty")).toBeInTheDocument();
    expect(chartCapture.options).toHaveLength(0);
  });
});

describe("SeasonalityHeatmap", () => {
  test("renders a 12-month grid with average return text", () => {
    render(() => <SeasonalityHeatmap cells={SEASONALITY} names={SEASONALITY_NAMES} />);
    const svg = screen.getByTestId("history-seasonality");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("role", "img");
    expect(svg.querySelectorAll("[data-cell]")).toHaveLength(36);
    expect(svg.querySelectorAll("[data-cell] > title")).toHaveLength(36);
    expect(screen.getByTestId("history-seasonality-legend")).toHaveTextContent(
      "bar = up-month hit rate",
    );
    const cells = Array.from(svg.querySelectorAll("[data-cell]"));
    expect(cells.filter((cell) => cell.getAttribute("tabindex") === "0")).toHaveLength(1);
    for (const cell of cells) {
      expect(["0", "-1"]).toContain(cell.getAttribute("tabindex"));
      expect(cell).toHaveAttribute("role", "img");
    }
    expect(screen.getByText("+2.1%")).toBeInTheDocument();
    expect(screen.getByTestId("history-seasonality-note")).toHaveTextContent("n=5 per month");
    expectAccessibleLabels(svg);
  });

  test("puts hit rate and sample size in the cell title", () => {
    render(() => <SeasonalityHeatmap cells={SEASONALITY} names={SEASONALITY_NAMES} />);
    expect(
      screen.getByLabelText("Jun · NIFTY IT · avg +2.1% · hit rate 60% · n=5"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Jul · PSU BANK · no data · hit rate n/a · n=0"),
    ).toBeInTheDocument();
  });

  test("accepts month numbers as 0-based", () => {
    const cells: SectorHistorySeasonality[] = [
      { name: "NIFTY IT", month: 0, avg_return: 1, hit_rate: 0.5, n: 4 },
    ];
    render(() => <SeasonalityHeatmap cells={cells} names={["NIFTY IT"]} />);
    expect(
      screen.getByLabelText("Jan · NIFTY IT · avg +1.0% · hit rate 50% · n=4"),
    ).toBeInTheDocument();
  });

  test("accepts hit rates expressed as whole percentages", () => {
    const cells: SectorHistorySeasonality[] = [
      { name: "NIFTY IT", month: 1, avg_return: 1.5, hit_rate: 60, n: 5 },
    ];
    render(() => <SeasonalityHeatmap cells={cells} names={["NIFTY IT"]} />);
    expect(
      screen.getByLabelText("Jan · NIFTY IT · avg +1.5% · hit rate 60% · n=5"),
    ).toBeInTheDocument();
  });

  test("renders an empty state without cells", () => {
    render(() => <SeasonalityHeatmap cells={[]} names={[]} />);
    expect(screen.getByTestId("history-seasonality")).toBeInTheDocument();
    expect(screen.getByTestId("history-seasonality-empty")).toBeInTheDocument();
  });
});

describe("PersistenceMatrix", () => {
  test("renders N by N cells, emphasizes the diagonal and prints percentages above 10%", () => {
    render(() => <PersistenceMatrix names={PERSISTENCE_NAMES} matrix={PERSISTENCE_MATRIX} />);
    const svg = screen.getByTestId("history-persistence");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("role", "img");
    expect(svg.querySelectorAll("[data-cell]")).toHaveLength(9);
    expect(svg.querySelectorAll('[data-diagonal="true"]')).toHaveLength(3);
    const cells = Array.from(svg.querySelectorAll("[data-cell]"));
    expect(cells.filter((cell) => cell.getAttribute("tabindex") === "0")).toHaveLength(1);
    for (const cell of cells) {
      expect(["0", "-1"]).toContain(cell.getAttribute("tabindex"));
      expect(cell).toHaveAttribute("role", "img");
    }
    expect(screen.queryByTestId("history-persistence-count")).not.toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getAllByText("10%")).toHaveLength(2);
    expect(screen.queryByText("5%")).not.toBeInTheDocument();
    expect(svg.querySelector("desc")?.textContent).toMatch(/Rows are this month's sector rank/i);
    expect(svg.querySelector("desc")?.textContent).toMatch(/columns are next month's rank/i);
    expectAccessibleLabels(svg);
  });

  test("shows the exact percentage in the cell title", () => {
    render(() => <PersistenceMatrix names={PERSISTENCE_NAMES} matrix={PERSISTENCE_MATRIX} />);
    const svg = screen.getByTestId("history-persistence");
    expect(screen.getByLabelText("#1 → #1 · 50%")).toBeInTheDocument();
    expect(within(svg).getByText("#1")).toBeInTheDocument();
  });

  test("accepts percentages as well as fractions", () => {
    const matrix: (number | null)[][] = [
      [45, 30, 25],
      [20, 50, 30],
      [10, 20, 70],
    ];
    render(() => <PersistenceMatrix names={PERSISTENCE_NAMES} matrix={matrix} />);
    expect(screen.getByText("45%")).toBeInTheDocument();
    expect(screen.getByLabelText("#1 → #1 · 45%")).toBeInTheDocument();
  });

  test("treats rows that sum to 100 as percentages", () => {
    const matrix: (number | null)[][] = [
      [100, 0],
      [20, 80],
    ];
    render(() => <PersistenceMatrix names={["A", "B"]} matrix={matrix} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByLabelText("#1 → #2 · 0%")).toBeInTheDocument();
  });

  test("labels missing transitions and renders no value text for them", () => {
    const matrix: (number | null)[][] = [
      [null, 0.25],
      [0.1, null],
    ];
    render(() => <PersistenceMatrix names={["A", "B"]} matrix={matrix} />);
    expect(screen.getByLabelText("#1 → #1 · no data")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
  });

  test("renders an empty state without a matrix", () => {
    render(() => <PersistenceMatrix names={[]} matrix={[]} />);
    expect(screen.getByTestId("history-persistence")).toBeInTheDocument();
    expect(screen.getByTestId("history-persistence-empty")).toBeInTheDocument();
  });
});

describe("MiniSparkline", () => {
  test("renders blue and orange segments, breaking on nulls without NaN", () => {
    render(() => <MiniSparkline values={SPARK_VALUES} />);
    const svg = screen.getByTestId("history-sparkline");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute("viewBox", "0 0 96 24");
    expect(svg.querySelectorAll("[data-segment]").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll('[data-sign="positive"]').length).toBeGreaterThan(0);
    expect(svg.querySelectorAll('[data-sign="negative"]').length).toBeGreaterThan(0);
    expect(svg.querySelector("title")?.textContent).toMatch(/Cumulative monthly return \+/);
    expectAccessibleLabels(svg);
    expectNoNaN(svg);
  });

  test("draws only the zero baseline with fewer than two valid points", () => {
    render(() => <MiniSparkline values={[null, 1.5]} />);
    const svg = screen.getByTestId("history-sparkline");
    expect(svg.querySelectorAll("[data-segment]")).toHaveLength(0);
    expect(svg.querySelector("[data-baseline]")).not.toBeNull();
    expectNoNaN(svg);
  });

  test("honours custom dimensions", () => {
    render(() => <MiniSparkline values={SPARK_VALUES} width={120} height={32} />);
    expect(screen.getByTestId("history-sparkline")).toHaveAttribute("viewBox", "0 0 120 32");
  });

  test("renders an empty state with no values", () => {
    render(() => <MiniSparkline values={[]} />);
    const svg = screen.getByTestId("history-sparkline");
    expect(svg.querySelectorAll("[data-segment]")).toHaveLength(0);
    expectNoNaN(svg);
  });
});
