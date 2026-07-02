// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ScreenerStockView } from "./ScreenerStockView";
import { UIProvider } from "@/ui";

vi.mock("./ScreenerTable", () => ({
  ScreenerTable: (props: any) => (
    <div data-testid={props["data-testid"] || "screener-table"} data-view="table">
      Table View
    </div>
  ),
}));

vi.mock("./ScreenerHeatmapView", () => ({
  ScreenerHeatmapView: (props: any) => (
    <div data-testid={props.testId || "screener-heatmap"} data-view="heatmap">
      Heatmap View
    </div>
  ),
}));

describe("ScreenerStockView", () => {
  const defaultProps = {
    stocks: [],
    columns: [],
    touchedSymbols: new Set<string>(),
    sortColumn: null,
    sortDirection: "desc" as const,
    onSortChange: vi.fn(),
    onSymbolClick: vi.fn(),
    onSymbolHover: vi.fn(),
    section: "approaching" as const,
    activeScreener: "trending",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders ScreenerHeatmap when viewMode is heatmap", () => {
    render(
      <UIProvider>
        <ScreenerStockView {...defaultProps} viewMode="heatmap" />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-heatmap-approaching")).toBeInTheDocument();
    expect(screen.queryByTestId("screener-table-approaching")).not.toBeInTheDocument();
  });

  it("renders ScreenerTable when viewMode is table", () => {
    render(
      <UIProvider>
        <ScreenerStockView {...defaultProps} viewMode="table" />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-table-approaching")).toBeInTheDocument();
    expect(screen.queryByTestId("screener-heatmap-approaching")).not.toBeInTheDocument();
  });

  it("passes data-testid with section suffix for both views", () => {
    const { rerender } = render(
      <UIProvider>
        <ScreenerStockView {...defaultProps} viewMode="table" section="touched" />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-table-touched")).toBeInTheDocument();

    rerender(
      <UIProvider>
        <ScreenerStockView {...defaultProps} viewMode="heatmap" section="touched" />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-heatmap-touched")).toBeInTheDocument();
  });
});
