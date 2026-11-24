// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { alpha, SURFACE_ALT } from "@/ui/palette";
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
  ROTATION_BACKGROUND_SERIES,
  ROTATION_MATRIX_SERIES,
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

function lab(hex: string): [number, number, number] {
  const linear = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel > 0.04045 ? ((channel + 0.055) / 1.055) ** 2.4 : channel / 12.92;
  });
  const [r, g, b] = linear;
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (value: number) => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
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

const LAGGARD: SectorHistorySeries = {
  name: "LAGGARD",
  is_benchmark: false,
  monthly_returns: [],
  ranks: MONTHS.map(() => 4),
};

const THIRD_ONLY: SectorHistorySeries = {
  name: "THIRD ONLY",
  is_benchmark: false,
  monthly_returns: [],
  ranks: MONTHS.map(() => 3),
};

const ALL_LEADERS = [...SERIES, LAGGARD, THIRD_ONLY];

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

function rotationOption(series: SectorHistorySeries[], topN?: number): ChartOption {
  return buildRotationOption({ months: MONTHS, series, topN });
}

function matrixSeries(option: ChartOption): ChartOption {
  return (option.series as ChartOption[]).find((item) => item.name === ROTATION_MATRIX_SERIES)!;
}

function backgroundSeries(option: ChartOption): ChartOption {
  return (option.series as ChartOption[]).find((item) => item.name === ROTATION_BACKGROUND_SERIES)!;
}

function cellData(option: ChartOption): ChartOption[] {
  return matrixSeries(option).data as ChartOption[];
}

