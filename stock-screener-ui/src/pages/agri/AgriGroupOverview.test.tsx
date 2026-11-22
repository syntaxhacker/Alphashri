// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { AgriGroupOverview, type AgriGroupSummary } from "./AgriGroupOverview";

afterEach(cleanup);

const GROUP_CARDS = ["cereals", "pulses", "vegetables", "oilseeds", "spices"];

const cereals: AgriGroupSummary = {
  group: "cereals",
  index: 104.2,
  breadth_pct: 66.7,
  up_count: 4,
  total_count: 6,
  median_volatility_pct: 2.4,
  best: { key: "wheat", label: "Wheat", chg_pct: 3.2 },
  worst: { key: "rice", label: "Rice", chg_pct: -1.1 },
  tier: "A",
  mandis: 140,
  coverage_pct: 92,
  as_of: "2026-11-21",
};

function renderOverview(overrides: {
  groups?: AgriGroupSummary[] | null;
  loading?: boolean;
  error?: string | null;
  asOf?: string | null;
  selected?: string | null;
  onSelect?: (group: string) => void;
  onRetry?: () => void;
} = {}) {
  render(() => (
    <AgriGroupOverview
      groups={overrides.groups ?? []}
      asOf={overrides.asOf}
      loading={overrides.loading}
      error={overrides.error}
      selected={overrides.selected}
      onSelect={overrides.onSelect}
      onRetry={overrides.onRetry}
    />
  ));
}

