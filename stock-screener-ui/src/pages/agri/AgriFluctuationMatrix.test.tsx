// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import {
  AgriFluctuationMatrix,
  type AgriFluctuationMatrixRow,
} from "./AgriFluctuationMatrix";

afterEach(cleanup);

const rows: AgriFluctuationMatrixRow[] = [
  {
    key: "onion",
    label: "Onion",
    group: "vegetables",
    chg_1w_pct: 2.4,
    chg_1m_pct: -1.2,
    chg_3m_pct: 0,
    chg_6m_pct: null,
    markets: 42,
    dates: 120,
    coverage_pct: 88.5,
    tier: "B",
    as_of: "2026-11-21",
    sparkline: [100, 102, 101, 104],
  },
  {
    key: "wheat",
    label: "Wheat",
    group: "cereals",
    chg_1w_pct: null,
    chg_1m_pct: 4.1,
    chg_3m_pct: null,
    chg_6m_pct: -3.5,
    markets: 8,
    dates: 60,
    coverage_pct: 40,
    as_of: "2026-11-21",
  },
  {
    key: "tomato",
    label: "",
    group: "vegetables",
    chg_1w_pct: Number.NaN,
    chg_1m_pct: undefined,
    chg_3m_pct: Number.POSITIVE_INFINITY,
    chg_6m_pct: null,
    markets: null,
    coverage_pct: null,
    as_of: "2026-11-21",
  },
];

function renderMatrix(overrides: {
  rows?: AgriFluctuationMatrixRow[] | null;
  loading?: boolean;
  error?: string | null;
  group?: string | null;
  selected?: string | null;
  onSelect?: (commodity: string) => void;
  onRetry?: () => void;
} = {}) {
  render(() => (
    <AgriFluctuationMatrix
      rows={overrides.rows ?? rows}
      group={overrides.group ?? "vegetables"}
      asOf="2026-11-21"
      loading={overrides.loading}
      error={overrides.error}
      selected={overrides.selected}
      onSelect={overrides.onSelect}
      onRetry={overrides.onRetry}
    />
  ));
}

