import { describe, it, expect, vi } from "vitest";
import {
  getStrategiesState,
  getCurrentView,
  setCurrentView,
  subscribe,
  triggerRerender,
  openCreateModal,
  closeCreateModal,
  openEditModal,
  closeEditModal,
  clearError,
  selectStrategy,
  loadStrategies,
  createStrategy,
  updateStrategy,
  deleteStrategyAction,
} from "./strategies";
import {
  createMockStrategy,
  restoreSandbox,
  expectSubscribeReturnsUnsubscribe,
  expectTriggerRerenderNotifies,
} from "./stateTestFixtures";

vi.mock("../api/strategies", () => ({
  listStrategies: vi.fn(),
  listTemplates: vi.fn(),
  getStrategy: vi.fn(),
  createStrategy: vi.fn(),
  updateStrategy: vi.fn(),
  deleteStrategy: vi.fn(),
  getStrategyPerformance: vi.fn(),
  listBots: vi.fn(),
}));

describe("strategies state", () => {
  restoreSandbox();

  it("has correct initial state", () => {
    const state = getStrategiesState();
    expect(state.strategies).toEqual([]);
    expect(state.templates).toEqual([]);
    expect(state.selectedStrategy).toBeNull();
    expect(state.selectedVariations).toEqual([]);
    expect(state.performance).toBeNull();
    expect(state.allPerformance).toEqual([]);
    expect(state.bots).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.showCreateModal).toBe(false);
    expect(state.showEditModal).toBe(false);
    expect(state.editingStrategy).toBeNull();
    expect(state.parentTemplate).toBeNull();
  });
});

describe("view management", () => {
  restoreSandbox();

  it("initial view is 'templates'", () => {
    expect(getCurrentView()).toBe("tree");
  });

  it("setCurrentView updates view", () => {
    setCurrentView("list");
    expect(getCurrentView()).toBe("list");
  });

  it("notifies subscribers on view change", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);
    setCurrentView("performance");
    expect(cb).toHaveBeenCalled();
    unsub();
  });
});

describe("subscribe", () => {
  restoreSandbox();

  it("returns unsubscribe function", () => {
    expectSubscribeReturnsUnsubscribe(subscribe);
  });

  it("triggerRerender notifies all subscribers", () => {
    expectTriggerRerenderNotifies(subscribe, triggerRerender);
  });
});

describe("modal management", () => {
  restoreSandbox();

  it("openCreateModal sets showCreateModal true", () => {
    openCreateModal();
    const state = getStrategiesState();
    expect(state.showCreateModal).toBe(true);
    expect(state.showEditModal).toBe(false);
    expect(state.editingStrategy).toBeNull();
    expect(state.parentTemplate).toBeNull();
  });

  it("openCreateModal with template sets parentTemplate", () => {
    const template = createMockStrategy({ is_template: true });
    openCreateModal(template);
    expect(getStrategiesState().parentTemplate).toEqual(template);
  });

  it("closeCreateModal clears create state", () => {
    openCreateModal();
    closeCreateModal();
    const state = getStrategiesState();
    expect(state.showCreateModal).toBe(false);
    expect(state.parentTemplate).toBeNull();
  });

  it("openEditModal sets showEditModal and editingStrategy", () => {
    const strategy = createMockStrategy();
    openEditModal(strategy);
    const state = getStrategiesState();
    expect(state.showEditModal).toBe(true);
    expect(state.editingStrategy).toEqual(strategy);
    expect(state.showCreateModal).toBe(false);
    expect(state.parentTemplate).toBeNull();
  });

  it("closeEditModal clears edit state", () => {
    openEditModal(createMockStrategy());
    closeEditModal();
    const state = getStrategiesState();
    expect(state.showEditModal).toBe(false);
    expect(state.editingStrategy).toBeNull();
  });
});

describe("clearError", () => {
  restoreSandbox();

  it("clears error state", async () => {
    const api = await import("../api/strategies");
    vi.mocked(api.listStrategies).mockRejectedValue(new Error("fail"));
    await loadStrategies();
    expect(getStrategiesState().error).toBe("fail");

    clearError();
    expect(getStrategiesState().error).toBeNull();
  });
});

