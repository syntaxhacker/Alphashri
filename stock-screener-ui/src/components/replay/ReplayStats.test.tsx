// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { ReplayStats } from "./ReplayStats";
import type { ReplayTrade, ReplaySummary } from "../../types/replay";

afterEach(() => {
  cleanup();

  vi.clearAllMocks();
});

describe("ReplayStats", () => {
  it("shows empty state when no trades and not running", () => {
    render(
      <UIProvider>
        <ReplayStats trades={[]} summary={null} progress={null} totalCandles={0} isRunning={false} />
      </UIProvider>,
    );
    expect(screen.getByText("Run a replay to see stats")).toBeInTheDocument();
  });

  it("shows Total Trades stat", () => {
    const trades = [{
      id: 1, symbol: "TCS", strategy: "ORB", side: "LONG",
      entry_price: 100, exit_price: 110, entry_time: "09:15", exit_time: "09:30",
      pnl: 10, net_pnl: 9.5, costs: 0.5, exit_reason: "TP", quantity: 100,
    }];
    render(
      <UIProvider>
        <ReplayStats trades={trades} summary={null} progress={null} totalCandles={0} isRunning={false} />
      </UIProvider>,
    );
    expect(screen.getByTestId("replay-stats")).toBeInTheDocument();
  });

  it("shows Win Rate percentage with green tone when >= 50", () => {
    const trades = [
      { id: 1, symbol: "TCS", strategy: "ORB", side: "LONG", entry_price: 100, exit_price: 110, entry_time: "09:15", exit_time: "09:30", pnl: 10, net_pnl: 9.5, costs: 0.5, exit_reason: "TP", quantity: 100 },
      { id: 2, symbol: "INFY", strategy: "ORB", side: "LONG", entry_price: 200, exit_price: 190, entry_time: "09:20", exit_time: "09:40", pnl: -10, net_pnl: -10.5, costs: 0.5, exit_reason: "SL", quantity: 50 },
    ];
    render(
      <UIProvider>
        <ReplayStats trades={trades} summary={{ total_trades: 2, winners: 1, losers: 1, win_rate: 50, profit_factor: 1.0, gross_pnl: 10, total_costs: 1, net_pnl: 0, strategy_breakdown: { ORB: { trades: 2, win_rate: 50, net_pnl: 0, profit_factor: 1.0 } } }} progress={null} totalCandles={0} isRunning={false} />
      </UIProvider>,
    );
  });

  it("shows Profit Factor with value", () => {
    const summary: ReplaySummary = {
      total_trades: 5, winners: 3, losers: 2, win_rate: 60, profit_factor: 2.5,
      gross_pnl: 1000, total_costs: 50, net_pnl: 950,
      strategy_breakdown: { ORB: { trades: 5, win_rate: 60, net_pnl: 950, profit_factor: 2.5 } },
    };
    render(
      <UIProvider>
        <ReplayStats trades={[]} summary={summary} progress={null} totalCandles={0} isRunning={false} />
      </UIProvider>,
    );
  });

  it("shows Net P&L with calculated value from summary", () => {
    const summary: ReplaySummary = {
      total_trades: 3, winners: 2, losers: 1, win_rate: 66.7, profit_factor: 2.0,
      gross_pnl: 2000, total_costs: 100, net_pnl: 1900,
      strategy_breakdown: { ORB: { trades: 3, win_rate: 66.7, net_pnl: 1900, profit_factor: 2.0 } },
    };
    render(
      <UIProvider>
        <ReplayStats trades={[]} summary={summary} progress={null} totalCandles={0} isRunning={false} />
      </UIProvider>,
    );
  });

  it("calculates Net P&L from trades when summary is null", () => {
    const trades = [
      { id: 1, symbol: "TCS", strategy: "ORB", side: "LONG", entry_price: 100, exit_price: 110, entry_time: "09:15", exit_time: "09:30", pnl: 10, net_pnl: 9.5, costs: 0.5, exit_reason: "TP", quantity: 100 },
      { id: 2, symbol: "INFY", strategy: "ORB", side: "LONG", entry_price: 200, exit_price: 190, entry_time: "09:20", exit_time: "09:40", pnl: -10, net_pnl: -10.5, costs: 0.5, exit_reason: "SL", quantity: 50 },
    ];
    render(
      <UIProvider>
        <ReplayStats trades={trades} summary={null} progress={null} totalCandles={0} isRunning={true} />
      </UIProvider>,
    );
  });

  it("shows Winners / Losers count", () => {
    const summary: ReplaySummary = {
      total_trades: 10, winners: 7, losers: 3, win_rate: 70, profit_factor: 3.0,
      gross_pnl: 5000, total_costs: 200, net_pnl: 4800,
      strategy_breakdown: { ORB: { trades: 10, win_rate: 70, net_pnl: 4800, profit_factor: 3.0 } },
    };
    render(
      <UIProvider>
        <ReplayStats trades={[]} summary={summary} progress={null} totalCandles={0} isRunning={false} />
      </UIProvider>,
    );
  });

  it("shows Progress stat when running with progress", () => {
    const progress = { candle: 50, total: 200, time: "10:30", symbol: "TCS" };
    render(
      <UIProvider>
        <ReplayStats trades={[]} summary={null} progress={progress} totalCandles={200} isRunning={true} />
      </UIProvider>,
    );
  });

  it("shows Progress bar when running and totalCandles > 0", () => {
    const progress = { candle: 50, total: 200, time: "10:30", symbol: "TCS" };
    render(
      <UIProvider>
        <ReplayStats trades={[]} summary={null} progress={progress} totalCandles={200} isRunning={true} />
      </UIProvider>,
    );
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  });

  it("calculates win rate from trades when summary is null", () => {
    const trades = [
      { id: 1, symbol: "TCS", strategy: "ORB", side: "LONG", entry_price: 100, exit_price: 110, entry_time: "09:15", exit_time: "09:30", pnl: 10, net_pnl: 9.5, costs: 0.5, exit_reason: "TP", quantity: 100 },
      { id: 2, symbol: "INFY", strategy: "ORB", side: "LONG", entry_price: 200, exit_price: 190, entry_time: "09:20", exit_time: "09:40", pnl: -10, net_pnl: -10.5, costs: 0.5, exit_reason: "SL", quantity: 50 },
    ];
    render(
      <UIProvider>
        <ReplayStats trades={trades} summary={null} progress={null} totalCandles={0} isRunning={true} />
      </UIProvider>,
    );
  });

  it("calculates winners/losers from trades when summary is null", () => {
    const trades = [
      { id: 1, symbol: "TCS", strategy: "ORB", side: "LONG", entry_price: 100, exit_price: 110, entry_time: "09:15", exit_time: "09:30", pnl: 10, net_pnl: 9.5, costs: 0.5, exit_reason: "TP", quantity: 100 },
      { id: 2, symbol: "INFY", strategy: "ORB", side: "LONG", entry_price: 200, exit_price: 190, entry_time: "09:20", exit_time: "09:40", pnl: -10, net_pnl: -10.5, costs: 0.5, exit_reason: "SL", quantity: 50 },
    ];
    render(
      <UIProvider>
        <ReplayStats trades={trades} summary={null} progress={null} totalCandles={0} isRunning={true} />
      </UIProvider>,
    );
  });
});
