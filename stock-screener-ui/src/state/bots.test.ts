import { describe, it, expect, vi } from "vitest";
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
  createBotAction,
  deleteBotAction,
  startBotAction,
  stopBotAction,
} from "./bots";
import type { BotsState } from "../types/bots";
import {
  createMockBot,
  fakeTimersSandbox,
  expectSubscribeReturnsUnsubscribe,
  expectTriggerRerenderNotifies,
} from "./stateTestFixtures";

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

describe("bots state", () => {
  fakeTimersSandbox();

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
  });

  it("all loading keys default to false", () => {
    const state = getBotsState();
    const keys: Array<keyof BotsState["loading"]> = [
      "list",
      "load",
      "status",
      "strategies",
      "create",
      "update",
      "delete",
      "start",
      "stop",
      "trades",
    ];
    for (const key of keys) {
      expect(state.loading[key]).toBe(false);
    }
  });
});

describe("view management", () => {
  fakeTimersSandbox();

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
  fakeTimersSandbox();

  it("returns unsubscribe function", () => {
    expectSubscribeReturnsUnsubscribe(subscribe);
  });

  it("triggerRerender notifies all subscribers", () => {
    expectTriggerRerenderNotifies(subscribe, triggerRerender);
  });
});

describe("modal management", () => {
  fakeTimersSandbox();

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
  fakeTimersSandbox();

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
  fakeTimersSandbox();

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
  fakeTimersSandbox();

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
  fakeTimersSandbox();

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

// API preamble shared by the deleteBotAction scenarios.
const mockDeleteApis = async (count: number) => {
  const api = await import("../api/bots");
  vi.mocked(api.getBotTradeCount).mockResolvedValue({ count });
  vi.mocked(api.deleteBot).mockResolvedValue({ message: "deleted" });
  vi.mocked(api.listBots).mockResolvedValue([]);
  return api;
};

describe("deleteBotAction", () => {
  fakeTimersSandbox();

  it("prevents delete when trades exist", async () => {
    const api = await mockDeleteApis(5);

    const result = await deleteBotAction("bot-1");
    expect(result).toBe(false);
    expect(getBotsState().error).toContain("5 trade(s) exist");
    expect(api.deleteBot).not.toHaveBeenCalled();
  });

  it("deletes bot when no trades exist", async () => {
    const api = await mockDeleteApis(0);

    const result = await deleteBotAction("bot-1");
    expect(result).toBe(true);
    expect(api.deleteBot).toHaveBeenCalledWith("bot-1");
  });
});

describe("startBotAction / stopBotAction", () => {
  fakeTimersSandbox();

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
