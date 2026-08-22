// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi, test } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { UIProvider } from "@/ui";
import { BacktestResultsTable } from "./BacktestResultsTable";
import type { BacktestResult } from "../../types/backtest";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
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
    expect(screen.getByText("Symbol", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Net PnL", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Trades", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("WR%", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("PF", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("TP/SL", { exact: false })).toBeInTheDocument();
  });

  it("renders rows for each result", () => {
    const symbols = ["TCS", "INFY", "RELIANCE"];
    const results = symbols.map((sym) => mockResult({ symbol: sym }));
    render(<BacktestResultsTable results={results} {...defaultProps} />, { wrapper: Wrapper });
    expect(screen.getByTestId("result-row-TCS")).toBeInTheDocument();
    expect(screen.getByTestId("result-row-INFY")).toBeInTheDocument();
    expect(screen.getByTestId("result-row-RELIANCE")).toBeInTheDocument();
  });

  describe("cell value formatting", () => {
    test.each([
      ["positive P&L as +₹15.0K", { net_pnl: 15000 }, "net-pnl-TCS", "+₹15.0K"],
      ["negative P&L as ₹-5.0K", { net_pnl: -5000 }, "net-pnl-TCS", "₹-5.0K"],
      ["trades count", { trades: 42 }, "trades-TCS", "42"],
      ["win rate rounded to integer percent", { win_rate: 65.5 }, "wr-TCS", "66%"],
      ["profit factor to one decimal", { pf: 1.823 }, "pf-TCS", "1.8"],
      ["TP/SL exits as 10/32", { tp_exits: 10, sl_exits: 32 }, "tpsl-TCS", "10/32"],
      ["undefined win_rate as 0%", { win_rate: undefined }, "wr-TCS", "0%"],
      ["undefined pf as 0.0", { pf: undefined }, "pf-TCS", "0.0"],
      [
        "zero values formatted correctly",
        { net_pnl: 0, trades: 0, win_rate: 0, pf: 0 },
        "net-pnl-TCS",
        "₹0.0K",
      ],
    ])("%s", (_, overrides, cellTestId, expectedText) => {
      const results = [mockResult(overrides)];
      render(<BacktestResultsTable results={results} {...defaultProps} />, { wrapper: Wrapper });
      expect(screen.getByTestId(cellTestId)).toHaveTextContent(expectedText);
    });
  });

  it("calls onRowClick when row is clicked", async () => {
      const user = userEvent.setup();
    const results = [mockResult({ symbol: "TCS" })];
    render(<BacktestResultsTable results={results} {...defaultProps} />, { wrapper: Wrapper });
    const row = screen.getByTestId("result-row-TCS");
    await user.click(row);
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
