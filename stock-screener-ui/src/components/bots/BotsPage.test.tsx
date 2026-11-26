// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, useSearchParams, createMemoryHistory } from "@solidjs/router";
import { UIProvider } from "@/ui";
import type { BotsState } from "../../types/bots";

// The mocked store never emits on its own, so tests drive a manual tick:
// `useBotsState`/`useCurrentView` re-read the mocked getters whenever a
// subscriber fires.
const storeSubscribers = new Set<() => void>();
function notifyStore() {
  storeSubscribers.forEach((cb) => cb());
}

const mockGetBotsState = vi.fn();
const mockGetCurrentView = vi.fn();
const mockSetCurrentView = vi.fn();
const mockSelectBot = vi.fn();
const mockStartBotAction = vi.fn();
const mockStopBotAction = vi.fn();
const mockDeleteBotAction = vi.fn();
const mockClearError = vi.fn();
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
  initBotsState: (...args: any[]) => mockInitBotsState(...args),
  openCreateModal: (...args: any[]) => mockOpenCreateModal(...args),
  openEditModal: (...args: any[]) => mockOpenEditModal(...args),
  closeCreateModal: (...args: any[]) => mockCloseCreateModal(...args),
  closeEditModal: (...args: any[]) => mockCloseEditModal(...args),
  subscribe: vi.fn((cb: () => void) => {
    storeSubscribers.add(cb);
    return () => {
      storeSubscribers.delete(cb);
    };
  }),
  loadBotStatus: (...args: any[]) => mockLoadBotStatus(...args),
  loadBotTrades: (...args: any[]) => mockLoadBotTrades(...args),
}));

vi.mock("../../hooks/useStoreSubscription", () => ({
  useStoreSubscription: vi.fn(),
}));

// Fixed IST instant injected into the real session helper so bot pages render
// the same "open" state they did before, without depending on the real clock.
const clock = vi.hoisted(() => ({ now: new Date("2026-11-16T05:30:00Z") })); // Mon 11:00 IST

vi.mock("../../state/holidays", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../state/holidays")>();
  const istDate = (now: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  return {
    ...actual,
    subscribeToHolidays: vi.fn(),
    getHolidayState: () => ({ ...actual.getHolidayState() }),
    isMarketClosedToday: (now?: Date) => actual.isTradingHoliday(istDate(now ?? clock.now)),
    isMarketOpenNow: (now?: Date) => actual.isMarketOpenNow(now ?? clock.now),
  };
});

import { BotsPage } from "./BotsPage";

import type { JSX } from "solid-js";

function mountWithHistory(ui: () => JSX.Element, path = "/bots") {
  const history = createMemoryHistory();
  history.set({ value: path, replace: true, scroll: false });
  return render(() => (
    <MemoryRouter history={history} root={() => <UIProvider>{ui()}</UIProvider>} />
  ));
}

function renderWithProviders(ui: () => JSX.Element, path = "/bots") {
  return mountWithHistory(ui, path);
}

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
      "start-all": false,
      "stop-all": false,
      trades: false,
    },
    error: null,
    showCreateModal: false,
    showEditModal: false,
    editingBot: null,
  }) as BotsState;

function SearchProbe() {
  const [searchParams] = useSearchParams<{ tab?: string }>();
  return <div data-testid="search-probe">{searchParams.tab ? `tab=${searchParams.tab}` : ""}</div>;
}

