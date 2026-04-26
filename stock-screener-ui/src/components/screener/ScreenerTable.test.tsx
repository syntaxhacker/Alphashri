// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ScreenerTable } from "./ScreenerTable";
import { MantineProvider } from "@mantine/core";
import { DataTable } from "../common/DataTable";
import { SortableHeader } from "../common/SortableHeader";
import type { Stock } from "../../types";
import type { ColumnDef } from "./columns";

// Mock StockRow as a simple table row
vi.mock("./StockRow", () => ({
  StockRow: ({ stock, isTouched, onSymbolClick, onSymbolHover }: any) => (
    <tr
      data-testid={`stock-row-${stock.symbol}`}
      data-is-touched={isTouched}
      onClick={() => onSymbolClick(stock.symbol)}
      onMouseEnter={() => onSymbolHover(stock.symbol)}
      onMouseLeave={() => onSymbolHover(null)}
    >
      <td>{stock.symbol}</td>
    </tr>
  ),
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
    sortColumn: "score",
    sortDirection: "desc" as const,
    onSortChange: vi.fn(),
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
      <MantineProvider>
        <ScreenerTable {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-table")).toBeInTheDocument();
  });

  it("renders table header with correct test id", () => {
    render(
      <MantineProvider>
        <ScreenerTable {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-table-header")).toBeInTheDocument();
  });

  it("renders table body with correct test id", () => {
    render(
      <MantineProvider>
        <ScreenerTable {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-table-body")).toBeInTheDocument();
  });

  it("renders all stocks as rows", () => {
    render(
      <MantineProvider>
        <ScreenerTable {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("stock-row-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("stock-row-TCS")).toBeInTheDocument();
    expect(screen.getByTestId("stock-row-INFY")).toBeInTheDocument();
  });

  it("renders sortable headers for each column", () => {
    render(
      <MantineProvider>
        <ScreenerTable {...defaultProps} />
      </MantineProvider>,
    );
    mockColumns.forEach((col) => {
      expect(screen.getByTestId(`sort-header-${col.key}`)).toBeInTheDocument();
    });
  });

  it("calls onSortChange when sortable header is clicked", () => {
    render(
      <MantineProvider>
        <ScreenerTable {...defaultProps} />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByTestId("sort-header-score"));
    expect(defaultProps.onSortChange).toHaveBeenCalledWith("score");
  });

  it("displays sort indicator on sorted column", () => {
    render(
      <MantineProvider>
        <ScreenerTable {...defaultProps} />
      </MantineProvider>,
    );
    const scoreHeader = screen.getByTestId("sort-header-score");
    expect(scoreHeader).toHaveAttribute("data-sorted", "true");
    expect(scoreHeader).toHaveAttribute("data-direction", "desc");
  });

  it("shows sort indicator with correct direction class", () => {
    render(
      <MantineProvider>
        <ScreenerTable {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("sort-indicator-score")).toHaveClass("desc");
  });

  it("marks touched rows with is-touched attribute", () => {
    render(
      <MantineProvider>
        <ScreenerTable {...defaultProps} />
      </MantineProvider>,
    );
    const infyRow = screen.getByTestId("stock-row-INFY");
    expect(infyRow).toHaveAttribute("data-is-touched", "true");

    const relianceRow = screen.getByTestId("stock-row-RELIANCE");
    expect(relianceRow).toHaveAttribute("data-is-touched", "false");
  });

  it("calls onSymbolClick when stock row is clicked", () => {
    render(
      <MantineProvider>
        <ScreenerTable {...defaultProps} />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByTestId("stock-row-TCS"));
    expect(defaultProps.onSymbolClick).toHaveBeenCalledWith("TCS");
  });

  it("calls onSymbolHover on mouse enter and leave", () => {
    render(
      <MantineProvider>
        <ScreenerTable {...defaultProps} />
      </MantineProvider>,
    );
    const row = screen.getByTestId("stock-row-RELIANCE");

    fireEvent.mouseEnter(row);
    expect(defaultProps.onSymbolHover).toHaveBeenCalledWith("RELIANCE");

    fireEvent.mouseLeave(row);
    expect(defaultProps.onSymbolHover).toHaveBeenCalledWith(null);
  });

  it("renders copy-all-symbols button when stocks exist", () => {
    render(
      <MantineProvider>
        <ScreenerTable {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("copy-all-symbols-btn")).toBeInTheDocument();
  });

  it("does not render copy-all-symbols button when stocks array is empty", () => {
    render(
      <MantineProvider>
        <ScreenerTable {...defaultProps} stocks={[]} />
      </MantineProvider>,
    );
    expect(screen.queryByTestId("copy-all-symbols-btn")).not.toBeInTheDocument();
  });

  it("renders correct number of columns in header", () => {
    render(
      <MantineProvider>
        <ScreenerTable {...defaultProps} />
      </MantineProvider>,
    );
    const header = screen.getByTestId("screener-table-header");
    const rows = header.querySelectorAll("tr th");
    expect(rows.length).toBe(mockColumns.length);
  });

  it("renders correct number of body rows", () => {
    render(
      <MantineProvider>
        <ScreenerTable {...defaultProps} />
      </MantineProvider>,
    );
    const body = screen.getByTestId("screener-table-body");
    const rows = body.querySelectorAll("tr");
    expect(rows.length).toBe(mockStocks.length);
  });

  it("handles empty stocks array gracefully", () => {
    render(
      <MantineProvider>
        <ScreenerTable {...defaultProps} stocks={[]} />
      </MantineProvider>,
    );
    const body = screen.getByTestId("screener-table-body");
    const rows = body.querySelectorAll("tr");
    expect(rows.length).toBe(0);
  });

  it("handles single stock", () => {
    render(
      <MantineProvider>
        <ScreenerTable {...defaultProps} stocks={[mockStock]} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("stock-row-RELIANCE")).toBeInTheDocument();
    expect(screen.queryByTestId("stock-row-TCS")).not.toBeInTheDocument();
  });

  it("updates sort direction when same column clicked again", () => {
    render(
      <MantineProvider>
        <ScreenerTable {...defaultProps} />
      </MantineProvider>,
    );
    const scoreHeader = screen.getByTestId("sort-header-score");
    expect(scoreHeader).toHaveAttribute("data-direction", "desc");

    fireEvent.click(scoreHeader);
    expect(defaultProps.onSortChange).toHaveBeenCalledWith("score");
  });

  it("applies custom className to table", () => {
    render(
      <MantineProvider>
        <ScreenerTable {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-table")).toHaveClass("screener-table");
  });
});
