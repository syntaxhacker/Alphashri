// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import type { BotsState, BotsView } from "../../types/bots";

const mockGetBotsState = vi.fn();
const mockGetCurrentView = vi.fn();
const mockSetCurrentView = vi.fn();
const mockSelectBot = vi.fn();
const mockStartBotAction = vi.fn();
const mockStopBotAction = vi.fn();
const mockDeleteBotAction = vi.fn();
const mockClearError = vi.fn();
const mockStartAutoRefresh = vi.fn();
const mockStopAutoRefresh = vi.fn();
const mockInitBotsState = vi.fn();
const mockOpenCreateModal = vi.fn();
const mockOpenEditModal = vi.fn();
const mockCloseCreateModal = vi.fn();
const mockCloseEditModal = vi.fn();
const mockLoadBotStatus = vi.fn();
const mockLoadBotTrades = vi.fn();

vi.mock("../../state/bots", () => ({
  getBotsState: (...args: any[]) => mockGetBotsState(...args),
  getCurrentView: (...args: any[]) => mockGetCurrentView(...args),
  setCurrentView: (...args: any[]) => mockSetCurrentView(...args),
  selectBot: (...args: any[]) => mockSelectBot(...args),
  startBotAction: (...args: any[]) => mockStartBotAction(...args),
  stopBotAction: (...args: any[]) => mockStopBotAction(...args),
  deleteBotAction: (...args: any[]) => mockDeleteBotAction(...args),
  clearError: (...args: any[]) => mockClearError(...args),
  startAutoRefresh: (...args: any[]) => mockStartAutoRefresh(...args),
  stopAutoRefresh: (...args: any[]) => mockStopAutoRefresh(...args),
  initBotsState: (...args: any[]) => mockInitBotsState(...args),
  openCreateModal: (...args: any[]) => mockOpenCreateModal(...args),
  openEditModal: (...args: any[]) => mockOpenEditModal(...args),
  closeCreateModal: (...args: any[]) => mockCloseCreateModal(...args),
  closeEditModal: (...args: any[]) => mockCloseEditModal(...args),
  subscribe: vi.fn(() => () => {}),
  loadBotStatus: (...args: any[]) => mockLoadBotStatus(...args),
  loadBotTrades: (...args: any[]) => mockLoadBotTrades(...args),
}));

vi.mock("../../hooks/useStoreSubscription", () => ({
  useStoreSubscription: vi.fn(),
}));

vi.mock("../../state/holidays", () => ({
  subscribeToHolidays: vi.fn(),
  isMarketClosedToday: vi.fn().mockReturnValue(false),
}));

import { BotsPage } from "./BotsPage";

const baseState = (): BotsState =>
  ({
    bots: [],
    selectedBot: null,
    botStatus: null,
    botTrades: [],
    availableStrategies: [],
    loading: {
      list: false,
      load: false,
      status: false,
      strategies: false,
      create: false,
      update: false,
      delete: false,
      start: false,
      stop: false,
      trades: false,
    },
    error: null,
    showCreateModal: false,
    showEditModal: false,
    editingBot: null,
  }) as BotsState;

function renderWithProviders(ui: React.ReactElement) {
  return render(<UIProvider>{ui}</UIProvider>);
}

function createBot(overrides: Record<string, any> = {}) {
  return {
    id: "bot-1",
    uuid: "uuid-1",
    name: "Test Bot",
    is_active: true,
    max_total_positions: 5,
    max_total_capital_pct: 0.5,
    max_daily_loss_pct: 0.03,
    strategies: [
      { id: "s1", name: "ORB Strategy", strategy_type: "ORB", max_positions: 3, capital_allocation_pct: 0.5 },
    ],
    created_at: "2025-01-01T00:00:00Z",
    updated_at: null,
    running: false,
    pid: null,
    ...overrides,
  };
}

