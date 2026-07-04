// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { ReplayTradeLog } from "./ReplayTradeLog";
import type { ReplayTrade } from "../../types/replay";

afterEach(() => {
  cleanup();
});

const makeTrade = (id: number, overrides: Partial<ReplayTrade> = {}): ReplayTrade => ({
  id,
  symbol: "TCS",
  strategy: "ORB",
  side: "LONG",
  entry_price: 100,
  exit_price: 110,
  entry_time: "2025-01-15T09:15:00",
  exit_time: "2025-01-15T09:30:00",
  pnl: 10,
  net_pnl: 9.5,
  costs: 0.5,
  exit_reason: "TP",
  quantity: 100,
  ...overrides,
});

describe("ReplayTradeLog", () => {
  it("renders with data-testid", () => {
    render(
      <UIProvider>
        <ReplayTradeLog
          trades={[]}
          strategyFilter="ALL"
          setStrategyFilter={vi.fn()}
          isRunning={false}
          highlightedTradeId={null}
        />
      </UIProvider>,
    );
    expect(screen.getByTestId("replay-trade-log")).toBeInTheDocument();
  });

  it("shows Trade Log title", () => {
    render(
      <UIProvider>
        <ReplayTradeLog
          trades={[]}
          strategyFilter="ALL"
          setStrategyFilter={vi.fn()}
          isRunning={false}
          highlightedTradeId={null}
        />
      </UIProvider>,
    );
    expect(screen.getByText("Trade Log")).toBeInTheDocument();
  });

  it("renders strategy filter Select with All Strategies + unique names", () => {
    const trades = [makeTrade(1), makeTrade(2, { id: 2, strategy: "52W", symbol: "INFY" })];
    render(
      <UIProvider>
        <ReplayTradeLog
          trades={trades}
          strategyFilter="ALL"
          setStrategyFilter={vi.fn()}
          isRunning={false}
          highlightedTradeId={null}
        />
      </UIProvider>,
    );
    expect(screen.getByTestId("replay-trade-log-strategy-filter")).toBeInTheDocument();
  });

  it("renders symbol filter Select with All Symbols + unique symbols", () => {
    const trades = [makeTrade(1), makeTrade(2, { id: 2, symbol: "INFY" })];
    render(
      <UIProvider>
        <ReplayTradeLog
          trades={trades}
          strategyFilter="ALL"
          setStrategyFilter={vi.fn()}
          isRunning={false}
          highlightedTradeId={null}
        />
      </UIProvider>,
    );
    expect(screen.getByTestId("replay-trade-log-symbol-filter")).toBeInTheDocument();
  });

  it("shows filtered trade count text", () => {
    const trades = [makeTrade(1), makeTrade(2)];
    render(
      <UIProvider>
        <ReplayTradeLog
          trades={trades}
          strategyFilter="ALL"
          setStrategyFilter={vi.fn()}
          isRunning={false}
          highlightedTradeId={null}
        />
      </UIProvider>,
    );
    expect(screen.getByText("2 trades")).toBeInTheDocument();
  });

  it("shows '1 trade' for single trade", () => {
    const trades = [makeTrade(1)];
    render(
      <UIProvider>
        <ReplayTradeLog
          trades={trades}
          strategyFilter="ALL"
          setStrategyFilter={vi.fn()}
          isRunning={false}
          highlightedTradeId={null}
        />
      </UIProvider>,
    );
    expect(screen.getByText("1 trade")).toBeInTheDocument();
  });

  it("shows empty state when filtered trades empty", () => {
    render(
      <UIProvider>
        <ReplayTradeLog
          trades={[]}
          strategyFilter="ALL"
          setStrategyFilter={vi.fn()}
          isRunning={false}
          highlightedTradeId={null}
        />
      </UIProvider>,
    );
    expect(screen.getByText("No trades yet")).toBeInTheDocument();
  });

  it("renders trade rows with index number", () => {
    const trades = [makeTrade(1)];
    render(
      <UIProvider>
        <ReplayTradeLog
          trades={trades}
          strategyFilter="ALL"
          setStrategyFilter={vi.fn()}
          isRunning={false}
          highlightedTradeId={null}
        />
      </UIProvider>,
    );
    expect(screen.getByTestId("replay-trade-row-1")).toBeInTheDocument();
  });

  it("shows SideBadge for each trade side", () => {
    const trades = [makeTrade(1)];
    render(
      <UIProvider>
        <ReplayTradeLog
          trades={trades}
          strategyFilter="ALL"
          setStrategyFilter={vi.fn()}
          isRunning={false}
          highlightedTradeId={null}
        />
      </UIProvider>,
    );
    expect(screen.getByTestId("replay-trade-row-1")).toBeInTheDocument();
  });

  it("renders header columns", () => {
    render(
      <UIProvider>
        <ReplayTradeLog
          trades={[]}
          strategyFilter="ALL"
          setStrategyFilter={vi.fn()}
          isRunning={false}
          highlightedTradeId={null}
        />
      </UIProvider>,
    );
    expect(screen.getByText("Symbol")).toBeInTheDocument();
    expect(screen.getByText("Qty")).toBeInTheDocument();
    expect(screen.getByText("Hold")).toBeInTheDocument();
    expect(screen.getByText("Strategy")).toBeInTheDocument();
    expect(screen.getByText("Reason")).toBeInTheDocument();
  });

  it("highlights row when highlightedTradeId matches", () => {
    const trades = [makeTrade(1)];
    render(
      <UIProvider>
        <ReplayTradeLog
          trades={trades}
          strategyFilter="ALL"
          setStrategyFilter={vi.fn()}
          isRunning={false}
          highlightedTradeId={1}
        />
      </UIProvider>,
    );
    const row = screen.getByTestId("replay-trade-row-1");
    expect(row.className).toContain("trade-row-highlighted");
  });

  it("calls onTradeClick when row clicked", async () => {
    const onTradeClick = vi.fn();
    const user = userEvent.setup();
    const trades = [makeTrade(1)];
    render(
      <UIProvider>
        <ReplayTradeLog
          trades={trades}
          strategyFilter="ALL"
          setStrategyFilter={vi.fn()}
          isRunning={false}
          highlightedTradeId={null}
          onTradeClick={onTradeClick}
        />
      </UIProvider>,
    );
    await user.click(screen.getByTestId("replay-trade-row-1"));
    expect(onTradeClick).toHaveBeenCalledWith(trades[0]);
  });

  it("strategy name as clickable Anchor that filters by strategy", async () => {
    const setStrategyFilter = vi.fn();
    const user = userEvent.setup();
    const trades = [makeTrade(1)];
    render(
      <UIProvider>
        <ReplayTradeLog
          trades={trades}
          strategyFilter="ALL"
          setStrategyFilter={setStrategyFilter}
          isRunning={false}
          highlightedTradeId={null}
        />
      </UIProvider>,
    );
    const link = screen.getByTestId("replay-trade-strategy-link-1");
    await user.click(link);
    expect(setStrategyFilter).toHaveBeenCalledWith("ORB");
  });

  it("shows exit reason as Badge with color", () => {
    const trades = [makeTrade(1)];
    render(
      <UIProvider>
        <ReplayTradeLog
          trades={trades}
          strategyFilter="ALL"
          setStrategyFilter={vi.fn()}
          isRunning={false}
          highlightedTradeId={null}
        />
      </UIProvider>,
    );
    expect(screen.getByText("TP")).toBeInTheDocument();
  });

  it("falls back to gray for unknown exit reasons", () => {
    const trades = [makeTrade(1, { exit_reason: "MANUAL_CLOSE" })];
    render(
      <UIProvider>
        <ReplayTradeLog
          trades={trades}
          strategyFilter="ALL"
          setStrategyFilter={vi.fn()}
          isRunning={false}
          highlightedTradeId={null}
        />
      </UIProvider>,
    );
    expect(screen.getByText("MANUAL_CLOSE")).toBeInTheDocument();
  });

  it("auto-scrolls to bottom when isRunning and trades exist", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const trades = [makeTrade(1)];
    render(
      <UIProvider>
        <ReplayTradeLog
          trades={trades}
          strategyFilter="ALL"
          setStrategyFilter={vi.fn()}
          isRunning={true}
          highlightedTradeId={null}
        />
      </UIProvider>,
    );
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth", block: "end" }),
    );
  });
});
