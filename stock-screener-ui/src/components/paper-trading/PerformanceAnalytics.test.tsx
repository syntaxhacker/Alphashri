// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach, test } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { renderWithMantine } from "../../test-utils/renderWithMantine";
import { PerformanceAnalytics } from "./PerformanceAnalytics";
import * as paperTradingState from "../../state/paperTrading";

vi.mock("../../api/paperTrading", () => ({
  fetchAnalytics: vi.fn().mockResolvedValue(null),
}));

vi.mock("echarts-for-react", () => ({
  default: () => <div data-testid="mock-echarts">ECharts</div>,
}));

afterEach(cleanup);

describe("PerformanceAnalytics", () => {
  beforeEach(() => {
    paperTradingState.resetPaperTradingState();
  });

  const mockAnalyticsData = {
    summary: {
      total_trades: 10,
      winners: 6,
      losers: 4,
      win_rate: 60,
      total_gross_pnl: 5000,
      total_net_pnl: 4500,
      total_costs: 500,
      avg_win: 1000,
      avg_loss: -375,
      profit_factor: 2.0,
      max_drawdown: 500,
      max_drawdown_pct: 10,
      final_pnl: 4500,
    },
    daily_pnl: [
      { date: "2026-05-01", net_pnl: 500, gross_pnl: 600 },
      { date: "2026-05-02", net_pnl: -200, gross_pnl: 300 },
    ],
    equity_curve: [
      { date: "2026-05-01", cumulative_pnl: 500 },
      { date: "2026-05-02", cumulative_pnl: 300 },
      { date: "2026-05-03", cumulative_pnl: 800 },
    ],
    drawdown: [
      { date: "2026-05-01", drawdown_pct: 0 },
      { date: "2026-05-02", drawdown_pct: -5 },
    ],
    monthly_pnl: [
      { month: "2026-05", pnl: 4500 },
    ],
    symbol_performance: [],
  };

  it("shows empty state when no data", () => {
    renderWithMantine(<PerformanceAnalytics />);
    expect(screen.getAllByText(/No analytics data available yet/i).length).toBeGreaterThan(0);
  });

  it("renders summary cards when data available", () => {
    const mockData = {
      summary: {
        total_trades: 10,
        winners: 6,
        losers: 4,
        win_rate: 60,
        total_gross_pnl: 5000,
        total_net_pnl: 4500,
        total_costs: 500,
        avg_win: 1000,
        avg_loss: -375,
        profit_factor: 2.0,
        max_drawdown: 500,
        max_drawdown_pct: 10,
        final_pnl: 4500,
      },
      daily_pnl: [],
      equity_curve: [],
      drawdown: [],
      monthly_pnl: [],
      symbol_performance: [],
    };
    paperTradingState.setAnalyticsData(mockData as any);
    renderWithMantine(<PerformanceAnalytics />);
    expect(screen.getAllByText(/^Total$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Win Rate/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^PF$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Trades$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Max DD/i).length).toBeGreaterThan(0);
  });

  test("shows loading spinner when analyticsLoading is true", () => {
    paperTradingState.setAnalyticsLoading(true);
    renderWithMantine(<PerformanceAnalytics />);
    expect(document.querySelector(".mantine-Loader-root")).toBeTruthy();
  });

  test("renders daysBack SegmentedControl (7d/30d/90d) when data available", () => {
    paperTradingState.setAnalyticsData(mockAnalyticsData as any);
    renderWithMantine(<PerformanceAnalytics />);
    expect(screen.getByText("7d")).toBeInTheDocument();
    expect(screen.getByText("30d")).toBeInTheDocument();
    expect(screen.getByText("90d")).toBeInTheDocument();
  });

  test("renders Equity Curve chart section with heading", () => {
    paperTradingState.setAnalyticsData(mockAnalyticsData as any);
    renderWithMantine(<PerformanceAnalytics />);
    expect(screen.getByText("Equity Curve")).toBeInTheDocument();
  });

  test("renders Daily P&L chart section with heading", () => {
    paperTradingState.setAnalyticsData(mockAnalyticsData as any);
    renderWithMantine(<PerformanceAnalytics />);
    expect(screen.getByText("Daily P&L")).toBeInTheDocument();
  });

  test("renders Drawdown chart section with heading", () => {
    paperTradingState.setAnalyticsData(mockAnalyticsData as any);
    renderWithMantine(<PerformanceAnalytics />);
    expect(screen.getByText("Drawdown")).toBeInTheDocument();
  });

  test("renders Monthly P&L chart section with heading", () => {
    paperTradingState.setAnalyticsData(mockAnalyticsData as any);
    renderWithMantine(<PerformanceAnalytics />);
    expect(screen.getByText("Monthly P&L")).toBeInTheDocument();
  });

  test("renders SummaryCards with all stat labels", () => {
    paperTradingState.setAnalyticsData(mockAnalyticsData as any);
    renderWithMantine(<PerformanceAnalytics />);
    expect(screen.getAllByText(/^Total$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Win Rate/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^PF$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Trades$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Max DD/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Avg Win")).toBeInTheDocument();
    expect(screen.getByText("Avg Loss")).toBeInTheDocument();
    expect(screen.getByText("Costs")).toBeInTheDocument();
  });

  test("renders correct values in summary cards", () => {
    paperTradingState.setAnalyticsData(mockAnalyticsData as any);
    renderWithMantine(<PerformanceAnalytics />);
    expect(screen.getByText("₹4500")).toBeInTheDocument();
    expect(screen.getByText("60.0%")).toBeInTheDocument();
    expect(screen.getByText("2.00")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("10.0%")).toBeInTheDocument();
    expect(screen.getByText("₹1000")).toBeInTheDocument();
    expect(screen.getByText("₹-375")).toBeInTheDocument();
    expect(screen.getByText("₹500")).toBeInTheDocument();
  });
});
