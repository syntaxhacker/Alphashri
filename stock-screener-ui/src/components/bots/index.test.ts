// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";

vi.mock("../../state/bots", () => ({
  getBotsState: vi.fn(),
  getCurrentView: vi.fn(),
  setCurrentView: vi.fn(),
  loadBots: vi.fn(),
  loadBotStatus: vi.fn(),
  loadBotTrades: vi.fn(),
  selectBot: vi.fn(),
  startAutoRefresh: vi.fn(),
  stopAutoRefresh: vi.fn(),
  openCreateModal: vi.fn(),
  openEditModal: vi.fn(),
  deleteBotAction: vi.fn(),
  startBotAction: vi.fn(),
  stopBotAction: vi.fn(),
  clearError: vi.fn(),
  initBotsState: vi.fn(),
}));

vi.mock("./config", () => ({
  renderBotConfigForm: vi.fn().mockReturnValue("<div>config-form</div>"),
  initConfigHandlers: vi.fn(),
}));

vi.mock("./status", () => ({
  renderBotStatusPanel: vi.fn().mockReturnValue("<div>status-panel</div>"),
  initStatusHandlers: vi.fn(),
}));

vi.mock("../../utils/loading", () => ({
  isLoading: vi.fn().mockReturnValue(false),
}));

import { renderBotsView, initBotsHandlers, cleanupBots } from "./index";
import * as botsState from "../../state/bots";

const createLoadingState = () =>
  ({
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
  }) as any;

