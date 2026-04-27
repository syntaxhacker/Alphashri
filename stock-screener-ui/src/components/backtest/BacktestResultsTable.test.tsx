// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { BacktestResultsTable } from "./BacktestResultsTable";
import type { BacktestResult } from "../../types/backtest";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

function mockResult(overrides: Partial<BacktestResult> = {}): BacktestResult {
  return {
    symbol: "TCS",
    net_pnl: 15000,
    trades: 42,
    win_rate: 65.5,
    pf: 1.8,
    tp_exits: 10,
    sl_exits: 32,
    ...overrides,
  };
}

describe("BacktestResultsTable", () => {
  const mockOnRowClick = vi.fn();
  const mockOnSort = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    selectedSymbol: null,
    sortColumn: "symbol",
    sortDirection: "asc" as const,
    onRowClick: mockOnRowClick,
    onSort: mockOnSort,
  };

  it("renders empty state when no results", () => {
    render(<BacktestResultsTable results={[]} {...defaultProps} />, { wrapper: Wrapper });
    expect(screen.getByTestId("results-empty")).toBeInTheDocument();
    expect(screen.getByText("No results yet. Run a backtest.")).toBeInTheDocument();
  });

  it("renders table wrapper with testid when results present", () => {
    const results = [mockResult(), mockResult({ symbol: "INFY" })];
    render(<BacktestResultsTable results={results} {...defaultProps} />, { wrapper: Wrapper });
    expect(screen.getByTestId("results-table-wrapper")).toBeInTheDocument();
  });

  it("renders table headers with correct labels", () => {
    const results = [mockResult()];
    render(<BacktestResultsTable results={results} {...defaultProps} />, { wrapper: Wrapper });
    expect(screen.getByText("Symbol")).toBeInTheDocument();
    expect(screen.getByText("Net PnL")).toBeInTheDocument();
    expect(screen.getByText("Trades")).toBeInTheDocument();
    expect(screen.getByText("WR%")).toBeInTheDocument();
    expect(screen.getByText("PF")).toBeInTheDocument();
    expect(screen.getByText("TP/SL")).toBeInTheDocument();
  });

  it("renders rows for each result", () => {
    const symbols = ["TCS", "INFY", "RELIANCE"];
    const results = symbols.map((sym) => mockResult({ symbol: sym }));
    render(<BacktestResultsTable results={results} {...defaultProps} />, { wrapper: Wrapper });
    expect(screen.getByTestId("result-row-TCS")).toBeInTheDocument();
    expect(screen.getByTestId("result-row-INFY")).toBeInTheDocument();
    expect(screen.getByTestId("result-row-RELIANCE")).toBeInTheDocument();
  });

  it("displays formatted P&L", () => {
    const results = [mockResult({ net_pnl: 15000 })];
    render(<BacktestResultsTable results={results} {...defaultProps} />, { wrapper: Wrapper });
    const pnlCell = screen.getByTestId("net-pnl-TCS");
    expect(pnlCell).toHaveTextContent("+₹15.0K");
  });

  it("displays negative P&L formatting", () => {
    const results = [mockResult({ net_pnl: -5000 })];
    render(<BacktestResultsTable results={results} {...defaultProps} />, { wrapper: Wrapper });
    const pnlCell = screen.getByTestId("net-pnl-TCS");
    expect(pnlCell).toHaveTextContent("₹-5.0K");
  });

  it("displays trades count", () => {
    const results = [mockResult({ trades: 42 })];
    render(<BacktestResultsTable results={results} {...defaultProps} />, { wrapper: Wrapper });
    expect(screen.getByTestId("trades-TCS")).toHaveTextContent("42");
  });

  it("displays win rate with %", () => {
    const results = [mockResult({ win_rate: 65.5 })];
    render(<BacktestResultsTable results={results} {...defaultProps} />, { wrapper: Wrapper });
    expect(screen.getByTestId("wr-TCS")).toHaveTextContent("66%");
  });

  it("displays PF with one decimal", () => {
    const results = [mockResult({ pf: 1.823 })];
    render(<BacktestResultsTable results={results} {...defaultProps} />, { wrapper: Wrapper });
    expect(screen.getByTestId("pf-TCS")).toHaveTextContent("1.8");
  });

  it("displays TP/SL exits", () => {
    const results = [mockResult({ tp_exits: 10, sl_exits: 32 })];
    render(<BacktestResultsTable results={results} {...defaultProps} />, { wrapper: Wrapper });
    expect(screen.getByTestId("tpsl-TCS")).toHaveTextContent("10/32");
  });

  it("highlights selected row", () => {
    const results = [mockResult({ symbol: "TCS" }), mockResult({ symbol: "INFY" })];
    render(<BacktestResultsTable results={results} {...defaultProps} selectedSymbol="INFY" />, {
      wrapper: Wrapper,
    });
    const rowINFY = screen.getByTestId("result-row-INFY");
    const style = rowINFY.getAttribute("style");
    expect(style).toContain("var(--mantine-color-blue-light)");
  });

  it("calls onRowClick when row is clicked", async () => {
    const results = [mockResult({ symbol: "TCS" })];
    render(<BacktestResultsTable results={results} {...defaultProps} />, { wrapper: Wrapper });
    const row = screen.getByTestId("result-row-TCS");
    row.click();
    expect(mockOnRowClick).toHaveBeenCalledWith("TCS");
  });

  it("highlights selected row", () => {
    const results = [mockResult({ symbol: "TCS" }), mockResult({ symbol: "INFY" })];
    render(<BacktestResultsTable results={results} {...defaultProps} selectedSymbol="INFY" />, {
      wrapper: Wrapper,
    });
    const rowINFY = screen.getByTestId("result-row-INFY");
    const style = rowINFY.getAttribute("style");
    expect(style).toContain("var(--mantine-color-blue-light)");
  });

  it("renders SortableHeader with correct props", () => {
    const results = [mockResult()];
    render(<BacktestResultsTable results={results} {...defaultProps} />, { wrapper: Wrapper });
    // Check that sortable headers exist
    expect(screen.getByTestId("th-symbol")).toBeInTheDocument();
    expect(screen.getByTestId("th-net_pnl")).toBeInTheDocument();
  });

  it("calls onSort when sortable header clicked", async () => {
    const results = [mockResult()];
    render(<BacktestResultsTable results={results} {...defaultProps} />, { wrapper: Wrapper });
    const header = screen.getByTestId("th-symbol");
    header.click();
    expect(mockOnSort).toHaveBeenCalledWith("symbol");
  });

  it("handles undefined win_rate gracefully", () => {
    const results = [mockResult({ win_rate: undefined })];
    render(<BacktestResultsTable results={results} {...defaultProps} />, { wrapper: Wrapper });
    expect(screen.getByTestId("wr-TCS")).toHaveTextContent("0%");
  });

  it("handles undefined pf gracefully", () => {
    const results = [mockResult({ pf: undefined })];
    render(<BacktestResultsTable results={results} {...defaultProps} />, { wrapper: Wrapper });
    expect(screen.getByTestId("pf-TCS")).toHaveTextContent("0.0");
  });

  it("handles zero values", () => {
    const results = [mockResult({ net_pnl: 0, trades: 0, win_rate: 0, pf: 0 })];
    render(<BacktestResultsTable results={results} {...defaultProps} />, { wrapper: Wrapper });
    expect(screen.getByTestId("net-pnl-TCS")).toHaveTextContent("₹0.0K");
    expect(screen.getByTestId("trades-TCS")).toHaveTextContent("0");
    expect(screen.getByTestId("wr-TCS")).toHaveTextContent("0%");
    expect(screen.getByTestId("pf-TCS")).toHaveTextContent("0.0");
  });
});