describe("RotationTimeline", () => {
  beforeEach(() => {
    chartCapture.options.length = 0;
    chartCapture.styles.length = 0;
  });

  test("renders a 3-row heatmap matrix with one cell per occupied rank slot", () => {
    const option = rotationOption(MATRIX_SERIES);
    const series = option.series as ChartOption[];

    expect(option.dataZoom).toBeUndefined();
    expect(series.every((item) => item.type === "heatmap")).toBe(true);
    expect(series.some((item) => item.type === "line")).toBe(false);
    expect(option.yAxis.data).toEqual(["#1", "#2", "#3"]);
    expect(option.yAxis.inverse).toBe(true);
    expect(option.xAxis.data).toEqual(MONTHS);

    const cells = cellData(option);
    expect(cells).toHaveLength(36);
    expect(cells[0].value).toEqual([0, 0, 0]);
    expect(cells[1].value).toEqual([0, 1, 1]);
    expect(cells[2].value).toEqual([0, 2, 2]);
    expect(cells.every((cell) => cell.value[1] >= 0 && cell.value[1] <= 2)).toBe(true);
    expect(backgroundSeries(option).data).toHaveLength(36);
  });

  test("keeps only sectors that ever held a top-3 rank and drops benchmarks", () => {
    const model = buildRotationModel({ months: MONTHS, series: ALL_LEADERS });
    expect(model.leaders.map((leader) => leader.name)).toEqual([
      "NIFTY IT",
      "PSU BANK",
      "FMCG",
      "THIRD ONLY",
    ]);
    expect(model.leaders.map((leader) => leader.name)).not.toContain("LAGGARD");
    expect(model.leaders.map((leader) => leader.name)).not.toContain("NIFTY 50");
    expect(model.cells.every((cell) => cell.rank >= 1 && cell.rank <= 3)).toBe(true);
  });

  test("uses one stable colour per sector and a stronger rank-1 border", () => {
    const option = rotationOption(MATRIX_SERIES);
    const model = buildRotationModel({ months: MONTHS, series: MATRIX_SERIES });
    const cells = cellData(option);
    const pieces = option.visualMap.pieces as ChartOption[];
    const colorByIndex = new Map(pieces.map((piece) => [piece.value, piece.color]));

    for (const leader of model.leaders) {
      const indexed = cells
        .filter((cell) => cell.sector === leader.name)
        .map((cell) => cell.value[2]);
      expect(new Set(indexed)).toEqual(new Set([leader.sectorIndex]));
      expect(colorByIndex.get(leader.sectorIndex)).toBe(leader.color);
    }

    const rankOne = cells.filter((cell) => cell.rank === 1);
    const rankTwo = cells.find((cell) => cell.rank === 2)!;
    expect(
      rankOne.every((cell) => cell.itemStyle.borderWidth > rankTwo.itemStyle.borderWidth),
    ).toBe(true);
  });

  test("maps every leader colour through a hidden piecewise visualMap", () => {
    const option = rotationOption(TEN_SERIES);
    const model = buildRotationModel({ months: MONTHS, series: TEN_SERIES });
    const visualMap = option.visualMap;
    expect(visualMap.type).toBe("piecewise");
    expect(visualMap.show).toBe(false);
    expect(visualMap.dimension).toBe(2);
    expect(visualMap.seriesIndex).toEqual([0, 1]);

    const pieces = visualMap.pieces as ChartOption[];
    expect(pieces.find((piece) => piece.value === -1)?.color).toBe(alpha(SURFACE_ALT, 0.45));
    for (const leader of model.leaders) {
      expect(pieces.find((piece) => piece.value === leader.sectorIndex)?.color).toBe(leader.color);
    }
    expect(new Set(model.leaders.map((leader) => leader.color)).size).toBe(10);
  });

  test("does not tooltip empty lattice slots", () => {
    const option = rotationOption(MATRIX_SERIES);
    const background = backgroundSeries(option);
    expect(background.silent).toBe(true);
    expect(background.tooltip).toEqual({ show: false });
    expect(cellData(option).every((cell) => cell.value[2] >= 0)).toBe(true);
  });

  test("assigns unique, perceptually separated colours to ten historical leaders", () => {
    const model = buildRotationModel({ months: MONTHS, series: TEN_SERIES });
    expect(model.leaders).toHaveLength(10);
    const colors = model.leaders.map((leader) => leader.color);
    expect(new Set(colors).size).toBe(colors.length);
    // CIE Lab distance catches the old gold/amber pair (~8.5) that read as one hue.
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        expect(deltaE(colors[i], colors[j])).toBeGreaterThanOrEqual(15);
      }
    }
  });

  test("labels only year boundaries and mid-year anchors without overlap", () => {
    const option = rotationOption(MATRIX_SERIES);
    expect(option.xAxis.axisLabel.hideOverlap).toBe(true);
    expect(option.xAxis.axisLabel.interval).toBe(0);
    expect(option.xAxis.axisLabel.formatter("2025-01")).toBe("2025");
    expect(option.xAxis.axisLabel.formatter("2025-07")).toBe("Jul");
    expect(option.xAxis.axisLabel.formatter("2025-02")).toBe("");
    expect(option.xAxis.splitLine.interval(0, "2025-01")).toBe(true);
    expect(option.xAxis.splitLine.interval(1, "2025-02")).toBe(false);
  });

  test("maps a cell tooltip to YYYY-MM · #rank · sector", () => {
    const option = rotationOption(MATRIX_SERIES);
    const first = cellData(option)[0];
    expect(option.tooltip.trigger).toBe("item");
    expect(option.tooltip.formatter({ data: first })).toBe("2025-01 · #1 · ALPHA");
    expect(
      formatRotationTooltip({
        data: { value: [0, 0, 0], month: "2025-01", rank: 1, sector: "A&B" },
      }),
    ).toBe("2025-01 · #1 · A&amp;B");
    expect(formatRotationTooltip({})).toBe("");
  });

  test("leaves months without ranks as empty matrix cells", () => {
    const model = buildRotationModel({ months: NULL_MONTHS, series: NULL_MONTH_SERIES });
    expect(model.hasData).toBe(true);
    expect(model.cells).toHaveLength(6);
    expect(model.cells.some((cell) => cell.monthIndex === 1)).toBe(false);

    const option = buildRotationOption({ months: NULL_MONTHS, series: NULL_MONTH_SERIES });
    expect(cellData(option).some((cell) => cell.value[0] === 1)).toBe(false);
  });

  test("renders the current leaders key, wrapped legend, scroll hint and wrapper", () => {
    render(() => <RotationTimeline months={MONTHS} series={MATRIX_SERIES} />);
    expect(screen.getByTestId("history-rotation-timeline")).toBeInTheDocument();
    expect(screen.getByText("Top 3 leadership · rank, not return")).toBeInTheDocument();

    const current = screen.getByTestId("history-rotation-current");
    expect(within(current).getByText("ALPHA")).toBeInTheDocument();
    expect(within(current).getByText("BETA")).toBeInTheDocument();
    expect(within(current).getByText("GAMMA")).toBeInTheDocument();
    expect(current.textContent).toContain("#1");

    const legend = screen.getByTestId("history-rotation-legend");
    expect(legend).toHaveClass("flex-wrap");
    expect(legend).not.toHaveClass("overflow-x-auto");
    expect(within(legend).getByText("ALPHA")).toBeInTheDocument();

    const hint = screen.getByTestId("history-rotation-scroll-hint");
    expect(hint).toHaveTextContent("Scroll →");
    expect(hint).toHaveClass("sm:hidden");

    const scroll = screen.getByTestId("history-rotation-scroll");
    expect(scroll).toHaveClass("overflow-x-auto");
    expect(scroll.firstElementChild).toHaveStyle({ "min-width": "900px" });
    expect(chartCapture.styles.at(-1)).toMatchObject({ height: "230px" });
    expect(chartCapture.options.at(-1)?.yAxis.data).toEqual(["#1", "#2", "#3"]);
  });

  test("keeps every historical leader visible in the wrapped legend", () => {
    const model = buildRotationModel({ months: MONTHS, series: TEN_SERIES });
    render(() => <RotationTimeline months={MONTHS} series={TEN_SERIES} />);
    const legend = screen.getByTestId("history-rotation-legend");
    for (const leader of model.leaders) {
      expect(within(legend).getByText(leader.name)).toBeInTheDocument();
    }
  });

  test("month inspector defaults to the latest month and matches the current key", () => {
    render(() => <RotationTimeline months={MONTHS} series={MATRIX_SERIES} />);
    const select = screen.getByTestId("history-rotation-month") as HTMLSelectElement;
    expect(screen.getByLabelText("Inspect rotation month")).toBe(select);
    expect(select.tagName).toBe("SELECT");
    expect(select.value).toBe("2025-12");

    const inspector = screen.getByTestId("history-rotation-inspector");
    expect(within(inspector).getByLabelText("#1 BETA")).toBeInTheDocument();
    expect(within(inspector).getByLabelText("#2 GAMMA")).toBeInTheDocument();
    expect(within(inspector).getByLabelText("#3 ALPHA")).toBeInTheDocument();

    const current = screen.getByTestId("history-rotation-current");
    expect(within(current).getByLabelText("#1 BETA")).toBeInTheDocument();
    expect(within(current).getByLabelText("#2 GAMMA")).toBeInTheDocument();
    expect(within(current).getByLabelText("#3 ALPHA")).toBeInTheDocument();
  });

  test("month inspector keyboard selection lists every month's top three", () => {
    render(() => <RotationTimeline months={MONTHS} series={MATRIX_SERIES} />);
    const select = screen.getByTestId("history-rotation-month") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "2025-01" } });
    expect(select.value).toBe("2025-01");
    expect(screen.getByLabelText("#1 ALPHA")).toBeInTheDocument();
    expect(screen.getByLabelText("#2 BETA")).toBeInTheDocument();
    expect(screen.getByLabelText("#3 GAMMA")).toBeInTheDocument();

    // The latest-month key stays pinned while inspecting an older month.
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

  test("keeps a sector that never reached the top three out of the legend", () => {
    render(() => <RotationTimeline months={MONTHS} series={ALL_LEADERS} />);
    const legend = screen.getByTestId("history-rotation-legend");
    expect(within(legend).queryByText("LAGGARD")).not.toBeInTheDocument();
    expect(within(legend).getByText("THIRD ONLY")).toBeInTheDocument();
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

  test("renders an empty state when no sector ever reached the top three", () => {
    render(() => <RotationTimeline months={MONTHS} series={[LAGGARD]} />);
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
  test("renders green and red segments, breaking on nulls without NaN", () => {
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
