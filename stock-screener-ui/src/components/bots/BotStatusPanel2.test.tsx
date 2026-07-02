// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { BotStatusPanel } from "./BotStatusPanel2";
import type { BotConfig, BotStatus, BotTrade } from "../../types/bots";

vi.mock("../../state/bots", () => ({
  loadBotStatus: vi.fn(),
  loadBotTrades: vi.fn(),
  startAutoRefresh: vi.fn(),
  stopAutoRefresh: vi.fn(),
}));

vi.mock("../../state/holidays", () => ({
  subscribeToHolidays: vi.fn(),
  isMarketClosedToday: vi.fn().mockReturnValue(false),
}));

import { loadBotStatus, loadBotTrades, startAutoRefresh, stopAutoRefresh } from "../../state/bots";

const mockBot: BotConfig = {
  id: "bot-1",
  uuid: "uuid-1",
  name: "Test Bot",
  is_active: true,
  max_total_positions: 5,
  max_total_capital_pct: 0.5,
  max_daily_loss_pct: 0.03,
  strategies: [],
  created_at: "2025-01-01T00:00:00Z",
  updated_at: null,
  running: false,
  pid: null,
};

const mockPortfolio = {
  initial_capital: 100000,
  cash: 50000,
  margin_used: 25000,
  total_value: 105000,
  total_pnl: 5000,
  total_pnl_pct: 5.0,
  daily_pnl: 200,
  total_positions: 3,
};

const mockStrategyStatus = {
  strategy_id: "s1",
  strategy_name: "ORB Strategy",
  status: "running" as const,
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

const mockPosition = {
  strategy_id: "s1",
  strategy_name: "ORB Strategy",
  symbol: "RELIANCE",
  side: "BUY" as const,
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

function renderWithProviders(ui: React.ReactElement) {
  return render(<UIProvider>{ui}</UIProvider>);
}

describe("BotStatusPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    bot: mockBot,
    status: null,
    trades: [],
    onStart: vi.fn(),
    onStop: vi.fn(),
  };

  it("renders bot name", () => {
    renderWithProviders(<BotStatusPanel {...defaultProps} />);
    expect(screen.getByTestId("bot-name")).toHaveTextContent("Test Bot");
  });

  it("shows StatusBadge with running/stopped state", () => {
    const status: BotStatus = {
      bot_id: "bot-1",
      running: true,
      pid: 12345,
      status: "running",
      portfolio: null,
      strategies: {},
    };
    renderWithProviders(<BotStatusPanel {...defaultProps} status={status} />);
    expect(screen.getByTestId("bot-running-badge")).toBeInTheDocument();
  });

  it("shows Start Bot button when bot is not running", () => {
    renderWithProviders(<BotStatusPanel {...defaultProps} />);
    expect(screen.getByTestId("start-bot-btn")).toBeInTheDocument();
  });

  it("shows Stop Bot button when bot is running", () => {
    const status: BotStatus = {
      bot_id: "bot-1",
      running: true,
      pid: 12345,
      status: "running",
      portfolio: null,
      strategies: {},
    };
    renderWithProviders(<BotStatusPanel {...defaultProps} status={status} />);
    expect(screen.getByTestId("stop-bot-btn")).toBeInTheDocument();
  });

  it("refresh button reloads status and trades", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BotStatusPanel {...defaultProps} />);
    await user.click(screen.getByTestId("refresh-bot-status-btn"));
    expect(loadBotStatus).toHaveBeenCalledWith("bot-1");
    expect(loadBotTrades).toHaveBeenCalledWith("bot-1");
  });

  it("start handler calls onStart, loads status/trades, starts auto-refresh", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn().mockResolvedValue(undefined);
    (loadBotStatus as any).mockResolvedValue(undefined);
    (loadBotTrades as any).mockResolvedValue(undefined);
    renderWithProviders(<BotStatusPanel {...defaultProps} onStart={onStart} />);
    await user.click(screen.getByTestId("start-bot-btn"));
    expect(onStart).toHaveBeenCalledWith("bot-1");
    await waitFor(() => {
      expect(loadBotStatus).toHaveBeenCalled();
      expect(loadBotTrades).toHaveBeenCalled();
      expect(startAutoRefresh).toHaveBeenCalledWith("bot-1", 5000);
    });
  });

  it("stop handler calls onStop, stops auto-refresh, loads status", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn().mockResolvedValue(undefined);
    const status: BotStatus = {
      bot_id: "bot-1",
      running: true,
      pid: 12345,
      status: "running",
      portfolio: null,
      strategies: {},
    };
    (loadBotStatus as any).mockResolvedValue(undefined);
    renderWithProviders(<BotStatusPanel {...defaultProps} status={status} onStop={onStop} />);
    await user.click(screen.getByTestId("stop-bot-btn"));
    expect(onStop).toHaveBeenCalledWith("bot-1");
    await waitFor(() => {
      expect(stopAutoRefresh).toHaveBeenCalled();
      expect(loadBotStatus).toHaveBeenCalled();
    });
  });

  it("PortfolioSummaryCard is shown when status.portfolio exists", () => {
    const status: BotStatus = {
      bot_id: "bot-1",
      running: true,
      pid: 12345,
      status: "running",
      portfolio: mockPortfolio,
      strategies: {},
    };
    renderWithProviders(<BotStatusPanel {...defaultProps} status={status} />);
    expect(screen.getByTestId("portfolio-summary")).toBeInTheDocument();
  });

  it("placeholder card shown when no portfolio data", () => {
    renderWithProviders(<BotStatusPanel {...defaultProps} />);
    expect(screen.getByTestId("portfolio-placeholder")).toBeInTheDocument();
    expect(screen.getByText("Start the bot to see live portfolio data")).toBeInTheDocument();
  });

  it("strategy status cards rendered when status.strategies exists", () => {
    const status: BotStatus = {
      bot_id: "bot-1",
      running: true,
      pid: 12345,
      status: "running",
      portfolio: null,
      strategies: { s1: mockStrategyStatus },
    };
    renderWithProviders(<BotStatusPanel {...defaultProps} status={status} />);
    expect(screen.getByTestId("strategies-status")).toBeInTheDocument();
  });

  it("positions table rendered when positions exist", () => {
    const status: BotStatus = {
      bot_id: "bot-1",
      running: true,
      pid: 12345,
      status: "running",
      portfolio: null,
      strategies: {},
      positions: [mockPosition],
    };
    renderWithProviders(<BotStatusPanel {...defaultProps} status={status} />);
    expect(screen.getByTestId("bot-positions")).toBeInTheDocument();
  });

  it("trades table always rendered (empty or populated)", () => {
    renderWithProviders(<BotStatusPanel {...defaultProps} trades={[mockTrade]} />);
    expect(screen.getByTestId("bot-trades")).toBeInTheDocument();
  });

  it("shows last update timestamp when available", () => {
    const status: BotStatus = {
      bot_id: "bot-1",
      running: true,
      pid: 12345,
      status: "running",
      portfolio: null,
      strategies: {},
      last_update: "2025-06-15T12:00:00Z",
    };
    renderWithProviders(<BotStatusPanel {...defaultProps} status={status} />);
    expect(screen.getByTestId("bot-last-update")).toBeInTheDocument();
  });
});
