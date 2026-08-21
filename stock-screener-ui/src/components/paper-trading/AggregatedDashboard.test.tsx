// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithMantine } from "../../test-utils/renderWithMantine";
import { AggregatedDashboard } from "./AggregatedDashboard";
import * as paperTradingState from "../../state/paperTrading";
import type { PaperDashboardAnalyticsData } from "../../types/paperTrading";

const fetchDashboardAnalytics = vi.fn().mockResolvedValue(null);

vi.mock("echarts-for-react", () => ({
  default: () => <div data-testid="mock-echarts">ECharts</div>,
}));

vi.mock("../../api/paperTrading", () => ({
  fetchDashboardAnalytics: (...args: any[]) => fetchDashboardAnalytics(...args),
}));

function mockDashboardData(overrides: Partial<PaperDashboardAnalyticsData> = {}): PaperDashboardAnalyticsData {
  return {
    period: { preset: "30D", from_date: "2026-06-15", to_date: "2026-07-15", bot_id: "all", trade_count: 4 },
    summary: {
      total_trades: 4,
      winners: 2,
      losers: 2,
      win_rate: 50,
      total_gross_pnl: 12000,
      total_net_pnl: 9840,
      total_costs: 2160,
      avg_win: 4300,
      avg_loss: -1380,
      profit_factor: 3.12,
      avg_hold_minutes: 72,
      max_drawdown: 2100,
      max_drawdown_pct: 12.5,
      best_day: { date: "2026-07-12", net_pnl: 4250, trades: 1, winners: 1, losers: 0 },
      worst_day: { date: "2026-07-14", net_pnl: -2100, trades: 1, winners: 0, losers: 1 },
    },
    bot_rankings: [
      {
        bot_id: "bot-1",
        bot_name: "ORB Bot",
        running: true,
        total_net_pnl: 12800,
        total_trades: 42,
        win_rate: 61.9,
        profit_factor: 1.92,
        max_drawdown: 2100,
        max_drawdown_pct: 8.3,
        avg_hold_minutes: 55,
      },
      {
        bot_id: "bot-2",
        bot_name: "EMA Bot",
        running: false,
        total_net_pnl: -3050,
        total_trades: 19,
        win_rate: 47.4,
        profit_factor: 0.82,
        max_drawdown: 2400,
        max_drawdown_pct: 11.1,
        avg_hold_minutes: 80,
      },
    ],
    strategy_rankings: [
      {
        bot_id: "bot-1",
        bot_name: "ORB Bot",
        strategy_id: 1,
        strategy_name: "ORB Best",
        total_net_pnl: 12800,
        total_trades: 42,
        win_rate: 61.9,
        profit_factor: 1.92,
        avg_hold_minutes: 55,
      },
    ],
    daily_pnl: [
      { date: "2026-07-12", net_pnl: 4250, trades: 1, winners: 1, losers: 0 },
      { date: "2026-07-14", net_pnl: -2100, trades: 1, winners: 0, losers: 1 },
    ],
    equity_curve: [
      { date: "2026-07-12", cumulative_pnl: 4250 },
      { date: "2026-07-14", cumulative_pnl: 2150 },
    ],
    drawdown: [
      { date: "2026-07-12", drawdown: 0, drawdown_pct: 0 },
      { date: "2026-07-14", drawdown: 2100, drawdown_pct: 49.41 },
    ],
    biggest_winners: [
      {
        trade_id: "TRADE-000001",
        symbol: "RELIANCE",
        bot_id: "bot-1",
        bot_name: "ORB Bot",
        strategy_id: 1,
        strategy_name: "ORB Best",
        side: "BUY",
        entry_time: "2026-07-12T09:20:00+05:30",
        exit_time: "2026-07-12T10:20:00+05:30",
        net_pnl: 4250,
        pnl_pct: 2.4,
        exit_reason: "TP",
        hold_duration_minutes: 60,
      },
    ],
    biggest_losers: [
      {
        trade_id: "TRADE-000002",
        symbol: "TCS",
        bot_id: "bot-2",
        bot_name: "EMA Bot",
        strategy_id: 2,
        strategy_name: "EMA Cross",
        side: "SELL",
        entry_time: "2026-07-14T09:20:00+05:30",
        exit_time: "2026-07-14T10:20:00+05:30",
        net_pnl: -2100,
        pnl_pct: -1.1,
        exit_reason: "SL",
        hold_duration_minutes: 60,
      },
    ],
    symbol_performance: [
      { symbol: "RELIANCE", total_net_pnl: 4250, total_trades: 1, win_rate: 100 },
      { symbol: "TCS", total_net_pnl: -2100, total_trades: 1, win_rate: 0 },
    ],
    exit_reasons: [
      { reason: "TP", count: 1, pct: 50 },
      { reason: "SL", count: 1, pct: 50 },
    ],
    ...overrides,
  };
}

describe("AggregatedDashboard", () => {
  beforeEach(() => {
    paperTradingState.resetPaperTradingState();
    fetchDashboardAnalytics.mockClear();
  });

  afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

  it("loads all bots 30D analytics by default", async () => {
    renderWithMantine(<AggregatedDashboard />);
    await waitFor(() => {
      expect(fetchDashboardAnalytics).toHaveBeenCalledWith({
        preset: "30D",
        botId: "all",
        fromDate: null,
        toDate: null,
      });
    });
  });

  it("shows empty state when no dashboard data is available", () => {
    renderWithMantine(<AggregatedDashboard />);
    expect(screen.getByText("No closed trades found for this period.")).toBeInTheDocument();
  });

  it("renders summary, bot rankings, strategy rows, winners, and losers", () => {
    paperTradingState.setDashboardAnalyticsData(mockDashboardData());
    renderWithMantine(<AggregatedDashboard />);

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getAllByText("Net P&L").length).toBeGreaterThan(0);
    expect(screen.getByText("Profit Factor")).toBeInTheDocument();
    expect(screen.getAllByText("ORB Bot").length).toBeGreaterThan(0);
    expect(screen.getAllByText("EMA Bot").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ORB Best").length).toBeGreaterThan(0);
    expect(screen.getAllByText("RELIANCE").length).toBeGreaterThan(0);
    expect(screen.getAllByText("TCS").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("mock-echarts").length).toBeGreaterThanOrEqual(5);
  });

  it("uses available bots in the bot filter and fetches selected bot analytics", async () => {
    const user = userEvent.setup();
    paperTradingState.setAvailableBots([
      { id: "bot-1", name: "ORB Bot", strategies: [], is_active: true, live_trading: false },
    ]);
    renderWithMantine(<AggregatedDashboard />);

    await user.click(screen.getByTestId("dashboard-bot-filter"));
    await user.click(screen.getByText("ORB Bot"));

    await waitFor(() => {
      expect(fetchDashboardAnalytics).toHaveBeenLastCalledWith({
        preset: "30D",
        botId: "bot-1",
        fromDate: null,
        toDate: null,
      });
    });
  });
});