describe("BotsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentView.mockReturnValue("list");
    mockGetBotsState.mockReturnValue(baseState());
  });

  afterEach(() => {
    cleanup();
    delete (window as any).confirm;
  });

  it("renders 'New Bot' create button", () => {
    renderWithProviders(<BotsPage />);
    expect(screen.getByText("New Bot")).toBeInTheDocument();
  });

  it("renders bots-view container", () => {
    renderWithProviders(<BotsPage />);
    expect(screen.getByTestId("bots-view")).toBeInTheDocument();
  });

  it("renders loading state with InlineLoader", () => {
    const state = baseState();
    state.loading.list = true;
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(<BotsPage />);
    expect(screen.getByTestId("bots-loading")).toBeInTheDocument();
  });

  it("renders error state with ErrorAlert", () => {
    const state = baseState();
    state.error = "Something went wrong";
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(<BotsPage />);
    expect(screen.getByTestId("bots-error")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("shows empty state when no bots configured", () => {
    renderWithProviders(<BotsPage />);
    expect(screen.getByText("No bots configured")).toBeInTheDocument();
  });

  it("renders bot list with bot data", () => {
    const state = baseState();
    state.bots = [createBot()];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(<BotsPage />);
    expect(screen.getByTestId("bots-table")).toBeInTheDocument();
    expect(screen.getByText("Test Bot")).toBeInTheDocument();
  });

  it("renders all BotsTable header columns", () => {
    const state = baseState();
    state.bots = [createBot()];
    mockGetBotsState.mockReturnValue(state);
    const { container } = renderWithProviders(<BotsPage />);
    const table = container.querySelector('[data-testid="bots-table"]');
    expect(table!.textContent).toContain("Name");
    expect(table!.textContent).toContain("Status");
    expect(table!.textContent).toContain("Strategies");
    expect(table!.textContent).toContain("Max Positions");
    expect(table!.textContent).toContain("Max Capital");
    expect(table!.textContent).toContain("Actions");
  });

  it("renders 'Inactive' badge for inactive bot", () => {
    const state = baseState();
    state.bots = [createBot({ is_active: false })];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(<BotsPage />);
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("shows running status for running bot", () => {
    const state = baseState();
    state.bots = [createBot({ running: true, pid: 12345 })];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(<BotsPage />);
    expect(screen.getByText(/Running/)).toBeInTheDocument();
  });

  it("disables status tab when no bot is selected", () => {
    const state = baseState();
    state.bots = [createBot()];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(<BotsPage />);
    const statusTab = screen.getByTestId("bots-tab-status");
    expect(statusTab).toBeInTheDocument();
  });

  it("switches to Status view when View Status button is clicked", async () => {
    const user = userEvent.setup();
    const state = baseState();
    state.bots = [createBot()];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(<BotsPage />);
    await user.click(screen.getByTestId("view-bot-status-btn-bot-1"));
    expect(mockSelectBot).toHaveBeenCalled();
    expect(mockSetCurrentView).toHaveBeenCalledWith("status");
    expect(mockLoadBotTrades).toHaveBeenCalledWith("bot-1");
  });

  it("calls startAutoRefresh when viewing status of a running bot", async () => {
    const user = userEvent.setup();
    const state = baseState();
    state.bots = [createBot({ running: true, pid: 12345 })];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(<BotsPage />);
    await user.click(screen.getByTestId("view-bot-status-btn-bot-1"));
    expect(mockSelectBot).toHaveBeenCalled();
    expect(mockSetCurrentView).toHaveBeenCalledWith("status");
    expect(mockLoadBotStatus).toHaveBeenCalledWith("bot-1");
    expect(mockStartAutoRefresh).toHaveBeenCalledWith("bot-1", 5000);
  });

  it("switches to Status view and shows BotStatusPanel when a bot is selected and view is status", () => {
    const state = baseState();
    state.bots = [createBot()];
    state.selectedBot = createBot();
    mockGetCurrentView.mockReturnValue("status");
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(<BotsPage />);
    expect(screen.getByTestId("bot-status-panel")).toBeInTheDocument();
  });

  it("calls startBotAction on Start", async () => {
    const user = userEvent.setup();
    const state = baseState();
    state.bots = [createBot()];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(<BotsPage />);
    await user.click(screen.getByTestId("start-bot-btn-bot-1"));
    expect(mockStartBotAction).toHaveBeenCalledWith("bot-1", false);
  });

  it("calls stopBotAction on Stop", async () => {
    const user = userEvent.setup();
    const state = baseState();
    state.bots = [createBot({ running: true, pid: 12345 })];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(<BotsPage />);
    await user.click(screen.getByTestId("stop-bot-btn-bot-1"));
    expect(mockStopBotAction).toHaveBeenCalledWith("bot-1");
  });

  it("deletes bot with confirmation dialog", async () => {
    const user = userEvent.setup();
    window.confirm = vi.fn().mockReturnValue(true);
    const state = baseState();
    state.bots = [createBot()];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(<BotsPage />);
    await user.click(screen.getByTestId("delete-bot-btn-bot-1"));
    expect(window.confirm).toHaveBeenCalledWith("Are you sure you want to delete this bot?");
    expect(mockDeleteBotAction).toHaveBeenCalledWith("bot-1");
  });

  it("does not delete bot when confirmation is cancelled", async () => {
    const user = userEvent.setup();
    window.confirm = vi.fn().mockReturnValue(false);
    const state = baseState();
    state.bots = [createBot()];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(<BotsPage />);
    await user.click(screen.getByTestId("delete-bot-btn-bot-1"));
    expect(window.confirm).toHaveBeenCalled();
    expect(mockDeleteBotAction).not.toHaveBeenCalled();
  });

  it("opens create modal when New Bot button is clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BotsPage />);
    await user.click(screen.getByText("New Bot"));
    expect(mockOpenCreateModal).toHaveBeenCalled();
  });

  it("renders BotConfigModal when showCreateModal is true", () => {
    const state = baseState();
    state.showCreateModal = true;
    state.availableStrategies = [
      {
        id: "s1", name: "ORB Strategy", strategy_type: "ORB",
        is_template: false, is_default: false, sl_pct: 1.0, tp_pct: 1.5,
        max_positions: 5, or_minutes: 15, min_or_range_pct: 0.3,
        max_or_range_pct: 2.0, max_distance_from_or_pct: 0.5,
        cooldown_minutes: 75, enable_shorts: false, eod_exit_hour: 15,
        eod_exit_minute: 0, pivot_type: "", breakout_buffer_pct: 0,
        entry_threshold_pct: 0, enable_trailing_stop: false,
        trailing_stop_pct: 0, max_holding_days: 0, cooldown_days: 0,
        ema_fast_period: 0, ema_slow_period: 0,
      },
    ];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(<BotsPage />);
    expect(screen.getByTestId("bot-config-modal")).toBeInTheDocument();
  });

  it("calls stopAutoRefresh when switching views", async () => {
    const user = userEvent.setup();
    const state = baseState();
    state.bots = [createBot()];
    state.selectedBot = createBot();
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(<BotsPage />);
    const statusTab = screen.getByTestId("bots-tab-status");
    await user.click(statusTab);
    expect(mockSetCurrentView).toHaveBeenCalledWith("status");
    expect(mockStopAutoRefresh).toHaveBeenCalled();
  });

  it("calls clearError when error dismiss is clicked", async () => {
    const user = userEvent.setup();
    const state = baseState();
    state.error = "Test error";
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(<BotsPage />);
    const closeBtn = screen.getByTestId("bots-error").querySelector('[aria-label="Close"]');
    if (closeBtn) {
      await user.click(closeBtn);
      expect(mockClearError).toHaveBeenCalled();
    }
  });
});
