import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getBotsState,
  getCurrentView,
  setCurrentView,
  subscribe,
  triggerRerender,
  clearError,
  selectBot,
  openCreateModal,
  closeCreateModal,
  openEditModal,
  closeEditModal,
  loadBots,
  loadBotStatus,
  loadBotTrades,
  createBotAction,
  updateBotAction,
  deleteBotAction,
  startBotAction,
  stopBotAction,
  startAutoRefresh,
  stopAutoRefresh,
} from "./bots";
import type { BotConfig, BotsState } from "../types/bots";

vi.mock("../api/bots", () => ({
  listBots: vi.fn(),
  getBot: vi.fn(),
  getBotStatus: vi.fn(),
  getBotTrades: vi.fn(),
  listAvailableStrategies: vi.fn(),
  createBot: vi.fn(),
  updateBot: vi.fn(),
  deleteBot: vi.fn(),
  getBotTradeCount: vi.fn(),
  startBot: vi.fn(),
  stopBot: vi.fn(),
}));

vi.mock("../utils/loading", () => ({
  createLoadingState: (keys: string[]) => {
    const obj: Record<string, boolean> = {};
    for (const k of keys) obj[k] = false;
    return obj;
  },
  setLoading: (state: Record<string, boolean>, key: string, loading: boolean) => ({
    ...state,
    [key]: loading,
  }),
}));

function createMockBot(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    id: "bot-uuid-1",
    name: "Test Bot",
    is_active: true,
    max_total_positions: 10,
    max_total_capital_pct: 80,
    strategies: [],
    created_at: null,
    updated_at: null,
    running: false,
    pid: null,
    ...overrides,
  };
}

describe("bots state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stopAutoRefresh();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("has correct initial state", () => {
    const state = getBotsState();
    expect(state.bots).toEqual([]);
    expect(state.selectedBot).toBeNull();
    expect(state.botStatus).toBeNull();
    expect(state.botTrades).toEqual([]);
    expect(state.availableStrategies).toEqual([]);
    expect(state.error).toBeNull();
    expect(state.showCreateModal).toBe(false);
    expect(state.showEditModal).toBe(false);
    expect(state.editingBot).toBeNull();
    expect(state.loading).toBeDefined();
  });

  it("all loading keys default to false", () => {
    const state = getBotsState();
    const keys: Array<keyof BotsState["loading"]> = [
      "list", "load", "status", "strategies", "create", "update", "delete", "start", "stop", "trades",
    ];
    for (const key of keys) {
      expect(state.loading[key]).toBe(false);
    }
  });
});