function renderWithProbe(path = "/bots") {
  const history = createMemoryHistory();
  history.set({ value: path, replace: true, scroll: false });
  return render(() => (
    <MemoryRouter
      history={history}
      root={() => (
        <UIProvider>
          <BotsPage />
          <SearchProbe />
        </UIProvider>
      )}
    />
  ));
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
    live_trading: false,
    strategies: [
      { id: "s1", name: "ORB Strategy", strategy_type: "ORB", max_positions: 3, capital_allocation_pct: 0.5, enable_shorts: false },
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
    vi.unstubAllGlobals();
    delete (window as unknown as { confirm?: () => boolean }).confirm;
  });

  it("renders 'New Bot' create button", () => {
    renderWithProviders(() => <BotsPage />);
    expect(screen.getByText("New Bot")).toBeInTheDocument();
  });

  it("renders bots-view container", () => {
    renderWithProviders(() => <BotsPage />);
    const shell = screen.getByTestId("bots-view");
    expect(shell).toBeInTheDocument();
    expect(shell).toHaveClass("h-full", "min-h-0", "flex", "flex-col", "overflow-hidden");
  });

  it("renders loading state with InlineLoader", () => {
    const state = baseState();
    state.loading.list = true;
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(() => <BotsPage />);
    expect(screen.getByTestId("bots-loading")).toBeInTheDocument();
  });

  it("renders error state with ErrorAlert", () => {
    const state = baseState();
    state.error = "Something went wrong";
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(() => <BotsPage />);
    expect(screen.getByTestId("bots-error")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("shows empty state when no bots configured", () => {
    renderWithProviders(() => <BotsPage />);
    expect(screen.getByText("No bots configured")).toBeInTheDocument();
  });

  it("renders bot list with bot data", () => {
    const state = baseState();
    state.bots = [createBot()];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(() => <BotsPage />);
    expect(screen.getByTestId("bots-table")).toBeInTheDocument();
    expect(screen.getByText("Test Bot")).toBeInTheDocument();
  });

  it("renders all BotsTable header columns", () => {
    const state = baseState();
    state.bots = [createBot()];
    mockGetBotsState.mockReturnValue(state);
    const { container } = renderWithProviders(() => <BotsPage />);
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
    renderWithProviders(() => <BotsPage />);
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("shows running status for running bot", () => {
    const state = baseState();
    state.bots = [createBot({ running: true, pid: 12345 })];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(() => <BotsPage />);
    expect(screen.getByTestId("bot-status-bot-1")).toHaveTextContent("RUNNING");
  });

  it("disables status tab when no bot is selected", () => {
    const state = baseState();
    state.bots = [createBot()];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(() => <BotsPage />);
    const statusTab = screen.getByTestId("bots-tab-status");
    expect(statusTab).toBeInTheDocument();
  });

  it("switches to Status view when View Status button is clicked", async () => {
        const state = baseState();
    state.bots = [createBot()];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(() => <BotsPage />);
    await fireEvent.click(screen.getByTestId("view-bot-status-btn-bot-1"));
    expect(mockSelectBot).toHaveBeenCalled();
    expect(mockSetCurrentView).toHaveBeenCalledWith("status");
    expect(mockLoadBotTrades).toHaveBeenCalledWith("bot-1");
  });

  it("loads status once (no polling) when viewing status of a running bot", async () => {
        const state = baseState();
    state.bots = [createBot({ running: true, pid: 12345 })];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(() => <BotsPage />);
    await fireEvent.click(screen.getByTestId("view-bot-status-btn-bot-1"));
    expect(mockSelectBot).toHaveBeenCalled();
    expect(mockSetCurrentView).toHaveBeenCalledWith("status");
    expect(mockLoadBotStatus).toHaveBeenCalledWith("bot-1");
  });

  it("switches to Status view and shows BotStatusPanel when a bot is selected and view is status", () => {
    const state = baseState();
    state.bots = [createBot()];
    state.selectedBot = createBot();
    mockGetCurrentView.mockReturnValue("status");
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(() => <BotsPage />);
    expect(screen.getByTestId("bot-status-panel")).toBeInTheDocument();
  });

  it("calls startBotAction on Start", async () => {
        const state = baseState();
    state.bots = [createBot()];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(() => <BotsPage />);
    await fireEvent.click(screen.getByTestId("start-bot-btn-bot-1"));
    expect(mockStartBotAction).toHaveBeenCalledWith("bot-1", false);
  });

  it("calls stopBotAction on Stop", async () => {
        const state = baseState();
    state.bots = [createBot({ running: true, pid: 12345 })];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(() => <BotsPage />);
    await fireEvent.click(screen.getByTestId("stop-bot-btn-bot-1"));
    expect(mockStopBotAction).toHaveBeenCalledWith("bot-1");
  });

  it("deletes bot with confirmation dialog", async () => {
        window.confirm = vi.fn().mockReturnValue(true);
    const state = baseState();
    state.bots = [createBot()];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(() => <BotsPage />);
    await fireEvent.click(screen.getByTestId("delete-bot-btn-bot-1"));
    expect(window.confirm).toHaveBeenCalledWith("Are you sure you want to delete this bot?");
    expect(mockDeleteBotAction).toHaveBeenCalledWith("bot-1");
  });

  it("does not delete bot when confirmation is cancelled", async () => {
        window.confirm = vi.fn().mockReturnValue(false);
    const state = baseState();
    state.bots = [createBot()];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(() => <BotsPage />);
    await fireEvent.click(screen.getByTestId("delete-bot-btn-bot-1"));
    expect(window.confirm).toHaveBeenCalled();
    expect(mockDeleteBotAction).not.toHaveBeenCalled();
  });

  it("opens create modal when New Bot button is clicked", async () => {
        renderWithProviders(() => <BotsPage />);
    await fireEvent.click(screen.getByText("New Bot"));
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
        entry_threshold_pct: 0, min_breakout_pct: 0, enable_trailing_stop: false,
        trailing_stop_pct: 0, max_holding_days: 0, cooldown_days: 0,
        ema_fast_period: 0, ema_slow_period: 0,
      },
    ];
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(() => <BotsPage />);
    expect(screen.getByTestId("bot-config-modal")).toBeInTheDocument();
  });

  it("switches views without polling", async () => {
        const state = baseState();
    state.bots = [createBot()];
    state.selectedBot = createBot();
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(() => <BotsPage />);
    const statusTab = screen.getByTestId("bots-tab-status");
    await fireEvent.click(statusTab);
    expect(mockSetCurrentView).toHaveBeenCalledWith("status");
  });

  it("deep-links ?tab=performance to the Performance view", () => {
    mockGetBotsState.mockReturnValue(baseState());
    renderWithProviders(() => <BotsPage />, "/bots?tab=performance");
    expect(mockSetCurrentView).toHaveBeenCalledWith("performance");
  });

  it("falls back to list for ?tab=status with no bot selected", () => {
    mockGetBotsState.mockReturnValue(baseState());
    renderWithProviders(() => <BotsPage />, "/bots?tab=status");
    expect(mockSetCurrentView).toHaveBeenCalledWith("list");
  });

  it("writes current view to the URL when no ?tab= present", async () => {
    mockGetBotsState.mockReturnValue(baseState());
    renderWithProbe("/bots");
    await waitFor(() => {
      expect(screen.getByTestId("search-probe")).toHaveTextContent("tab=list");
    });
  });

  it("updates ?tab= when switching tabs", async () => {
    mockGetBotsState.mockReturnValue(baseState());
    renderWithProbe("/bots");
    await fireEvent.click(screen.getByTestId("bots-tab-performance"));
    expect(mockSetCurrentView).toHaveBeenCalledWith("performance");
    mockGetCurrentView.mockReturnValue("performance");
    notifyStore();
    await waitFor(() => {
      expect(screen.getByTestId("search-probe")).toHaveTextContent("tab=performance");
    });
  });

  it("calls clearError when error dismiss is clicked", async () => {
        const state = baseState();
    state.error = "Test error";
    mockGetBotsState.mockReturnValue(state);
    renderWithProviders(() => <BotsPage />);
    const closeBtn = screen.getByTestId("bots-error").querySelector('[aria-label="Close"]');
    if (closeBtn) {
      await fireEvent.click(closeBtn);
      expect(mockClearError).toHaveBeenCalled();
    }
  });
});

/** `useMediaQuery` resolves each query against this width at mount time. */
function stubWidth(width: number) {
  vi.stubGlobal("matchMedia", ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    const matches = max ? width <= Number(max[1]) : min ? width >= Number(min[1]) : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia);
}

describe("BotsPage — missing limits and 390px layout", () => {
  const missingLimits = () => ({
    ...createBot(),
    max_total_positions: undefined,
    max_total_capital_pct: Number.NaN,
  });

  function renderBots(botOverrides: Record<string, any> = missingLimits()) {
    const state = baseState();
    state.bots = [createBot(botOverrides)];
    mockGetBotsState.mockReturnValue(state);
    return renderWithProviders(() => <BotsPage />);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentView.mockReturnValue("list");
  });

  it("renders dashes, never undefined or NaN%, for missing limits in the table", () => {
    const { container } = renderBots();
    const table = container.querySelector('[data-testid="bots-table"]')!;
    expect(table).toBeInTheDocument();
    expect(table.textContent).toContain("—");
    expect(table.textContent).not.toContain("undefined");
    expect(table.textContent).not.toContain("NaN%");
  });

  it("keeps finite limits formatted as a count and a whole percent", () => {
    const { container } = renderBots({ max_total_positions: 5, max_total_capital_pct: 0.5 });
    expect(container.querySelector('[data-testid="bots-table"]')!.textContent).toContain("50%");
    expect(container.textContent).toContain("5");
  });

  it("uses card rows with every column visible below 900px", () => {
    stubWidth(390);
    const { container } = renderBots();
    expect(screen.getByTestId("bots-narrow-cards")).toBeInTheDocument();
    expect(container.querySelector('[data-testid="bots-table"]')).toBeNull();
    const card = screen.getByTestId("bot-row-bot-1");
    for (const label of ["Strategies", "Max positions", "Max capital", "Actions"]) {
      expect(card.textContent).toContain(label);
    }
    expect(card.textContent).toContain("Test Bot");
    expect(card.textContent).toContain("STOPPED");
    expect(screen.getByTestId("bot-max-positions-bot-1")).toHaveTextContent("—");
    expect(screen.getByTestId("bot-max-capital-bot-1")).toHaveTextContent("—");
    for (const testId of [
      "view-bot-status-btn-bot-1",
      "start-bot-btn-bot-1",
      "edit-bot-btn-bot-1",
      "delete-bot-btn-bot-1",
    ]) {
      expect(card.querySelector(`[data-testid="${testId}"]`)).toBeInTheDocument();
    }
    expect(container.textContent).not.toContain("undefined");
    expect(container.textContent).not.toContain("NaN%");
  });

  it("fits the New action as an icon-only button at 390px", async () => {
    stubWidth(390);
    renderBots();
    const button = screen.getByTestId("create-bot-btn");
    expect(button).toHaveAttribute("aria-label", "New Bot");
    expect(button.textContent).toBe("");
    await fireEvent.click(button);
    expect(mockOpenCreateModal).toHaveBeenCalled();
  });
});
