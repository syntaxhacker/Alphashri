// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { PerformanceView } from "./PerformanceView";
import type { StrategyPerformance } from "../../types/strategies";

afterEach(() => {
  cleanup();

  vi.clearAllMocks();
});

describe("PerformanceView", () => {
  it("shows loading state with Loader when isLoading", () => {
    render(() => (
      <UIProvider>
        <PerformanceView performance={[]} strategies={[]} onSelectStrategy={vi.fn()} isLoading={true} />
      </UIProvider>
    ));
    expect(screen.getByTestId("performance-loading-state")).toBeInTheDocument();
    expect(screen.getByText("Loading performance")).toBeInTheDocument();
  });

  it("shows empty state when performance array empty", () => {
    render(() => (
      <UIProvider>
        <PerformanceView performance={[]} strategies={[]} onSelectStrategy={vi.fn()} isLoading={false} />
      </UIProvider>
    ));
    expect(screen.getByTestId("performance-empty-state")).toBeInTheDocument();
    expect(screen.getByText("No performance data")).toBeInTheDocument();
  });

  it("renders summary stats cards when data exists", () => {
    const perf: StrategyPerformance[] = [
      { strategy_id: 1, strategy_name: "ORB v1", total_trades: 10, winners: 6, losers: 4, win_rate: 60, total_pnl: 5000, net_pnl: 4800 },
    ];
    render(() => (
      <UIProvider>
        <PerformanceView performance={perf} strategies={[]} onSelectStrategy={vi.fn()} isLoading={false} />
      </UIProvider>
    ));
    expect(screen.getByText("Active Strategies")).toBeInTheDocument();
    expect(screen.getByText("ORB v1")).toBeInTheDocument();
    expect(screen.getAllByText("Total Trades").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Win Rate").length).toBeGreaterThanOrEqual(1);
  });

  it("renders performance table with data-testid", () => {
    const perf: StrategyPerformance[] = [
      { strategy_id: 1, strategy_name: "ORB v1", total_trades: 10, winners: 6, losers: 4, win_rate: 60, total_pnl: 5000, net_pnl: 4800 },
    ];
    render(() => (
      <UIProvider>
        <PerformanceView performance={perf} strategies={[]} onSelectStrategy={vi.fn()} isLoading={false} />
      </UIProvider>
    ));
    expect(screen.getByTestId("performance-table")).toBeInTheDocument();
  });

  it("renders performance rows with correct data", () => {
    const perf: StrategyPerformance[] = [
      { strategy_id: 1, strategy_name: "ORB v1", total_trades: 10, winners: 6, losers: 4, win_rate: 60, total_pnl: 5000, net_pnl: 4800 },
      { strategy_id: 2, strategy_name: "EMA v2", total_trades: 5, winners: 1, losers: 4, win_rate: 20, total_pnl: -1000, net_pnl: -1050 },
    ];
    render(() => (
      <UIProvider>
        <PerformanceView performance={perf} strategies={[]} onSelectStrategy={vi.fn()} isLoading={false} />
      </UIProvider>
    ));
    expect(screen.getByText("ORB v1")).toBeInTheDocument();
    expect(screen.getByText("EMA v2")).toBeInTheDocument();
  });

  it("performance rows are clickable, call onSelectStrategy", () => {
    const onSelectStrategy = vi.fn();
    const perf: StrategyPerformance[] = [
      { strategy_id: 1, strategy_name: "ORB v1", total_trades: 10, winners: 6, losers: 4, win_rate: 60, total_pnl: 5000, net_pnl: 4800 },
    ];
    render(() => (
      <UIProvider>
        <PerformanceView performance={perf} strategies={[]} onSelectStrategy={onSelectStrategy} isLoading={false} />
      </UIProvider>
    ));
    fireEvent.click(screen.getByText("ORB v1"));
    expect(onSelectStrategy).toHaveBeenCalledWith(1);
  });

  it("clicking W / L sorts winners numerically (10/2 above 9/1 for desc)", async () => {
    const perf: StrategyPerformance[] = [
      { strategy_id: 1, strategy_name: "Nine", total_trades: 10, winners: 9, losers: 1, win_rate: 90, total_pnl: 900, net_pnl: 900 },
      { strategy_id: 2, strategy_name: "Ten", total_trades: 12, winners: 10, losers: 2, win_rate: 83, total_pnl: 1000, net_pnl: 1000 },
    ];
    render(() => (
      <UIProvider>
        <PerformanceView performance={perf} strategies={[]} onSelectStrategy={vi.fn()} isLoading={false} />
      </UIProvider>
    ));
    const firstName = () =>
      document.querySelector('[data-testid="performance-table"] tbody [data-row="stock"]')?.textContent ?? "";
    expect(firstName()).toContain("Nine");
    fireEvent.click(screen.getByText("W / L"));
    // "10/2" must rank above "9/1" — a lexicographic string sort would put "9" first.
    await waitFor(() => expect(firstName()).toContain("Ten"));
  });

});