describe("renderBotsView", () => {
  it("renders bots-view container", () => {
    vi.mocked(botsState.getBotsState).mockReturnValue({
      bots: [],
      selectedBot: null,
      botStatus: null,
      botTrades: [],
      availableStrategies: [],
      loading: createLoadingState(),
      error: null,
      showCreateModal: false,
      showEditModal: false,
      editingBot: null,
    });
    vi.mocked(botsState.getCurrentView).mockReturnValue("list");

    const html = renderBotsView();
    expect(html).toContain('data-testid="bots-view"');
  });

  it("renders list tab as active when view is list", () => {
    vi.mocked(botsState.getBotsState).mockReturnValue({
      bots: [],
      selectedBot: null,
      botStatus: null,
      botTrades: [],
      availableStrategies: [],
      loading: createLoadingState(),
      error: null,
      showCreateModal: false,
      showEditModal: false,
      editingBot: null,
    });
    vi.mocked(botsState.getCurrentView).mockReturnValue("list");

    const html = renderBotsView();
    expect(html).toContain('class="bots-tab active"');
    expect(html).toContain("Bots");
  });

  it("renders empty state when no bots", () => {
    vi.mocked(botsState.getBotsState).mockReturnValue({
      bots: [],
      selectedBot: null,
      botStatus: null,
      botTrades: [],
      availableStrategies: [],
      loading: createLoadingState(),
      error: null,
      showCreateModal: false,
      showEditModal: false,
      editingBot: null,
    });
    vi.mocked(botsState.getCurrentView).mockReturnValue("list");

    const html = renderBotsView();
    expect(html).toContain("No bots configured");
  });

  it("renders bot list with bots data", () => {
    vi.mocked(botsState.getBotsState).mockReturnValue({
      bots: [
        {
          id: "bot-1",
          name: "Test Bot",
          is_active: true,
          max_total_positions: 5,
          max_total_capital_pct: 0.5,
          strategies: [
            {
              id: "s1",
              name: "Strategy 1",
              strategy_type: "momentum",
              max_positions: 3,
              capital_allocation_pct: 0.5,
            },
          ],
          created_at: null,
          updated_at: null,
          running: false,
          pid: null,
        },
      ],
      selectedBot: null,
      botStatus: null,
      botTrades: [],
      availableStrategies: [],
      loading: createLoadingState(),
      error: null,
      showCreateModal: false,
      showEditModal: false,
      editingBot: null,
    });
    vi.mocked(botsState.getCurrentView).mockReturnValue("list");

    const html = renderBotsView();
    expect(html).toContain('data-testid="bots-list"');
    expect(html).toContain("Test Bot");
    expect(html).toContain('data-testid="bot-card"');
  });

  it("renders running status with PID when bot is running", () => {
    vi.mocked(botsState.getBotsState).mockReturnValue({
      bots: [
        {
          id: "bot-1",
          name: "Running Bot",
          is_active: true,
          max_total_positions: 5,
          max_total_capital_pct: 0.5,
          strategies: [],
          created_at: null,
          updated_at: null,
          running: true,
          pid: 12345,
        },
      ],
      selectedBot: null,
      botStatus: null,
      botTrades: [],
      availableStrategies: [],
      loading: createLoadingState(),
      error: null,
      showCreateModal: false,
      showEditModal: false,
      editingBot: null,
    });
    vi.mocked(botsState.getCurrentView).mockReturnValue("list");

    const html = renderBotsView();
    expect(html).toContain("Running (PID 12345)");
  });

  it("renders inactive badge when bot is not active", () => {
    vi.mocked(botsState.getBotsState).mockReturnValue({
      bots: [
        {
          id: "bot-1",
          name: "Inactive Bot",
          is_active: false,
          max_total_positions: 5,
          max_total_capital_pct: 0.5,
          strategies: [],
          created_at: null,
          updated_at: null,
          running: false,
          pid: null,
        },
      ],
      selectedBot: null,
      botStatus: null,
      botTrades: [],
      availableStrategies: [],
      loading: createLoadingState(),
      error: null,
      showCreateModal: false,
      showEditModal: false,
      editingBot: null,
    });
    vi.mocked(botsState.getCurrentView).mockReturnValue("list");

    const html = renderBotsView();
    expect(html).toContain("Inactive");
  });

  it("renders error when present", () => {
    vi.mocked(botsState.getBotsState).mockReturnValue({
      bots: [],
      selectedBot: null,
      botStatus: null,
      botTrades: [],
      availableStrategies: [],
      loading: createLoadingState(),
      error: "Something went wrong",
      showCreateModal: false,
      showEditModal: false,
      editingBot: null,
    });
    vi.mocked(botsState.getCurrentView).mockReturnValue("list");

    const html = renderBotsView();
    expect(html).toContain('data-testid="bots-error"');
    expect(html).toContain("Something went wrong");
  });

  it("renders create modal when showCreateModal is true", () => {
    vi.mocked(botsState.getBotsState).mockReturnValue({
      bots: [],
      selectedBot: null,
      botStatus: null,
      botTrades: [],
      availableStrategies: [],
      loading: createLoadingState(),
      error: null,
      showCreateModal: true,
      showEditModal: false,
      editingBot: null,
    });
    vi.mocked(botsState.getCurrentView).mockReturnValue("list");

    const html = renderBotsView();
    expect(html).toContain("config-form");
  });

  it("disables status tab when no bot is selected", () => {
    vi.mocked(botsState.getBotsState).mockReturnValue({
      bots: [],
      selectedBot: null,
      botStatus: null,
      botTrades: [],
      availableStrategies: [],
      loading: createLoadingState(),
      error: null,
      showCreateModal: false,
      showEditModal: false,
      editingBot: null,
    });
    vi.mocked(botsState.getCurrentView).mockReturnValue("list");

    const html = renderBotsView();
    expect(html).toContain('data-testid="bots-tab-status"');
    expect(html).toContain("disabled");
  });

  it("renders strategy allocations for selected bot", () => {
    vi.mocked(botsState.getBotsState).mockReturnValue({
      bots: [
        {
          id: "bot-1",
          name: "Alloc Bot",
          is_active: true,
          max_total_positions: 10,
          max_total_capital_pct: 1.0,
          strategies: [
            {
              id: "s1",
              name: "Momentum",
              strategy_type: "momentum",
              max_positions: 5,
              capital_allocation_pct: 0.6,
            },
            {
              id: "s2",
              name: "Mean Revert",
              strategy_type: "mean_revert",
              max_positions: 3,
              capital_allocation_pct: 0.4,
            },
          ],
          created_at: null,
          updated_at: null,
          running: false,
          pid: null,
        },
      ],
      selectedBot: {
        id: "bot-1",
        name: "Alloc Bot",
        is_active: true,
        max_total_positions: 10,
        max_total_capital_pct: 1.0,
        strategies: [
          {
            id: "s1",
            name: "Momentum",
            strategy_type: "momentum",
            max_positions: 5,
            capital_allocation_pct: 0.6,
          },
          {
            id: "s2",
            name: "Mean Revert",
            strategy_type: "mean_revert",
            max_positions: 3,
            capital_allocation_pct: 0.4,
          },
        ],
        created_at: null,
        updated_at: null,
        running: false,
        pid: null,
      },
      botStatus: null,
      botTrades: [],
      availableStrategies: [],
      loading: createLoadingState(),
      error: null,
      showCreateModal: false,
      showEditModal: false,
      editingBot: null,
    });
    vi.mocked(botsState.getCurrentView).mockReturnValue("list");

    const html = renderBotsView();
    expect(html).toContain("Momentum");
    expect(html).toContain("60%");
    expect(html).toContain("Mean Revert");
    expect(html).toContain("40%");
    expect(html).toContain("Total: 100%");
  });

  it("renders warning when allocation exceeds 100%", () => {
    vi.mocked(botsState.getBotsState).mockReturnValue({
      bots: [
        {
          id: "bot-1",
          name: "Over Bot",
          is_active: true,
          max_total_positions: 10,
          max_total_capital_pct: 1.0,
          strategies: [
            {
              id: "s1",
              name: "Strat1",
              strategy_type: "t",
              max_positions: 5,
              capital_allocation_pct: 0.6,
            },
            {
              id: "s2",
              name: "Strat2",
              strategy_type: "t",
              max_positions: 5,
              capital_allocation_pct: 0.6,
            },
          ],
          created_at: null,
          updated_at: null,
          running: false,
          pid: null,
        },
      ],
      selectedBot: {
        id: "bot-1",
        name: "Over Bot",
        is_active: true,
        max_total_positions: 10,
        max_total_capital_pct: 1.0,
        strategies: [
          {
            id: "s1",
            name: "Strat1",
            strategy_type: "t",
            max_positions: 5,
            capital_allocation_pct: 0.6,
          },
          {
            id: "s2",
            name: "Strat2",
            strategy_type: "t",
            max_positions: 5,
            capital_allocation_pct: 0.6,
          },
        ],
        created_at: null,
        updated_at: null,
        running: false,
        pid: null,
      },
      botStatus: null,
      botTrades: [],
      availableStrategies: [],
      loading: createLoadingState(),
      error: null,
      showCreateModal: false,
      showEditModal: false,
      editingBot: null,
    });
    vi.mocked(botsState.getCurrentView).mockReturnValue("list");

    const html = renderBotsView();
    expect(html).toContain("Over 100%");
  });
});

describe("initBotsHandlers", () => {
  it("attaches handlers to window", () => {
    initBotsHandlers();

    expect(typeof (window as any).setBotsView).toBe("function");
    expect(typeof (window as any).clearBotError).toBe("function");
    expect(typeof (window as any).viewBotStatus).toBe("function");
    expect(typeof (window as any).startBot).toBe("function");
    expect(typeof (window as any).stopBot).toBe("function");
    expect(typeof (window as any).editBot).toBe("function");
    expect(typeof (window as any).deleteBot).toBe("function");
    expect(typeof (window as any).openCreateBotModal).toBe("function");
  });

  it("calls initBotsState", () => {
    initBotsHandlers();
    expect(botsState.initBotsState).toHaveBeenCalled();
  });
});

describe("cleanupBots", () => {
  it("calls stopAutoRefresh", () => {
    cleanupBots();
    expect(botsState.stopAutoRefresh).toHaveBeenCalled();
  });
});
