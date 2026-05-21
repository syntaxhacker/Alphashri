// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithMantine } from "../../test-utils/renderWithMantine";
import { PerformanceAnalytics } from "./PerformanceAnalytics";
import * as paperTradingState from "../../state/paperTrading";

vi.mock("../../api/paperTrading", () => ({
  fetchAnalytics: vi.fn().mockResolvedValue(null),
}));

vi.mock("echarts-for-react", () => ({
  default: () => <div data-testid="mock-echarts">ECharts</div>,
}));

describe("PerformanceAnalytics", () => {
  beforeEach(() => {
    paperTradingState.resetPaperTradingState();
  });

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
});