describe("AgriFluctuationMatrix", () => {
  it("renders commodity rows and all four period columns", () => {
    renderMatrix();

    expect(screen.getByTestId("agri-fluctuation-matrix")).toBeInTheDocument();
    expect(screen.getByText("1W")).toBeInTheDocument();
    expect(screen.getByText("1M")).toBeInTheDocument();
    expect(screen.getByText("3M")).toBeInTheDocument();
    expect(screen.getByText("6M")).toBeInTheDocument();
    expect(screen.getByTestId("agri-matrix-row-onion")).toBeInTheDocument();
    expect(screen.getByTestId("agri-matrix-row-wheat")).toBeInTheDocument();
    expect(screen.getByTestId("agri-matrix-row-tomato")).toBeInTheDocument();
    expect(screen.getByTestId("agri-matrix-commodity-tomato")).toHaveTextContent("Tomato");
    expect(screen.getByTestId("agri-fluctuation-matrix-scroll-hint")).toHaveTextContent(
      "Swipe horizontally",
    );

    // Fixed widths keep headers aligned and force horizontal scroll on narrow screens.
    const table = screen.getByTestId("agri-fluctuation-matrix");
    expect(table).toHaveStyle({ "min-width": "512px" });
    expect(screen.getByText("1W").closest("th")).toHaveStyle({ width: "84px" });
    expect(screen.getByText("Commodity").closest("th")).toHaveStyle({ width: "176px" });

    // The panel grows into the category view and keeps a floor when rows are sparse.
    expect(screen.getByTestId("agri-fluctuation-matrix-panel")).toHaveClass("flex-1");
    expect(screen.getByTestId("agri-fluctuation-matrix-region")).toHaveStyle({
      "min-height": "180px",
    });
  });

  it("shows signed changes and an em dash with a gap tooltip for nulls", () => {
    renderMatrix();

    expect(screen.getByTestId("agri-matrix-value-onion-1w")).toHaveTextContent("+2.4%");
    expect(screen.getByTestId("agri-matrix-value-onion-1m")).toHaveTextContent("-1.2%");
    expect(screen.getByTestId("agri-matrix-value-onion-3m")).toHaveTextContent("0.0%");

    const missing = screen.getByTestId("agri-matrix-value-onion-6m");
    expect(missing).toHaveTextContent("—");
    expect(missing.getAttribute("title")).toContain("gap");

    const trailingGap = screen.getByTestId("agri-matrix-value-wheat-3m");
    expect(trailingGap).toHaveTextContent("—");
    expect(trailingGap.getAttribute("title")).toContain("gap");
  });

  it("accepts pre-computed horizon cells from the aggregation helper", () => {
    renderMatrix({
      rows: [
        {
          key: "onion",
          label: "Onion",
          cells: [
            { key: "1W", value: 2 },
            { key: "1M", value: null },
            { key: "3M", value: -4.5 },
            { key: "6M", value: 8 },
          ],
        },
      ],
    });

    expect(screen.getByTestId("agri-matrix-value-onion-1w")).toHaveTextContent("+2.0%");
    expect(screen.getByTestId("agri-matrix-value-onion-1m")).toHaveTextContent("—");
    expect(screen.getByTestId("agri-matrix-value-onion-3m")).toHaveTextContent("-4.5%");
    expect(screen.getByTestId("agri-matrix-value-onion-6m")).toHaveTextContent("+8.0%");
  });

  it("never prints undefined or NaN for non-finite input", () => {
    renderMatrix();

    const tomato = screen.getByTestId("agri-matrix-row-tomato");
    expect(tomato.textContent ?? "").not.toMatch(/undefined|NaN/);
    expect(screen.getByTestId("agri-matrix-value-tomato-1w")).toHaveTextContent("—");
    expect(screen.getByTestId("agri-matrix-value-tomato-1m")).toHaveTextContent("—");
    expect(screen.getByTestId("agri-matrix-value-tomato-3m")).toHaveTextContent("—");
  });

  it("makes the sample and coverage badges explicit, including a thin-sample tier", () => {
    renderMatrix();

    expect(screen.getByTestId("agri-matrix-tier-onion")).toHaveTextContent("Tier B");
    expect(screen.getByTestId("agri-matrix-sample-onion")).toHaveTextContent("42m");
    expect(screen.getByTestId("agri-matrix-coverage-onion")).toHaveTextContent("89%");

    expect(screen.getByTestId("agri-matrix-tier-wheat")).toHaveTextContent("Tier C · thin");
    expect(screen.getByTestId("agri-matrix-sample-wheat")).toHaveTextContent("8m");
    expect(screen.getByTestId("agri-matrix-coverage-wheat")).toHaveTextContent("40%");

    // Tier shares the name line; sample and coverage share the second line.
    const tier = screen.getByTestId("agri-matrix-tier-wheat");
    const sample = screen.getByTestId("agri-matrix-sample-wheat");
    expect(tier.parentElement).not.toContainElement(sample);
    expect(sample.parentElement).toContainElement(
      screen.getByTestId("agri-matrix-coverage-wheat"),
    );
  });

  it("selects a commodity on row click and keyboard activation", () => {
    const onSelect = vi.fn();
    renderMatrix({ onSelect });

    fireEvent.click(screen.getByTestId("agri-matrix-row-onion"));
    expect(onSelect).toHaveBeenCalledWith("onion");

    fireEvent.keyDown(screen.getByTestId("agri-matrix-row-wheat"), { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("wheat");
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("marks the selected row and includes the group and as-of in the header", () => {
    renderMatrix({ selected: "onion" });

    expect(screen.getByTestId("agri-matrix-row-onion")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId("agri-matrix-row-wheat")).toHaveAttribute("data-selected", "false");

    const panel = screen.getByTestId("agri-fluctuation-matrix-panel");
    expect(panel.textContent).toContain("Vegetables");
    expect(panel.textContent).toContain("3 commodities");
    expect(panel.textContent).toContain("21 Nov 2026");
    expect(panel.textContent).toContain("— = gap");
  });

  it("shows a table loading state and an empty state", () => {
    const { unmount } = render(() => (
      <AgriFluctuationMatrix rows={[]} loading />
    ));
    expect(screen.getByTestId("table-loading-state")).toBeInTheDocument();
    expect(screen.getByText("Loading fluctuation matrix…")).toBeInTheDocument();
    unmount();

    render(() => <AgriFluctuationMatrix rows={[]} />);
    expect(screen.getByText("No commodities in this group")).toBeInTheDocument();
  });

  it("replaces the table with a retryable error", () => {
    const onRetry = vi.fn();
    renderMatrix({ error: "fluctuation payload failed", onRetry });

    expect(screen.getByTestId("agri-fluctuation-matrix-error")).toBeInTheDocument();
    expect(screen.queryByTestId("agri-fluctuation-matrix")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("agri-fluctuation-matrix-error-retry"));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
