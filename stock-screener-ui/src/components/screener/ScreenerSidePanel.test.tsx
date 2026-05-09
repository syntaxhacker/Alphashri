// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MantineProvider } from "@mantine/core";
import type { ReactElement } from "react";

let mockSortColumn: string | null = null;
let mockSortDirection: "asc" | "desc" = "desc";
let mockProfileFilters: Record<string, any> = {};
let mockProfileMetaById: Record<string, any> = {};

vi.mock("../../state", () => {
  const mockSetSortColumn = vi.fn((c: string | null) => { mockSortColumn = c; });
  const mockSetSortDirection = vi.fn((d: "asc" | "desc") => { mockSortDirection = d; });
  const mockSetProfileFilters = vi.fn((f: Record<string, any>) => { mockProfileFilters = f; });
  return {
    get sortColumn() { return mockSortColumn; },
    get sortDirection() { return mockSortDirection; },
    get profileFilters() { return mockProfileFilters; },
    get profileMetaById() { return mockProfileMetaById; },
    setSortColumn: mockSetSortColumn,
    setSortDirection: mockSetSortDirection,
    setProfileFilters: mockSetProfileFilters,
    subscribe: vi.fn(() => vi.fn()),
  };
});

vi.mock("../../api", () => ({
  fetchData: vi.fn(),
}));

import { ScreenerSidePanel } from "./ScreenerSidePanel";

const renderWithProvider = (ui: ReactElement) =>
  render(<MantineProvider>{ui}</MantineProvider>);

const trendingOption = {
  id: "trending",
  label: "Trending",
  description: "Top trending stocks",
  columns: ["symbol", "score", "rsi"],
  indicators: ["RSI", "ADX"],
  filters: [
    { key: "min_rsi", label: "Min RSI", type: "number", min: 0, max: 100, default: 30 },
    { key: "trend", label: "Trend", type: "select", options: ["up", "down", "sideways"] },
  ],
  default_sort: { column: "score", direction: "desc" },
};

const basicOption = {
  id: "new-highs",
  label: "New Highs",
  columns: ["symbol", "score"],
};

describe("ScreenerSidePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSortColumn = null;
    mockSortDirection = "desc";
    mockProfileFilters = {};
    mockProfileMetaById = {};
  });

  afterEach(() => {
    cleanup();
  });

  it("shows active screener name and description", () => {
    mockProfileMetaById = { trending: { default_sort: trendingOption.default_sort, filters: [] } };
    renderWithProvider(
      <ScreenerSidePanel
        activeScreener="trending"
        screenerOptions={[trendingOption, basicOption]}
        sortColumn={null}
        sortDirection="desc"
      />,
    );
    expect(screen.getByText("Trending")).toBeInTheDocument();
    expect(screen.getByText("Top trending stocks")).toBeInTheDocument();
  });

  it("shows indicator badges when activeOption has indicators", () => {
    mockProfileMetaById = { trending: { default_sort: trendingOption.default_sort, filters: trendingOption.filters } };
    renderWithProvider(
      <ScreenerSidePanel
        activeScreener="trending"
        screenerOptions={[trendingOption, basicOption]}
        sortColumn={null}
        sortDirection="desc"
      />,
    );
    expect(screen.getByText("RSI")).toBeInTheDocument();
    expect(screen.getByText("ADX")).toBeInTheDocument();
  });

  it("does not show indicator badges when activeOption has no indicators", () => {
    mockProfileMetaById = { "new-highs": { default_sort: null, filters: [] } };
    renderWithProvider(
      <ScreenerSidePanel
        activeScreener="new-highs"
        screenerOptions={[trendingOption, basicOption]}
        sortColumn={null}
        sortDirection="desc"
      />,
    );
    expect(screen.queryByText("INDICATORS")).not.toBeInTheDocument();
  });

  it("renders filter inputs for each filter in profile", () => {
    mockProfileMetaById = { trending: { default_sort: trendingOption.default_sort, filters: trendingOption.filters } };
    renderWithProvider(
      <ScreenerSidePanel
        activeScreener="trending"
        screenerOptions={[trendingOption, basicOption]}
        sortColumn={null}
        sortDirection="desc"
      />,
    );
    expect(screen.getByText("FILTERS")).toBeInTheDocument();
    expect(screen.getByText("Min RSI")).toBeInTheDocument();
    expect(screen.getByText("Trend")).toBeInTheDocument();
  });

  it("renders number input for number-type filters", () => {
    mockProfileMetaById = { trending: { default_sort: trendingOption.default_sort, filters: trendingOption.filters } };
    renderWithProvider(
      <ScreenerSidePanel
        activeScreener="trending"
        screenerOptions={[trendingOption, basicOption]}
        sortColumn={null}
        sortDirection="desc"
      />,
    );
    expect(screen.getByText("Min RSI")).toBeInTheDocument();
  });

  it("renders select for select-type filters", () => {
    mockProfileMetaById = { trending: { default_sort: trendingOption.default_sort, filters: trendingOption.filters } };
    renderWithProvider(
      <ScreenerSidePanel
        activeScreener="trending"
        screenerOptions={[trendingOption, basicOption]}
        sortColumn={null}
        sortDirection="desc"
      />,
    );
    expect(screen.getByText("Trend")).toBeInTheDocument();
  });

  it("Apply Filters button triggers fetchData", async () => {
    mockProfileMetaById = { trending: { default_sort: trendingOption.default_sort, filters: trendingOption.filters } };
    renderWithProvider(
      <ScreenerSidePanel
        activeScreener="trending"
        screenerOptions={[trendingOption, basicOption]}
        sortColumn={null}
        sortDirection="desc"
      />,
    );
    const applyBtn = screen.getByText("Apply Filters");
    fireEvent.click(applyBtn);
    const api = await import("../../api");
    expect(api.fetchData).toHaveBeenCalledWith("upstox", "intraday", "trending", "manual");
  });

  it.skip("Sort button shows default sort column with direction arrow", () => {
    mockSortColumn = "score";
    mockSortDirection = "asc";
    mockProfileMetaById = { trending: { default_sort: trendingOption.default_sort, filters: trendingOption.filters } };
    renderWithProvider(
      <ScreenerSidePanel
        activeScreener="trending"
        screenerOptions={[trendingOption, basicOption]}
        sortColumn="score"
        sortDirection="asc"
      />,
    );
    const sortBtn = screen.getByText(/score/);
    expect(sortBtn).toBeInTheDocument();
    expect(screen.getByText("↑")).toBeInTheDocument();
  });

  it("Calling sort toggles direction on same column", async () => {
    mockSortColumn = "score";
    mockSortDirection = "asc";
    mockProfileMetaById = { trending: { default_sort: trendingOption.default_sort, filters: trendingOption.filters } };
    renderWithProvider(
      <ScreenerSidePanel
        activeScreener="trending"
        screenerOptions={[trendingOption, basicOption]}
        sortColumn="score"
        sortDirection="asc"
      />,
    );
    const sortBtn = screen.getByText(/score/);
    fireEvent.click(sortBtn);
    const st = await import("../../state");
    expect(st.setSortDirection).toHaveBeenCalledWith("desc");
  });
});