describe("view management", () => {
  beforeEach(() => { vi.useFakeTimers(); stopAutoRefresh(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("initial view is 'list'", () => {
    expect(getCurrentView()).toBe("list");
  });

  it("setCurrentView updates view", () => {
    setCurrentView("status");
    expect(getCurrentView()).toBe("status");
  });

  it("notifies subscribers on view change", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);
    setCurrentView("status");
    expect(cb).toHaveBeenCalled();
    unsub();
  });
});

describe("subscribe", () => {
  beforeEach(() => { vi.useFakeTimers(); stopAutoRefresh(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("returns unsubscribe function", () => {
    const unsub = subscribe(vi.fn());
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("triggerRerender notifies all subscribers", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);
    triggerRerender();
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
  });
});

describe("modal management", () => {
  beforeEach(() => { vi.useFakeTimers(); stopAutoRefresh(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("openCreateModal sets showCreateModal true", async () => {
    const api = await import("../api/bots");
    vi.mocked(api.listAvailableStrategies).mockResolvedValue([]);
    openCreateModal();
    const state = getBotsState();
    expect(state.showCreateModal).toBe(true);
    expect(state.showEditModal).toBe(false);
    expect(state.editingBot).toBeNull();
  });

  it("closeCreateModal sets showCreateModal false", async () => {
    const api = await import("../api/bots");
    vi.mocked(api.listAvailableStrategies).mockResolvedValue([]);
    openCreateModal();
    closeCreateModal();
    expect(getBotsState().showCreateModal).toBe(false);
  });

  it("openEditModal sets showEditModal true and editingBot", async () => {
    const api = await import("../api/bots");
    vi.mocked(api.listAvailableStrategies).mockResolvedValue([]);
    const bot = createMockBot();
    openEditModal(bot);
    const state = getBotsState();
    expect(state.showEditModal).toBe(true);
    expect(state.editingBot).toEqual(bot);
    expect(state.showCreateModal).toBe(false);
  });

  it("closeEditModal clears edit state", async () => {
    const api = await import("../api/bots");
    vi.mocked(api.listAvailableStrategies).mockResolvedValue([]);
    openEditModal(createMockBot());
    closeEditModal();
    const state = getBotsState();
    expect(state.showEditModal).toBe(false);
    expect(state.editingBot).toBeNull();
  });
});

describe("selectBot", () => {
  beforeEach(() => { vi.useFakeTimers(); stopAutoRefresh(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("selects a bot and clears status/trades", () => {
    const bot = createMockBot({ running: false });
    selectBot(bot);
    const state = getBotsState();
    expect(state.selectedBot).toEqual(bot);
    expect(state.botStatus).toBeNull();
    expect(state.botTrades).toEqual([]);
  });

  it("selecting null clears selection", () => {
    selectBot(createMockBot({ running: false }));
    selectBot(null);
    expect(getBotsState().selectedBot).toBeNull();
  });
});

describe("clearError", () => {
  beforeEach(() => { vi.useFakeTimers(); stopAutoRefresh(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("clears error state", async () => {
    const api = await import("../api/bots");
    vi.mocked(api.listBots).mockRejectedValue(new Error("fail"));
    await loadBots();
    expect(getBotsState().error).toBe("fail");

    clearError();
    expect(getBotsState().error).toBeNull();
  });
});

describe("loadBots", () => {
  beforeEach(() => { vi.useFakeTimers(); stopAutoRefresh(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("loads bots successfully", async () => {
    const api = await import("../api/bots");
    const bots = [createMockBot()];
    vi.mocked(api.listBots).mockResolvedValue(bots);

    await loadBots();
    expect(getBotsState().bots).toEqual(bots);
    expect(getBotsState().error).toBeNull();
    expect(getBotsState().loading.list).toBe(false);
  });

  it("handles error", async () => {
    const api = await import("../api/bots");
    vi.mocked(api.listBots).mockRejectedValue(new Error("Network error"));

    await loadBots();
    expect(getBotsState().error).toBe("Network error");
    expect(getBotsState().loading.list).toBe(false);
  });

  it("handles non-Error rejection", async () => {
    const api = await import("../api/bots");
    vi.mocked(api.listBots).mockRejectedValue("string error");

    await loadBots();
    expect(getBotsState().error).toBe("Failed to load bots");
  });
});

describe("createBotAction", () => {
  beforeEach(() => { vi.useFakeTimers(); stopAutoRefresh(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("creates bot and closes modal", async () => {
    const api = await import("../api/bots");
    const newBot = createMockBot({ name: "New Bot" });
    vi.mocked(api.createBot).mockResolvedValue(newBot);
    vi.mocked(api.listBots).mockResolvedValue([newBot]);

    const result = await createBotAction({ name: "New Bot", strategies: [] });
    expect(result).toEqual(newBot);
    expect(getBotsState().showCreateModal).toBe(false);
  });

  it("returns null on error", async () => {
    const api = await import("../api/bots");
    vi.mocked(api.createBot).mockRejectedValue(new Error("create fail"));

    const result = await createBotAction({ name: "New Bot", strategies: [] });
    expect(result).toBeNull();
    expect(getBotsState().error).toBe("create fail");
  });
});

describe("deleteBotAction", () => {
  beforeEach(() => { vi.useFakeTimers(); stopAutoRefresh(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("prevents delete when trades exist", async () => {
    const api = await import("../api/bots");
    vi.mocked(api.getBotTradeCount).mockResolvedValue({ count: 5 });
    vi.mocked(api.deleteBot).mockResolvedValue({ message: "deleted" });
    vi.mocked(api.listBots).mockResolvedValue([]);

    const result = await deleteBotAction("bot-1");
    expect(result).toBe(false);
    expect(getBotsState().error).toContain("5 trade(s) exist");
    expect(api.deleteBot).not.toHaveBeenCalled();
  });

  it("deletes bot when no trades exist", async () => {
    const api = await import("../api/bots");
    vi.mocked(api.getBotTradeCount).mockResolvedValue({ count: 0 });
    vi.mocked(api.deleteBot).mockResolvedValue({ message: "deleted" });
    vi.mocked(api.listBots).mockResolvedValue([]);

    const result = await deleteBotAction("bot-1");
    expect(result).toBe(true);
    expect(api.deleteBot).toHaveBeenCalledWith("bot-1");
  });
});

describe("startBotAction / stopBotAction", () => {
  beforeEach(() => { vi.useFakeTimers(); stopAutoRefresh(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("starts bot successfully", async () => {
    const api = await import("../api/bots");
    vi.mocked(api.startBot).mockResolvedValue({ message: "started", pid: 123, log_file: "/log" });
    vi.mocked(api.listBots).mockResolvedValue([]);

    const result = await startBotAction("bot-1");
    expect(result).toBe(true);
  });

  it("stops bot successfully", async () => {
    const api = await import("../api/bots");
    vi.mocked(api.stopBot).mockResolvedValue({ message: "stopped" });
    vi.mocked(api.listBots).mockResolvedValue([]);

    const result = await stopBotAction("bot-1");
    expect(result).toBe(true);
  });

  it("handles start error", async () => {
    const api = await import("../api/bots");
    vi.mocked(api.startBot).mockRejectedValue(new Error("start fail"));

    const result = await startBotAction("bot-1");
    expect(result).toBe(false);
    expect(getBotsState().error).toBe("start fail");
  });
});

describe("startAutoRefresh / stopAutoRefresh", () => {
  beforeEach(() => { vi.useFakeTimers(); stopAutoRefresh(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); stopAutoRefresh(); });

  it("startAutoRefresh sets up interval", async () => {
    const api = await import("../api/bots");
    vi.mocked(api.getBotStatus).mockResolvedValue({ running: true } as any);

    startAutoRefresh("bot-1", 1000);
    vi.advanceTimersByTime(1500);
    expect(api.getBotStatus).toHaveBeenCalledWith("bot-1");
  });

  it("stopAutoRefresh clears interval", async () => {
    const api = await import("../api/bots");
    const spy = vi.fn().mockResolvedValue({ running: true } as any);
    vi.mocked(api.getBotStatus).mockImplementation(spy);

    stopAutoRefresh();
    startAutoRefresh("bot-1", 1000);
    stopAutoRefresh();
    vi.advanceTimersByTime(10000);
    expect(spy).toHaveBeenCalledTimes(0);
  });
});
