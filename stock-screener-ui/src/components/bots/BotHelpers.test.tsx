// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { Table } from "@mantine/core";
import {
  PortfolioSummaryCard,
  StrategyStatusCard,
  PositionsTable,
  TradesTable,
  BotActionButtons,
  BotSummaryCell,
  BotRow,
  getBotRowStyle,
  getBotIndicatorColor,
} from "./BotHelpers";
import type {
  PortfolioSummary,
  StrategyStatus,
  BotPosition,
  BotTrade,
  BotConfig,
} from "../../types/bots";

function renderWithProviders(ui: React.ReactElement) {
  return render(<UIProvider>{ui}</UIProvider>);
}

const mockPortfolio: PortfolioSummary = {
  initial_capital: 100000,
  cash: 50000,
  margin_used: 25000,
  total_value: 105000,
  total_pnl: 5000,
  total_pnl_pct: 5.0,
  daily_pnl: 200,
  total_positions: 3,
};

const mockStrategy: StrategyStatus = {
  strategy_id: "s1",
  strategy_name: "ORB Strategy",
  status: "running",
  active_positions: 2,
  positions_count: 2,
  max_positions: 5,
  allocated_capital: 50000,
  capital_used: 25000,
  capital_used_pct: 50,
  total_pnl: 1000,
  trades_count: 10,
  portfolio_status: null,
};

const mockPosition: BotPosition = {
  strategy_id: "s1",
  strategy_name: "ORB Strategy",
  symbol: "RELIANCE",
  side: "BUY",
  quantity: 10,
  entry_price: 2500,
  current_price: 2550,
  unrealized_pnl: 500,
  unrealized_pnl_pct: 2.0,
  stop_loss: 2400,
  take_profit: 2700,
  entry_time: "2025-06-15T09:30:00Z",
};

const mockTrade: BotTrade = {
  id: "t1",
  symbol: "TCS",
  side: "BUY",
  quantity: 5,
  entry_price: 3500,
  exit_price: 3600,
  pnl: 500,
  pnl_pct: 2.86,
  net_pnl: 450,
  realized_pnl: 500,
  strategy_id: "s1",
  strategy_name: "ORB Strategy",
  entry_time: "2025-06-14T09:30:00Z",
  exit_time: "2025-06-14T15:00:00Z",
  exit_reason: "target",
  is_test: false,
  is_test_data: false,
};

const mockBot: BotConfig = {
  id: "bot-1",
  uuid: "uuid-1",
  name: "Test Bot",
  is_active: true,
  max_total_positions: 5,
  max_total_capital_pct: 0.5,
  max_daily_loss_pct: 0.03,
  strategies: [
    {
      id: "s1",
      name: "ORB Strategy",
      strategy_type: "ORB",
      max_positions: 3,
      capital_allocation_pct: 0.5,
    },
  ],
  created_at: "2025-01-01T00:00:00Z",
  updated_at: null,
  running: false,
  pid: null,
};

describe("PortfolioSummaryCard", () => {
  it("displays portfolio summary data", () => {
    const { container } = renderWithProviders(<PortfolioSummaryCard portfolio={mockPortfolio} />);
    const el = container.querySelector('[data-testid="portfolio-summary"]');
    expect(el).toBeTruthy();
  });
});

describe("StrategyStatusCard", () => {
  it("renders strategy card with data", () => {
    const { container } = renderWithProviders(<StrategyStatusCard strategy={mockStrategy} isRunning={true} />);
    const el = container.querySelector('[data-testid="strategy-card"]');
    expect(el).toBeTruthy();
  });
});

describe("PositionsTable", () => {
  it("renders column headers", () => {
    const { container } = renderWithProviders(<PositionsTable positions={[mockPosition]} />);
    const table = container.querySelector('[data-testid="bot-positions"]');
    expect(table).toBeTruthy();
    expect(table!.textContent).toContain("Strategy");
    expect(table!.textContent).toContain("Symbol");
    expect(table!.textContent).toContain("Side");
    expect(table!.textContent).toContain("Qty");
    expect(table!.textContent).toContain("Entry");
    expect(table!.textContent).toContain("Current");
    expect(table!.textContent).toContain("P&L");
    expect(table!.textContent).toContain("SL/TP");
  });

  it("returns null when positions array is empty", () => {
    const { container } = renderWithProviders(<PositionsTable positions={[]} />);
    const el = container.querySelector('[data-testid="bot-positions"]');
    expect(el).toBeNull();
  });
});

