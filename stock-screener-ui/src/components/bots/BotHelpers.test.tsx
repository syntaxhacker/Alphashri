// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import {
  PortfolioSummaryCard,
  StrategyStatusCard,
  PositionsTable,
  TradesTable,
  BotActionButtons,
  BotSummaryCell,
  getBotIndicatorColor,
} from "./BotHelpers";
import { BOT_RUNNING, BOT_STOPPED } from "../../config/colors";
import type {
  PortfolioSummary,
  StrategyStatus,
  BotPosition,
  BotTrade,
  BotConfig,
} from "../../types/bots";
import { Router } from "@solidjs/router";
import type { JSX } from "solid-js";
import { fetchHolidays } from "../../api/holidays_api";
import { loadHolidays, resetHolidays } from "../../state/holidays";

// Fixed IST instants injected into the real session helper; the holiday-only
// helper stays holiday-only so the after-hours regressions fail on the old code.
const clock = vi.hoisted(() => ({ now: new Date("2026-11-16T05:30:00Z") })); // Mon 11:00 IST

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
    isMarketClosedToday: (now?: Date) => actual.isTradingHoliday(istDate(now ?? clock.now)),
    isMarketOpenNow: (now?: Date) => actual.isMarketOpenNow(now ?? clock.now),
  };
});

// Local equivalent of the shared renderWithProviders test helper, fixed for
// Solid: solid-router renders no plain children, so tests mount through the
// router's `root` prop instead.
function renderWithProviders(ui: () => JSX.Element) {
  return render(() => (
    <Router root={() => <UIProvider>{ui()}</UIProvider>} />
  ));
}

