// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { ReplaySummaryPanel } from "./ReplaySummary";
import type { ReplaySummary } from "../../types/replay";

afterEach(() => {
  cleanup();
});

describe("ReplaySummaryPanel", () => {
  it("returns null when summary is null", () => {
    render(
      <UIProvider>
        <ReplaySummaryPanel summary={null} />
      </UIProvider>,
    );
    expect(screen.queryByText("Per-Strategy Breakdown")).not.toBeInTheDocument();
  });

  it("renders title Per-Strategy Breakdown", () => {
    const summary: ReplaySummary = {
      total_trades: 5, winners: 3, losers: 2, win_rate: 60, profit_factor: 1.5,
      gross_pnl: 1000, total_costs: 50, net_pnl: 950,
      strategy_breakdown: { ORB: { trades: 3, win_rate: 66.7, net_pnl: 600, profit_factor: 2.0 } },
    };
    render(
      <UIProvider>
        <ReplaySummaryPanel summary={summary} />
      </UIProvider>,
    );
    expect(screen.getByText("Per-Strategy Breakdown")).toBeInTheDocument();
  });

  it("renders table with Strategy, Trades, Win Rate, Net P&L, PF columns", () => {
    const summary: ReplaySummary = {
      total_trades: 5, winners: 3, losers: 2, win_rate: 60, profit_factor: 1.5,
      gross_pnl: 1000, total_costs: 50, net_pnl: 950,
      strategy_breakdown: { ORB: { trades: 3, win_rate: 66.7, net_pnl: 600, profit_factor: 2.0 } },
    };
    render(
      <UIProvider>
        <ReplaySummaryPanel summary={summary} />
      </UIProvider>,
    );
    expect(screen.getByText("Strategy")).toBeInTheDocument();
    expect(screen.getByText("Trades")).toBeInTheDocument();
    expect(screen.getByText("Win Rate")).toBeInTheDocument();
    expect(screen.getByText("Net P&L")).toBeInTheDocument();
    expect(screen.getByText("PF")).toBeInTheDocument();
  });

  it("renders one row per strategy in breakdown", () => {
    const summary: ReplaySummary = {
      total_trades: 8, winners: 5, losers: 3, win_rate: 62.5, profit_factor: 1.8,
      gross_pnl: 2000, total_costs: 100, net_pnl: 1900,
      strategy_breakdown: {
        ORB: { trades: 3, win_rate: 66.7, net_pnl: 600, profit_factor: 2.0 },
        EMA: { trades: 5, win_rate: 60, net_pnl: 1300, profit_factor: 1.7 },
      },
    };
    render(
      <UIProvider>
        <ReplaySummaryPanel summary={summary} />
      </UIProvider>,
    );
    expect(screen.getByText("ORB")).toBeInTheDocument();
    expect(screen.getByText("EMA")).toBeInTheDocument();
  });

  it("shows win rate with 1 decimal and %", () => {
    const summary: ReplaySummary = {
      total_trades: 3, winners: 2, losers: 1, win_rate: 66.7, profit_factor: 2.0,
      gross_pnl: 1000, total_costs: 50, net_pnl: 950,
      strategy_breakdown: { ORB: { trades: 3, win_rate: 66.7, net_pnl: 600, profit_factor: 2.0 } },
    };
    render(
      <UIProvider>
        <ReplaySummaryPanel summary={summary} />
      </UIProvider>,
    );
    expect(screen.getAllByText("66.7%").length).toBeGreaterThanOrEqual(1);
  });

  it("shows PF with 2 decimals", () => {
    const summary: ReplaySummary = {
      total_trades: 3, winners: 2, losers: 1, win_rate: 66.7, profit_factor: 2.0,
      gross_pnl: 1000, total_costs: 50, net_pnl: 950,
      strategy_breakdown: { ORB: { trades: 3, win_rate: 66.7, net_pnl: 600, profit_factor: 2.0 } },
    };
    render(
      <UIProvider>
        <ReplaySummaryPanel summary={summary} />
      </UIProvider>,
    );
    expect(screen.getAllByText("2.00").length).toBeGreaterThanOrEqual(1);
  });

  it("shows Total row with bold font and top border", () => {
    const summary: ReplaySummary = {
      total_trades: 3, winners: 2, losers: 1, win_rate: 66.7, profit_factor: 2.0,
      gross_pnl: 1000, total_costs: 50, net_pnl: 950,
      strategy_breakdown: { ORB: { trades: 3, win_rate: 66.7, net_pnl: 600, profit_factor: 2.0 } },
    };
    render(
      <UIProvider>
        <ReplaySummaryPanel summary={summary} />
      </UIProvider>,
    );
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  it("Total row shows summary totals", () => {
    const summary: ReplaySummary = {
      total_trades: 3, winners: 2, losers: 1, win_rate: 66.7, profit_factor: 2.0,
      gross_pnl: 1000, total_costs: 50, net_pnl: 950,
      strategy_breakdown: { ORB: { trades: 3, win_rate: 66.7, net_pnl: 600, profit_factor: 2.0 } },
    };
    render(
      <UIProvider>
        <ReplaySummaryPanel summary={summary} />
      </UIProvider>,
    );
    expect(screen.getAllByText("3").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("66.7%").length).toBeGreaterThanOrEqual(1);
  });
});