describe("selectStrategy", () => {
  restoreSandbox();

  it("selects a strategy and clears performance", async () => {
    const api = await import("../api/strategies");
    vi.mocked(api.getStrategyPerformance).mockResolvedValue({
      strategy_id: 1,
      strategy_name: "ORB Strategy",
      total_trades: 10,
      winners: 6,
      losers: 4,
      win_rate: 60,
      total_pnl: 5000,
      net_pnl: 4500,
    });

    const strategy = createMockStrategy();
    selectStrategy(strategy);
    const state = getStrategiesState();
    expect(state.selectedStrategy).toEqual(strategy);
    expect(state.performance).toBeNull();
  });

  it("selecting null clears selection", () => {
    selectStrategy(null);
    expect(getStrategiesState().selectedStrategy).toBeNull();
  });
});

describe("loadStrategies", () => {
  restoreSandbox();

  it("loads strategies successfully", async () => {
    const api = await import("../api/strategies");
    const strategies = [createMockStrategy()];
    vi.mocked(api.listStrategies).mockResolvedValue({ strategies, count: 1 });

    await loadStrategies();
    expect(getStrategiesState().strategies).toEqual(strategies);
    expect(getStrategiesState().error).toBeNull();
    expect(getStrategiesState().isLoading).toBe(false);
  });

  it("handles error", async () => {
    const api = await import("../api/strategies");
    vi.mocked(api.listStrategies).mockRejectedValue(new Error("Network error"));

    await loadStrategies();
    expect(getStrategiesState().error).toBe("Network error");
    expect(getStrategiesState().isLoading).toBe(false);
  });

  it("handles non-Error rejection", async () => {
    const api = await import("../api/strategies");
    vi.mocked(api.listStrategies).mockRejectedValue("string error");

    await loadStrategies();
    expect(getStrategiesState().error).toBe("Failed to load strategies");
  });
});

describe("createStrategy", () => {
  restoreSandbox();

  it("creates strategy and closes modal", async () => {
    const api = await import("../api/strategies");
    const newStrategy = createMockStrategy({ name: "New Strategy" });
    vi.mocked(api.createStrategy).mockResolvedValue({
      status: "ok",
      message: "created",
      strategy: newStrategy,
    });
    vi.mocked(api.listStrategies).mockResolvedValue({ strategies: [newStrategy], count: 1 });

    const result = await createStrategy({ name: "New Strategy", strategy_type: "orb" });
    expect(result).toEqual(newStrategy);
    expect(getStrategiesState().showCreateModal).toBe(false);
  });

  it("returns null on error", async () => {
    const api = await import("../api/strategies");
    vi.mocked(api.createStrategy).mockRejectedValue(new Error("create fail"));

    const result = await createStrategy({ name: "New Strategy", strategy_type: "orb" });
    expect(result).toBeNull();
    expect(getStrategiesState().error).toBe("create fail");
  });
});

describe("updateStrategy", () => {
  restoreSandbox();

  it("updates strategy and closes edit modal", async () => {
    const api = await import("../api/strategies");
    const updated = createMockStrategy({ name: "Updated" });
    vi.mocked(api.updateStrategy).mockResolvedValue({
      status: "ok",
      message: "updated",
      strategy: updated,
    });
    vi.mocked(api.listStrategies).mockResolvedValue({ strategies: [updated], count: 1 });

    const result = await updateStrategy(1, { name: "Updated" });
    expect(result).toEqual(updated);
    expect(getStrategiesState().showEditModal).toBe(false);
    expect(getStrategiesState().editingStrategy).toBeNull();
  });

  it("returns null on error", async () => {
    const api = await import("../api/strategies");
    vi.mocked(api.updateStrategy).mockRejectedValue(new Error("update fail"));

    const result = await updateStrategy(1, { name: "Updated" });
    expect(result).toBeNull();
    expect(getStrategiesState().error).toBe("update fail");
  });
});

describe("deleteStrategyAction", () => {
  restoreSandbox();

  it("deletes strategy and clears selection", async () => {
    const api = await import("../api/strategies");
    vi.mocked(api.deleteStrategy).mockResolvedValue({ status: "ok", message: "deleted" });
    vi.mocked(api.listStrategies).mockResolvedValue({ strategies: [], count: 0 });

    const result = await deleteStrategyAction(1);
    expect(result).toBe(true);
    expect(getStrategiesState().selectedStrategy).toBeNull();
  });

  it("returns false on error", async () => {
    const api = await import("../api/strategies");
    vi.mocked(api.deleteStrategy).mockRejectedValue(new Error("delete fail"));

    const result = await deleteStrategyAction(1);
    expect(result).toBe(false);
    expect(getStrategiesState().error).toBe("delete fail");
  });
});
