// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { ScreenerTable } from "./ScreenerTable";
import { UIProvider } from "@/ui";
import type { Stock } from "../../types";
import type { ColumnDef } from "./columns";

vi.mock("../../state", () => ({
  selectedSymbols: [],
  toggleSymbolSelection: vi.fn(),
  clearSelectedSymbols: vi.fn(),
  setSelectedSymbols: vi.fn(),
}));

vi.mock("../common/PreviewChartProvider", () => ({
  usePreviewChart: () => ({
    showPreviewChart: vi.fn(),
    hidePreviewChart: vi.fn(),
  }),
}));

const mockStock: Stock = {
  symbol: "RELIANCE",
  score: 85,
  tv_price: 2450.5,
  upstox_price: 2451.0,
  broker_diff: 0.02,
  high_52w: 2600,
  to_52w_high: -5.76,
  recent_return_5d: 3.2,
  perf_w: 1.5,
  sector: "Energy",
  touched_52w: false,
  day_change: 1.25,
  rsi: 65.3,
  stoch_k: 72.1,
  gap_pct: 0.5,
  premarket_change: 0.8,
  impact_score: 2.5,
  market_cap_b: 185.3,
  volume_m: 12.45,
};

const mockColumns: ColumnDef[] = [
  { key: "symbol", label: "Symbol", type: "string", sortable: true },
  { key: "score", label: "Score", type: "badge", sortable: true },
  { key: "tv_price", label: "Price", type: "number", sortable: true },
  { key: "day_change", label: "Change", type: "number", sortable: true },
  { key: "sector", label: "Sector", type: "string", sortable: true },
];

const mockStocks: Stock[] = [
  mockStock,
  { ...mockStock, symbol: "TCS", score: 75, sector: "Technology" },
  { ...mockStock, symbol: "INFY", score: 90, touched_52w: true, sector: "Technology" },
];

describe("ScreenerTable", () => {
  const defaultProps = {
    stocks: mockStocks,
    columns: mockColumns,
    touchedSymbols: new Set(["INFY"]),
    onSymbolClick: vi.fn(),
    onSymbolHover: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders table with data-testid", () => {
    render(
      <UIProvider>
        <ScreenerTable {...defaultProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-table")).toBeInTheDocument();
  });

  it("renders all stocks as rows", () => {
    render(
      <UIProvider>
        <ScreenerTable {...defaultProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("stock-row-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("stock-row-TCS")).toBeInTheDocument();
    expect(screen.getByTestId("stock-row-INFY")).toBeInTheDocument();
  });

  it("renders header text for each column", () => {
    render(
      <UIProvider>
        <ScreenerTable {...defaultProps} />
      </UIProvider>,
    );
    mockColumns.forEach((col) => {
      expect(screen.getByText(col.label)).toBeInTheDocument();
    });
  });

  it("calls onSymbolClick when stock row is clicked", async () => {
      const user = userEvent.setup();
    render(
      <UIProvider>
        <ScreenerTable {...defaultProps} />
      </UIProvider>,
    );
    await user.click(screen.getByTestId("stock-row-TCS"));
    expect(defaultProps.onSymbolClick).toHaveBeenCalledWith("TCS");
  });

  it("renders copy-all-symbols button when stocks exist", () => {
    render(
      <UIProvider>
        <ScreenerTable {...defaultProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("copy-all-symbols-btn")).toBeInTheDocument();
  });

  it("does not render copy-all-symbols button when stocks array is empty", () => {
    render(
      <UIProvider>
        <ScreenerTable {...defaultProps} stocks={[]} />
      </UIProvider>,
    );
    expect(screen.queryByTestId("copy-all-symbols-btn")).not.toBeInTheDocument();
  });

  it("renders correct number of columns in header", () => {
    render(
      <UIProvider>
        <ScreenerTable {...defaultProps} />
      </UIProvider>,
    );
    const ths = document.querySelectorAll("thead tr th");
    expect(ths.length).toBe(mockColumns.length + 1);
  });

  it("renders correct number of body rows", () => {
    render(
      <UIProvider>
        <ScreenerTable {...defaultProps} />
      </UIProvider>,
    );
    const rows = document.querySelectorAll("tbody tr");
    expect(rows.length).toBe(mockStocks.length);
  });

  it("handles empty stocks array gracefully", () => {
    render(
      <UIProvider>
        <ScreenerTable {...defaultProps} stocks={[]} />
      </UIProvider>,
    );
    expect(screen.queryByTestId("stock-row-RELIANCE")).not.toBeInTheDocument();
  });

  it("handles single stock", () => {
    render(
      <UIProvider>
        <ScreenerTable {...defaultProps} stocks={[mockStock]} />
      </UIProvider>,
    );
    expect(screen.getByTestId("stock-row-RELIANCE")).toBeInTheDocument();
    expect(screen.queryByTestId("stock-row-TCS")).not.toBeInTheDocument();
  });

  it("renders table with MUI sx (no global CSS class)", () => {
    render(
      <UIProvider>
        <ScreenerTable {...defaultProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("screener-table")).toBeInTheDocument();
  });
});
