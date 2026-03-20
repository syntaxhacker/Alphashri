import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./utils", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  buildUrl: vi.fn((endpoint: string, params?: Record<string, string>) => {
    if (!params || Object.keys(params).length === 0) {
      return `http://localhost:8765${endpoint}`;
    }
    const qs = new URLSearchParams(params).toString();
    return `http://localhost:8765${endpoint}?${qs}`;
  }),
}));

import { apiGet, apiPost, apiPut, apiDelete } from "./utils";
import {
  listStrategies,
  listTemplates,
  getStrategy,
  createStrategy,
  updateStrategy,
  deleteStrategy,
  getStrategyPerformance,
  getStrategyTrades,
  getStrategyVariations,
  listBots,
  getBot,
} from "./strategies";

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPost = vi.mocked(apiPost);
const mockedApiPut = vi.mocked(apiPut);
const mockedApiDelete = vi.mocked(apiDelete);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listStrategies", () => {
  it("calls apiGet with base endpoint and no params by default", async () => {
    mockedApiGet.mockResolvedValue({ strategies: [], count: 0 });

    await listStrategies();

    expect(mockedApiGet).toHaveBeenCalledWith("/api/strategies", {});
  });

  it("passes include_templates param when true", async () => {
    mockedApiGet.mockResolvedValue({ strategies: [], count: 0 });

    await listStrategies(true);

    expect(mockedApiGet).toHaveBeenCalledWith("/api/strategies", { include_templates: "true" });
  });

  it("passes strategy_type param when provided", async () => {
    mockedApiGet.mockResolvedValue({ strategies: [], count: 0 });

    await listStrategies(false, "orb");

    expect(mockedApiGet).toHaveBeenCalledWith("/api/strategies", { strategy_type: "orb" });
  });

  it("passes both params when both are provided", async () => {
    mockedApiGet.mockResolvedValue({ strategies: [], count: 0 });

    await listStrategies(true, "breakout");

    expect(mockedApiGet).toHaveBeenCalledWith("/api/strategies", {
      include_templates: "true",
      strategy_type: "breakout",
    });
  });

  it("returns strategies and count from API", async () => {
    const response = { strategies: [{ id: 1 }], count: 1 };
    mockedApiGet.mockResolvedValue(response);

    const result = await listStrategies();

    expect(result).toEqual(response);
  });
});

describe("listTemplates", () => {
  it("calls apiGet with templates endpoint", async () => {
    mockedApiGet.mockResolvedValue({ templates: [], count: 0 });

    await listTemplates();

    expect(mockedApiGet).toHaveBeenCalledWith("/api/strategies/templates");
  });

  it("returns templates and count", async () => {
    const response = { templates: [{ id: 1, name: "ORB" }], count: 1 };
    mockedApiGet.mockResolvedValue(response);

    const result = await listTemplates();

    expect(result).toEqual(response);
  });
});

describe("getStrategy", () => {
  it("calls apiGet with strategy ID in path", async () => {
    mockedApiGet.mockResolvedValue({ strategy: {}, variations: [] });

    await getStrategy(42);

    expect(mockedApiGet).toHaveBeenCalledWith("/api/strategies/42");
  });

  it("returns strategy and variations", async () => {
    const response = { strategy: { id: 42 }, variations: [{ id: 43 }] };
    mockedApiGet.mockResolvedValue(response);

    const result = await getStrategy(42);

    expect(result).toEqual(response);
  });
});

describe("createStrategy", () => {
  it("calls apiPost with base endpoint and data", async () => {
    mockedApiPost.mockResolvedValue({ status: "ok", message: "Created", strategy: {} });

    const data = { name: "Test Strategy", type: "orb" };
    await createStrategy(data as any);

    expect(mockedApiPost).toHaveBeenCalledWith("/api/strategies", data);
  });

  it("returns created strategy", async () => {
    const response = { status: "ok", message: "Created", strategy: { id: 1 } };
    mockedApiPost.mockResolvedValue(response);

    const result = await createStrategy({} as any);

    expect(result).toEqual(response);
  });
});

describe("updateStrategy", () => {
  it("calls apiPut with strategy ID in path and data", async () => {
    mockedApiPut.mockResolvedValue({ status: "ok", message: "Updated", strategy: {} });

    const data = { name: "Updated Strategy" };
    await updateStrategy(42, data as any);

    expect(mockedApiPut).toHaveBeenCalledWith("/api/strategies/42", data);
  });

  it("returns updated strategy", async () => {
    const response = { status: "ok", message: "Updated", strategy: { id: 42 } };
    mockedApiPut.mockResolvedValue(response);

    const result = await updateStrategy(42, {} as any);

    expect(result).toEqual(response);
  });
});

describe("deleteStrategy", () => {
  it("calls apiDelete with strategy ID in path", async () => {
    mockedApiDelete.mockResolvedValue({ status: "ok", message: "Deleted" });

    await deleteStrategy(42);

    expect(mockedApiDelete).toHaveBeenCalledWith("/api/strategies/42");
  });

  it("returns status and message", async () => {
    const response = { status: "ok", message: "Deleted" };
    mockedApiDelete.mockResolvedValue(response);

    const result = await deleteStrategy(42);

    expect(result).toEqual(response);
  });
});

describe("getStrategyPerformance", () => {
  it("calls apiGet with performance endpoint", async () => {
    mockedApiGet.mockResolvedValue({ total_pnl: 5000 });

    await getStrategyPerformance(42);

    expect(mockedApiGet).toHaveBeenCalledWith("/api/strategies/42/performance");
  });
});

describe("getStrategyTrades", () => {
  it("calls apiGet with default limit", async () => {
    mockedApiGet.mockResolvedValue({
      strategy_id: 42,
      strategy_name: "Test",
      trades: [],
      total: 0,
    });

    await getStrategyTrades(42);

    expect(mockedApiGet).toHaveBeenCalledWith("/api/strategies/42/trades", { limit: 50 });
  });

  it("passes custom limit parameter", async () => {
    mockedApiGet.mockResolvedValue({
      strategy_id: 42,
      strategy_name: "Test",
      trades: [],
      total: 0,
    });

    await getStrategyTrades(42, 100);

    expect(mockedApiGet).toHaveBeenCalledWith("/api/strategies/42/trades", { limit: 100 });
  });
});

describe("getStrategyVariations", () => {
  it("calls apiGet with variations endpoint", async () => {
    mockedApiGet.mockResolvedValue({ parent: {}, variations: [], count: 0 });

    await getStrategyVariations(42);

    expect(mockedApiGet).toHaveBeenCalledWith("/api/strategies/42/variations");
  });
});

describe("listBots", () => {
  it("calls apiGet with bots endpoint", async () => {
    mockedApiGet.mockResolvedValue({ bots: [], count: 0 });

    await listBots();

    expect(mockedApiGet).toHaveBeenCalledWith("/api/strategies/bots");
  });
});

describe("getBot", () => {
  it("calls apiGet with bot ID in path", async () => {
    mockedApiGet.mockResolvedValue({ bot: { id: "bot-1" } });

    await getBot("bot-1");

    expect(mockedApiGet).toHaveBeenCalledWith("/api/strategies/bots/bot-1");
  });
});
