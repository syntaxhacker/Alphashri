// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { BotStatusPanel } from "./BotStatusPanel";
import type { BotConfig, BotStatus, BotTrade } from "../../types/bots";
import { fetchHolidays } from "../../api/holidays_api";
import { loadHolidays, resetHolidays } from "../../state/holidays";

// Fixed IST instants injected into the real session helper; the holiday-only
// helper stays holiday-only so the after-hours regressions fail on the old code.
const clock = vi.hoisted(() => ({ now: new Date("2026-11-16T05:30:00Z") })); // Mon 11:00 IST

vi.mock("../../state/bots", () => ({
  loadBotStatus: vi.fn(),
  loadBotTrades: vi.fn(),
}));

vi.mock("../../api/holidays_api", () => ({
  fetchHolidays: vi.fn(async () => []),
  fetchHolidayCheck: vi.fn(),
}));

vi.mock("../../state/holidays", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../state/holidays")>();
  const istDate = (now: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  return {
    ...actual,
    subscribeToHolidays: vi.fn(() => () => {}),
    isMarketClosedToday: (now?: Date) => actual.isTradingHoliday(istDate(now ?? clock.now)),
    isMarketOpenNow: (now?: Date) => actual.isMarketOpenNow(now ?? clock.now),
  };
});

import { loadBotStatus, loadBotTrades } from "../../state/bots";

import { Router } from "@solidjs/router";
import type { JSX } from "solid-js";

// Local equivalent of the shared renderWithProviders test helper, fixed for
// Solid: solid-router renders no plain children, so tests mount through the
// router's `root` prop instead.
function renderWithProviders(ui: () => JSX.Element) {
  return render(() => (
    <Router root={() => <UIProvider>{ui()}</UIProvider>} />
  ));
}