describe("AgriGroupOverview", () => {
  it("renders exactly the five registry group cards, in order", () => {
    renderOverview({ groups: [cereals, { group: "livestock", index: 101 }] });

    const cards = GROUP_CARDS.map((key) => screen.getByTestId(`agri-group-card-${key}`));
    expect(cards).toHaveLength(5);
    expect(cards.map((card) => card.getAttribute("data-group"))).toEqual(GROUP_CARDS);
    expect(screen.queryByTestId("agri-group-card-livestock")).not.toBeInTheDocument();

    const grid = screen.getByTestId("agri-group-overview-grid");
    expect(grid).toHaveClass("grid-cols-1", "min-[360px]:grid-cols-2", "xl:grid-cols-5");
  });

  it("shows index, breadth, movers, tier, coverage and as-of", () => {
    renderOverview({ groups: [cereals], asOf: "2026-11-21" });

    expect(screen.getByTestId("agri-group-index-cereals")).toHaveTextContent("104.2");
    expect(screen.getByTestId("agri-group-change-cereals")).toHaveTextContent("+4.2%");
    expect(screen.getByTestId("agri-group-breadth-cereals")).toHaveTextContent("67%");
    expect(screen.getByTestId("agri-group-best-cereals").textContent).toContain("Wheat");
    expect(screen.getByTestId("agri-group-best-cereals").textContent).toContain("+3.2%");
    expect(screen.getByTestId("agri-group-worst-cereals").textContent).toContain("Rice");
    expect(screen.getByTestId("agri-group-worst-cereals").textContent).toContain("-1.1%");
    expect(screen.getByTestId("agri-group-tier-cereals")).toHaveTextContent("Tier A");
    expect(screen.getByTestId("agri-group-coverage-cereals").textContent).toContain("140 mandis");
    expect(screen.getByTestId("agri-group-coverage-cereals").textContent).toContain("92% cov");
    expect(screen.getByTestId("agri-group-coverage-cereals").textContent).toContain("2.4% vol");
    expect(screen.getByTestId("agri-group-asof-cereals")).toHaveTextContent("21 Nov 2026");

    // Index, breadth and both movers share one label/value/trailing grid.
    const rowGrid = "grid-cols-[38px_minmax(0,1fr)_40px]";
    for (const id of [
      "agri-group-best-cereals",
      "agri-group-worst-cereals",
    ]) {
      expect(screen.getByTestId(id)).toHaveClass(rowGrid);
    }
    expect(screen.getByTestId("agri-group-index-cereals").parentElement).toHaveClass(rowGrid);
    expect(screen.getByTestId("agri-group-breadth-cereals").parentElement).toHaveClass(rowGrid);
  });

  it("renders every missing field as an em dash, never undefined or NaN", () => {
    renderOverview({
      groups: [
        {
          group: "pulses",
          index: null,
          breadth_pct: null,
          best: null,
          worst: null,
          tier: null,
          mandis: null,
          coverage_pct: null,
          as_of: null,
        },
      ],
    });

    expect(screen.getByTestId("agri-group-index-pulses")).toHaveTextContent("—");
    expect(screen.getByTestId("agri-group-breadth-pulses")).toHaveTextContent("—");
    expect(screen.getByTestId("agri-group-tier-pulses")).toHaveTextContent("Tier —");
    expect(screen.getByTestId("agri-group-best-pulses").textContent).toContain("—");
    expect(screen.getByTestId("agri-group-worst-pulses").textContent).toContain("—");
    expect(screen.getByTestId("agri-group-coverage-pulses")).toHaveTextContent("coverage —");

    const text = screen.getByTestId("agri-group-card-pulses").textContent ?? "";
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it("accepts a group series and derives the normalized index from its points", () => {
    renderOverview({
      groups: [
        {
          group: "Cereals",
          key: "cereals",
          points: [
            { date: "2026-05-01", modal: 100 },
            { date: "2026-11-21", modal: 104 },
          ],
          breadth: 0.67,
          volatility: 2.4,
          best: "Wheat",
          worst: "Rice",
        },
      ],
    });

    expect(screen.getByTestId("agri-group-index-cereals")).toHaveTextContent("104.0");
    expect(screen.getByTestId("agri-group-change-cereals")).toHaveTextContent("+4.0%");
    expect(screen.getByTestId("agri-group-breadth-cereals")).toHaveTextContent("67%");
    expect(screen.getByTestId("agri-group-best-cereals").textContent).toContain("Wheat");
    expect(screen.getByTestId("agri-group-worst-cereals").textContent).toContain("Rice");
  });

  it("derives Tier C and the thin-sample badge from a small mandi sample", () => {
    renderOverview({
      groups: [
        {
          group: "spices",
          index: 99.6,
          breadth_pct: 25,
          mandis: 8,
          coverage_pct: 40,
        },
      ],
    });

    expect(screen.getByTestId("agri-group-tier-spices")).toHaveTextContent("Tier C");
    const thin = screen.getByTestId("agri-group-thin-spices");
    expect(thin).toHaveTextContent("thin sample");
    // The thin-sample badge sits on the index subline, clear of the header tier badge.
    expect(thin.parentElement?.textContent).toContain("100 base");
    expect(thin.parentElement?.parentElement).not.toContainElement(
      screen.getByTestId("agri-group-tier-spices"),
    );
    expect(screen.getByTestId("agri-group-coverage-spices").textContent).toContain("8 mandis");
    expect(screen.getByTestId("agri-group-coverage-spices").textContent).toContain("40% cov");
  });

  it("selects a group when a card is clicked", () => {
    const onSelect = vi.fn();
    renderOverview({ groups: [cereals], onSelect });

    fireEvent.click(screen.getByTestId("agri-group-card-cereals"));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("cereals");
  });

  it("marks the selected card without changing the other cards", () => {
    renderOverview({ groups: [cereals], selected: "cereals", onSelect: vi.fn() });

    expect(screen.getByTestId("agri-group-card-cereals")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("agri-group-card-pulses")).toHaveAttribute("aria-pressed", "false");
  });

  it("shows a loader during the initial fetch and an empty state afterward", () => {
    const { unmount } = render(() => <AgriGroupOverview groups={[]} loading />);
    expect(screen.getByTestId("agri-group-overview-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("agri-group-overview-grid")).not.toBeInTheDocument();
    unmount();

    renderOverview({ groups: [] });
    expect(screen.getByTestId("agri-group-overview-grid")).toBeInTheDocument();
    expect(screen.getByTestId("agri-group-overview-empty")).toBeInTheDocument();
    expect(screen.getAllByTestId(/agri-group-card-/)).toHaveLength(5);
  });

  it("keeps the cards and surfaces a retryable error", () => {
    const onRetry = vi.fn();
    renderOverview({ groups: [cereals], error: "group aggregates failed", onRetry });

    expect(screen.getByTestId("agri-group-overview-error")).toBeInTheDocument();
    expect(screen.getByTestId("agri-group-card-cereals")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("agri-group-overview-error-retry"));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
