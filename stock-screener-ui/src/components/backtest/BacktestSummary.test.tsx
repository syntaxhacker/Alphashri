// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { BacktestSummary, resolveTotals, formatCosts, formatWinRate } from "./BacktestSummary";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

describe("resolveTotals", () => {
  it("returns null when totals is null", () => {
    expect(resolveTotals(null)).toBeNull();
  });

  it("returns null when totals is undefined", () => {
    expect(resolveTotals(undefined)).toBeNull();
  });

  it("maps totals correctly", () => {
    const totals = {
      net_pnl: 15000,
      total_costs: 2500,
      win_rate: 65.5,
      trades: 42,
    };
    const result = resolveTotals(totals);
    expect(result).toEqual({
      netPnl: 15000,
      totalCosts: 2500,
      winRate: 65.5,
      trades: 42,
    });
  });

  it("handles undefined values with defaults", () => {
    const totals = {
      net_pnl: undefined,
      total_costs: undefined,
      win_rate: undefined,
      trades: undefined,
    };
    const result = resolveTotals(totals);
    expect(result).toEqual({
      netPnl: 0,
      totalCosts: 0,
      winRate: 0,
      trades: 0,
    });
  });
});

describe("formatCosts", () => {
  it("formats costs in thousands with 1 decimal", () => {
    expect(formatCosts(2500)).toBe("₹2.5K");
  });

  it("formats zero costs", () => {
    expect(formatCosts(0)).toBe("₹0.0K");
  });

  it("formats large costs", () => {
    expect(formatCosts(150000)).toBe("₹150.0K");
  });

  it("formats fractional thousands", () => {
    expect(formatCosts(12345)).toBe("₹12.3K");
  });
});

describe("formatWinRate", () => {
  it("formats win rate with no decimals", () => {
    expect(formatWinRate(65.5)).toBe("66%");
  });

  it("formats 100% win rate", () => {
    expect(formatWinRate(100)).toBe("100%");
  });

  it("formats 0% win rate", () => {
    expect(formatWinRate(0)).toBe("0%");
  });

  it("formats 33.33% to 33%", () => {
    expect(formatWinRate(33.33)).toBe("33%");
  });
});

describe("BacktestSummary", () => {
  const mockTotals = {
    net_pnl: 15000,
    total_costs: 2500,
    win_rate: 65.5,
    trades: 42,
  };

  it("renders nothing when totals is null", () => {
    render(<BacktestSummary totals={null} />, { wrapper: Wrapper });
    expect(screen.queryByTestId("results-summary")).not.toBeInTheDocument();
  });

  it("renders nothing when totals is undefined", () => {
    render(<BacktestSummary totals={undefined} />, { wrapper: Wrapper });
    expect(screen.queryByTestId("results-summary")).not.toBeInTheDocument();
  });

  it("renders with correct testid", () => {
    render(<BacktestSummary totals={mockTotals} />, { wrapper: Wrapper });
    expect(screen.getByTestId("results-summary")).toBeInTheDocument();
  });

  it("displays net P&L with correct formatting", () => {
    render(<BacktestSummary totals={mockTotals} />, { wrapper: Wrapper });
    expect(screen.getByTestId("summary-net-pnl")).toHaveTextContent("+₹15.0K");
  });

  it("displays costs correctly", () => {
    render(<BacktestSummary totals={mockTotals} />, { wrapper: Wrapper });
    expect(screen.getByTestId("summary-costs")).toHaveTextContent("₹2.5K");
  });

  it("displays win rate correctly", () => {
    render(<BacktestSummary totals={mockTotals} />, { wrapper: Wrapper });
    expect(screen.getByTestId("summary-wr")).toHaveTextContent("66%");
  });

  it("displays trades count correctly", () => {
    render(<BacktestSummary totals={mockTotals} />, { wrapper: Wrapper });
    expect(screen.getByTestId("summary-trades")).toHaveTextContent("42");
  });

  it("handles negative net P&L", () => {
    const negativeTotals = { ...mockTotals, net_pnl: -5000 };
    render(<BacktestSummary totals={negativeTotals} />, { wrapper: Wrapper });
    // formatPnl returns "+₹5.0K" for positive and "₹-5.0K" for negative
    expect(screen.getByTestId("summary-net-pnl")).toHaveTextContent("₹-5.0K");
  });

  it("handles zero values", () => {
    const zeroTotals = {
      net_pnl: 0,
      total_costs: 0,
      win_rate: 0,
      trades: 0,
    };
    render(<BacktestSummary totals={zeroTotals} />, { wrapper: Wrapper });
    expect(screen.getByTestId("summary-net-pnl")).toBeInTheDocument();
    expect(screen.getByTestId("summary-trades")).toHaveTextContent("0");
  });

  it("has proper labels for each stat", () => {
    render(<BacktestSummary totals={mockTotals} />, { wrapper: Wrapper });
    expect(screen.getByText("Net PnL")).toBeInTheDocument();
    expect(screen.getByText("Costs")).toBeInTheDocument();
    expect(screen.getByText("WR")).toBeInTheDocument();
    expect(screen.getByText("Trades")).toBeInTheDocument();
  });

  it("renders with individual data-testids on stat items", () => {
    render(<BacktestSummary totals={mockTotals} />, { wrapper: Wrapper });
    expect(screen.getByTestId("summary-net-pnl")).toBeInTheDocument();
    expect(screen.getByTestId("summary-costs")).toBeInTheDocument();
    expect(screen.getByTestId("summary-wr")).toBeInTheDocument();
    expect(screen.getByTestId("summary-trades")).toBeInTheDocument();
  });
});
