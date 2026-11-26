// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, expectTypeOf, test } from "vitest";
import { cleanup, screen, within } from "@solidjs/testing-library";
import { NEGATIVE } from "@/ui/palette";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import type {
  SectorHistoryPersistence,
  SectorHistoryPersistenceItem,
  SectorHistoryRisk,
  SectorHistorySeries,
} from "../../../types/sectorHistory";
import { RiskTable } from "./RiskTable";
import { buildRiskRows, cumulativeReturn } from "./RiskTable.columns";
import { CHART_MUTED, CHART_NEGATIVE, CHART_POSITIVE } from "./visuals/chartPalette";

const SERIES: SectorHistorySeries[] = [
  {
    name: "Technology",
    is_benchmark: false,
    monthly_returns: [2.1, -1.2, 3.4],
    ranks: [1, 3, 2],
  },
  {
    name: "Banking",
    is_benchmark: false,
    monthly_returns: [-2, 0.5, null],
    ranks: [2, 1, 3],
  },
  {
    name: "Energy",
    is_benchmark: false,
    monthly_returns: [],
    ranks: [3, 2, 1],
  },
];

// Deliberately not worst-first: the panel owns the ordering.
const RISK: SectorHistoryRisk[] = [
  {
    name: "Banking",
    max_drawdown: -12.2,
    current_drawdown: 0,
    recovery_days: null,
    sharpe: null,
    volatility: null,
  },
  {
    name: "Energy",
    max_drawdown: null,
    current_drawdown: null,
    recovery_days: 12,
    sharpe: -0.4,
    volatility: 0,
  },
  {
    name: "Technology",
    max_drawdown: -18.4,
    current_drawdown: -2.1,
    recovery_days: 96,
    sharpe: 0.84,
    volatility: 21.3,
  },
];

function renderPanel(risk: SectorHistoryRisk[] = RISK, series: SectorHistorySeries[] = SERIES) {
  return renderWithProviders(() => <RiskTable risk={risk} series={series} />);
}

