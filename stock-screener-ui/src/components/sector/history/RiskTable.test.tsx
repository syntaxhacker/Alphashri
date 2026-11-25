// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, expectTypeOf, test } from "vitest";
import { cleanup, screen, waitFor, within } from "@solidjs/testing-library";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import type {
  SectorHistoryPersistence,
  SectorHistoryPersistenceItem,
  SectorHistoryRisk,
  SectorHistorySeries,
} from "../../../types/sectorHistory";
import { RiskTable } from "./RiskTable";
import { cumulativeReturn } from "./RiskTable.columns";
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

const RISK: SectorHistoryRisk[] = [
  {
    name: "Technology",
    max_drawdown: -18.4,
    current_drawdown: -2.1,
    recovery_days: 96,
    sharpe: 0.84,
    volatility: 21.3,
  },
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
];

function renderTable() {
  return renderWithProviders(() => <RiskTable risk={RISK} series={SERIES} />);
}

describe("RiskTable", () => {
  afterEach(() => cleanup());

  test("formats numbers and renders a dash for every missing value", async () => {
    renderTable();
    const technology = await screen.findByTestId("sector-history-risk-row-Technology");
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
    expect(dashes[0]).toHaveClass("text-fin-text-muted");

    const energy = screen.getByTestId("sector-history-risk-row-Energy");
    expect(within(energy).getByText("0.0%")).toBeInTheDocument();
    expect(within(energy).getByText("-0.40")).toBeInTheDocument();

    const cells = technology.querySelectorAll<HTMLElement>("td");
    expect(cells[0].className).toContain("text-left");
    expect(cells[1].className).toContain("text-right");
    expect(cells[1].className).toContain("font-mono");
    expect(cells[1].className).toContain("tabular-nums");
  });

  test("compounds monthly returns and shows the final cumulative value", async () => {
    expect(cumulativeReturn([2.1, -1.2, 3.4])).toBeCloseTo(4.3045, 3);
    expect(cumulativeReturn([])).toBeNull();
    expect(cumulativeReturn([null, Number.NaN])).toBeNull();
    expect(cumulativeReturn([-150])).toBe(-100);

    renderTable();
    const technology = await screen.findByTestId("sector-history-risk-spark-Technology");
    expect(technology).toHaveAttribute("title", "Cumulative return +4.3%");
    expect(technology).toHaveTextContent("+4.3%");
    expect(screen.getByTestId("sector-history-risk-cumulative-Technology")).toHaveStyle({
      color: CHART_POSITIVE,
    });

    const banking = screen.getByTestId("sector-history-risk-spark-Banking");
    expect(banking).toHaveAttribute("title", "Cumulative return -1.5%");
    expect(banking).toHaveTextContent("-1.5%");
    expect(screen.getByTestId("sector-history-risk-cumulative-Banking")).toHaveStyle({
      color: CHART_NEGATIVE,
    });

    const energy = screen.getByTestId("sector-history-risk-spark-Energy");
    expect(energy).toHaveAttribute("title", "Cumulative return unavailable");
    expect(energy).toHaveTextContent("—");
    expect(screen.getByTestId("sector-history-risk-cumulative-Energy")).toHaveStyle({
      color: CHART_MUTED,
    });
  });

  test("pins the sector column and exposes the table scrollport as a region", async () => {
    renderTable();
    const table = await screen.findByTestId("sector-history-risk-table");
    const scroller = table.closest<HTMLElement>(".paper-tanstack-scroll");
    expect(scroller).not.toBeNull();
    await waitFor(() => expect(scroller).toHaveAttribute("role", "region"));
    expect(scroller).toHaveAttribute("tabindex", "0");
    expect(scroller).toHaveAttribute(
      "aria-label",
      "Sector history risk metrics, scroll sideways for all columns",
    );

    expect(screen.queryByTestId("sector-history-risk-scroll-hint")).not.toBeInTheDocument();

    const sticky = screen.getByTestId("sector-history-risk-sticky-style");
    expect(sticky.textContent).toContain("th:first-child");
    expect(sticky.textContent).toContain("td:first-child");
    expect(sticky.textContent).toContain("position: sticky");
    expect(sticky.textContent).toContain("left: 0");
    expect(sticky.textContent).not.toContain("height:");
    expect(sticky.textContent).not.toContain("padding");

    const firstHeader = table.querySelector<HTMLElement>("thead th");
    expect(firstHeader?.style.position).toBe("sticky");
    expect(firstHeader?.style.top).toBe("0px");
  });

  test("uses dense metrics that still land in the 20–24px row pitch", async () => {
    renderTable();
    const table = await screen.findByTestId("sector-history-risk-table");
    expect(table.style.getPropertyValue("--tbl-row-h")).toBe("18px");
    expect(table.style.getPropertyValue("--tbl-cell-pad")).toBe("1px 6px");

    const rowHeight = Number.parseFloat(table.style.getPropertyValue("--tbl-row-h"));
    const [padTop = 0, padRight = padTop, padBottom = padTop, padLeft = padRight] = table.style
      .getPropertyValue("--tbl-cell-pad")
      .split(/\s+/)
      .map((part) => Number.parseFloat(part));
    expect([padTop, padRight, padBottom, padLeft]).toEqual([1, 6, 1, 6]);
    // The 18px sparkline is the tallest content: 18 + 1px top + 1px bottom
    // padding + the 1px row border gives the rendered 21px pitch.
    const pitch = rowHeight + padTop + padBottom + 1;
    expect(pitch).toBeGreaterThanOrEqual(20);
    expect(pitch).toBeLessThanOrEqual(24);
  });

  test("renders the empty state without risk rows", async () => {
    renderWithProviders(() => <RiskTable risk={[]} series={[]} />);
    expect(await screen.findByText("No risk metrics")).toBeInTheDocument();
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