const mockBot: BotConfig = {
  id: "bot-1",
  uuid: "uuid-1",
  name: "Test Bot",
  is_active: true,
  max_total_positions: 5,
  max_total_capital_pct: 0.5,
  max_daily_loss_pct: 0.03,
  live_trading: false,
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

async function setHoliday(date: string, description: string) {
  vi.mocked(fetchHolidays).mockResolvedValueOnce([{ date, description, type: "trading" }]);
  resetHolidays();
  await loadHolidays();
}

describe("BotStatusPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clock.now = new Date("2026-11-16T05:30:00Z"); // Monday 11:00 IST — open
    delete (window as any).__E2E_MOCK_MARKET_OPEN__;
    vi.mocked(fetchHolidays).mockResolvedValue([]);
    resetHolidays();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const defaultProps = {
    bot: mockBot,
    status: null,
    trades: [],
    onStart: vi.fn(),
    onStop: vi.fn(),
  };

  it("renders bot name", () => {
    renderWithProviders(() => <BotStatusPanel {...defaultProps} />);
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
    renderWithProviders(() => <BotStatusPanel {...defaultProps} status={status} />);
    expect(screen.getByTestId("bot-running-badge")).toBeInTheDocument();
  });

  it("shows Start Bot button when bot is not running", () => {
    renderWithProviders(() => <BotStatusPanel {...defaultProps} />);
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
    renderWithProviders(() => <BotStatusPanel {...defaultProps} status={status} />);
    expect(screen.getByTestId("stop-bot-btn")).toBeInTheDocument();
  });

  it("refresh button reloads status and trades", async () => {
        renderWithProviders(() => <BotStatusPanel {...defaultProps} />);
    await fireEvent.click(screen.getByTestId("refresh-bot-status-btn"));
    expect(loadBotStatus).toHaveBeenCalledWith("bot-1");
    expect(loadBotTrades).toHaveBeenCalledWith("bot-1");
  });

  it("start handler calls onStart and loads status/trades once (no polling)", async () => {
        const onStart = vi.fn().mockResolvedValue(undefined);
    vi.mocked(loadBotStatus).mockResolvedValue(undefined);
    vi.mocked(loadBotTrades).mockResolvedValue(undefined);
    renderWithProviders(() => <BotStatusPanel {...defaultProps} onStart={onStart} />);
    await fireEvent.click(screen.getByTestId("start-bot-btn"));
    expect(onStart).toHaveBeenCalledWith("bot-1");
    await waitFor(() => {
      expect(loadBotStatus).toHaveBeenCalledTimes(1);
      expect(loadBotTrades).toHaveBeenCalledTimes(1);
    });
  });

  it("stop handler calls onStop and loads status once (no polling)", async () => {
        const onStop = vi.fn().mockResolvedValue(undefined);
    const status: BotStatus = {
      bot_id: "bot-1",
      running: true,
      pid: 12345,
      status: "running",
      portfolio: null,
      strategies: {},
    };
    vi.mocked(loadBotStatus).mockResolvedValue(undefined);
    renderWithProviders(() => <BotStatusPanel {...defaultProps} status={status} onStop={onStop} />);
    await fireEvent.click(screen.getByTestId("stop-bot-btn"));
    expect(onStop).toHaveBeenCalledWith("bot-1");
    await waitFor(() => {
      expect(loadBotStatus).toHaveBeenCalledTimes(1);
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
    renderWithProviders(() => <BotStatusPanel {...defaultProps} status={status} />);
    expect(screen.getByTestId("portfolio-summary")).toBeInTheDocument();
  });

  it("placeholder card shown when no portfolio data", () => {
    renderWithProviders(() => <BotStatusPanel {...defaultProps} />);
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
    renderWithProviders(() => <BotStatusPanel {...defaultProps} status={status} />);
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
    renderWithProviders(() => <BotStatusPanel {...defaultProps} status={status} />);
    expect(screen.getByTestId("bot-positions")).toBeInTheDocument();
  });

  it("trades table always rendered (empty or populated)", () => {
    renderWithProviders(() => <BotStatusPanel {...defaultProps} trades={[mockTrade]} />);
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
    renderWithProviders(() => <BotStatusPanel {...defaultProps} status={status} />);
    expect(screen.getByTestId("bot-last-update")).toBeInTheDocument();
  });
});

// Fixed-instant regressions: the holiday-only helper said "open" at 17:11.
describe("BotStatusPanel — session guard with fixed timestamps", () => {
  const stoppedProps = {
    bot: mockBot,
    status: null,
    trades: [],
    onStart: vi.fn(),
    onStop: vi.fn(),
  };

  it("17:11 IST on a weekday disables Start Bot", () => {
    clock.now = new Date("2026-11-16T11:41:00Z"); // Monday 17:11 IST
    renderWithProviders(() => <BotStatusPanel {...stoppedProps} />);
    expect(screen.getByTestId("start-bot-btn")).toBeDisabled();
  });

  it("11:00 IST on a weekday enables Start Bot", () => {
    clock.now = new Date("2026-11-16T05:30:00Z"); // Monday 11:00 IST
    renderWithProviders(() => <BotStatusPanel {...stoppedProps} />);
    expect(screen.getByTestId("start-bot-btn")).not.toBeDisabled();
  });

  it("a holiday at 11:00 IST keeps the holiday reason", async () => {
    clock.now = new Date("2026-01-26T05:30:00Z"); // Republic Day, Monday 11:00 IST
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(clock.now);
    await setHoliday("2026-01-26", "Republic Day");
    renderWithProviders(() => <BotStatusPanel {...stoppedProps} />);
    const startBtn = screen.getByTestId("start-bot-btn");
    expect(startBtn).toBeDisabled();
    const tooltipWrap = startBtn.closest('[aria-label^="Market closed"]') as HTMLElement;
    fireEvent.mouseEnter(tooltipWrap);
    expect(await screen.findByText(/Republic Day/)).toBeInTheDocument();
  });

  it("__E2E_MOCK_MARKET_OPEN__ enables Start Bot at 17:11 IST", () => {
    clock.now = new Date("2026-11-16T11:41:00Z");
    (window as any).__E2E_MOCK_MARKET_OPEN__ = true;
    renderWithProviders(() => <BotStatusPanel {...stoppedProps} />);
    expect(screen.getByTestId("start-bot-btn")).not.toBeDisabled();
    delete (window as any).__E2E_MOCK_MARKET_OPEN__;
  });
});
