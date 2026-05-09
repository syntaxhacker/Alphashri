// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ScreenerStockView } from "./ScreenerStockView";
import { MantineProvider } from "@mantine/core";

vi.mock("./ScreenerTable", () => ({
  ScreenerTable: (props: any) => (
    <div data-testid={props["data-testid"] || "screener-table"} data-view="table">
      Table View
    </div>
  ),
}));

vi.mock("./ScreenerHeatmap", () => ({
  ScreenerHeatmap: (props: any) => (
    <div data-testid={props["data-testid"] || "screener-heatmap"} data-view="heatmap">
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
      <MantineProvider>
        <ScreenerStockView {...defaultProps} viewMode="heatmap" />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-heatmap-approaching")).toBeInTheDocument();
    expect(screen.queryByTestId("screener-table-approaching")).not.toBeInTheDocument();
  });

  it("renders ScreenerTable when viewMode is table", () => {
    render(
      <MantineProvider>
        <ScreenerStockView {...defaultProps} viewMode="table" />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-table-approaching")).toBeInTheDocument();
    expect(screen.queryByTestId("screener-heatmap-approaching")).not.toBeInTheDocument();
  });

  it("passes data-testid with section suffix for both views", () => {
    const { rerender } = render(
      <MantineProvider>
        <ScreenerStockView {...defaultProps} viewMode="table" section="touched" />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-table-touched")).toBeInTheDocument();

    rerender(
      <MantineProvider>
        <ScreenerStockView {...defaultProps} viewMode="heatmap" section="touched" />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-heatmap-touched")).toBeInTheDocument();
  });
});