beforeEach(() => {
  clock.now = new Date("2026-11-16T05:30:00Z"); // Monday 11:00 IST — open
  delete (window as any).__E2E_MOCK_MARKET_OPEN__;
  vi.mocked(fetchHolidays).mockResolvedValue([]);
  resetHolidays();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function setHoliday(date: string, description: string) {
  vi.mocked(fetchHolidays).mockResolvedValueOnce([{ date, description, type: "trading" }]);
  resetHolidays();
  await loadHolidays();
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
  live_trading: false,
  strategies: [
    {
      id: "s1",
      name: "ORB Strategy",
      strategy_type: "ORB",
      max_positions: 3,
      capital_allocation_pct: 0.5,
      enable_shorts: false,
    },
  ],
  created_at: "2025-01-01T00:00:00Z",
  updated_at: null,
  running: false,
  pid: null,
};

describe("PortfolioSummaryCard", () => {
  it("displays portfolio summary data", () => {
    const { container } = renderWithProviders(() => <PortfolioSummaryCard portfolio={mockPortfolio} />);
    const el = container.querySelector('[data-testid="portfolio-summary"]');
    expect(el).toBeInTheDocument();
  });
});

describe("StrategyStatusCard", () => {
  it("renders strategy card with data", () => {
    const { container } = renderWithProviders(() => <StrategyStatusCard strategy={mockStrategy} isRunning={true} />);
    const el = container.querySelector('[data-testid="strategy-card"]');
    expect(el).toBeInTheDocument();
  });
});

describe("PositionsTable", () => {
  it("copies the display symbol from positions and trades tables", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { unmount } = renderWithProviders(() => <PositionsTable positions={[mockPosition]} />);

    const positionCopy = screen.getByTestId("copy-symbol-RELIANCE");
    expect(positionCopy).toHaveAttribute("aria-label", "Copy RELIANCE");
    await fireEvent.click(positionCopy);
    expect(writeText).toHaveBeenCalledWith("RELIANCE");
    unmount();

    renderWithProviders(() => <TradesTable trades={[mockTrade]} onRefresh={vi.fn()} />);
    const tradeCopy = screen.getByTestId("copy-symbol-TCS");
    expect(tradeCopy).toHaveAttribute("aria-label", "Copy TCS");
    await fireEvent.click(tradeCopy);
    expect(writeText).toHaveBeenCalledWith("TCS");
  });

  it("renders column headers", () => {
    const { container } = renderWithProviders(() => <PositionsTable positions={[mockPosition]} />);
    const table = container.querySelector('[data-testid="bot-positions"]');
    expect(table).toBeInTheDocument();
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
    const { container } = renderWithProviders(() => <PositionsTable positions={[]} />);
    const el = container.querySelector('[data-testid="bot-positions"]');
    expect(el).toBeNull();
  });
});

describe("TradesTable", () => {
  it("renders trade history table", () => {
    const { container } = renderWithProviders(() => <TradesTable trades={[mockTrade]} onRefresh={vi.fn()} />);
    const el = container.querySelector('[data-testid="bot-trades"]');
    expect(el).toBeInTheDocument();
  });

  it("shows 'No trades yet' empty state", () => {
    const { container } = renderWithProviders(() => <TradesTable trades={[]} onRefresh={vi.fn()} />);
    const el = container.querySelector('[data-testid="bot-trades"]');
    expect(el).toBeInTheDocument();
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
    const { container } = renderWithProviders(() => <BotActionButtons {...actionProps} />);
    expect(container.querySelector(`[data-testid="view-bot-status-btn-${mockBot.id}"]`)).toBeInTheDocument();
    expect(container.querySelector(`[data-testid="start-bot-btn-${mockBot.id}"]`)).toBeInTheDocument();
    expect(container.querySelector(`[data-testid="edit-bot-btn-${mockBot.id}"]`)).toBeInTheDocument();
    expect(container.querySelector(`[data-testid="delete-bot-btn-${mockBot.id}"]`)).toBeInTheDocument();
  });

  it("start button is disabled when bot is not active", () => {
    const inactiveBot = { ...mockBot, is_active: false };
    const { container } = renderWithProviders(() => <BotActionButtons {...actionProps} bot={inactiveBot} />);
    const btn = container.querySelector(`[data-testid="start-bot-btn-${inactiveBot.id}"]`);
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it("delete button is disabled when bot is running", () => {
    const runningBot = { ...mockBot, running: true };
    const { container } = renderWithProviders(() => <BotActionButtons {...actionProps} bot={runningBot} />);
    const btn = container.querySelector(`[data-testid="delete-bot-btn-${runningBot.id}"]`);
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it("shows stop button when bot is running", () => {
    const runningBot = { ...mockBot, running: true };
    const { container } = renderWithProviders(() => <BotActionButtons {...actionProps} bot={runningBot} />);
    const btn = container.querySelector(`[data-testid="stop-bot-btn-${runningBot.id}"]`);
    expect(btn).toBeInTheDocument();
  });
});

describe("BotSummaryCell", () => {
  it("shows strategy count and type badges", () => {
    const { container } = renderWithProviders(() => <BotSummaryCell bot={mockBot} />);
    expect(container.textContent).toContain("1 strategies");
  });
});

describe("getBotIndicatorColor", () => {
  it("returns correct colors", () => {
    expect(getBotIndicatorColor(true)).toBe(BOT_RUNNING);
    expect(getBotIndicatorColor(false)).toBe(BOT_STOPPED);
  });
});

// Fixed-instant regressions: the holiday-only helper said "open" at 17:11,
// so the after-hours case fails on the old code.
describe("BotActionButtons — session guard with fixed timestamps", () => {
  const actionProps = {
    bot: mockBot,
    onView: vi.fn(),
    onStart: vi.fn(),
    onStop: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  };
  const startBtnId = `start-bot-btn-${mockBot.id}`;
  const renderButtons = () => renderWithProviders(() => <BotActionButtons {...actionProps} />);

  it("17:11 IST on a weekday disables Start and explains the session", () => {
    clock.now = new Date("2026-11-16T11:41:00Z"); // Monday 17:11 IST
    const { container } = renderButtons();
    const btn = container.querySelector(`[data-testid="${startBtnId}"]`)!;
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", expect.stringContaining("Closed at 15:30 IST"));
  });

  it("11:00 IST on a weekday enables Start", () => {
    clock.now = new Date("2026-11-16T05:30:00Z"); // Monday 11:00 IST
    const { container } = renderButtons();
    const btn = container.querySelector(`[data-testid="${startBtnId}"]`)!;
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute("title", "Start Bot");
  });

  it("a holiday at 11:00 IST keeps the holiday reason", async () => {
    clock.now = new Date("2026-01-26T05:30:00Z"); // Republic Day, Monday 11:00 IST
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(clock.now);
    await setHoliday("2026-01-26", "Republic Day");
    const { container } = renderButtons();
    const btn = container.querySelector(`[data-testid="${startBtnId}"]`)!;
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", expect.stringContaining("Republic Day"));
  });

  it("__E2E_MOCK_MARKET_OPEN__ enables Start at 17:11 IST", () => {
    clock.now = new Date("2026-11-16T11:41:00Z");
    (window as any).__E2E_MOCK_MARKET_OPEN__ = true;
    const { container } = renderButtons();
    const btn = container.querySelector(`[data-testid="${startBtnId}"]`)!;
    expect(btn).not.toBeDisabled();
    delete (window as any).__E2E_MOCK_MARKET_OPEN__;
  });
});
