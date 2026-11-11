// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { StrategyRunnerStats } from "./StrategyRunnerStats";
import type { StrategyRunnerTrade, StrategyRunnerSummary } from "../../types/strategyRunner";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const noProgress = { currentBot: 0, totalBots: 0, currentBotName: "" };

function makeSummary(overrides: Partial<StrategyRunnerSummary> = {}): StrategyRunnerSummary {
  return {
    total_trades: 2,
    winners: 1,
    losers: 1,
    win_rate: 50,
    net_pnl: 950,
    profit_factor: 2.5,
    total_costs: 0,
    by_bot: {},
    by_symbol: {},
    ...overrides,
  };
}

function makeTrade(overrides: Partial<StrategyRunnerTrade> = {}): StrategyRunnerTrade {
  return {
    bot_name: "ORB A",
    bot_uuid: "bot-1",
    symbol: "TCS",
    side: "LONG",
    entry_price: 100,
    exit_price: 110,
    pnl: 10,
    net_pnl: 9.5,
    reason: "TP",
    entry_time: "09:15",
    exit_time: "09:30",
    ...overrides,
  };
}

describe("StrategyRunnerStats", () => {
  it("shows the strategy-comparison empty copy", () => {
    render(
      <UIProvider>
        <StrategyRunnerStats trades={[]} summary={null} isRunning={false} progress={noProgress} />
      </UIProvider>,
    );
    expect(screen.getByText("Run a strategy comparison to see stats")).toBeInTheDocument();
  });

  it("does not put a testid on the root node", () => {
    const { container } = render(
      <UIProvider>
        <StrategyRunnerStats trades={[makeTrade()]} summary={null} isRunning={false} progress={noProgress} />
      </UIProvider>,
    );
    expect(container.querySelector("[data-testid]")).toBeNull();
  });

  it("renders the shared stats from a summary", () => {
    render(
      <UIProvider>
        <StrategyRunnerStats
          trades={[makeTrade()]}
          summary={makeSummary()}
          isRunning={false}
          progress={noProgress}
        />
      </UIProvider>,
    );
    expect(screen.getByText("Win Rate")).toBeInTheDocument();
    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText("2.50")).toBeInTheDocument();
    expect(screen.getByText("+₹950")).toBeInTheDocument();
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.queryByText("Total Costs")).toBeNull();
  });

  it("adds Total Costs only when costs are positive", () => {
    render(
      <UIProvider>
        <StrategyRunnerStats
          trades={[makeTrade()]}
          summary={makeSummary({ total_costs: 50 })}
          isRunning={false}
          progress={noProgress}
        />
      </UIProvider>,
    );
    expect(screen.getByText("Total Costs")).toBeInTheDocument();
    expect(screen.getByText("+₹50")).toBeInTheDocument();
  });

  it("drives progress from bots, not candles", () => {
    render(
      <UIProvider>
        <StrategyRunnerStats
          trades={[]}
          summary={null}
          isRunning
          progress={{ currentBot: 1, totalBots: 4, currentBotName: "ORB A" }}
        />
      </UIProvider>,
    );
    expect(screen.getByText("Progress")).toBeInTheDocument();
    expect(screen.getByText("1 / 4")).toBeInTheDocument();
    expect(screen.getByText("ORB A")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  });
});
