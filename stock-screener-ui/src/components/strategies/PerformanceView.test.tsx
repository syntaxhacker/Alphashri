// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { PerformanceView } from "./PerformanceView";
import type { StrategyPerformance } from "../../types/strategies";

afterEach(() => {
  cleanup();
});

describe("PerformanceView", () => {
  it("shows loading state with Loader when isLoading", () => {
    render(
      <UIProvider>
        <PerformanceView performance={[]} strategies={[]} onSelectStrategy={vi.fn()} isLoading={true} />
      </UIProvider>,
    );
    expect(screen.getByTestId("performance-loading-state")).toBeInTheDocument();
    expect(screen.getByText("Loading performance")).toBeInTheDocument();
  });

  it("shows empty state when performance array empty", () => {
    render(
      <UIProvider>
        <PerformanceView performance={[]} strategies={[]} onSelectStrategy={vi.fn()} isLoading={false} />
      </UIProvider>,
    );
    expect(screen.getByTestId("performance-empty-state")).toBeInTheDocument();
    expect(screen.getByText("No performance data")).toBeInTheDocument();
  });

  it("renders summary stats cards when data exists", () => {
    const perf: StrategyPerformance[] = [
      { strategy_id: 1, strategy_name: "ORB v1", total_trades: 10, winners: 6, losers: 4, win_rate: 60, total_pnl: 5000, net_pnl: 4800 },
    ];
    render(
      <UIProvider>
        <PerformanceView performance={perf} strategies={[]} onSelectStrategy={vi.fn()} isLoading={false} />
      </UIProvider>,
    );
    expect(screen.getByText("Active Strategies")).toBeInTheDocument();
    expect(screen.getByText("ORB v1")).toBeInTheDocument();
    expect(screen.getAllByText("Total Trades").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Win Rate").length).toBeGreaterThanOrEqual(1);
  });

  it("renders performance table with data-testid", () => {
    const perf: StrategyPerformance[] = [
      { strategy_id: 1, strategy_name: "ORB v1", total_trades: 10, winners: 6, losers: 4, win_rate: 60, total_pnl: 5000, net_pnl: 4800 },
    ];
    render(
      <UIProvider>
        <PerformanceView performance={perf} strategies={[]} onSelectStrategy={vi.fn()} isLoading={false} />
      </UIProvider>,
    );
    expect(screen.getByTestId("performance-table")).toBeInTheDocument();
  });

  it("renders performance rows with correct data", () => {
    const perf: StrategyPerformance[] = [
      { strategy_id: 1, strategy_name: "ORB v1", total_trades: 10, winners: 6, losers: 4, win_rate: 60, total_pnl: 5000, net_pnl: 4800 },
      { strategy_id: 2, strategy_name: "EMA v2", total_trades: 5, winners: 1, losers: 4, win_rate: 20, total_pnl: -1000, net_pnl: -1050 },
    ];
    render(
      <UIProvider>
        <PerformanceView performance={perf} strategies={[]} onSelectStrategy={vi.fn()} isLoading={false} />
      </UIProvider>,
    );
    expect(screen.getByText("ORB v1")).toBeInTheDocument();
    expect(screen.getByText("EMA v2")).toBeInTheDocument();
  });

  it("performance rows are clickable, call onSelectStrategy", async () => {
    const onSelectStrategy = vi.fn();
    const userEvent = (await import("@testing-library/user-event")).default;
    const perf: StrategyPerformance[] = [
      { strategy_id: 1, strategy_name: "ORB v1", total_trades: 10, winners: 6, losers: 4, win_rate: 60, total_pnl: 5000, net_pnl: 4800 },
    ];
    render(
      <UIProvider>
        <PerformanceView performance={perf} strategies={[]} onSelectStrategy={onSelectStrategy} isLoading={false} />
      </UIProvider>,
    );
    await userEvent.click(screen.getByText("ORB v1"));
    expect(onSelectStrategy).toHaveBeenCalledWith(1);
  });

  it("shows win rate badge with teal color >= 50%, red < 50%", () => {
    const perf: StrategyPerformance[] = [
      { strategy_id: 1, strategy_name: "ORB", total_trades: 10, winners: 6, losers: 4, win_rate: 60, total_pnl: 5000, net_pnl: 4800 },
      { strategy_id: 2, strategy_name: "EMA", total_trades: 10, winners: 3, losers: 7, win_rate: 30, total_pnl: -2000, net_pnl: -2050 },
    ];
    render(
      <UIProvider>
        <PerformanceView performance={perf} strategies={[]} onSelectStrategy={vi.fn()} isLoading={false} />
      </UIProvider>,
    );
  });

  it("shows Net P&L colored teal for positive, red for negative", () => {
    const perf: StrategyPerformance[] = [
      { strategy_id: 1, strategy_name: "ORB", total_trades: 5, winners: 3, losers: 2, win_rate: 60, total_pnl: 1000, net_pnl: 950 },
    ];
    render(
      <UIProvider>
        <PerformanceView performance={perf} strategies={[]} onSelectStrategy={vi.fn()} isLoading={false} />
      </UIProvider>,
    );
  });
});