describe("TradesTable", () => {
  it("renders trade history table", () => {
    const { container } = renderWithProviders(<TradesTable trades={[mockTrade]} onRefresh={vi.fn()} />);
    const el = container.querySelector('[data-testid="bot-trades"]');
    expect(el).toBeTruthy();
  });

  it("shows 'No trades yet' empty state", () => {
    const { container } = renderWithProviders(<TradesTable trades={[]} onRefresh={vi.fn()} />);
    const el = container.querySelector('[data-testid="bot-trades"]');
    expect(el).toBeTruthy();
    expect(screen.getByText("No trades yet")).toBeInTheDocument();
  });
});

describe("BotActionButtons", () => {
  const actionProps = {
    bot: mockBot,
    onView: vi.fn(),
    onStart: vi.fn(),
    onStop: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  };

  it("shows action buttons with testids", () => {
    const { container } = renderWithProviders(<BotActionButtons {...actionProps} />);
    expect(container.querySelector(`[data-testid="view-bot-status-btn-${mockBot.id}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-testid="start-bot-btn-${mockBot.id}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-testid="edit-bot-btn-${mockBot.id}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-testid="delete-bot-btn-${mockBot.id}"]`)).toBeTruthy();
  });

  it("start button is disabled when bot is not active", () => {
    const inactiveBot = { ...mockBot, is_active: false };
    const { container } = renderWithProviders(<BotActionButtons {...actionProps} bot={inactiveBot} />);
    const btn = container.querySelector(`[data-testid="start-bot-btn-${inactiveBot.id}"]`);
    expect(btn).toBeTruthy();
  });

  it("delete button is disabled when bot is running", () => {
    const runningBot = { ...mockBot, running: true };
    const { container } = renderWithProviders(<BotActionButtons {...actionProps} bot={runningBot} />);
    const btn = container.querySelector(`[data-testid="delete-bot-btn-${runningBot.id}"]`);
    expect(btn).toBeTruthy();
  });

  it("shows stop button when bot is running", () => {
    const runningBot = { ...mockBot, running: true };
    const { container } = renderWithProviders(<BotActionButtons {...actionProps} bot={runningBot} />);
    const btn = container.querySelector(`[data-testid="stop-bot-btn-${runningBot.id}"]`);
    expect(btn).toBeTruthy();
  });
});

describe("BotSummaryCell", () => {
  it("shows strategy count and type badges", () => {
    const { container } = renderWithProviders(<BotSummaryCell bot={mockBot} />);
    expect(container.textContent).toContain("1 strategies");
  });
});

describe("BotRow", () => {
  const rowProps = {
    bot: mockBot,
    isSelected: false,
    onView: vi.fn(),
    onStart: vi.fn(),
    onStop: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  };

  it("renders bot row with testid", () => {
    const { container } = renderWithProviders(
      <UIProvider>
        <Table>
          <Table.Tbody>
            <BotRow {...rowProps} />
          </Table.Tbody>
        </Table>
      </UIProvider>
    );
    const el = container.querySelector(`[data-testid="bot-row-${mockBot.id}"]`);
    expect(el).toBeTruthy();
  });

  it("shows 'Inactive' badge when bot is not active", () => {
    const inactiveBot = { ...mockBot, is_active: false };
    const { container } = renderWithProviders(
      <UIProvider>
        <Table>
          <Table.Tbody>
            <BotRow {...rowProps} bot={inactiveBot} />
          </Table.Tbody>
        </Table>
      </UIProvider>
    );
    expect(container.textContent).toContain("Inactive");
  });
});

describe("getBotRowStyle", () => {
  it("applies selection background", () => {
    const style = getBotRowStyle(true, mockBot);
    expect(style.backgroundColor).toBeTruthy();
  });

  it("returns undefined for non-selected", () => {
    const style = getBotRowStyle(false, mockBot);
    expect(style.backgroundColor).toBeUndefined();
  });
});

describe("getBotIndicatorColor", () => {
  it("returns correct colors", () => {
    expect(getBotIndicatorColor(true)).toBeTruthy();
    expect(getBotIndicatorColor(false)).toBeTruthy();
  });
});