describe("RiskTable", () => {
  afterEach(() => cleanup());

  test("renders a direct-labeled bar panel without table markup", async () => {
    renderPanel();
    const panel = await screen.findByTestId("sector-history-risk-table");
    expect(panel.tagName).not.toBe("TABLE");
    expect(panel.querySelector("table, thead, tbody, tr, td, th")).toBeNull();
    expect(panel.querySelector("[role='table'], [role='row']")).toBeNull();
    expect(screen.getByTestId("sector-history-risk-bars").tagName).toBe("UL");

    const technology = screen.getByTestId("sector-history-risk-row-Technology");
    expect(within(technology).getByText("Technology")).toBeInTheDocument();
    expect(within(technology).getByText("-18.4%")).toBeInTheDocument();
    for (const label of ["Cur DD", "Recovery", "Sharpe", "Vol"]) {
      expect(within(technology).getByText(label)).toBeInTheDocument();
    }
    expect(within(panel).queryByText("Max DD")).not.toBeInTheDocument();
  });

  test("orders rows worst drawdown first and null drawdowns last", () => {
    renderPanel();
    const rows = screen.getAllByTestId(/^sector-history-risk-row-/);
    expect(rows.map((row) => row.getAttribute("data-sector"))).toEqual([
      "Technology",
      "Banking",
      "Energy",
    ]);
    expect(screen.getByTestId("sector-history-risk-row-Energy")).toHaveAttribute(
      "data-null-drawdown",
      "true",
    );
  });

  test("formats values and keeps nulls distinct from zero", () => {
    renderPanel();
    const technology = screen.getByTestId("sector-history-risk-row-Technology");
    expect(within(technology).getByText("-18.4%")).toBeInTheDocument();
    expect(within(technology).getByText("-2.1%")).toBeInTheDocument();
    expect(within(technology).getByText("96d")).toBeInTheDocument();
    expect(within(technology).getByText("0.84")).toBeInTheDocument();
    expect(within(technology).getByText("21.3%")).toBeInTheDocument();

    const banking = screen.getByTestId("sector-history-risk-row-Banking");
    expect(within(banking).getByText("0.0%")).toBeInTheDocument();
    expect(within(banking).queryByText("+0.0%")).not.toBeInTheDocument();
    const dashes = within(banking).getAllByText("—");
    expect(dashes).toHaveLength(3);
    for (const dash of dashes) expect(dash).toHaveClass("text-fin-text-muted");

    const energy = screen.getByTestId("sector-history-risk-row-Energy");
    expect(screen.getByTestId("sector-history-risk-max-dd-Energy")).toHaveTextContent("—");
    expect(screen.getByTestId("sector-history-risk-max-dd-Energy")).toHaveClass(
      "text-fin-text-muted",
    );
    expect(within(energy).getByText("12d")).toBeInTheDocument();
    expect(within(energy).getByText("-0.40")).toBeInTheDocument();
    expect(within(energy).getByText("0.0%")).toBeInTheDocument();
    expect(screen.queryByTestId("sector-history-risk-bar-Energy")).not.toBeInTheDocument();
  });

  test("aligns bar lengths to the largest drawdown and grows them left from zero", () => {
    renderPanel();
    const panel = screen.getByTestId("sector-history-risk-table");
    expect(panel).toHaveAttribute("data-scale", "18.4");

    const technologyTrack = screen.getByTestId("sector-history-risk-track-Technology");
    const technologyBar = screen.getByTestId("sector-history-risk-bar-Technology");
    const bankingBar = screen.getByTestId("sector-history-risk-bar-Banking");
    expect(technologyTrack).toHaveAttribute("data-zero-edge", "right");
    expect(technologyBar).toHaveAttribute("data-origin", "right");
    expect(technologyBar).toHaveClass("right-0");
    expect(technologyBar).not.toHaveClass("left-0");
    expect(screen.getByTestId("sector-history-risk-zero-Technology")).toHaveClass("right-0");
    expect(Number(technologyBar.getAttribute("data-bar-fraction"))).toBeCloseTo(1, 6);
    expect(Number(bankingBar.getAttribute("data-bar-fraction"))).toBeCloseTo(12.2 / 18.4, 6);
    expect(technologyBar).toHaveStyle({ "background-color": NEGATIVE });

    expect(screen.getByTestId("sector-history-risk-zero-Technology")).toBeInTheDocument();
    expect(screen.getByTestId("sector-history-risk-zero-Banking")).toBeInTheDocument();
    expect(technologyTrack).toContainElement(technologyBar);
  });

  test("compounds monthly returns and shows the cumulative value beside its sparkline", () => {
    expect(cumulativeReturn([2.1, -1.2, 3.4])).toBeCloseTo(4.3045, 3);
    expect(cumulativeReturn([])).toBeNull();
    expect(cumulativeReturn([null, Number.NaN])).toBeNull();
    expect(cumulativeReturn([-150])).toBe(-100);

    renderPanel();
    const technology = screen.getByTestId("sector-history-risk-spark-Technology");
    expect(technology).toHaveAttribute("title", "Cumulative return +4.3%");
    expect(technology).toHaveTextContent("+4.3%");
    expect(within(technology).getByTestId("history-sparkline")).toBeInTheDocument();
    expect(screen.getByTestId("sector-history-risk-cumulative-Technology")).toHaveStyle({
      color: CHART_POSITIVE,
    });

    expect(screen.getByTestId("sector-history-risk-spark-Banking")).toHaveAttribute(
      "title",
      "Cumulative return -1.5%",
    );
    expect(screen.getByTestId("sector-history-risk-cumulative-Banking")).toHaveStyle({
      color: CHART_NEGATIVE,
    });

    expect(screen.getByTestId("sector-history-risk-spark-Energy")).toHaveAttribute(
      "title",
      "Cumulative return —",
    );
    expect(screen.getByTestId("sector-history-risk-cumulative-Energy")).toHaveTextContent("—");
    expect(screen.getByTestId("sector-history-risk-cumulative-Energy")).toHaveStyle({
      color: CHART_MUTED,
    });
  });

  test("keeps the cumulative accessible name aligned with the visible value", () => {
    renderPanel();
    for (const name of ["Technology", "Energy"]) {
      const visible = screen.getByTestId(`sector-history-risk-cumulative-${name}`).textContent ?? "";
      expect(screen.getByTestId(`sector-history-risk-spark-${name}`)).toHaveAttribute(
        "aria-label",
        `Cumulative return ${visible}`,
      );
    }
    expect(screen.getByTestId("sector-history-risk-cumulative-Energy")).toHaveTextContent("—");
  });

  test("stacks metrics into a two-column grid at 390 without a fixed table width", () => {
    renderPanel();
    const panel = screen.getByTestId("sector-history-risk-table");
    const row = screen.getByTestId("sector-history-risk-row-Technology");
    const metrics = screen.getByTestId("sector-history-risk-metrics-Technology");
    const spark = screen.getByTestId("sector-history-risk-spark-Technology");

    expect(panel).toHaveClass("min-w-0");
    expect(panel.className).not.toMatch(/(^|\s)(min-w-\[|overflow-x-(auto|scroll))/);
    expect(panel.querySelector("[style*='min-width']")).toBeNull();
    expect(row).toHaveClass("grid-cols-2");
    expect(row.className).toContain("lg:grid-cols-[");
    expect(metrics).toHaveClass("grid-cols-2");
    expect(metrics).toHaveClass("lg:grid-cols-4");
    expect(spark).toHaveClass("col-span-2");
    expect(spark).toHaveClass("lg:col-span-1");
    expect(screen.queryByTestId("sector-history-risk-scroll-hint")).not.toBeInTheDocument();
  });

  test("computes a shared scale and null fractions in the model", () => {
    const model = buildRiskRows(RISK, SERIES);
    expect(model.scale).toBe(18.4);
    expect(model.rows.map((row) => row.name)).toEqual(["Technology", "Banking", "Energy"]);
    expect(model.rows[0].barFraction).toBeCloseTo(1, 6);
    expect(model.rows[1].barFraction).toBeCloseTo(12.2 / 18.4, 6);
    expect(model.rows[2].barFraction).toBeNull();

    const flat = buildRiskRows(
      [
        {
          name: "Flat",
          max_drawdown: 0,
          current_drawdown: 0,
          recovery_days: 0,
          sharpe: 0,
          volatility: 0,
        },
      ],
      [],
    );
    expect(flat.scale).toBe(1);
    expect(flat.rows[0].barFraction).toBe(0);
  });

  test("renders the empty state without risk rows", async () => {
    renderWithProviders(() => <RiskTable risk={[]} series={[]} />);
    expect(await screen.findByText("No risk metrics")).toBeInTheDocument();
    expect(screen.queryByTestId("sector-history-risk-bars")).not.toBeInTheDocument();
  });

  test("keeps the persistence block's transition_n typed as a number", () => {
    const item: SectorHistoryPersistenceItem = {
      name: "Technology",
      top3_months: 24,
      top3_stayed: 15,
      top3_persistence_pct: 62.5,
      avg_next_rank: 3.4,
    };
    const persistence: SectorHistoryPersistence = {
      by_sector: [item],
      transition_matrix: [[0.6, null]],
      transition_n: 48,
    };
    expectTypeOf(persistence.transition_n).toEqualTypeOf<number>();
    expect(persistence.transition_n).toBe(48);
    expect(persistence.by_sector[0].top3_months).toBe(24);
  });
});
