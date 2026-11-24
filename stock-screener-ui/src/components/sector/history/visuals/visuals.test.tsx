// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import {
  MiniSparkline,
  PersistenceMatrix,
  RotationTimeline,
  SeasonalityHeatmap,
  SectorRankHeatmap,
} from "./index";
import type {
  SectorHistorySeasonality,
  SectorHistorySeries,
} from "../../../../types/sectorHistory";

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

describe("RotationTimeline", () => {
  test("renders trajectories without NaN and highlights top-N segments", () => {
    render(() => <RotationTimeline months={MONTHS} series={SERIES} topN={2} />);
    const svg = screen.getByTestId("history-rotation-timeline");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("role", "img");
    expect(svg.querySelectorAll("[data-trajectory]").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll('[data-highlight="true"]').length).toBeGreaterThan(0);
    expect(svg.querySelectorAll('[data-highlight="false"]').length).toBeGreaterThan(0);
    expectAccessibleLabels(svg);
    expectNoNaN(svg);
  });

  test("names the current leaders and explains that this is rank, not returns", () => {
    render(() => <RotationTimeline months={MONTHS} series={SERIES} topN={2} />);
    const svg = screen.getByTestId("history-rotation-timeline");
    expect(svg.querySelector("title")?.textContent).toMatch(/rank 1 is the strongest/i);
    expect(screen.getByText(/TOP 2 HIGHLIGHTED/)).toBeInTheDocument();
    expect(screen.getAllByText("PSU BANK").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NIFTY IT").length).toBeGreaterThan(0);
    expect(screen.queryByText("NIFTY 50")).not.toBeInTheDocument();
  });

  test("defaults to the top three and draws only the top-N dots", () => {
    render(() => <RotationTimeline months={MONTHS} series={SERIES} />);
    const svg = screen.getByTestId("history-rotation-timeline");
    expect(screen.getByText(/TOP 3 HIGHLIGHTED/)).toBeInTheDocument();
    // Null IT ranks (Apr, Oct) and rank-4 months (IT Jul, FMCG Jun/Sep) are not leaders.
    const expectedPerMonth = [3, 3, 3, 2, 3, 2, 2, 3, 2, 2, 3, 3];
    MONTHS.forEach((month, index) => {
      const dots = svg.querySelectorAll(`circle[aria-label^="${month} ·"]`);
      expect(dots).toHaveLength(expectedPerMonth[index]);
      for (const dot of Array.from(dots)) {
        expect(dot.getAttribute("aria-label")).toMatch(/rank [123]$/);
      }
    });
    expect(svg.querySelectorAll("circle")).toHaveLength(31);
    expect(svg.querySelectorAll("circle > title")).toHaveLength(31);
    expect(screen.queryByLabelText("2025-06 · NIFTY IT · rank 4")).not.toBeInTheDocument();
  });

  test("renders an empty state with no history", () => {
    render(() => <RotationTimeline months={[]} series={[]} />);
    expect(screen.getByTestId("history-rotation-timeline")).toBeInTheDocument();
    expect(screen.getByTestId("history-rotation-timeline-empty")).toBeInTheDocument();
  });

  test("renders an empty state when every rank is null", () => {
    const noRanks = SERIES.map((item) => ({ ...item, ranks: MONTHS.map(() => null) }));
    render(() => <RotationTimeline months={MONTHS} series={noRanks} />);
    expect(screen.getByTestId("history-rotation-timeline-empty")).toBeInTheDocument();
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
    expect(screen.getByText("+2.1%")).toBeInTheDocument();
    expect(screen.getByTestId("history-seasonality-note")).toHaveTextContent("n=5 per month");
    expectAccessibleLabels(svg);
  });

  test("puts hit rate and sample size in the cell title", () => {
    render(() => <SeasonalityHeatmap cells={SEASONALITY} names={SEASONALITY_NAMES} />);
    expect(screen.getByLabelText("Jun · avg +2.1% · 3/5 up (60%)")).toBeInTheDocument();
    expect(screen.getByLabelText("Jul · PSU BANK · no data")).toBeInTheDocument();
  });

  test("accepts month numbers as 0-based", () => {
    const cells: SectorHistorySeasonality[] = [
      { name: "NIFTY IT", month: 0, avg_return: 1, hit_rate: 0.5, n: 4 },
    ];
    render(() => <SeasonalityHeatmap cells={cells} names={["NIFTY IT"]} />);
    expect(screen.getByLabelText("Jan · avg +1.0% · 2/4 up (50%)")).toBeInTheDocument();
  });

  test("accepts hit rates expressed as whole percentages", () => {
    const cells: SectorHistorySeasonality[] = [
      { name: "NIFTY IT", month: 1, avg_return: 1.5, hit_rate: 60, n: 5 },
    ];
    render(() => <SeasonalityHeatmap cells={cells} names={["NIFTY IT"]} />);
    expect(screen.getByLabelText("Jan · avg +1.5% · 3/5 up (60%)")).toBeInTheDocument();
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
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getAllByText("10%")).toHaveLength(2);
    expect(screen.queryByText("5%")).not.toBeInTheDocument();
    expect(svg.querySelector("desc")?.textContent).toMatch(/Rows are this month's sector rank/i);
    expect(svg.querySelector("desc")?.textContent).toMatch(/columns are next month's rank/i);
    expectAccessibleLabels(svg);
  });

  test("shows the exact percentage in the cell title", () => {
    render(() => <PersistenceMatrix names={PERSISTENCE_NAMES} matrix={PERSISTENCE_MATRIX} />);
    expect(screen.getByLabelText("#1 → #1 · 50%")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
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
