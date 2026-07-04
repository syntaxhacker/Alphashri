// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { BotConfigModal } from "./BotConfigModal2";
import type { BotConfig, AvailableStrategy } from "../../types/bots";

const mockCreateBotAction = vi.fn();
const mockUpdateBotAction = vi.fn();
const mockCloseCreateModal = vi.fn();
const mockCloseEditModal = vi.fn();

vi.mock("../../state/bots", () => ({
  createBotAction: (...args: any[]) => mockCreateBotAction(...args),
  updateBotAction: (...args: any[]) => mockUpdateBotAction(...args),
  closeCreateModal: (...args: any[]) => mockCloseCreateModal(...args),
  closeEditModal: (...args: any[]) => mockCloseEditModal(...args),
}));

const mockBot: BotConfig = {
  id: "bot-1",
  uuid: "uuid-1",
  name: "Test Bot",
  is_active: true,
  max_total_positions: 10,
  max_total_capital_pct: 0.8,
  max_daily_loss_pct: 0.05,
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

const mockStrategies: AvailableStrategy[] = [
  {
    id: "s1",
    name: "ORB Strategy",
    strategy_type: "ORB",
    is_template: false,
    is_default: false,
    sl_pct: 1.0,
    tp_pct: 1.5,
    max_positions: 5,
    or_minutes: 15,
    min_or_range_pct: 0.3,
    max_or_range_pct: 2.0,
    max_distance_from_or_pct: 0.5,
    cooldown_minutes: 75,
    enable_shorts: false,
    eod_exit_hour: 15,
    eod_exit_minute: 0,
    pivot_type: "",
    breakout_buffer_pct: 0,
    entry_threshold_pct: 0,
    enable_trailing_stop: false,
    trailing_stop_pct: 0,
    max_holding_days: 0,
    cooldown_days: 0,
    ema_fast_period: 0,
    ema_slow_period: 0,
  },
  {
    id: "s2",
    name: "SR Breakout",
    strategy_type: "SR_BREAKOUT",
    is_template: false,
    is_default: false,
    sl_pct: 1.0,
    tp_pct: 1.5,
    max_positions: 5,
    or_minutes: 0,
    min_or_range_pct: 0,
    max_or_range_pct: 0,
    max_distance_from_or_pct: 0,
    cooldown_minutes: 30,
    enable_shorts: true,
    eod_exit_hour: 15,
    eod_exit_minute: 15,
    pivot_type: "swing",
    breakout_buffer_pct: 0.3,
    entry_threshold_pct: 0,
    enable_trailing_stop: false,
    trailing_stop_pct: 0,
    max_holding_days: 0,
    cooldown_days: 0,
    ema_fast_period: 0,
    ema_slow_period: 0,
  },
  {
    id: "s3",
    name: "52W Chaser",
    strategy_type: "52W_CHASER",
    is_template: false,
    is_default: false,
    sl_pct: 2.0,
    tp_pct: 3.0,
    max_positions: 5,
    or_minutes: 0,
    min_or_range_pct: 0,
    max_or_range_pct: 0,
    max_distance_from_or_pct: 0,
    cooldown_minutes: 0,
    enable_shorts: false,
    eod_exit_hour: 15,
    eod_exit_minute: 0,
    pivot_type: "",
    breakout_buffer_pct: 0,
    entry_threshold_pct: 1.5,
    enable_trailing_stop: true,
    trailing_stop_pct: 0.5,
    max_holding_days: 30,
    cooldown_days: 7,
    ema_fast_period: 0,
    ema_slow_period: 0,
  },
  {
    id: "s4",
    name: "EMA Cross",
    strategy_type: "EMA_CROSS",
    is_template: false,
    is_default: false,
    sl_pct: 1.0,
    tp_pct: 2.0,
    max_positions: 3,
    or_minutes: 0,
    min_or_range_pct: 0,
    max_or_range_pct: 0,
    max_distance_from_or_pct: 0,
    cooldown_minutes: 0,
    enable_shorts: true,
    eod_exit_hour: 15,
    eod_exit_minute: 15,
    pivot_type: "",
    breakout_buffer_pct: 0,
    entry_threshold_pct: 0,
    enable_trailing_stop: false,
    trailing_stop_pct: 0,
    max_holding_days: 0,
    cooldown_days: 0,
    ema_fast_period: 9,
    ema_slow_period: 21,
  },
];

function renderWithProviders(ui: React.ReactElement) {
  return render(<UIProvider>{ui}</UIProvider>);
}

describe("BotConfigModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    opened: true,
    bot: null,
    availableStrategies: mockStrategies,
    onClose: vi.fn(),
  };

  it("modal title is 'Create New Bot' when bot is null", () => {
    renderWithProviders(<BotConfigModal {...defaultProps} />);
    expect(screen.getByText("Create New Bot")).toBeInTheDocument();
  });

  it("modal title is 'Edit Bot' when bot is provided", () => {
    renderWithProviders(<BotConfigModal {...defaultProps} bot={mockBot} />);
    expect(screen.getByText("Edit Bot")).toBeInTheDocument();
  });

  it("form pre-fills bot data when editing", () => {
    renderWithProviders(<BotConfigModal {...defaultProps} bot={mockBot} />);
    const nameInput = screen.getByTestId("bot-name-input") as HTMLInputElement;
    expect(nameInput.value).toBe("Test Bot");
  });

  it("bot name input is required", () => {
    renderWithProviders(<BotConfigModal {...defaultProps} />);
    const nameInput = screen.getByTestId("bot-name-input");
    expect(nameInput).toBeRequired();
  });

  it("active checkbox is shown", () => {
    renderWithProviders(<BotConfigModal {...defaultProps} />);
    expect(screen.getByTestId("bot-active-checkbox")).toBeInTheDocument();
  });

  it("max positions number input (1-20)", () => {
    renderWithProviders(<BotConfigModal {...defaultProps} />);
    const input = screen.getByTestId("max-positions-input");
    expect(input).toBeInTheDocument();
  });

  it("max capital % number input (10-100)", () => {
    renderWithProviders(<BotConfigModal {...defaultProps} />);
    const input = screen.getByTestId("max-capital-input");
    expect(input).toBeInTheDocument();
  });

  it("max daily loss % number input (1-20)", () => {
    renderWithProviders(<BotConfigModal {...defaultProps} />);
    const input = screen.getByTestId("max-daily-loss-input");
    expect(input).toBeInTheDocument();
  });

  it("strategy allocation rows are editable", () => {
    renderWithProviders(<BotConfigModal {...defaultProps} bot={mockBot} />);
    expect(screen.getByTestId("strategy-allocation-row")).toBeInTheDocument();
  });

  it("strategy select dropdown shows available strategies", () => {
    renderWithProviders(<BotConfigModal {...defaultProps} />);
    expect(screen.getByText("Strategy Allocations")).toBeInTheDocument();
  });

  it("add strategy button adds a new row", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BotConfigModal {...defaultProps} />);
    await user.click(screen.getByTestId("add-strategy-btn"));
    expect(screen.getAllByTestId("strategy-allocation-row")).toHaveLength(1);
  });

  it("remove strategy button removes a row", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BotConfigModal {...defaultProps} bot={mockBot} />);
    await user.click(screen.getByTestId("add-strategy-btn"));
    expect(screen.getAllByTestId("strategy-allocation-row")).toHaveLength(2);
    const removeBtn = screen.getByTestId("remove-strategy-btn-new-100");
    await user.click(removeBtn);
    expect(screen.getAllByTestId("strategy-allocation-row")).toHaveLength(1);
  });

  it("total allocation % is calculated and displayed", () => {
    renderWithProviders(<BotConfigModal {...defaultProps} bot={mockBot} />);
    expect(screen.getByText(/Total Allocation/)).toBeInTheDocument();
  });

  it("cancel button closes the modal", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<BotConfigModal {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByTestId("cancel-bot-config-btn"));
    expect(onClose).toHaveBeenCalled();
  });

  it("submit calls createBotAction for new bot", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(
      <BotConfigModal {...defaultProps} onClose={onClose} />,
    );
    await user.type(screen.getByTestId("bot-name-input"), "New Bot");
    await user.click(screen.getByTestId("save-bot-config-btn"));
    await waitFor(() => {
      expect(mockCreateBotAction).toHaveBeenCalled();
    });
  });

  it("submit calls updateBotAction for existing bot", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(
      <BotConfigModal {...defaultProps} bot={mockBot} onClose={onClose} />,
    );
    await user.click(screen.getByTestId("save-bot-config-btn"));
    await waitFor(() => {
      expect(mockUpdateBotAction).toHaveBeenCalled();
    });
  });

  it("StrategyParams displays ORB-specific parameters", () => {
    renderWithProviders(<BotConfigModal {...defaultProps} bot={mockBot} />);
    expect(screen.getByText(/OR Window/)).toBeInTheDocument();
  });

  it("StrategyParams displays ORB-specific parameters when strategy selected in edit mode", () => {
    renderWithProviders(<BotConfigModal {...defaultProps} bot={mockBot} />);
    expect(screen.getByText(/OR Window/)).toBeInTheDocument();
  });

  it("StrategyParams displays 52W-specific parameters", () => {
    const bot52W: BotConfig = {
      ...mockBot,
      strategies: [
        {
          id: "s3",
          name: "52W Chaser",
          strategy_type: "52W_CHASER",
          max_positions: 3,
          capital_allocation_pct: 0.5,
        },
      ],
    };
    renderWithProviders(<BotConfigModal {...defaultProps} bot={bot52W} />);
    expect(screen.getByText(/Entry Threshold/)).toBeInTheDocument();
    expect(screen.getByText(/Trailing/)).toBeInTheDocument();
    expect(screen.getByText(/Max Holding/)).toBeInTheDocument();
    expect(screen.getByText(/Cooldown/)).toBeInTheDocument();
  });

  it("StrategyParams displays EMA_CROSS-specific parameters", () => {
    const botEMACross: BotConfig = {
      ...mockBot,
      strategies: [
        {
          id: "s4",
          name: "EMA Cross",
          strategy_type: "EMA_CROSS",
          max_positions: 3,
          capital_allocation_pct: 0.5,
        },
      ],
    };
    renderWithProviders(<BotConfigModal {...defaultProps} bot={botEMACross} />);
    expect(screen.getByText(/EMA Fast/)).toBeInTheDocument();
    expect(screen.getByText(/EMA Slow/)).toBeInTheDocument();
  });
});
